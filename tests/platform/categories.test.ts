import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createValidBundle, packageBytes, replaceBundleArtifact } from '../fixtures/t05-artifacts.js';
import { platformHarness, grant, upload, release, type Harness } from './http-support.js';
import { managedPlatformSubject } from '../../apps/api/dist/accounts/service.js';

const issuer = 'https://issuer.t05.test';
const access = { apiOrigin: 'https://api.example.com', administrators: [{ issuer, subject: 'admin' }], outbound: [{ hostname: '127.0.0.1', port: 443, networks: ['127.0.0.1/32'] }] };
async function harness() { return platformHarness({ access }); }
async function createCategory(h: Harness, id = 'charts') {
  const response = await h.request('/v1/categories', { id, name: '图表' }, await h.token('admin', ['reader']));
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(201);
  return body as { id: string; name: string; enabled: boolean; revision: string };
}
const update = (h: Harness, id: string, body: unknown, token: string) => h.request(`/v1/categories/${id}/update`, body, token);

describe('persistent category and publishing HTTP', () => {
  it('rejects category names containing NUL with 400 and leaves stored categories unchanged', async () => {
    const h = await harness();
    try {
      const token = await h.token('admin', ['reader']);
      const created = await h.request('/v1/categories', { id: 'bad', name: 'bad\u0000name' }, token);
      await createCategory(h);
      const updated = await update(h, 'charts', { name: 'bad\u0000name', enabled: true, expectedRevision: '0' }, token);
      expect([created.status, updated.status]).toEqual([400, 400]);
      expect((await h.db.query('SELECT id,name,revision FROM component_categories ORDER BY id')).rows).toEqual([{ id: 'charts', name: '图表', revision: '0' }]);
    } finally { await h.close(); }
  });
  it('allows only real administrators to create, rename and disable, with persistent optimistic revisions and audit', async () => {
    const h = await harness();
    try {
      const publisher = await h.token(); const maintainer = await h.token('maintainer', ['maintainer']); const admin = await h.token('admin', ['reader']);
      expect((await h.request('/v1/categories', { id: 'charts', name: '越权' }, publisher)).status).toBe(403);
      expect((await h.request('/v1/categories', { id: 'charts', name: '越权' }, maintainer)).status).toBe(403);
      const category = await createCategory(h);
      expect(category).toEqual({ id: 'charts', name: '图表', enabled: true, revision: '0' });
      expect((await h.request('/v1/categories', { id: 'charts', name: '重复' }, admin)).status).toBe(409);
      expect((await h.request('/v1/categories', { id: 'empty', name: '  ' }, admin)).status).toBe(400);
      expect((await update(h, 'charts', { name: '越界revision', enabled: false, expectedRevision: '9999999999999999999' }, admin)).status).toBe(409);
      expect((await update(h, 'charts', { name: '越权', enabled: false, expectedRevision: '0' }, maintainer)).status).toBe(403);
      const responses = await Promise.all([
        update(h, 'charts', { name: '统计图表', enabled: true, expectedRevision: '0' }, admin),
        update(h, 'charts', { name: '统计图表', enabled: true, expectedRevision: '0' }, admin),
      ]);
      expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
      expect((await update(h, 'charts', { name: '统计图表', enabled: false, expectedRevision: '1' }, admin)).status).toBe(200);
      await h.restart();
      expect(await (await h.request('/v1/categories', undefined, publisher, 'GET')).json()).toEqual({ items: [] });
      expect((await h.request('/v1/categories?includeDisabled=true', undefined, maintainer, 'GET')).status).toBe(403);
      expect(await (await h.request('/v1/categories?includeDisabled=true', undefined, admin, 'GET')).json()).toEqual({ items: [{ id: 'charts', name: '统计图表', enabled: false, revision: '2' }] });
      expect((await h.request('/v1/categories', undefined, await h.token('reader', ['reader']), 'GET')).status).toBe(403);
      expect((await h.db.query("SELECT event FROM audit_events WHERE event LIKE 'CATEGORY_%' ORDER BY id")).rows).toEqual([{ event: 'CATEGORY_CREATED' }, { event: 'CATEGORY_UPDATED' }, { event: 'CATEGORY_UPDATED' }]);
    } finally { await h.close(); }
  });
  it('uses current managed administrator authority rather than business roles or bootstrap registration', async () => {
    const h = await platformHarness({ access, managedAccounts: { issuer, realm: 'local' }, localIdentity: {
      issuer, audience: 'platform-api', webClientId: 'web', cliClientId: 'cli',
      webRedirectUris: ['https://api.example.com/v1/auth/oidc/callback'], cliRedirectUris: ['http://127.0.0.1:23456/callback'],
    } });
    try {
      h.platform().identityWorker!.stop();
      await h.db.query('INSERT INTO managed_accounts(id,issuer,subject,platform_subject,username,display_name,roles,enabled,administrator) VALUES ($1,$2,$3,$4,$3,$3,$5,true,false)', [randomUUID(), issuer, 'admin', managedPlatformSubject(issuer, 'admin'), ['maintainer']]);
      const admin = await h.token('admin', ['maintainer'], 'web', '5m', { platform_account_version: '0', auth_time: 1 });
      expect((await h.request('/v1/categories', { id: 'charts', name: '越权' }, admin)).status).toBe(403);
      await h.db.query("UPDATE managed_accounts SET administrator=true,roles=ARRAY['reader'] WHERE subject='admin'");
      expect((await h.request('/v1/categories', { id: 'charts', name: '图表' }, admin)).status).toBe(201);
      await h.db.query("UPDATE managed_accounts SET administrator=false WHERE subject='admin'");
      expect((await update(h, 'charts', { name: '越权', enabled: false, expectedRevision: '0' }, admin)).status).toBe(403);
      await h.db.query("UPDATE managed_accounts SET enabled=false WHERE subject='admin'");
      expect((await h.request('/v1/categories?includeDisabled=true', undefined, admin, 'GET')).status).toBe(403);
    } finally { await h.close(); }
  });
  it('rechecks the active identity generation after waiting for the transaction lock', async () => {
    const h = await harness(); const blocker = await h.db.pool.connect();
    try {
      const token = await h.token('admin', ['reader']);
      await blocker.query('BEGIN');
      await blocker.query("SELECT * FROM access_active WHERE section='oidc' FOR UPDATE");
      const response = h.request('/v1/categories', { id: 'stale', name: '旧身份' }, token);
      // Wait for the real category transaction, not an arbitrary timing guess.
      await expect.poll(async () => (await h.db.query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SELECT generation FROM access_active%'")).rows[0]?.count, { timeout: 5000 }).toBe('1');
      await blocker.query("UPDATE access_active SET generation=generation+1 WHERE section='oidc'");
      await blocker.query('COMMIT');
      expect((await response).status).toBe(401);
      expect((await h.db.query("SELECT 1 FROM component_categories WHERE id='stale'")).rowCount).toBe(0);
    } finally { await blocker.query('ROLLBACK').catch(() => {}); blocker.release(); await h.close(); }
  });
  it('returns enabled choices and only existing publish ACLs without granting component or package access', async () => {
    const h = await harness();
    try {
      await createCategory(h); await grant(h);
      await h.db.query("UPDATE components SET category='retired' WHERE id='line'");
      await h.db.query("DELETE FROM component_permissions WHERE subject='alice' AND component_id<>'line'");
      await h.db.query("DELETE FROM package_permissions WHERE subject='alice' AND package_name<>'@company/charts-vue'");
      const token = await h.token();
      expect(await (await h.request('/v1/publishing/options', undefined, token, 'GET')).json()).toEqual({ categories: [{ id: 'charts', name: '图表', enabled: true, revision: '0' }], components: [{ componentId: 'line', category: 'retired' }], packages: ['@company/charts-vue'] });
      expect(await (await h.request('/v1/publishing/options', undefined, await h.token('unassigned'), 'GET')).json()).toEqual({ categories: [{ id: 'charts', name: '图表', enabled: true, revision: '0' }], components: [], packages: [] });
      await h.db.query("INSERT INTO disabled_subjects(subject) VALUES ('alice')");
      expect((await h.request('/v1/publishing/options', undefined, token, 'GET')).status).toBe(403);
    } finally { await h.close(); }
  });
  it('validates explicit category choices only for new authorized jobs and preserves successful retries and historical snapshots', async () => {
    const h = await harness();
    try {
      await createCategory(h); await createCategory(h, 'cards');
      const token = await h.token(); const admin = await h.token('admin', ['reader']);
      const fixture = await createValidBundle();
      for (const variant of fixture.manifest.variants) Object.assign(variant, { category: 'charts' });
      const body = await upload(h, fixture, token); const key = randomUUID();
      expect((await release(h, body, token, key)).status).toBe(403);
      await grant(h);
      expect((await h.db.query("SELECT category FROM components WHERE id='line'")).rows[0]?.category).toBe('uncategorized');
      const created = await release(h, body, token, key); expect(created.status).toBe(202); const job = await created.json();
      expect((await h.db.query("SELECT category FROM components WHERE id='line'")).rows[0]?.category).toBe('charts');
      expect((await update(h, 'charts', { name: '历史图表', enabled: false, expectedRevision: '0' }, admin)).status).toBe(200);
      expect(await (await release(h, body, token, key)).json()).toEqual(job);
      expect((await release(h, body, token, randomUUID())).status).toBe(400);
      const invalid = await createValidBundle();
      for (const variant of invalid.manifest.variants) Object.assign(variant, { category: 'unknown' });
      const rejected = await release(h, await upload(h, invalid, token), token);
      expect(rejected.status).toBe(400); expect(await rejected.json()).toMatchObject({ code: 'REFERENCE_NOT_FOUND' });
      expect((await h.db.query('SELECT count(*) FROM release_jobs')).rows[0]?.count).toBe('1');
      expect((await h.db.query("SELECT metadata->>'category' AS category FROM variant_releases ORDER BY variant_id")).rows).toEqual([{ category: 'charts' }, { category: 'charts' }, { category: 'charts' }]);
      expect((await h.db.query('SELECT manifest FROM release_jobs WHERE id=$1', [job.jobId])).rows[0]?.manifest.variants[0].category).toBe('charts');
      const next = await createValidBundle();
      for (const pkg of next.manifest.packages) pkg.version = '0.0.2';
      for (const variant of next.manifest.variants) {
        variant.category = 'cards'; variant.packageVersion = '0.0.2';
        for (const screenshot of variant.screenshots) screenshot.packageVersion = '0.0.2';
      }
      for (const [index, pkg] of next.manifest.packages.entries()) replaceBundleArtifact(next, pkg.tarball.path, await packageBytes(next, index));
      expect((await release(h, await upload(h, next, token), token)).status).toBe(202);
      expect((await h.db.query("SELECT category FROM components WHERE id='line'")).rows[0]?.category).toBe('cards');
      expect((await h.db.query('SELECT manifest FROM release_jobs WHERE id=$1', [job.jobId])).rows[0]?.manifest.variants[0].category).toBe('charts');
      await expect(h.db.query("DELETE FROM component_categories WHERE id='charts'")).rejects.toMatchObject({ code: '42501' });
    } finally { await h.close(); }
  });
  it('keeps category-free legacy releases compatible', async () => {
    const h = await harness();
    try {
      await grant(h); const token = await h.token();
      expect((await release(h, await upload(h, await createValidBundle(), token), token)).status).toBe(202);
      expect((await h.db.query("SELECT category FROM components WHERE id='line'")).rows[0]?.category).toBe('uncategorized');
    } finally { await h.close(); }
  });
});
