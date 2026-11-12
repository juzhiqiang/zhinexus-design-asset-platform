import { describe, expect, it } from 'vitest';
import { createValidBundle } from '../fixtures/t05-artifacts.js';
import { platformHarness, grant, upload, release } from './http-support.js';

describe('T05 baseline and deprecation HTTP', () => {
  it('requires role and component scope, rejects manual evidence, CAS updates append-only history independently of Ready', async () => {
    const h = await platformHarness();
    try {
      await grant(h, 'alice', true);
      const cli = await h.token('alice', ['maintainer'], 'cli');
      const fixture = await createValidBundle('cli');
      expect((await release(h, await upload(h, fixture, cli), cli)).status).toBe(202);
      const variant = fixture.manifest.variants[0]!; const shot = variant.screenshots[0]!;
      const body = { variantId: variant.variantId, exampleId: shot.exampleId, environmentKey: shot.environmentKey, screenshotId: shot.id, reason: '接受经过本地验证的候选图' };
      expect((await h.request('/v1/baselines', body, await h.token('alice', ['publisher'], 'cli'))).status).toBe(403);
      expect((await h.request('/v1/baselines', body, await h.token('mallory', ['maintainer'], 'cli'))).status).toBe(403);
      expect((await h.request('/v1/baselines', { ...body, screenshotId: fixture.manifest.variants[1]!.screenshots[0]!.id }, cli)).status).toBe(404);
      expect((await h.request('/v1/baselines', { ...body, environmentKey: 'a'.repeat(64) }, cli)).status).toBe(400);
      const first = await h.request('/v1/baselines', body, cli);
      expect(first.status).toBe(201); const { revisionId } = await first.json();
      const responses = await Promise.all([h.request('/v1/baselines', { ...body, expectedRevision: revisionId, reason: '复核一' }, cli), h.request('/v1/baselines', { ...body, expectedRevision: revisionId, reason: '复核二' }, cli)]);
      expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
      expect((await h.request('/v1/baselines', body, cli)).status).toBe(409);
      expect((await h.db.query('SELECT count(*) FROM baseline_revisions')).rows[0]!.count).toBe('2');
      await expect(h.db.query('DELETE FROM baseline_revisions WHERE id=$1', [revisionId])).rejects.toMatchObject({ code: '42501' });
      expect((await h.db.query("SELECT count(*) FROM audit_events WHERE event='BASELINE_ACCEPTED'")).rows[0]!.count).toBe('2');
      const variantRelease = (await h.db.query('SELECT id,availability FROM variant_releases WHERE variant_id=$1', [variant.variantId])).rows[0]!;
      expect(variantRelease.availability).toBe('PENDING');
      expect((await h.request(`/v1/variant-releases/${variantRelease.id}/deprecate`, { reason: '弃用' }, cli)).status).toBe(409);
      // Seed the downstream T06 result solely to exercise T05's Ready-only maintenance transition.
      await h.db.query("UPDATE variant_releases SET availability='Ready' WHERE id=$1", [variantRelease.id]);
      expect((await h.request(`/v1/variant-releases/${variantRelease.id}/deprecate`, { reason: '新版替代' }, cli)).status).toBe(200);
      expect((await h.db.query('SELECT availability FROM variant_releases WHERE id=$1', [variantRelease.id])).rows[0]!.availability).toBe('DEPRECATED');
      expect((await h.db.query("SELECT count(*) FROM audit_events WHERE event='VARIANT_DEPRECATED'")).rows[0]!.count).toBe('1');
    } finally { await h.close(); }
  });
  it('does not promote manually uploaded screenshots into automatic baselines', async () => {
    const h = await platformHarness();
    try {
      await grant(h, 'alice', true); const token = await h.token('alice', ['maintainer']);
      const fixture = await createValidBundle(); expect((await release(h, await upload(h, fixture, token), token)).status).toBe(202);
      const variant = fixture.manifest.variants[0]!; const shot = variant.screenshots[0]!;
      const response = await h.request('/v1/baselines', { variantId: variant.variantId, exampleId: shot.exampleId, environmentKey: 'a'.repeat(64), screenshotId: shot.id, reason: '手动图' }, token);
      expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ code: 'SOURCE_FORBIDDEN' });
      expect((await h.db.query('SELECT count(*) FROM baseline_revisions')).rows[0]!.count).toBe('0');
    } finally { await h.close(); }
  });
});
