import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, expect, type Page, type Response } from '@playwright/test';
import { createValidBundle } from '../fixtures/t05-artifacts.js';

const api = 'http://127.0.0.1:3000';
const category = { id: 'charts', name: '图表', enabled: true, revision: '0' };
function gate() { let open!: () => void; const promise = new Promise<void>(resolve => { open = resolve; }); return { promise, open }; }
async function finishResponse(page: Page, pending: ReturnType<typeof gate>, match: (response: Response) => boolean) {
  const response = page.waitForResponse(match);
  pending.open(); await (await response).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function login(page: Page) {
  await page.route('**/v1/auth/oidc/session', route => route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } }));
  await page.addInitScript(() => localStorage.setItem('zhinexus_console_auth', JSON.stringify({ token: 'local-ui-test', subject: 'operator', roles: ['reader'], channel: 'web' })));
}

test.describe('built admin controls with mocked API responses (not persistence evidence)', () => {
  for (const lateStatus of [200, 500]) test(`discards late administrator mutation ${lateStatus} and private drafts after cookie identity switches to denied reader`, async ({ page }) => {
    const company = gate(), mutation = gate(), started = gate();
    const privateCategory = { id: 'private-archived', name: 'Private admin category', enabled: false, revision: '0' };
    await page.addInitScript(() => localStorage.setItem('zhinexus_console_auth', JSON.stringify({ token: 'admin-a-test', subject: 'admin-a', roles: ['reader'], channel: 'web' })));
    await page.route('**/v1/auth/oidc/session', async route => { await company.promise; await route.fulfill({ json: { authenticated: true, subject: 'reader-b', roles: ['reader'] } }); });
    await page.route(`${api}/v1/categories**`, async route => {
      if (route.request().method() === 'GET') return route.fulfill(route.request().headers().authorization ? { json: { items: [privateCategory] } } : { status: 403, json: { code: 'FORBIDDEN' } });
      started.open(); await mutation.promise;
      await route.fulfill(lateStatus === 200 ? { json: { ...privateCategory, name: 'Late private rename', revision: '1' } } : { status: lateStatus, json: { code: 'INTERNAL_ERROR' } });
    });
    await page.goto('/categories');
    await page.getByLabel('分类 ID').fill('private-admin-draft'); await page.getByLabel('分类名称', { exact: true }).fill('Admin A unsaved category');
    await page.getByRole('row').filter({ hasText: 'private-archived' }).getByRole('button', { name: '编辑' }).click();
    await page.getByLabel('编辑分类名称').fill('Late private rename'); await page.getByRole('button', { name: '保存分类' }).click(); await started.promise;
    company.open(); await expect(page.getByText('当前身份：reader-b', { exact: false })).toBeVisible();
    await expect(page.locator('main [role="alert"]')).toContainText('管理员');
    await expect.soft(page.getByLabel('分类 ID')).toHaveValue(''); await expect.soft(page.getByLabel('分类名称', { exact: true })).toHaveValue('');
    await finishResponse(page, mutation, response => response.url().includes('/v1/categories/') && response.request().method() === 'POST');
    await expect(page.getByRole('row').filter({ hasText: 'private-archived' })).toHaveCount(0);
    await expect(page.locator('main [role="alert"]')).toContainText('管理员');
    await expect(page.locator('main')).not.toContainText('Late private rename');
    await expect(page.getByRole('button', { name: '创建分类', exact: true })).toBeDisabled();
  });
  test('a late failure cannot clear a newer identity mutation busy state', async ({ page }) => {
    const company = gate(), oldPost = gate(), oldStarted = gate(), newPost = gate(), newStarted = gate();
    let posts = 0;
    await page.addInitScript(() => localStorage.setItem('zhinexus_console_auth', JSON.stringify({ token: 'admin-a-test', subject: 'admin-a', roles: ['reader'], channel: 'web' })));
    await page.route('**/v1/auth/oidc/session', async route => { await company.promise; await route.fulfill({ json: { authenticated: true, subject: 'admin-b', roles: ['reader'] } }); });
    await page.route(`${api}/v1/categories**`, async route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { items: [category] } });
      if (++posts === 1) { oldStarted.open(); await oldPost.promise; await route.fulfill({ status: 500, json: { code: 'INTERNAL_ERROR' } }); }
      else { newStarted.open(); await newPost.promise; await route.fulfill({ json: { ...category, name: 'Current identity name', revision: '1' } }); }
    });
    await page.goto('/categories');
    await page.getByRole('row').filter({ hasText: 'charts' }).getByRole('button', { name: '停用' }).click(); await oldStarted.promise;
    company.open(); await expect(page.getByText('当前身份：admin-b', { exact: false })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'charts' }).getByRole('button', { name: '编辑' })).toBeEnabled({ timeout: 3000 });
    await page.getByRole('row').filter({ hasText: 'charts' }).getByRole('button', { name: '编辑' }).click();
    await page.getByLabel('编辑分类名称').fill('Current identity name'); await page.getByRole('button', { name: '保存分类' }).click(); await newStarted.promise;
    await finishResponse(page, oldPost, response => response.request().method() === 'POST' && response.request().headers().authorization === 'Bearer admin-a-test');
    await expect(page.getByRole('button', { name: '保存分类' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '刷新列表' })).toBeDisabled();
    await expect(page.locator('main [role="alert"]')).toHaveCount(0);
    newPost.open(); await expect(page.getByRole('row').filter({ hasText: 'charts' })).toContainText('Current identity name');
    await expect(page.getByRole('button', { name: '保存分类' })).toBeEnabled();
  });
  test('clears private creation drafts on logout and re-login as another admin', async ({ page }) => {
    await login(page);
    await page.route('**/v1/categories**', route => route.fulfill({ json: { items: [category] } }));
    await page.route('**/v1/auth/oidc/logout', route => route.fulfill({ status: 204 }));
    await page.goto('/categories');
    await page.getByLabel('分类 ID').fill('private-draft');
    await page.getByLabel('分类名称', { exact: true }).fill('Private category');
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible();
    await page.locator('details.zn-token-login summary').click();
    const payload = Buffer.from(JSON.stringify({ sub: 'next-admin', roles: ['reader'] })).toString('base64url');
    await page.locator('#token-input').fill(`header.${payload}.signature`);
    await page.getByRole('button', { name: '凭证登录' }).click();
    await page.goto('/categories');
    await expect(page.getByLabel('分类 ID')).toHaveValue('');
    await expect(page.getByLabel('分类名称', { exact: true })).toHaveValue('');
  });
  for (const deniedStatus of [401, 403]) test(`preflight ${deniedStatus} clears previous publishing ACL without losing frozen materials or creating uploads`, async ({ page }) => {
    await login(page); const fixture = await createValidBundle(); const directory = await mkdtemp(join(tmpdir(), 'categories-denied-'));
    let denied = false, uploads = 0;
    await page.route(`${api}/v1/publishing/options`, route => route.fulfill(denied ? { status: deniedStatus, json: { code: deniedStatus === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN' } } : { json: { categories: [category], components: [{ componentId: 'line', category: 'charts' }], packages: ['@company/charts-react'] } }));
    await page.route(`${api}/v1/uploads`, route => { uploads++; return route.fulfill({ status: 500, body: 'must not upload' }); });
    try {
      for (const [path, bytes] of fixture.files) { await mkdir(join(directory, path, '..'), { recursive: true }); await writeFile(join(directory, path), bytes); }
      await page.goto('/upload');
      await page.locator('#import-manifest-input').setInputFiles({ name: 'manifest.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture.manifest)) });
      await page.locator('#import-files-input').setInputFiles(directory);
      await page.getByLabel('待发布框架').selectOption('react'); await page.getByLabel('line-react 分类').selectOption('charts');
      const submit = page.getByRole('button', { name: '确认并提交发布' }); await expect(submit).toBeEnabled();
      await page.evaluate(() => localStorage.setItem('zhinexus_pending_release', 'preserved-frozen-pending'));
      denied = true; await submit.click(); await expect(page.locator('#upload-status-message')).toContainText('发布失败');
      await expect(page.getByText('当前发布授权：', { exact: false })).toHaveCount(0);
      await expect(page.getByLabel('line-react 分类')).toBeDisabled(); await expect(submit).toBeDisabled();
      await expect(page.locator('.variant-shot-card')).toHaveCount(3);
      expect(uploads).toBe(0); expect(await page.evaluate(() => localStorage.getItem('zhinexus_pending_release'))).toBe('preserved-frozen-pending');
      // Reacquiring the same identity's options uses the existing in-memory artifact bytes, without importing again.
      denied = false; await page.getByRole('button', { name: '刷新发布选项' }).click(); await expect(submit).toBeEnabled();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  test('a signed storage URL 403 preserves current publishing ACL and frozen upload session', async ({ page }) => {
    await login(page); const fixture = await createValidBundle(); const directory = await mkdtemp(join(tmpdir(), 'categories-storage-'));
    let uploads = 0, puts = 0, releases = 0;
    await page.route(`${api}/v1/publishing/options`, route => route.fulfill({ json: { categories: [category], components: [{ componentId: 'line', category: 'charts' }], packages: ['@company/charts-react'] } }));
    await page.route(`${api}/v1/uploads`, route => {
      uploads++; const body = route.request().postDataJSON();
      return route.fulfill({ json: { uploadSessionId: 'storage-forbidden-session', files: body.files.map((file: { path: string }) => ({ path: file.path, uploadUrl: `https://signed-storage.test/${file.path}`, expiresAt: new Date(Date.now() + 60_000).toISOString() })) } });
    });
    await page.route('https://signed-storage.test/**', route => { puts++; return route.fulfill({ status: 403, body: 'ExpiredToken' }); });
    await page.route(`${api}/v1/releases`, route => { releases++; return route.fulfill({ status: 500, body: 'must not release' }); });
    try {
      for (const [path, bytes] of fixture.files) { await mkdir(join(directory, path, '..'), { recursive: true }); await writeFile(join(directory, path), bytes); }
      await page.goto('/upload');
      await page.locator('#import-manifest-input').setInputFiles({ name: 'manifest.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture.manifest)) });
      await page.locator('#import-files-input').setInputFiles(directory);
      await page.getByLabel('待发布框架').selectOption('react'); await page.getByLabel('line-react 分类').selectOption('charts');
      const submit = page.getByRole('button', { name: '确认并提交发布' }); await expect(submit).toBeEnabled();
      await submit.click(); await expect(page.locator('#upload-status-message')).toContainText('文件上传失败 (403)');
      await expect(page.getByText('当前发布授权：', { exact: false })).toBeVisible();
      await expect(page.getByLabel('line-react 分类')).toBeEnabled(); await expect(submit).toBeEnabled();
      await expect(page.locator('.variant-shot-card')).toHaveCount(3);
      expect(uploads).toBe(1); expect(puts).toBe(1); expect(releases).toBe(0);
      expect(await page.evaluate(() => localStorage.getItem('zhinexus_active_session_id'))).toBe('storage-forbidden-session');
      const plan = await page.evaluate(() => JSON.parse(localStorage.getItem('zhinexus_active_session_plan')!));
      expect(plan.subject).toBe('operator'); expect(plan.manifestDigest).toMatch(/^[0-9a-f]{64}$/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  test('requires login and redirects unauthenticated visits to login with password and OIDC PKCE options', async ({ page }) => {
    await page.route('**/v1/auth/oidc/session', route => route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } }));
    const directToken = `header.${Buffer.from(JSON.stringify({ sub: 'admin', roles: ['publisher'], azp: 'zhinexus-web' })).toString('base64url')}.sig`;
    let loginCalls = 0;
    await page.route('**/identity/login', async route => {
      loginCalls += 1;
      const body = route.request().postDataJSON();
      if (loginCalls === 1) {
        return route.fulfill({ status: 503, json: { code: 'INFRA_UNAVAILABLE' } });
      }
      if (!body.new_password) {
        return route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED', details: [{ code: 'INVALID_SCHEMA', path: 'newPassword', message: '首次登录必须设置新密码' }] } });
      }
      return route.fulfill({ status: 200, json: { access_token: directToken, token_type: 'Bearer', expires_in: 300, scope: 'openid' } });
    });
    await page.route(`${api}/v1/categories**`, route => route.fulfill({ json: { items: [] } }));
    await page.goto('/categories');
    await expect(page).toHaveURL(/\/login\?next=%2Fcategories$/);
    await expect(page.getByRole('heading', { name: '管理员登录', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '账号登录', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '创建分类', exact: true })).toHaveCount(0);

    await page.getByLabel('用户名').fill('admin');
    await page.getByLabel('密码', { exact: true }).fill('temp-pass-1234');
    await page.getByRole('button', { name: '密码登录', exact: true }).click();
    await expect(page.locator('main [role="alert"]')).toContainText('本地账号密码服务未启用');

    await page.getByRole('button', { name: '密码登录', exact: true }).click();
    await expect(page.getByLabel('新密码')).toBeVisible();
    await page.getByLabel('新密码').fill('fresh-pass-5678');
    await page.getByRole('button', { name: '密码登录', exact: true }).click();
    await expect(page).toHaveURL(/\/categories$/);
    await expect(page.getByRole('heading', { name: '组件分类', exact: true })).toBeVisible();
  });
  test('creates, renames and toggles a stable ID; stale CAS keeps edits until explicit refresh', async ({ page }) => {
    await login(page);
    let current = { ...category }; let exists = false; let conflict = false;
    const changes: unknown[] = [];
    await page.route(`${api}/v1/categories**`, async route => {
      const request = route.request();
      if (request.method() === 'GET') return route.fulfill({ json: { items: exists ? [current] : [] } });
      const body = request.postDataJSON(); changes.push(body);
      if (request.url().endsWith('/update')) {
        if (conflict) { conflict = false; current = { ...current, name: '另一管理员修改', revision: '3' }; return route.fulfill({ status: 409, json: { code: 'CONFLICT' } }); }
        current = { ...current, name: body.name, enabled: body.enabled, revision: String(Number(current.revision) + 1) };
      } else { exists = true; current = { ...category, id: body.id, name: body.name }; }
      return route.fulfill({ status: request.url().endsWith('/update') ? 200 : 201, json: current });
    });
    await page.goto('/categories');
    await expect(page.getByText('暂无分类')).toBeVisible();
    await page.getByLabel('分类 ID').fill('charts'); await page.getByLabel('分类名称', { exact: true }).fill('图表');
    await page.getByRole('button', { name: '创建分类', exact: true }).click();
    const row = page.getByRole('row').filter({ has: page.getByText('charts', { exact: true }) });
    await row.getByRole('button', { name: '编辑' }).click();
    await page.getByLabel('编辑分类名称').fill('统计图表'); await page.getByRole('button', { name: '保存分类' }).click();
    await expect(row).toContainText('统计图表');
    await row.getByRole('button', { name: '停用' }).click(); await expect(row).toContainText('已停用');
    await row.getByRole('button', { name: '启用' }).click(); await expect(row).toContainText('已启用');
    await row.getByRole('button', { name: '编辑' }).click(); await page.getByLabel('编辑分类名称').fill('我的编辑');
    conflict = true; await page.getByRole('button', { name: '保存分类' }).click();
    await expect(page.locator('main [role="alert"]')).toContainText('刷新'); await expect(page.getByLabel('编辑分类名称')).toHaveValue('我的编辑');
    await page.getByRole('button', { name: '刷新列表' }).click();
    await expect(row).toContainText('另一管理员修改'); await expect(page.getByLabel('编辑分类名称')).toHaveValue('另一管理员修改');
    expect(changes).toEqual([
      { id: 'charts', name: '图表' },
      { name: '统计图表', enabled: true, expectedRevision: '0' },
      { name: '统计图表', enabled: false, expectedRevision: '1' },
      { name: '统计图表', enabled: true, expectedRevision: '2' },
      { name: '我的编辑', enabled: true, expectedRevision: '3' },
    ]);
  });
  test('shows real permission denial instead of exposing mutation forms based on a business role', async ({ page }) => {
    await login(page);
    await page.route(`${api}/v1/categories**`, route => route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }));
    await page.goto('/categories');
    await expect(page.locator('main [role="alert"]')).toContainText('管理员');
    await expect(page.getByRole('button', { name: '创建分类', exact: true })).toBeDisabled();
  });
  test('selects actual React artifacts and current category; a disabled selection blocks the same final manifest', async ({ page }) => {
    await login(page);
    let categories = [category];
    await page.route(`${api}/v1/publishing/options`, route => route.fulfill({ json: { categories, components: [{ componentId: 'line', category: 'retired' }, { componentId: 'bar', category: 'uncategorized' }], packages: ['@company/charts-vue', '@company/charts-react'] } }));
    const fixture = await createValidBundle();
    const directory = await mkdtemp(join(tmpdir(), 'categories-ui-'));
    try {
      for (const [path, bytes] of fixture.files) { await mkdir(join(directory, path, '..'), { recursive: true }); await writeFile(join(directory, path), bytes); }
      await page.goto('/upload');
      await page.locator('#import-manifest-input').setInputFiles({ name: 'manifest.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture.manifest)) });
      await expect(page.locator('#upload-status-message')).toContainText('成功导入');
      await page.locator('#import-files-input').setInputFiles(directory);
      await page.getByLabel('待发布框架').selectOption('react');
      await expect(page.getByLabel('发布 line-react')).toBeChecked();
      await expect(page.getByLabel('发布 line-vue')).not.toBeChecked();
      await page.getByLabel('发布 line-vue').check();
      await expect(page.getByLabel('发布 bar-vue')).toBeChecked();
      await page.getByLabel('发布 line-vue').uncheck();
      await expect(page.getByLabel('发布 bar-vue')).not.toBeChecked();
      await expect(page.getByText('line 当前分类 retired 未知或已停用')).toBeVisible();
      await page.getByLabel('line-react 分类').selectOption('charts');
      await expect(page.getByLabel('line-vue 分类')).toHaveValue('charts');
      const submit = page.getByRole('button', { name: '确认并提交发布' });
      await expect(submit).toBeEnabled();
      await page.locator('button[data-remove-shot="line-vue"]').click();
      await expect(submit).toBeEnabled(); // An unselected package does not borrow or require its screenshots.
      // The failure route captures the final upload-plan digest; full real HTTP/PG is covered separately.
      let uploadPlan: { manifestDigest: string; files: { path: string }[] } | undefined;
      await page.route(`${api}/v1/uploads`, async route => { uploadPlan = route.request().postDataJSON(); await route.fulfill({ status: 500, body: 'isolated failure' }); });
      await submit.click(); await expect(page.locator('#upload-status-message')).toContainText('创建上传会话失败');
      expect(uploadPlan?.files.map(file => file.path)).toEqual(['api/line-react.json', 'docs/line-react.md', 'packages/charts-react-0.0.1.tgz', 'preview/line-react/index.html', 'screenshots/line-react.png']);
      expect(uploadPlan?.manifestDigest).toMatch(/^[0-9a-f]{64}$/);
      categories = [{ ...category, enabled: false, revision: '1' }];
      await page.getByRole('button', { name: '刷新发布选项' }).click();
      await expect(page.locator('#publishing-selection-alert')).toContainText('已停用');
      await expect(submit).toBeDisabled();
      categories = [category];
      await page.getByRole('button', { name: '刷新发布选项' }).click();
      await expect(submit).toBeEnabled();
      await page.locator('button[data-remove-shot="line-react"]').click();
      await expect(page.locator('#missing-screenshots-alert')).toContainText('SCREENSHOT_REQUIRED');
      await expect(submit).toBeDisabled();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
