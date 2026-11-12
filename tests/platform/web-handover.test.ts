import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { validateApiMessage } from '@company/contracts';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { createValidBundle } from '../fixtures/t05-artifacts.js';
import { grant, platformHarness, release, upload } from './http-support.js';
import { realRegistry, workerHarness } from './t06-support.js';

it('hands web clients a durable idempotent manual release and exact public/private material endpoints', async () => {
  const h = await workerHarness();
  try {
    const body = { uploadSessionId: h.uploadSessionId, manifest: h.fixture.manifest };
    const key = (await h.db.query('SELECT idempotency_key FROM release_jobs WHERE id=$1', [h.jobId])).rows[0]!.idempotency_key as string;
    // Clients must persist their original key; another key cannot reserve a package again.
    expect((await release(h, body, h.auth, randomUUID())).status).toBe(409);
    const original = await release(h, body, h.auth, key);
    expect(original.status).toBe(202);
    expect((await original.json()).jobId).toBe(h.jobId);
    await h.restart();
    const repeated = await release(h, body, h.auth, key);
    expect(repeated.status).toBe(202);
    expect((await repeated.json()).jobId).toBe(h.jobId);
    await new ReleaseWorker(h.db, h.store, await realRegistry()).runOnce(h.jobId);
    const status = await h.request(`/v1/releases/${h.jobId}`, undefined, h.auth, 'GET');
    expect(await status.json()).toMatchObject({ state: 'READY', baselineCandidates: [] });
    expect((await h.db.query('SELECT count(*) FROM baseline_heads')).rows[0]!.count).toBe('0');
    expect((await h.db.query('SELECT count(*) FROM check_reports')).rows[0]!.count).toBe('0');
    const rows = (await h.db.query('SELECT id,variant_id FROM variant_releases')).rows;
    for (const row of rows) {
      const privatePath = `/v1/me/variant-releases/${row.id}`;
      expect((await h.request(privatePath, undefined, undefined, 'GET')).status).toBe(401);
      const result = await h.request(privatePath, undefined, h.auth, 'GET');
      expect(result.status).toBe(200);
      const detail = await result.json();
      expect(validateApiMessage('variantReleaseResponse', detail).ok).toBe(true);
      expect(detail).toMatchObject({ reportSource: 'manual-upload', baselineStatus: 'unconfirmed', indexStatus: 'pending' });
      const docs = await h.request(`${privatePath}/artifacts?path=${encodeURIComponent(detail.variant.docs.path)}`, undefined, h.auth, 'GET');
      expect(docs.status).toBe(200); expect(await docs.text()).toBe('# synthetic');
      expect(await (await h.request(`${privatePath}/reports`, undefined, h.auth, 'GET')).json()).toEqual({ variantReleaseId: row.id, reports: [] });
      const publicPath = `/v1/variant-releases/${row.id}`;
      expect((await h.request(publicPath, undefined, undefined, 'GET')).status).toBe(404);
      await h.db.query('UPDATE components SET public=true WHERE id=$1', [detail.variant.componentId]);
      expect((await h.request(publicPath, undefined, undefined, 'GET')).status).toBe(200);
      await h.db.query('UPDATE components SET public=false WHERE id=$1', [detail.variant.componentId]);
      const withdrawn = await h.request(publicPath, undefined, undefined, 'GET');
      expect(withdrawn.status).toBe(404); expect(withdrawn.headers.get('cache-control')).toBe('no-store');
    }
  } finally { await h.close(); }
});

it.each(['missing-vue', 'missing-react', 'wrong-framework', 'automatic-source'] as const)(
  'rejects web %s material before creating any job or baseline', async defect => {
    const h = await platformHarness();
    try {
      await grant(h); const token = await h.token();
      const fixture = await createValidBundle(defect === 'automatic-source' ? 'cli' : 'web');
      if (defect === 'missing-vue') fixture.manifest.variants[0]!.screenshots = [];
      if (defect === 'missing-react') fixture.manifest.variants.find(v => v.framework === 'react')!.screenshots = [];
      if (defect === 'wrong-framework') fixture.manifest.variants[0]!.screenshots[0]!.framework = 'react';
      const response = await release(h, await upload(h, fixture, token), token);
      expect(response.status).toBe(400);
      const error = await response.json();
      expect(validateApiMessage('error', error).ok).toBe(true);
      expect(error.code).toBe(defect === 'automatic-source' ? 'SOURCE_FORBIDDEN' : defect === 'wrong-framework' ? 'SCREENSHOT_VARIANT_MISMATCH' : 'SCREENSHOT_REQUIRED');
      for (const table of ['release_jobs', 'screenshots', 'baseline_heads']) {
        expect((await h.db.query(`SELECT count(*) FROM ${table}`)).rows[0]!.count).toBe('0');
      }
    } finally { await h.close(); }
  },
);
