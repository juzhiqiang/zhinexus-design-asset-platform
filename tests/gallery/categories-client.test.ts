import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CategoryApiError, createComponentCategory, listComponentCategories, readPublishingOptions, updateComponentCategory } from '../../apps/admin/app/lib/categories-client.js';
import { buildPublishingManifest, sanitizeWebManifest, uploadFileBytes } from '../../apps/admin/app/lib/uploads/manifest-form.js';
import { makeFixture } from '../fixtures/releases/g1/factory.js';

const enabled = { id: 'charts', name: '图表', enabled: true, revision: '0' };
let server: Server | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; }
});
async function endpoint(reply: unknown, status = 200) {
  const requests: { path: string; method: string; authorization?: string; body: unknown }[] = [];
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString();
    requests.push({ path: request.url!, method: request.method!, ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}), body: raw ? JSON.parse(raw) : undefined });
    response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(reply));
  });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  return { connection: { apiUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, token: 'signed-test-token' }, requests };
}

describe('admin category API client', () => {
  it('validates administrator list responses and requests disabled categories without trusting business roles', async () => {
    const { connection, requests } = await endpoint({ items: [enabled] });
    expect(await listComponentCategories(connection)).toEqual({ items: [enabled] });
    expect(requests).toEqual([{ path: '/v1/categories?includeDisabled=true', method: 'GET', authorization: 'Bearer signed-test-token', body: undefined }]);
  });
  it.each([
    { items: [{ ...enabled, revision: 0 }] },
    { items: [{ ...enabled, enabled: 'true' }] },
    { items: [{ ...enabled, name: ' 图表 ' }] },
  ])('rejects malformed category response %j', async reply => {
    const { connection } = await endpoint(reply);
    await expect(listComponentCategories(connection)).rejects.toThrow(/无效/);
  });
  it('creates and validates a stable ID and sends CAS revision on rename or toggle', async () => {
    const { connection, requests } = await endpoint(enabled);
    expect(await createComponentCategory(connection, { id: 'charts', name: '图表' })).toEqual(enabled);
    await updateComponentCategory(connection, 'charts', { name: '统计图表', enabled: false, expectedRevision: '0' });
    expect(requests.map(request => [request.path, request.body])).toEqual([
      ['/v1/categories', { id: 'charts', name: '图表' }],
      ['/v1/categories/charts/update', { name: '统计图表', enabled: false, expectedRevision: '0' }],
    ]);
    await expect(createComponentCategory(connection, { id: 'charts', name: ' ' })).rejects.toThrow(/名称|规则/);
    expect(requests).toHaveLength(2);
  });
  it.each([
    [403, /管理员/], [401, /登录/], [409, /刷新|变化/],
  ] as const)('reports HTTP %i without treating it as success', async (status, message) => {
    const { connection } = await endpoint({ code: 'DENIED' }, status);
    await expect(listComponentCategories(connection)).rejects.toThrow(message);
  });
  it('validates publisher choices and preserves existing ACL lists including retired current categories', async () => {
    const options = { categories: [enabled], components: [{ componentId: 'line', category: 'retired' }], packages: ['@company/charts-vue'] };
    const { connection, requests } = await endpoint(options);
    expect(await readPublishingOptions(connection)).toEqual(options);
    expect(requests[0]?.path).toBe('/v1/publishing/options');
  });
  it.each([401, 403])('keeps publishing options HTTP %i as a typed permission failure', async status => {
    const { connection } = await endpoint({ code: 'DENIED' }, status);
    const failure = await readPublishingOptions(connection).catch(error => error);
    expect(failure).toBeInstanceOf(CategoryApiError); expect(failure.status).toBe(status);
  });
  it('keeps signed storage HTTP 403 distinct from a publishing identity failure', async () => {
    const { connection } = await endpoint({ code: 'ExpiredToken' }, 403);
    const failure = await uploadFileBytes(connection.apiUrl + '/signed', Buffer.from('{}')).catch(error => error);
    expect(failure).toBeInstanceOf(Error); expect(failure).not.toBeInstanceOf(CategoryApiError);
    expect(failure.message).toContain('文件上传失败 (403)');
  });
  it('rejects malformed publishing options', async () => {
    const { connection } = await endpoint({ categories: [enabled], components: [{ componentId: 'line' }], packages: ['@company/charts-vue'] });
    await expect(readPublishingOptions(connection)).rejects.toThrow(/无效/);
  });
  it('uses existing cookie session auth without sending the session marker as a bearer credential', async () => {
    const { connection } = await endpoint({ items: [] });
    const originalFetch = globalThis.fetch;
    const seen: RequestInit[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => { seen.push(init!); return originalFetch(input, init); });
    await listComponentCategories({ ...connection, token: '__session__' });
    expect(seen[0]).toMatchObject({ credentials: 'include', cache: 'no-store', redirect: 'error' });
    expect(new Headers(seen[0]?.headers).has('authorization')).toBe(false);
  });
});

describe('manual publishing selections', () => {
  it('selects an existing React implementation with its original package, API, screenshot identity and bytes', () => {
    const { manifest } = makeFixture('cli');
    manifest.variants.forEach(variant => { variant.category = 'charts'; });
    const result = buildPublishingManifest(manifest, ['line-react'], [enabled]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.variants.map(variant => ({ id: variant.variantId, framework: variant.framework, category: variant.category, package: variant.packageName, api: variant.api.path, shotFramework: variant.screenshots[0]?.framework, source: variant.screenshots[0]?.source }))).toEqual([
      { id: 'line-react', framework: 'react', category: 'charts', package: '@company/charts-react', api: 'api/line-react.json', shotFramework: 'react', source: 'manual-upload' },
    ]);
    expect(result.value.packages.map(pkg => pkg.name)).toEqual(['@company/charts-react']);
    expect(result.value.packages[0]?.tarball).toEqual(manifest.packages[1]?.tarball);
    expect(result.value.files.map(file => file.path)).toEqual(['api/line-react.json', 'docs/line-react.md', 'packages/charts-react-0.0.1.tgz', 'preview/line-react/index.html', 'screenshots/line-react.png']);
    expect(result.value.reports).toEqual([]);
    expect(manifest.variants).toHaveLength(3);
    expect(manifest.channel).toBe('cli');
  });
  it('keeps candidate dependency tarballs when selecting a framework package that needs them', () => {
    const { manifest } = makeFixture();
    manifest.packages[0]!.dependencies = { '@company/charts-core': '0.0.1' };
    manifest.packages.push({ ...manifest.packages[0]!, name: '@company/charts-core', dependencies: {}, tarball: { path: 'packages/core.tgz', bytes: 1, sha256: '1'.repeat(64) } });
    const result = buildPublishingManifest(manifest, ['line-vue', 'bar-vue'], []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.packages.map(pkg => pkg.name)).toEqual(['@company/charts-vue', '@company/charts-core']);
  });
  it('blocks dropping a sibling implementation exported by the same frozen multi-component package', () => {
    const { manifest } = makeFixture();
    const result = buildPublishingManifest(manifest, ['line-vue'], []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map(issue => issue.code)).toContain('PACKAGE_IMPLEMENTATIONS_REQUIRED');
  });
  it('also requires implementations of a retained candidate dependency package', () => {
    const { manifest } = makeFixture();
    manifest.packages[0]!.dependencies = { '@company/charts-react': '0.0.1' };
    const result = buildPublishingManifest(manifest, ['line-vue', 'bar-vue'], []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map(issue => issue.code)).toContain('PACKAGE_IMPLEMENTATIONS_REQUIRED');
  });
  it.each([
    ['unknown', [enabled], 'REFERENCE_NOT_FOUND'],
    ['charts', [{ ...enabled, enabled: false }], 'CATEGORY_DISABLED'],
  ])('blocks explicit %s category before publishing', (category, categories, code) => {
    const { manifest } = makeFixture(); manifest.variants[0]!.category = category;
    const result = buildPublishingManifest(manifest, ['line-vue'], categories);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map(issue => issue.code)).toContain(code);
  });
  it('blocks conflicting categories for one logical component across selected frameworks', () => {
    const { manifest } = makeFixture(); manifest.variants[0]!.category = 'charts'; manifest.variants[2]!.category = 'cards';
    const result = buildPublishingManifest(manifest, ['line-vue', 'line-react'], [enabled, { ...enabled, id: 'cards' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map(issue => issue.code)).toContain('CATEGORY_CONFLICT');
  });
  it('keeps category-absent legacy manifests compatible and never invents an unavailable framework', () => {
    const { manifest } = makeFixture();
    const result = buildPublishingManifest(manifest, ['line-vue', 'bar-vue'], []);
    expect(result.ok).toBe(true);
    if (result.ok) expect('category' in result.value.variants[0]!).toBe(false);
    expect(buildPublishingManifest(manifest, ['line-angular'], []).ok).toBe(false);
    expect(buildPublishingManifest(manifest, [], []).ok).toBe(false);
    expect(sanitizeWebManifest(manifest).variants).toHaveLength(3);
  });
});
