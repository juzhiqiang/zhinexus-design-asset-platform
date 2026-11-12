import { describe, expect, it } from 'vitest';
import { ReleaseLeases } from '../../apps/api/dist/releases/leases.js';
import { createValidBundle } from '../fixtures/t05-artifacts.js';
import { platformHarness, grant, upload, release } from './http-support.js';

describe('T06 real PostgreSQL leases', () => {
  it('allows one claimant, fences expired workers and preserves the checkpoint on restart', async () => {
    const h = await platformHarness();
    try {
      await grant(h); const token = await h.token();
      const accepted = await release(h, await upload(h, await createValidBundle(), token), token);
      const { jobId } = await accepted.json();
      const leases = new ReleaseLeases(h.db);
      const claimed = await Promise.all([leases.claim(jobId), leases.claim(jobId)]);
      expect(claimed.filter(Boolean)).toHaveLength(1);
      const first = claimed.find(Boolean)!;
      expect(first).toMatchObject({ id: jobId, stage: 'FINALIZE_OBJECTS', attempt: 1 });
      await leases.checkpoint(first, 'ENSURE_PACKAGES');
      await leases.renew(first);
      await h.db.query("UPDATE release_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [jobId]);
      await expect(leases.renew(first)).rejects.toMatchObject({ code: 'LEASE_LOST' });
      const second = (await new ReleaseLeases(h.db).claim(jobId))!;
      expect(second.stage).toBe('ENSURE_PACKAGES');
      expect(BigInt(second.fencing_token)).toBeGreaterThan(BigInt(first.fencing_token));
      await expect(leases.checkpoint(first, 'READY_TX')).rejects.toMatchObject({ code: 'LEASE_LOST' });
      await expect(leases.fail(first, 'INFRA_UNAVAILABLE')).rejects.toMatchObject({ code: 'LEASE_LOST' });
      expect((await h.db.query('SELECT state,stage FROM release_jobs WHERE id=$1', [jobId])).rows[0]).toEqual({ state: 'PUBLISHING', stage: 'ENSURE_PACKAGES' });
    } finally { await h.close(); }
  });

  it('backs off five retries, stops automatically, and resets only the retry budget on explicit retry', async () => {
    const h = await platformHarness();
    try {
      await grant(h); const token = await h.token();
      const { jobId } = await (await release(h, await upload(h, await createValidBundle(), token), token)).json();
      const leases = new ReleaseLeases(h.db);
      for (let i = 0; i < 6; i++) {
        const current = (await leases.claim(jobId))!;
        expect(current).toBeDefined();
        await leases.checkpoint(current, 'CHECK_AVAILABILITY');
        await leases.fail(current, 'INFRA_UNAVAILABLE', ['preview/missing.js']);
        const row = (await h.db.query('SELECT state,next_attempt_at,retry_count FROM release_jobs WHERE id=$1', [jobId])).rows[0]!;
        expect(row.state).toBe('RETRY_WAIT');
        expect(row.retry_count).toBe(i + 1);
        expect(await leases.claim(jobId)).toBeUndefined();
        if (i < 5) {
          expect(row.next_attempt_at).toBeInstanceOf(Date);
          await h.db.query("UPDATE release_jobs SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1", [jobId]);
        } else expect(row.next_attempt_at).toBeNull();
      }
      const status = await h.request(`/v1/releases/${jobId}`, undefined, token, 'GET');
      expect(await status.json()).toMatchObject({ missingArtifacts: ['preview/missing.js'], lastError: { code: 'INFRA_UNAVAILABLE' } });
      expect((await h.request(`/v1/releases/${jobId}/retry`, {}, token)).status).toBe(202);
      const resumed = (await leases.claim(jobId))!;
      expect(resumed.stage).toBe('CHECK_AVAILABILITY');
      expect(resumed.attempt).toBe(7);
      expect(resumed.retry_count).toBe(0);
    } finally { await h.close(); }
  });
});
