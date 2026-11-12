import { request as httpRequest } from 'node:http';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { buildServer } from '../../apps/preview-gateway/dist/app.js';
import { workerHarness, realRegistry } from './t06-support.js';

const preview = { platformOrigin: 'https://gallery.platform.test', apiOrigin: 'https://api.platform.test', previewOrigin: 'https://preview.assets.test' };
describe('T07 durable preview grants and static gateway', () => {
  let h: Awaited<ReturnType<typeof workerHarness>>;
  let gateway: Awaited<ReturnType<typeof buildServer>>;
  let port: number; let id: string; let otherId: string;
  beforeAll(async () => {
    h = await workerHarness(undefined, { preview });
    await new ReleaseWorker(h.db, h.store, await realRegistry()).runOnce(h.jobId);
    id = (await h.db.query("SELECT id FROM variant_releases WHERE variant_id='line-vue'")).rows[0]!.id;
    otherId = (await h.db.query("SELECT id FROM variant_releases WHERE variant_id='line-react'")).rows[0]!.id;
    gateway = await buildServer({ databaseUrl: h.options.databaseUrl, storage: h.options.storage, preview });
    await gateway.listen(0, '127.0.0.1'); port = Number(new URL(await gateway.getUrl()).port);
  });
  afterAll(async () => { await gateway?.close(); await h?.close(); });
  const host = () => `r-${id}.preview.assets.test`;
  const mint = async () => {
    const response = await h.request('/v1/preview-grants', { variantReleaseId: id }, h.auth);
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    return await response.json() as { bootstrapUrl: string; expiresAt: string };
  };
  const resource = (path: string, cookie?: string, hostname = host(), method = 'GET') => new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, path, method, headers: { host: hostname, ...(cookie ? { cookie } : {}) } }, response => {
      const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    }); request.on('error', reject); request.end();
  });
  const redeem = async () => {
    const grant = await mint(); const url = new URL(grant.bootstrapUrl);
    const response = await resource(url.pathname + url.search);
    expect(response.status).toBe(303);
    const cookie = response.headers['set-cookie']![0]!.split(';')[0]!;
    return { response, cookie, grant, path: url.pathname + url.search };
  };

  it('requires identity, Ready and component permission to mint a grant', async () => {
    expect((await h.request('/v1/preview-grants', { variantReleaseId: id })).status).toBe(401);
    expect((await h.request('/v1/preview-grants', { variantReleaseId: id }, await h.token('bob', ['reader']))).status).toBe(404);
    await h.db.query("UPDATE variant_releases SET availability='PENDING' WHERE id=$1", [id]);
    expect((await h.request('/v1/preview-grants', { variantReleaseId: id }, h.auth)).status).toBe(404);
    await h.db.query("UPDATE variant_releases SET availability='Ready' WHERE id=$1", [id]);
  });
  it('atomically exchanges once, clears URL credentials and serves only frozen declared files with no-store', async () => {
    const { response, cookie, path, grant } = await redeem();
    expect(new URL(grant.bootstrapUrl).host).toBe(host());
    expect(Date.parse(grant.expiresAt) - Date.now()).toBeLessThanOrEqual(300_000);
    expect(Date.parse(grant.expiresAt) - Date.now()).toBeGreaterThan(290_000);
    expect(response.headers.location).toBe('/preview/line-vue/index.html');
    expect(response.headers['set-cookie']![0]).toMatch(/^__Host-preview=/);
    expect(response.headers['set-cookie']![0]).toMatch(/Secure; HttpOnly; SameSite=None/);
    expect(response.headers['set-cookie']![0]).not.toMatch(/Domain=/i);
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect((await resource(path)).status).toBe(404);
    const file = await resource(response.headers.location!, cookie);
    expect(file.status).toBe(200); expect(file.body).toBe('<p>synthetic line-vue</p>');
    expect(file.headers['content-type']).toContain('text/html');
    expect(file.headers['cache-control']).toBe('no-store');
    expect(file.headers['content-security-policy']).toContain("connect-src 'none'");
    expect(file.headers['content-security-policy']).toContain("worker-src 'none'");
    expect((await resource('/preview/line-vue/index.html')).status).toBe(404);
    expect((await resource('/docs/line-vue.md', cookie)).status).toBe(404);
    expect((await resource('/preview/line-react/index.html', cookie)).status).toBe(404);
    expect((await resource('/preview/line-vue/index.html', cookie, `r-${otherId}.preview.assets.test`)).status).toBe(404);
    expect((await resource('/preview/line-vue/index.html', cookie, 'api.platform.test')).status).toBe(404);
    expect((await resource('/preview/line-vue/index.html', cookie, host(), 'POST')).status).toBe(405);
  });
  it('allows only one concurrent bootstrap and stores hashes instead of bearer tokens', async () => {
    const grant = await mint(); const url = new URL(grant.bootstrapUrl);
    const results = await Promise.all([resource(url.pathname + url.search), resource(url.pathname + url.search)]);
    expect(results.map(r => r.status).sort()).toEqual([303,404]);
    const stored = JSON.stringify((await h.db.query('SELECT * FROM preview_grants')).rows);
    expect(stored).not.toContain(url.searchParams.get('grant'));
  });
  it.each(['/../preview/line-vue/index.html','/%2e%2e/preview/line-vue/index.html','/%252e%252e/x','/preview\\line-vue/index.html','/preview//line-vue/index.html','/preview/line-vue/index.html%00','//preview/line-vue/index.html'])('rejects raw path bypass %s', async path => {
    const { cookie } = await redeem(); expect((await resource(path, cookie)).status).toBe(404);
  });
  it('keeps sessions across process restarts and rejects replaced bytes or undeclared object keys', async () => {
    const { cookie } = await redeem();
    await gateway.close();
    gateway = await buildServer({ databaseUrl: h.options.databaseUrl, storage: h.options.storage, preview });
    await gateway.listen(0, '127.0.0.1'); port = Number(new URL(await gateway.getUrl()).port);
    expect((await resource('/preview/line-vue/index.html', cookie)).status).toBe(200);
    await h.db.query("UPDATE release_artifacts SET sha256=$1 WHERE job_id=$2 AND path='preview/line-vue/index.html'", ['0'.repeat(64), h.jobId]);
    expect((await resource('/preview/line-vue/index.html', cookie)).status).toBe(404);
    await h.db.query("UPDATE release_artifacts SET sha256=$1 WHERE job_id=$2 AND path='preview/line-vue/index.html'", [h.fixture.manifest.variants[0]!.examples[0]!.previewFiles[0]!.sha256, h.jobId]);
    expect((await resource('/preview/line-vue/index.html', `${cookie}; ${cookie}`)).status).toBe(404);
    await h.db.query("UPDATE variant_releases SET availability='DEPRECATED' WHERE id=$1", [id]);
    expect((await resource('/preview/line-vue/index.html', cookie)).status).toBe(404);
    await h.db.query("UPDATE variant_releases SET availability='Ready' WHERE id=$1", [id]);
  });
  it('rejects revoked grants, expired sessions, disabled users and component permission removal on the next request', async () => {
    let session = await redeem();
    await h.db.query('UPDATE preview_grants SET revoked_at=now()');
    expect((await resource('/preview/line-vue/index.html', session.cookie)).status).toBe(404);
    session = await redeem();
    await h.db.query("UPDATE preview_grants SET expires_at=now()-interval '1 second'");
    expect((await resource('/preview/line-vue/index.html', session.cookie)).status).toBe(404);
    session = await redeem();
    await h.db.query("INSERT INTO disabled_subjects(subject) VALUES ('alice')");
    expect((await resource('/preview/line-vue/index.html', session.cookie)).status).toBe(404);
    await h.db.query("DELETE FROM disabled_subjects WHERE subject='alice'");
    await h.db.query("DELETE FROM component_permissions WHERE subject='alice'");
    expect((await resource('/preview/line-vue/index.html', session.cookie)).status).toBe(404);
  });
});
