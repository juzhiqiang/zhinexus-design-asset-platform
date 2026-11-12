import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Database } from './database.js';

const tables = ['release_tags', 'release_outbox', 'release_artifacts', 'baseline_heads', 'baseline_revisions', 'screenshots', 'check_reports', 'variant_releases', 'package_releases', 'release_jobs', 'upload_files', 'upload_sessions', 'variants', 'component_permissions', 'package_permissions', 'audit_events', 'components'] as const;
export async function migrateRegistry(db: Database): Promise<void> {
  const migrations = await Promise.all(['001_registry.sql', '002_package_permissions.sql', '003_evidence_references.sql', '004_release_worker.sql', '005_catalog.sql'].map(async (file, i) => {
    const sql = await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');
    return { version: i + 1, sql, digest: createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex') };
  }));
  await db.transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(75605001)');
    await client.query('CREATE TABLE IF NOT EXISTS registry_migrations(version integer PRIMARY KEY, sha256 text NOT NULL)');
    for (const { version, sql, digest } of migrations) {
      const prior = await client.query('SELECT sha256 FROM registry_migrations WHERE version=$1', [version]);
      if (prior.rowCount) {
        if (prior.rows[0].sha256 !== digest) throw new Error('Migration checksum changed; do not rewrite applied migrations');
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO registry_migrations VALUES ($1,$2)', [version, digest]);
    }
  });
}
/** Development migration roundtrip only; refuses any registry that contains business data. */
export async function rollbackEmptyRegistry(db: Database): Promise<void> {
  await db.transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(75605001)');
    await client.query(`LOCK TABLE ${tables.join(',')},disabled_subjects IN ACCESS EXCLUSIVE MODE`);
    if ((await client.query('SELECT 1 FROM disabled_subjects LIMIT 1')).rowCount) throw new Error('Refusing rollback of non-empty registry');
    for (const table of tables) {
      if ((await client.query(`SELECT 1 FROM ${table} LIMIT 1`)).rowCount) throw new Error('Refusing rollback of non-empty registry');
    }
    await client.query('DROP FUNCTION catalog_can_read(text,text)');
    await client.query(`DROP TABLE ${tables.join(',')},disabled_subjects,registry_migrations`);
    await client.query('DROP FUNCTION reject_immutable_change()');
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const connectionString = process.env.PLATFORM_DATABASE_URL;
  if (!connectionString) { console.error('PLATFORM_DATABASE_URL is required'); process.exitCode = 1; }
  else {
    const db = new Database(connectionString);
    try { await migrateRegistry(db); console.log('Registry migration applied.'); }
    catch { console.error('Registry migration failed; no credential details printed.'); process.exitCode = 1; }
    finally { await db.close(); }
  }
}
