import { it, expect } from 'vitest';
import { validateApiMessage } from '@company/contracts';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { workerHarness, realRegistry } from './t06-support.js';
it('returns only the current authorized variant reports and preserves baseline evidence independently from Ready', async () => {
  const h = await workerHarness(undefined, {}, 'cli');
  try {
    await new ReleaseWorker(h.db, h.store, await realRegistry()).runOnce(h.jobId);
    const url = '/v1/me/variants/line-vue/releases/0.0.1/reports';
    const response = await h.request(url, undefined, h.auth, 'GET');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(validateApiMessage('variantReportsResponse', body).ok).toBe(true);
    expect(body.reports).toEqual([h.fixture.reports['reports/line-vue.json']]);
    expect((await h.request('/v1/variants/line-vue/releases/0.0.1/reports', undefined, h.auth, 'GET')).status).toBe(404);
    await h.db.query('UPDATE components SET public=true');
    expect((await h.request('/v1/variants/line-vue/releases/0.0.1/reports', undefined, undefined, 'GET')).status).toBe(200);
    const shot = (await h.db.query("SELECT s.id,s.environment_key,s.example_id FROM screenshots s JOIN variant_releases v ON v.id=s.variant_release_id WHERE v.variant_id='line-vue'")).rows[0]!;
    await h.db.query("UPDATE component_permissions SET can_maintain=true WHERE subject='alice'");
    const accepted = await h.request('/v1/baselines', { variantId: 'line-vue', exampleId: shot.example_id, environmentKey: shot.environment_key, screenshotId: shot.id, reason: '本地协议测试基线' }, await h.token('alice', ['maintainer'], 'cli'));
    expect(accepted.status).toBe(201);
    const detail = await (await h.request('/v1/variants/line-vue/releases/0.0.1', undefined, undefined, 'GET')).json();
    expect(detail).toMatchObject({ availability: 'Ready', reportSource: 'local-automatic', baselineStatus: 'accepted', indexStatus: 'pending' });
  } finally { await h.close(); }
});
