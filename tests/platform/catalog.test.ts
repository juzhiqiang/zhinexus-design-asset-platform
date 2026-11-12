import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { validateApiMessage } from '@company/contracts';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { workerHarness, realRegistry } from './t06-support.js';

describe('T07 catalog real HTTP/storage boundaries', () => {
  let h: Awaited<ReturnType<typeof workerHarness>>;
  beforeAll(async () => { h = await workerHarness(); });
  afterAll(async () => { await h?.close(); });
  const get = (path: string, token?: string) => h.request(path, undefined, token, 'GET');

  it('keeps pending and private assets out of public lists even with publisher auth', async () => {
    let response = await get('/v1/components', h.auth);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
    await new ReleaseWorker(h.db, h.store, await realRegistry()).runOnce(h.jobId);
    response = await get('/v1/components', h.auth);
    expect(await response.json()).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('filters before counting/pagination, returns only Ready variants and uses stable component ordering', async () => {
    await h.db.query('UPDATE components SET public=true');
    const response = await get('/v1/components?framework=react&page=1&pageSize=1');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(validateApiMessage('componentsResponse', body).ok).toBe(true);
    expect(body.total).toBe(1); expect(body.items[0].componentId).toBe('line');
    expect(body.items[0].variants.map((v: { framework: string }) => v.framework)).toEqual(['react']);
    expect((await (await get('/v1/components?pageSize=1')).json()).items[0].componentId).toBe('bar');
    expect((await (await get('/v1/components?query=LiNe')).json()).total).toBe(1);
    expect((await (await get('/v1/components?query=%25')).json()).total).toBe(0);
    expect((await (await get('/v1/components?category=missing')).json()).total).toBe(0);
    await h.db.query("UPDATE variant_releases SET availability='PENDING' WHERE variant_id='line-react'");
    expect((await (await get('/v1/components?framework=react')).json()).total).toBe(0);
    await h.db.query("UPDATE variant_releases SET availability='Ready' WHERE variant_id='line-react'");
  });

  it.each(['page=0', 'page=1.5', 'pageSize=101', 'page=1&page=2', 'framework=angular', 'unknown=x'])('rejects malformed query %s', async query => {
    expect((await get(`/v1/components?${query}`)).status).toBe(400);
  });

  it('keeps exact version metadata and independent verification states, hides pending and missing versions', async () => {
    const response = await get('/v1/variants/line-vue/releases/0.0.1');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(validateApiMessage('variantReleaseResponse', body).ok).toBe(true);
    expect(body).toMatchObject({ availability: 'Ready', reportSource: 'manual-upload', baselineStatus: 'unconfirmed', indexStatus: 'pending' });
    expect(body.variant).toEqual(h.fixture.manifest.variants[0]);
    expect(body.package).toEqual(h.fixture.manifest.packages[0]);
    expect(JSON.stringify(body)).not.toMatch(/alice|object_key|upload_session|idempotency/);
    expect((await get('/v1/variants/line-vue/releases/9.9.9')).status).toBe(404);
    await h.db.query("UPDATE release_outbox SET state='failed'");
    expect((await (await get('/v1/variants/line-vue/releases/0.0.1')).json()).indexStatus).toBe('failed');
  });

  it('serves exact-version documentation as inert text and refuses preview, tarball or another variant material', async () => {
    const url = '/v1/variants/line-vue/releases/0.0.1/artifacts?path=';
    const response = await get(`${url}docs/line-vue.md`);
    expect(response.status).toBe(200); expect(await response.text()).toBe('# synthetic');
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('cache-control')).toBe('no-store');
    for (const path of ['docs/line-react.md','preview/line-vue/index.html','../docs/line-vue.md',h.fixture.manifest.packages[0]!.tarball.path]) {
      expect((await get(url + encodeURIComponent(path))).status).toBe(404);
    }
  });

  it('requires both role and component access for private endpoints and immediately applies revocation', async () => {
    await h.db.query('UPDATE components SET public=false');
    expect((await get('/v1/variants/line-vue/releases/0.0.1', h.auth)).status).toBe(404);
    const url = '/v1/me/variants/line-vue/releases/0.0.1';
    expect((await get(url)).status).toBe(401);
    expect((await get(url, await h.token('alice', []))).status).toBe(403);
    expect((await get(url, await h.token('bob', ['reader']))).status).toBe(404);
    expect((await get(url, h.auth)).status).toBe(200);
    expect((await (await get('/v1/me/components', h.auth)).json()).total).toBe(2);
    await h.db.query("DELETE FROM component_permissions WHERE subject='alice' AND component_id='line'");
    expect((await get(url, h.auth)).status).toBe(404);
    expect((await (await get('/v1/me/components', h.auth)).json()).total).toBe(1);
  });
  it('denies a disabled subject even if the JWT is valid and assets are public', async () => {
    await h.db.query('UPDATE components SET public=true');
    await h.db.query("INSERT INTO disabled_subjects(subject) VALUES ('alice')");
    expect((await get('/v1/me/components', h.auth)).status).toBe(403);
    expect((await get('/v1/components')).status).toBe(200);
  });
});
