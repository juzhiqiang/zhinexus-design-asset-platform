import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { Database } from '../../apps/api/dist/db/database.js';
import { migrateRegistry } from '../../apps/api/dist/db/migrate.js';
import { registryMigrationFiles } from '../../apps/api/dist/db/migration-files.js';
import { isolatedDatabase } from './support.js';

it('registers web targets as migration 14 alongside the earlier local-identity migration', async () => {
  const isolated = await isolatedDatabase();
  const db = new Database(isolated.url);
  try {
    await migrateRegistry(db);
    expect((await db.query('SELECT version FROM registry_migrations WHERE version BETWEEN 13 AND 14 ORDER BY version')).rows).toEqual([{version:13},{version:14}]);
    await expect(db.query("INSERT INTO oidc_attempts(state_hash,browser_hash,generation,candidate,verifier,nonce,expires_at,web_target) VALUES ('state','browser',0,false,'verifier','nonce',now(),'https://evil.example.com')")).rejects.toMatchObject({code:'23514'});
  } finally { await db.close(); await isolated.close(); }
});

it('applies an unrecorded earlier migration even when a later version has already been recorded', async () => {
  const isolated = await isolatedDatabase();
  const db = new Database(isolated.url);
  try {
    await db.query('CREATE TABLE registry_migrations(version integer PRIMARY KEY, sha256 text NOT NULL)');
    // Web targets are independent of account storage; leave the dependent 12/13 chain unapplied.
    for (const file of registryMigrationFiles.filter(file => !file.startsWith('012_') && !file.startsWith('013_'))) {
      const sql = await readFile(new URL(`../../apps/api/migrations/${file}`, import.meta.url), 'utf8');
      if (file.startsWith('014_')) {
        await db.query("INSERT INTO oidc_attempts(state_hash,browser_hash,generation,candidate,verifier,nonce,expires_at) VALUES ('old-gallery','browser',0,false,'verifier','nonce',now()),('old-candidate','browser',0,true,'verifier','nonce',now())");
      }
      await db.query(sql);
      await db.query('INSERT INTO registry_migrations VALUES ($1,$2)', [Number(file.slice(0,3)), createHash('sha256').update(sql.replaceAll('\r\n','\n')).digest('hex')]);
    }
    await migrateRegistry(db);
    await migrateRegistry(db);
    expect((await db.query('SELECT version FROM registry_migrations WHERE version BETWEEN 12 AND 14 ORDER BY version')).rows).toEqual([{version:12},{version:13},{version:14}]);
    expect((await db.query("SELECT to_regclass('managed_accounts') AS name")).rows[0]?.name).toBe('managed_accounts');
    expect((await db.query('SELECT state_hash,web_target FROM oidc_attempts ORDER BY state_hash')).rows).toEqual([
      {state_hash:'old-candidate',web_target:'admin'}, {state_hash:'old-gallery',web_target:'gallery'},
    ]);
  } finally { await db.close(); await isolated.close(); }
});
