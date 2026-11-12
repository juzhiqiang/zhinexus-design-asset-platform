import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createValidBundle } from '../fixtures/t05-artifacts.js';
import { platformHarness, grant, upload, release } from './http-support.js';

describe('T05 concealed ownership denial audit', () => {
  it('audits upload owner/client denials without auditing nonexistent IDs', async () => {
    const h = await platformHarness();
    try {
      const token = await h.token(); const fixture = await createValidBundle();
      const body = await upload(h, fixture, token);
      for (const deniedToken of [await h.token('mallory'), await h.token('alice', ['publisher'], 'cli')]) {
        const response = await h.request(`/v1/uploads/${body.uploadSessionId}/complete`, { parts: [] }, deniedToken);
        expect(response.status).toBe(404); const error = await response.json();
        expect(error).toEqual({ code: 'NOT_FOUND', message: 'NOT_FOUND', details: [], requestId: expect.any(String) });
        expect((await h.db.query("SELECT subject,data FROM audit_events WHERE request_id=$1 AND event='AUTH_DENIED'", [error.requestId])).rows)
          .toEqual([{ subject: expect.any(String), data: { code: 'FORBIDDEN' } }]);
      }
      const missing = await h.request(`/v1/uploads/${randomUUID()}/complete`, { parts: [] }, token);
      expect(missing.status).toBe(404); const error = await missing.json();
      expect((await h.db.query("SELECT id FROM audit_events WHERE request_id=$1 AND event='AUTH_DENIED'", [error.requestId])).rowCount).toBe(0);
    } finally { await h.close(); }
  });

  it('audits hidden release reads for other users and unscoped maintainers without auditing missing jobs', async () => {
    const h = await platformHarness();
    try {
      await grant(h); const token = await h.token(); const fixture = await createValidBundle();
      const created = await release(h, await upload(h, fixture, token), token); expect(created.status).toBe(202);
      const { jobId } = await created.json();
      for (const roles of [['reader'], ['maintainer']]) {
        const response = await h.request(`/v1/releases/${jobId}`, undefined, await h.token('mallory', roles), 'GET');
        expect(response.status).toBe(404); const error = await response.json();
        expect((await h.db.query("SELECT subject,data FROM audit_events WHERE request_id=$1 AND event='AUTH_DENIED'", [error.requestId])).rows)
          .toEqual([{ subject: 'mallory', data: { code: 'FORBIDDEN' } }]);
      }
      const missing = await h.request(`/v1/releases/${randomUUID()}`, undefined, token, 'GET');
      expect(missing.status).toBe(404); const error = await missing.json();
      expect((await h.db.query("SELECT id FROM audit_events WHERE request_id=$1 AND event='AUTH_DENIED'", [error.requestId])).rowCount).toBe(0);
    } finally { await h.close(); }
  });
});
