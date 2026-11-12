import type { PackageRef } from '@company/contracts';
import type { Database } from '../db/database.js';
import { audit } from '../db/access.js';
import type { RegistryClient } from './registry-client.js';

/** Mutable npm tags are a separate, durable, per-package serialized reconciliation step. */
export class ReleaseTags {
  constructor(private readonly db: Database, private readonly registry: RegistryClient) {}
  async runOnce(): Promise<boolean> {
    const candidates = await this.db.query(`SELECT name FROM release_tags
      WHERE generation>applied_generation AND next_attempt_at<=clock_timestamp() ORDER BY updated_at,name LIMIT 20`);
    for (const { name } of candidates.rows) {
      const sql = await this.db.pool.connect(); let locked = false;
      const lock = `release-tag:${name}`;
      try {
        locked = (await sql.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [lock])).rows[0].locked as boolean;
        if (!locked) continue;
        // Session advisory lock, never a row lock/transaction across network I/O.
        // Re-read the desired version after each write; an older retry cannot complete newer work.
        for (let turn = 0; turn < 3; turn++) {
          const target = (await sql.query(`SELECT t.generation,t.applied_generation,p.metadata FROM release_tags t
            JOIN package_releases p ON p.id=t.package_release_id WHERE t.name=$1 AND p.state='READY'`, [name])).rows[0];
          if (!target || target.generation === target.applied_generation) break;
          try {
            await this.registry.promote(target.metadata as PackageRef);
            const saved = await sql.query(`UPDATE release_tags SET applied_generation=$2,last_error=NULL,attempt=attempt+1,
              updated_at=clock_timestamp() WHERE name=$1 AND generation=$2 RETURNING name`, [name, target.generation]);
            if (saved.rowCount) { await audit(sql, undefined, 'RELEASE_TAG_APPLIED', name, { generation: target.generation }); break; }
          } catch {
            await sql.query(`UPDATE release_tags SET attempt=attempt+1,last_error='INFRA_UNAVAILABLE',
              next_attempt_at=clock_timestamp()+interval '5 seconds' WHERE name=$1 AND generation=$2`, [name, target.generation]);
            break;
          }
        }
        return true;
      } finally {
        if (locked) await sql.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lock]).catch(() => {});
        sql.release();
      }
    }
    return false;
  }
}
