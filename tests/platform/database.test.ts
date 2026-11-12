import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { Database } from '../../apps/api/dist/db/database.js';
import { migrateRegistry, rollbackEmptyRegistry } from '../../apps/api/dist/db/migrate.js';
import { isolatedDatabase } from './support.js';

describe('T05 real PostgreSQL migration and invariants', () => {
  it('upgrades existing evidence IDs while preserving report and immutable baseline foreign keys', async () => {
    const isolated = await isolatedDatabase(); const db = new Database(isolated.url);
    try {
      await db.query('CREATE TABLE registry_migrations(version integer PRIMARY KEY, sha256 text NOT NULL)');
      for (const [index, file] of ['001_registry.sql', '002_package_permissions.sql'].entries()) {
        const sql = await readFile(new URL(`../../apps/api/migrations/${file}`, import.meta.url), 'utf8');
        await db.query(sql);
        await db.query('INSERT INTO registry_migrations VALUES ($1,$2)', [index + 1, createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex')]);
      }
      const session = randomUUID(); const job = randomUUID(); const pkg = randomUUID(); const variant = randomUUID(); const revision = randomUUID(); const hash = 'a'.repeat(64);
      await db.query("INSERT INTO components(id) VALUES ('line'); INSERT INTO variants(id,component_id,framework) VALUES ('line-vue','line','vue')");
      await db.query("INSERT INTO upload_sessions(id,subject,client_id,channel,manifest_digest,state,expires_at) VALUES ($1,'alice','cli','cli',$2,'COMPLETE',now())", [session, hash]);
      await db.query("INSERT INTO release_jobs(id,subject,client_id,channel,upload_session_id,manifest_digest,manifest,idempotency_key,request_digest,state,stage) VALUES ($1,'alice','cli','cli',$2,$3,'{}','legacy',$3,'PENDING','PENDING')", [job, session, hash]);
      await db.query("INSERT INTO package_releases(id,job_id,name,version,sha256,metadata) VALUES ($1,$2,'@company/charts-vue','0.0.1',$3,'{}')", [pkg, job, hash]);
      await db.query("INSERT INTO variant_releases(id,variant_id,package_release_id,metadata) VALUES ($1,'line-vue',$2,'{}')", [variant, pkg]);
      await db.query("INSERT INTO check_reports(id,job_id,variant_id,content) VALUES ('legacy-report',$1,'line-vue','{\"id\":\"legacy-report\"}')", [job]);
      await db.query("INSERT INTO screenshots(id,variant_release_id,example_id,environment_key,source,report_id,object_key,sha256,metadata) VALUES ('legacy-shot',$1,'example',$2,'local-automatic','legacy-report','frozen/legacy',$2,'{\"id\":\"legacy-shot\"}')", [variant, hash]);
      await db.query("INSERT INTO baseline_revisions(id,variant_id,example_id,environment_key,screenshot_id,reason,subject) VALUES ($1,'line-vue','example',$2,'legacy-shot','保留已确认历史','alice')", [revision, hash]);
      await db.query("INSERT INTO baseline_heads(variant_id,example_id,environment_key,revision_id) VALUES ('line-vue','example',$1,$2)", [hash, revision]);
      await migrateRegistry(db); await migrateRegistry(db);
      const row = (await db.query(`SELECT s.id,s.client_ref,s.job_id,s.metadata,r.id AS report_id,r.client_ref AS report_ref,r.content,b.screenshot_id,b.reason,h.revision_id
        FROM screenshots s JOIN check_reports r ON r.id=s.report_id JOIN baseline_revisions b ON b.screenshot_id=s.id JOIN baseline_heads h ON h.revision_id=b.id`)).rows[0]!;
      expect(row).toMatchObject({ client_ref: 'legacy-shot', job_id: job, metadata: { id: 'legacy-shot' }, report_ref: 'legacy-report', content: { id: 'legacy-report' }, screenshot_id: row.id, reason: '保留已确认历史', revision_id: revision });
      expect(row.id).toMatch(/^[a-f0-9-]{36}$/); expect(row.report_id).toMatch(/^[a-f0-9-]{36}$/);
      await expect(db.query('UPDATE baseline_revisions SET reason=$1 WHERE id=$2', ['不能修改', revision])).rejects.toMatchObject({ code: '42501' });
      await expect(db.query('DELETE FROM screenshots WHERE id=$1', [row.id])).rejects.toMatchObject({ code: '23503' });
      await expect(db.query('DELETE FROM check_reports WHERE id=$1', [row.report_id])).rejects.toMatchObject({ code: '23503' });
      await expect(db.query("INSERT INTO check_reports(id,job_id,client_ref,variant_id,content) VALUES ($1,$2,'legacy-report','line-vue','{}')", [randomUUID(), job])).rejects.toMatchObject({ code: '23505' });
    } finally { await db.close(); await isolated.close(); }
  });
  it('roundtrips an empty schema, enforces uniqueness and makes audit/revisions append-only', async () => {
    const isolated = await isolatedDatabase();
    const db = new Database(isolated.url);
    try {
      await migrateRegistry(db);
      await migrateRegistry(db);
      await rollbackEmptyRegistry(db);
      expect((await db.query("SELECT to_regclass('components') AS name")).rows[0]!.name).toBeNull();
      await migrateRegistry(db);
      await db.query("INSERT INTO components(id) VALUES ('line')");
      await db.query("INSERT INTO package_permissions(subject,package_name) VALUES ('test-user','@company/charts-core')");
      await expect(db.query("INSERT INTO package_permissions(subject,package_name) VALUES ('test-user','@company/charts-core')")).rejects.toMatchObject({ code: '23505' });
      await expect(db.query("INSERT INTO components(id) VALUES ('line')")).rejects.toMatchObject({ code: '23505' });
      await expect(db.query("INSERT INTO variants(id,component_id,framework) VALUES ('ghost-vue','ghost','vue')")).rejects.toMatchObject({ code: '23503' });
      await db.query("INSERT INTO audit_events(subject,event,target_id,data) VALUES ('test-user','TEST','line','{}')");
      await expect(db.query("UPDATE audit_events SET event='CHANGED'")).rejects.toMatchObject({ code: '42501' });
      await expect(db.query('DELETE FROM audit_events')).rejects.toMatchObject({ code: '42501' });
      await expect(rollbackEmptyRegistry(db)).rejects.toThrow('non-empty');
      const triggers = await db.query("SELECT event_object_table FROM information_schema.triggers WHERE trigger_name='immutable_rows' GROUP BY event_object_table ORDER BY event_object_table");
      expect(triggers.rows.map(row => row.event_object_table)).toEqual(['audit_events', 'baseline_revisions']);
    } finally { await db.close(); await isolated.close(); }
  });
});
