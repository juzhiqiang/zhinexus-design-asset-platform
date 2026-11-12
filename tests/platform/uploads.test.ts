import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { platformHarness } from './http-support.js';

const bytes = Buffer.from('valid upload');
const ref = { path: 'docs/note.txt', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
const request = { manifestDigest: 'a'.repeat(64), files: [ref] };
describe('T05 real Nest upload sessions', () => {
  it('fails closed for anonymous/reader, rejects unsafe lists, and audits denial', async () => {
    const h = await platformHarness();
    try {
      const anonymous = await h.request('/v1/uploads', request);
      expect(anonymous.status).toBe(401);
      expect(await anonymous.json()).toMatchObject({ code: 'UNAUTHENTICATED', requestId: expect.any(String), details: [] });
      const reader = await h.token('reader', ['reader']);
      expect((await h.request('/v1/uploads', request, reader)).status).toBe(403);
      const owner = await h.token();
      for (const files of [[ref, ref], [{ ...ref, path: '../secret' }], [{ ...ref, bytes: 51 * 1024 ** 2 }]]) {
        expect((await h.request('/v1/uploads', { ...request, files }, owner)).status).toBeGreaterThanOrEqual(400);
      }
      expect(Number((await h.db.query("SELECT count(*) FROM audit_events WHERE event='AUTH_DENIED'")).rows[0]!.count)).toBeGreaterThanOrEqual(2);
    } finally { await h.close(); }
  });
  it('binds ownership, freezes exact bytes, persists over restart and safely repeats completion', async () => {
    const h = await platformHarness();
    try {
      const owner = await h.token();
      const created = await h.request('/v1/uploads', request, owner);
      expect(created.status).toBe(201);
      const plan = await created.json();
      expect((await h.request(`/v1/uploads/${plan.uploadSessionId}/complete`, { parts: [] }, await h.token('mallory'))).status).toBe(404);
      expect((await h.request(`/v1/uploads/${plan.uploadSessionId}/complete`, { parts: [] }, owner)).status).toBe(409);
      expect((await fetch(plan.files[0].uploadUrl, { method: 'PUT', body: bytes })).status).toBe(200);
      const complete = await h.request(`/v1/uploads/${plan.uploadSessionId}/complete`, { parts: [] }, owner);
      expect(complete.status).toBe(200);
      expect(await complete.json()).toEqual({ status: 'complete', verifiedFiles: [ref] });
      await h.restart();
      expect((await h.request(`/v1/uploads/${plan.uploadSessionId}/complete`, { parts: [] }, owner)).status).toBe(200);
      const changed = Buffer.alloc(bytes.length, 42);
      expect((await fetch(plan.files[0].uploadUrl, { method: 'PUT', body: changed })).status).toBe(200);
      const file = (await h.db.query('SELECT frozen_key FROM upload_files WHERE session_id=$1', [plan.uploadSessionId])).rows[0]!;
      expect(Buffer.from(await h.store.read(file.frozen_key, ref.bytes))).toEqual(bytes);
    } finally { await h.close(); }
  });
  it('rejects wrong bytes and expired sessions without marking them complete', async () => {
    const h = await platformHarness();
    try {
      const owner = await h.token();
      const wrong = await (await h.request('/v1/uploads', request, owner)).json();
      await fetch(wrong.files[0].uploadUrl, { method: 'PUT', body: Buffer.alloc(bytes.length, 0) });
      const response = await h.request(`/v1/uploads/${wrong.uploadSessionId}/complete`, { parts: [] }, owner);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'DIGEST_MISMATCH' });
      const expired = await (await h.request('/v1/uploads', request, owner)).json();
      await h.db.query("UPDATE upload_sessions SET expires_at=now()-interval '1 minute' WHERE id=$1", [expired.uploadSessionId]);
      expect((await h.request(`/v1/uploads/${expired.uploadSessionId}/complete`, { parts: [] }, owner)).status).toBe(409);
      expect(Number((await h.db.query("SELECT count(*) FROM upload_sessions WHERE state='COMPLETE'")).rows[0]!.count)).toBe(0);
    } finally { await h.close(); }
  });
});
