import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createValidBundle, packageBytes, replaceBundleArtifact } from '../fixtures/t05-artifacts.js';
import { platformHarness, grant, upload, release } from './http-support.js';

describe('T05 persistent release HTTP', () => {
  it('requires component and package ownership before atomically registering PENDING; survives restart and deduplicates concurrent retries', async () => {
    const h = await platformHarness();
    try {
      const token = await h.token(); const fixture = await createValidBundle(); const body = await upload(h, fixture, token);
      expect((await release(h, body, token)).status).toBe(403);
      await grant(h);
      await h.db.query("DELETE FROM package_permissions WHERE subject='alice' AND package_name='@company/charts-react'");
      expect((await release(h, body, token)).status).toBe(403);
      await grant(h);
      const key = randomUUID();
      const responses = await Promise.all([release(h, body, token, key), release(h, body, token, key)]);
      expect(responses.map(r => r.status)).toEqual([202, 202]);
      const results = await Promise.all(responses.map(r => r.json()));
      expect(results[0]).toEqual(results[1]); expect(results[0]).toMatchObject({ state: 'PENDING' });
      const jobId = results[0].jobId;
      expect((await h.db.query('SELECT count(*) FROM release_jobs')).rows[0]!.count).toBe('1');
      expect((await h.db.query('SELECT count(*) FROM package_releases')).rows[0]!.count).toBe('2');
      expect((await h.db.query('SELECT count(*) FROM variant_releases')).rows[0]!.count).toBe('3');
      await h.restart();
      const status = await h.request(`/v1/releases/${jobId}`, undefined, token, 'GET');
      expect(await status.json()).toEqual({ state: 'PENDING', stage: 'PENDING', attempt: 0, missingArtifacts: [], pollAfterMs: 2000, baselineCandidates: [] });
      expect((await h.request(`/v1/releases/${jobId}`, undefined, await h.token('mallory'), 'GET')).status).toBe(404);
      expect((await h.request(`/v1/releases/${jobId}/retry`, {}, token)).status).toBe(409);
      const another = await upload(h, fixture, token);
      expect((await release(h, another, token, key)).status).toBe(409);
      expect((await h.db.query("SELECT count(*) FROM variant_releases WHERE availability='Ready'")).rows[0]!.count).toBe('0');
      expect((await h.db.query("SELECT count(*) FROM audit_events WHERE event='RELEASE_CREATED'")).rows[0]!.count).toBe('1');
    } finally { await h.close(); }
  });
  it('fails closed for source spoofing, manifest mutation and same package version with different bytes without partial rows', async () => {
    const h = await platformHarness();
    try {
      await grant(h); const token = await h.token();
      const manual = await createValidBundle(); const wrongDigest = await upload(h, manual, token, 'a'.repeat(64));
      const digestFailure = await release(h, wrongDigest, token);
      expect(digestFailure.status).toBe(400); expect(await digestFailure.json()).toMatchObject({ code: 'DIGEST_MISMATCH' });
      const spoof = await upload(h, await createValidBundle('cli'), token);
      const sourceFailure = await release(h, spoof, token);
      expect(sourceFailure.status).toBe(400); expect(await sourceFailure.json()).toMatchObject({ code: 'SOURCE_FORBIDDEN' });
      const first = await upload(h, manual, token); expect((await release(h, first, token)).status).toBe(202);
      replaceBundleArtifact(manual, manual.manifest.packages[0]!.tarball.path, await packageBytes(manual, 0, { description: 'different frozen package' }));
      expect((await release(h, await upload(h, manual, token), token)).status).toBe(409);
      expect((await h.db.query('SELECT count(*) FROM release_jobs')).rows[0]!.count).toBe('1');
      expect((await h.db.query('SELECT count(*) FROM screenshots')).rows[0]!.count).toBe('3');
    } finally { await h.close(); }
  });
});
