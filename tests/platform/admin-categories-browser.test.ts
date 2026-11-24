import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test';
import { expect, it } from 'vitest';
import { createValidBundle } from '../fixtures/t05-artifacts.js';
import { grant, platformHarness, type Harness } from './http-support.js';

async function freePort(): Promise<number> {
  const socket = createServer(); await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>(resolve => socket.close(() => resolve())); return port;
}
async function startBuiltAdmin(port: number) {
  const child = spawn(process.execPath, [resolve('apps/admin/node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: resolve('apps/admin'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; child.stdout?.on('data', chunk => { output += String(chunk); }); child.stderr?.on('data', chunk => { output += String(chunk); });
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Built admin exited: ${output}`);
    try { if ((await fetch(origin + '/categories', { signal: AbortSignal.timeout(500) })).ok) return { child, origin }; } catch { /* Wait for the owned Next server's actual HTTP readiness. */ }
    await delay(50);
  }
  child.kill(); throw new Error(`Built admin did not become ready: ${output}`);
}
async function authenticatedPage(browser: Browser, h: Harness, subject: string, roles: string[], token?: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(({ token, subject, roles, apiUrl }) => {
    localStorage.setItem('zhinexus_console_auth', JSON.stringify({ token, subject, roles, channel: 'web' }));
    localStorage.setItem('zhinexus_api_url', apiUrl);
  }, { token: token ?? await h.token(subject, roles), subject, roles, apiUrl: h.origin() });
  return context.newPage();
}
const categoryRow = (page: Page) => page.getByRole('row').filter({ has: page.getByText('charts', { exact: true }) });

it('connects the real built admin UI to category HTTP and persists exact selected manual release metadata in PostgreSQL', async () => {
  // No route mocks: the actual built Next controls use local signed Bearer auth, real Nest HTTP, PostgreSQL and MinIO.
  // Binary protocol fixtures are not SDK/consumer evidence; READY and production OIDC/TLS remain separate acceptance.
  const directory = await mkdtemp(join(tmpdir(), 'categories-real-'));
  let h: Harness | undefined; let browser: Browser | undefined; let child: ChildProcess | undefined;
  try {
    const built = await startBuiltAdmin(await freePort()); child = built.child;
    h = await platformHarness({ adminOrigin: built.origin, access: { apiOrigin: 'https://api.example.com', administrators: [{ issuer: 'https://issuer.t05.test', subject: 'admin' }], outbound: [{ hostname: '127.0.0.1', port: 443, networks: ['127.0.0.1/32'] }] } });
    browser = await chromium.launch();
    const admin = await authenticatedPage(browser, h, 'admin', ['reader']);
    const secondAdmin = await authenticatedPage(browser, h, 'admin', ['reader']);
    const responses: { method: string; path: string; status: number }[] = [];
    for (const page of [admin, secondAdmin]) page.on('response', response => {
      if (response.url().startsWith(h!.origin() + '/v1/categories')) responses.push({ method: response.request().method(), path: new URL(response.url()).pathname, status: response.status() });
    });
    await admin.goto(built.origin + '/categories?apiUrl=' + encodeURIComponent(h.origin()));
    await browserExpect(admin.getByText('暂无分类')).toBeVisible();
    await admin.getByLabel('分类 ID').fill('charts'); await admin.getByLabel('分类名称', { exact: true }).fill('图表');
    await admin.getByRole('button', { name: '创建分类', exact: true }).click();
    await browserExpect(categoryRow(admin)).toContainText('图表');
    await categoryRow(admin).getByRole('button', { name: '编辑' }).click();
    await admin.getByLabel('编辑分类名称').fill('统计图表'); await admin.getByRole('button', { name: '保存分类' }).click();
    await browserExpect(categoryRow(admin)).toContainText('统计图表');
    await secondAdmin.goto(built.origin + '/categories?apiUrl=' + encodeURIComponent(h.origin()));
    await categoryRow(secondAdmin).getByRole('button', { name: '编辑' }).click();
    await secondAdmin.getByLabel('编辑分类名称').fill('过期编辑');
    await categoryRow(admin).getByRole('button', { name: '停用' }).click(); await browserExpect(categoryRow(admin)).toContainText('已停用');
    await secondAdmin.getByRole('button', { name: '保存分类' }).click();
    await browserExpect(secondAdmin.locator('main [role="alert"]')).toContainText('刷新');
    await browserExpect(secondAdmin.getByLabel('编辑分类名称')).toHaveValue('过期编辑');
    await secondAdmin.getByRole('button', { name: '刷新列表' }).click();
    await browserExpect(secondAdmin.getByLabel('编辑分类名称')).toHaveValue('统计图表');
    await categoryRow(admin).getByRole('button', { name: '启用' }).click(); await browserExpect(categoryRow(admin)).toContainText('已启用');
    expect((await h.db.query('SELECT id,name,enabled,revision::text FROM component_categories')).rows).toEqual([{ id: 'charts', name: '统计图表', enabled: true, revision: '3' }]);
    expect(responses.filter(response => response.method === 'POST').map(response => response.status)).toEqual([201, 200, 200, 409, 200]);

    await grant(h);
    const publisher = await authenticatedPage(browser, h, 'alice', ['publisher']);
    const forbidden = await authenticatedPage(browser, h, 'alice', ['publisher']);
    await forbidden.goto(built.origin + '/categories?apiUrl=' + encodeURIComponent(h.origin()));
    await browserExpect(forbidden.locator('main [role="alert"]')).toContainText('管理员');
    await browserExpect(forbidden.getByRole('button', { name: '创建分类', exact: true })).toBeDisabled();

    const fixture = await createValidBundle();
    for (const [path, bytes] of fixture.files) { await mkdir(join(directory, path, '..'), { recursive: true }); await writeFile(join(directory, path), bytes); }
    await publisher.goto(built.origin + '/upload?apiUrl=' + encodeURIComponent(h.origin()));
    await publisher.locator('#import-manifest-input').setInputFiles({ name: 'manifest.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture.manifest)) });
    await publisher.locator('#import-files-input').setInputFiles(directory);
    await publisher.getByLabel('待发布框架').selectOption('react');
    await publisher.getByLabel('发布 line-vue').check(); await browserExpect(publisher.getByLabel('发布 bar-vue')).toBeChecked();
    await publisher.getByLabel('发布 line-vue').uncheck(); await browserExpect(publisher.getByLabel('发布 bar-vue')).not.toBeChecked();
    await publisher.getByLabel('line-react 分类').selectOption('charts');
    await browserExpect(publisher.getByLabel('line-vue 分类')).toHaveValue('charts');
    const submit = publisher.getByRole('button', { name: '确认并提交发布' }); await browserExpect(submit).toBeEnabled();

    // Actual current-subject 403 must discard the old ACL before any upload session exists.
    await h.db.query("INSERT INTO disabled_subjects(subject) VALUES ('alice')");
    const deniedResponse = publisher.waitForResponse(response => response.url() === h!.origin() + '/v1/publishing/options');
    await submit.click(); expect((await deniedResponse).status()).toBe(403);
    await browserExpect(publisher.locator('#upload-status-message')).toContainText('发布失败');
    await browserExpect(publisher.getByText('当前发布授权：', { exact: false })).toHaveCount(0);
    await browserExpect(publisher.getByLabel('line-react 分类')).toBeDisabled(); await browserExpect(submit).toBeDisabled();
    await browserExpect(publisher.locator('.variant-shot-card')).toHaveCount(3);
    expect((await h.db.query('SELECT count(*) FROM upload_sessions')).rows[0]!.count).toBe('0');
    await h.db.query("DELETE FROM disabled_subjects WHERE subject='alice'");
    await publisher.getByRole('button', { name: '刷新发布选项' }).click(); await browserExpect(submit).toBeEnabled();

    // A real signed Bearer token expires after choices load; no mocked response or arbitrary sleep.
    await grant(h, 'expiring-publisher');
    const expiringToken = await h.token('expiring-publisher', ['publisher'], 'web', '5s');
    const expiring = await authenticatedPage(browser, h, 'expiring-publisher', ['publisher'], expiringToken);
    await expiring.goto(built.origin + '/upload?apiUrl=' + encodeURIComponent(h.origin()));
    await expiring.locator('#import-manifest-input').setInputFiles({ name: 'manifest.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture.manifest)) });
    await expiring.locator('#import-files-input').setInputFiles(directory);
    await expiring.getByLabel('待发布框架').selectOption('react'); await expiring.getByLabel('line-react 分类').selectOption('charts');
    const expiringSubmit = expiring.getByRole('button', { name: '确认并提交发布' }); await browserExpect(expiringSubmit).toBeEnabled();
    await expect.poll(async () => (await h!.request('/v1/publishing/options', undefined, expiringToken, 'GET')).status, { timeout: 10_000 }).toBe(401);
    const expiredResponse = expiring.waitForResponse(response => response.url() === h!.origin() + '/v1/publishing/options');
    await expiringSubmit.click(); expect((await expiredResponse).status()).toBe(401);
    await browserExpect(expiring.locator('#upload-status-message')).toContainText('登录已失效');
    await browserExpect(expiring.getByText('当前发布授权：', { exact: false })).toHaveCount(0);
    await browserExpect(expiring.getByLabel('line-react 分类')).toBeDisabled(); await browserExpect(expiringSubmit).toBeDisabled();
    await browserExpect(expiring.locator('.variant-shot-card')).toHaveCount(3);
    expect((await h.db.query('SELECT count(*) FROM upload_sessions')).rows[0]!.count).toBe('0');

    // A category disabled after the UI loaded must fail before creating any upload session.
    await categoryRow(admin).getByRole('button', { name: '停用' }).click(); await browserExpect(categoryRow(admin)).toContainText('已停用');
    await submit.click(); await browserExpect(publisher.locator('#upload-status-message')).toContainText('发布选择未通过');
    await browserExpect(submit).toBeDisabled();
    expect((await h.db.query('SELECT count(*) FROM upload_sessions')).rows[0]!.count).toBe('0');
    await categoryRow(admin).getByRole('button', { name: '启用' }).click(); await browserExpect(categoryRow(admin)).toContainText('已启用');
    await publisher.getByRole('button', { name: '刷新发布选项' }).click(); await browserExpect(submit).toBeEnabled();
    await submit.click(); await browserExpect(publisher.locator('#upload-status-message')).toContainText('作业已成功创建');
    const job = (await h.db.query('SELECT manifest,manifest_digest,state FROM release_jobs')).rows[0]!;
    expect(job.state).toBe('PENDING');
    expect(job.manifest.channel).toBe('web');
    expect(job.manifest.variants).toHaveLength(1);
    expect(job.manifest.variants[0]).toMatchObject({ variantId: 'line-react', framework: 'react', category: 'charts', packageName: '@company/charts-react', api: fixture.manifest.variants[2]!.api, screenshots: [{ framework: 'react', source: 'manual-upload', packageSha256: fixture.manifest.packages[1]!.tarball.sha256 }] });
    expect(job.manifest.packages).toEqual([fixture.manifest.packages[1]]);
    expect(job.manifest.files.map((file: { path: string }) => file.path)).toEqual(['api/line-react.json', 'docs/line-react.md', 'packages/charts-react-0.0.1.tgz', 'preview/line-react/index.html', 'screenshots/line-react.png']);
    expect((await h.db.query("SELECT id,category FROM components WHERE id IN ('line','bar') ORDER BY id")).rows).toEqual([{ id: 'bar', category: 'uncategorized' }, { id: 'line', category: 'charts' }]);
    expect((await h.db.query("SELECT variant_id, metadata->>'category' AS category FROM variant_releases")).rows).toEqual([{ variant_id: 'line-react', category: 'charts' }]);

    await mkdir(resolve('test-results/categories-real'), { recursive: true });
    await admin.screenshot({ path: resolve('test-results/categories-real/admin.png'), fullPage: true });
    await publisher.screenshot({ path: resolve('test-results/categories-real/upload.png'), fullPage: true });
    await h.restart();
    await admin.goto(built.origin + '/categories?apiUrl=' + encodeURIComponent(h.origin()));
    await browserExpect(categoryRow(admin)).toContainText('统计图表'); await browserExpect(categoryRow(admin)).toContainText('已启用');
    expect((await h.db.query('SELECT id,name,enabled,revision::text FROM component_categories')).rows).toEqual([{ id: 'charts', name: '统计图表', enabled: true, revision: '5' }]);
    expect((await h.db.query('SELECT count(*) FROM release_jobs')).rows[0]!.count).toBe('1');
    const evidence = { event: 'ADMIN_CATEGORIES_REAL_UI_HTTP_PG', uiOrigin: built.origin, apiOrigin: h.origin(), browser: browser.version(), categoryId: 'charts', revision: '5', staleRevisionStatus: 409, preflightDenials: [{ status: 403, cause: 'disabled-subject', uploadSessions: 0, oldAclCleared: true }, { status: 401, cause: 'expired-signed-bearer', uploadSessions: 0, oldAclCleared: true }], releaseState: 'PENDING', selectedVariant: 'line-react', category: 'charts', screenshotSource: 'manual-upload', tarballSha256: fixture.manifest.packages[1]!.tarball.sha256, manifestDigest: job.manifest_digest, tarballUnchanged: true, apiRestartPersisted: true, httpResponses: responses, productionOidcAcceptance: false, sdkConsumerAcceptance: false };
    await writeFile(resolve('test-results/categories-real/evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify(evidence));
  } finally {
    await browser?.close();
    if (child && child.exitCode === null) { child.kill(); await new Promise<void>(resolve => child!.once('exit', () => resolve())); }
    await h?.close(); await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
