import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, expect, type Page } from '@playwright/test';
import { createValidBundle } from '../fixtures/t05-artifacts.js';

const api = 'http://127.0.0.1:3000';
const category = { id: 'charts', name: '图表', enabled: true, revision: '0' };
async function login(page: Page) {
  await page.route('**/v1/auth/oidc/session', route => route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } }));
  await page.addInitScript(() => localStorage.setItem('zhinexus_console_auth', JSON.stringify({ token: 'local-ui-test', subject: 'operator', roles: ['reader'], channel: 'web' })));
}

test.describe('built admin controls with mocked API responses (not persistence evidence)', () => {
  test('requires login and keeps the new route and navigation within admin', async ({ page }) => {
    await page.route('**/v1/auth/oidc/session', route => route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } }));
    await page.goto('/categories');
    await expect(page.getByRole('heading', { name: '组件分类', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '组件分类', exact: true })).toHaveAttribute('href', '/categories');
    await expect(page.getByText('分类管理仅允许平台管理员')).toBeVisible();
    await expect(page.getByRole('button', { name: '创建分类', exact: true })).toHaveCount(0);
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
