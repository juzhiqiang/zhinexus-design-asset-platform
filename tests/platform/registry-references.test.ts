import { describe, expect, it } from 'vitest';
import { validateApiMessage, type ApiMessages } from '@company/contracts';
import { createValidBundle, packageBytes, replaceBundleArtifact } from '../fixtures/t05-artifacts.js';
import { platformHarness, grant, upload, release } from './http-support.js';

async function nextBundle() {
  const fixture = await createValidBundle('cli');
  for (const pkg of fixture.manifest.packages) pkg.version = '0.0.2';
  for (const variant of fixture.manifest.variants) {
    variant.packageVersion = '0.0.2';
    for (const shot of variant.screenshots) shot.packageVersion = '0.0.2';
  }
  for (const [index, pkg] of fixture.manifest.packages.entries()) replaceBundleArtifact(fixture, pkg.tarball.path, await packageBytes(fixture, index));
  return fixture;
}

describe('T05 bundle-scoped evidence references', () => {
  it('registers a new package version reusing original screenshot/report IDs without altering frozen evidence', async () => {
    const h = await platformHarness();
    try {
      await grant(h, 'alice', true); const token = await h.token('alice', ['maintainer'], 'cli');
      const first = await createValidBundle('cli'); const next = await nextBundle();
      expect((await release(h, await upload(h, first, token), token)).status).toBe(202);
      const created = await release(h, await upload(h, next, token), token);
      expect(created.status, JSON.stringify(await created.clone().json())).toBe(202);
      expect((await h.db.query('SELECT count(*) FROM release_jobs')).rows[0]!.count).toBe('2');
      expect((await h.db.query('SELECT count(DISTINCT id) FROM screenshots')).rows[0]!.count).toBe('6');
      expect((await h.db.query('SELECT count(DISTINCT id) FROM check_reports')).rows[0]!.count).toBe('6');
      const { jobId } = await created.json();
      expect((await h.db.query('SELECT manifest FROM release_jobs WHERE id=$1', [jobId])).rows[0]!.manifest).toEqual(next.manifest);
      expect((await h.db.query('SELECT content FROM check_reports WHERE job_id=$1 ORDER BY client_ref', [jobId])).rows.map(row => row.content))
        .toEqual(Object.values(next.reports).sort((a, b) => a.id.localeCompare(b.id)));
    } finally { await h.close(); }
  });

  it('exposes unique server candidates and rejects ambiguous legacy references while accepting explicit server IDs', async () => {
    const h = await platformHarness();
    try {
      await grant(h, 'alice', true); const token = await h.token('alice', ['maintainer'], 'cli');
      const fixture = await createValidBundle('cli');
      const created = await release(h, await upload(h, fixture, token), token); expect(created.status).toBe(202);
      const { jobId } = await created.json();
      const status: ApiMessages['releaseJobResponse'] = await (await h.request(`/v1/releases/${jobId}`, undefined, token, 'GET')).json();
      expect(validateApiMessage('releaseJobResponse', status).ok).toBe(true);
      expect(status.baselineCandidates).toHaveLength(3);
      const variant = fixture.manifest.variants[0]!; const shot = variant.screenshots[0]!;
      const candidate = status.baselineCandidates!.find(item => item.sourceScreenshotId === shot.id)!;
      expect(candidate).toEqual({ screenshotId: expect.any(String), sourceScreenshotId: shot.id, variantId: variant.variantId, exampleId: shot.exampleId, environmentKey: shot.environmentKey });
      expect(candidate.screenshotId).toMatch(/^[a-f0-9-]{36}$/); expect(candidate.screenshotId).not.toBe(shot.id);
      const body = { variantId: variant.variantId, exampleId: shot.exampleId, environmentKey: shot.environmentKey, screenshotId: shot.id, reason: '登记原始引用' };
      const accepted = await h.request('/v1/baselines', body, token); expect(accepted.status).toBe(201);
      const { revisionId } = await accepted.json();
      const nextCreated = await release(h, await upload(h, await nextBundle(), token), token); expect(nextCreated.status).toBe(202);
      const nextId = (await nextCreated.json()).jobId;
      const nextStatus: ApiMessages['releaseJobResponse'] = await (await h.request(`/v1/releases/${nextId}`, undefined, token, 'GET')).json();
      const nextCandidate = nextStatus.baselineCandidates!.find(item => item.sourceScreenshotId === shot.id)!;
      expect(nextCandidate.screenshotId).not.toBe(candidate.screenshotId);
      const ambiguous = await h.request('/v1/baselines', { ...body, expectedRevision: revisionId }, token);
      expect(ambiguous.status).toBe(409); expect(await ambiguous.json()).toMatchObject({ code: 'CONFLICT' });
      const exact = await h.request('/v1/baselines', { ...body, screenshotId: nextCandidate.screenshotId, expectedRevision: revisionId }, token);
      expect(exact.status, JSON.stringify(await exact.clone().json())).toBe(201);
      const newRevision = (await exact.json()).revisionId;
      expect((await h.db.query('SELECT screenshot_id FROM baseline_revisions WHERE id=$1', [newRevision])).rows[0]!.screenshot_id).toBe(nextCandidate.screenshotId);
      const wrongVariant = status.baselineCandidates!.find(item => item.variantId !== variant.variantId)!;
      expect((await h.request('/v1/baselines', { ...body, screenshotId: wrongVariant.screenshotId }, token)).status).toBe(400);
    } finally { await h.close(); }
  });
});
