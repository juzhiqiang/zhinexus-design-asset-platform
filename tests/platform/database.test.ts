import { describe, expect, it } from 'vitest';
import { Database } from '../../apps/api/dist/db/database.js';
import { migrateRegistry, rollbackEmptyRegistry } from '../../apps/api/dist/db/migrate.js';
import { isolatedDatabase } from './support.js';

describe('T05 real PostgreSQL migration and invariants', () => {
  it('roundtrips an empty schema, enforces uniqueness and makes audit/revisions append-only', async () => {
    const isolated = await isolatedDatabase();
    const db = new Database(isolated.url);
    try {
      await migrateRegistry(db);
      await migrateRegistry(db);
      await rollbackEmptyRegistry(db);
      expect((await db.query("SELECT to_regclass('components') AS name")).rows[0].name).toBeNull();
      await migrateRegistry(db);
      await db.query("INSERT INTO components(id) VALUES ('line')");
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
