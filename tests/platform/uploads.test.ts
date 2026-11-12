import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { platformHarness } from './http-support.js';

const bytes = Buffer.from('valid upload');
const ref = { path: 'docs/note.txt', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
const request = { manifestDigest: 'a'.repeat(64), files: [ref] };
describe('T05 real Nest upload sessions', () => {
  it('completes real multipart HTTP uploads only with exact parts and keeps client ownership', async () => {
    const h = await platformHarness();
    try {
      const owner = await h.token();
      const content = Buffer.alloc(11 * 1024 ** 2, 65);
      const reference = { path: 'assets/data.bin', sha256: createHash('sha256').update(content).digest('hex'), bytes: content.length };
      const created = await h.request('/v1/uploads', { manifestDigest: 'a'.repeat(64), files: [reference] }, owner);
      expect(created.status).toBe(201);
      const plan = await created.json(); const file = plan.files[0]; const parts = [];
      const completePath = `/v1/uploads/${plan.uploadSessionId}/complete`;
      expect((await h.request(completePath, { parts: [] }, await h.token('alice', ['publisher'], 'cli'))).status).toBe(404);
      for (const part of file.multipart.parts) {
        const offset = (part.partNumber - 1) * file.multipart.partSize;
        const response = await fetch(part.uploadUrl, { method: 'PUT', body: content.subarray(offset, offset + file.multipart.partSize) });
        expect(response.status).toBe(200);
        parts.push({ path: file.path, partNumber: part.partNumber, etag: response.headers.get('etag')! });
      }
      expect((await h.request(completePath, { parts: parts.slice(1) }, owner)).status).toBe(409);
      expect((await h.request(completePath, { parts: parts.map((part, i) => i ? part : { ...part, etag: '"wrong"' }) }, owner)).status).toBe(409);
      expect((await h.request(completePath, { parts: [...parts, parts[0]] }, owner)).status).toBe(409);
      expect((await h.request(completePath, { parts }, owner)).status).toBe(200);
      const frozen = (await h.db.query('SELECT frozen_key FROM upload_files WHERE session_id=$1', [plan.uploadSessionId])).rows[0]!;
      expect(Buffer.from(await h.store.read(frozen.frozen_key, content.length))).toEqual(content);
    } finally { await h.close(); }
  });
  it('rejects concurrent completion and fences an expired old attempt after another attempt completes', async () => {
    const h = await platformHarness();
    let unblock: () => void = () => {};
    try {
      const owner = await h.token(); const plan = await (await h.request('/v1/uploads', request, owner)).json();
      await fetch(plan.files[0].uploadUrl, { method: 'PUT', body: bytes });
      const store = h.platform().store!; const originalRead = store.read.bind(store);
      let enter: () => void = () => {};
      const entered = new Promise<void>(resolve => { enter = resolve; });
      const blocked = new Promise<void>(resolve => { unblock = resolve; });
      vi.spyOn(store, 'read').mockImplementationOnce(async (...args) => { const value = await originalRead(...args); enter(); await blocked; return value; });
      const path = `/v1/uploads/${plan.uploadSessionId}/complete`;
      const old = h.request(path, { parts: [] }, owner);
      await entered;
      expect((await h.request(path, { parts: [] }, owner)).status).toBe(409);
      await h.db.query("UPDATE upload_sessions SET lease_until=now()-interval '1 second' WHERE id=$1", [plan.uploadSessionId]);
      expect((await h.request(path, { parts: [] }, owner)).status).toBe(200);
      const currentKey = (await h.db.query('SELECT frozen_key FROM upload_files WHERE session_id=$1', [plan.uploadSessionId])).rows[0]!.frozen_key;
      unblock();
      const response = await old; expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'LEASE_LOST' });
      expect((await h.db.query('SELECT state,fence FROM upload_sessions WHERE id=$1', [plan.uploadSessionId])).rows[0]).toMatchObject({ state: 'COMPLETE', fence: '2' });
      expect((await h.db.query('SELECT frozen_key FROM upload_files WHERE session_id=$1', [plan.uploadSessionId])).rows[0]!.frozen_key).toBe(currentKey);
      expect((await h.db.query("SELECT count(*) FROM audit_events WHERE event='UPLOAD_VERIFIED'")).rows[0]!.count).toBe('1');
    } finally { unblock(); vi.restoreAllMocks(); await h.close(); }
  });
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
