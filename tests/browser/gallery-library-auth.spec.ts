import { expect, test } from '@playwright/test';
import { catalogFixture, officialFixture, releaseFixture } from '../gallery/echarts-compatibility-fixtures.js';

const origin = process.env.GALLERY_TEST_ORIGIN ?? 'http://127.0.0.1:5173';
const ipBootstrap = `https://127.0.0.1:5443/bootstrap?grant=${'a'.repeat(43)}`;

test.describe('Gallery /library authenticated catalog & detail isolation', () => {
  test('anonymous user sees login prompt with target=gallery, noindex, and zero private data or iframes', async ({ page }) => {
    await page.route('**/v1/auth/oidc/session', (route) =>
      route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } }),
    );

    const listRes = await page.goto(`${origin}/library`);
    expect(listRes?.status()).toBe(200);
    const initialHtml = await listRes!.text();
    expect(initialHtml).not.toContain('release-vue');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.getByTestId('library-unauthenticated')).toBeVisible();
    const loginLink = page.getByRole('link', { name: '使用公司账号登录' });
    await expect(loginLink).toHaveAttribute('href', /\/v1\/auth\/oidc\/start\?target=gallery$/);
    await expect(page.getByTestId('library-grid')).toHaveCount(0);

    const detailRes = await page.goto(`${origin}/library/release-vue`);
    expect(detailRes?.status()).toBe(200);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.getByTestId('library-detail-unauthenticated')).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
  });

  test('authorized user views /v1/me/components and /library/[releaseId] detail, reports, docs, and preview', async ({ page }) => {
    await page.route('**/v1/auth/oidc/session', (route) =>
      route.fulfill({ json: { authenticated: true, administrator: false, subject: 'alice', roles: ['reader'] } }),
    );
    await page.route('**/v1/me/components**', (route) => route.fulfill({ json: catalogFixture('vue') }));
    await page.route('**/v1/me/variant-releases/release-vue', (route) => route.fulfill({ json: releaseFixture('vue') }));
    await page.route('**/v1/me/variant-releases/release-vue/reports', (route) =>
      route.fulfill({ json: { variantReleaseId: 'release-vue', reports: [] } }),
    );
    await page.route('**/v1/me/variant-releases/release-vue/artifacts**', (route) =>
      route.fulfill({ body: '# Internal LineChart Guide', contentType: 'text/markdown' }),
    );
    await page.route('**/v1/preview-grants', (route) =>
      route.fulfill({ json: { bootstrapUrl: ipBootstrap, expiresAt: new Date(Date.now() + 300_000).toISOString(), mode: 'ip-port' } }),
    );
    await page.route('https://127.0.0.1:5443/bootstrap**', (route) =>
      route.fulfill({ body: 'Preview OK', contentType: 'text/html' }),
    );
    await page.route('https://registry.npmjs.org/echarts/latest', (route) => route.fulfill({ json: officialFixture() }));
    await page.route('**/v1/components**', (route) => route.fulfill({ json: { items: [], page: 1, pageSize: 100, total: 0 } }));

    await page.goto(`${origin}/library`);
    await expect(page.getByTestId('library-subject')).toHaveText('alice');
    await expect(page.getByTestId('library-grid')).toContainText('折线图');
    await page.getByRole('link', { name: /查看已授权详情与预览/ }).click();

    await expect(page.getByTestId('library-detail')).toBeVisible();
    await expect(page.locator('.status-grid')).toContainText('@company/charts-vue@0.0.12');
    await expect(page.getByRole('region', { name: '组件文档产物' })).toContainText('# Internal LineChart Guide');
    await expect(page.locator('iframe.preview-frame')).toHaveAttribute('src', ipBootstrap);
  });

  test('unauthorized user (403) cannot view private list or detail and sees zero iframes', async ({ page }) => {
    await page.route('**/v1/auth/oidc/session', (route) =>
      route.fulfill({ json: { authenticated: true, administrator: false, subject: 'bob', roles: ['reader'] } }),
    );
    await page.route('**/v1/me/components**', (route) =>
      route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }),
    );
    await page.route('**/v1/me/variant-releases/release-secret', (route) =>
      route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }),
    );

    await page.goto(`${origin}/library`);
    await expect(page.getByTestId('library-forbidden')).toBeVisible();
    await expect(page.getByTestId('library-grid')).toHaveCount(0);

    await page.goto(`${origin}/library/release-secret`);
    await expect(page.getByTestId('library-detail-forbidden')).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
  });

  test('logout immediately clears private detail and preview iframe and blocks stale async writeback', async ({ page }) => {
    let authenticated = true;
    await page.route('**/v1/auth/oidc/session', (route) =>
      authenticated
        ? route.fulfill({ json: { authenticated: true, administrator: false, subject: 'alice', roles: ['reader'] } })
        : route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } }),
    );
    await page.route('**/v1/auth/oidc/logout', (route) => {
      authenticated = false;
      return route.fulfill({ json: { authenticated: false } });
    });
    await page.route('**/v1/me/components**', (route) => route.fulfill({ json: catalogFixture('vue') }));
    await page.route('**/v1/me/variant-releases/release-vue', (route) => route.fulfill({ json: releaseFixture('vue') }));
    await page.route('**/v1/me/variant-releases/release-vue/reports', (route) =>
      route.fulfill({ json: { variantReleaseId: 'release-vue', reports: [] } }),
    );
    await page.route('**/v1/me/variant-releases/release-vue/artifacts**', (route) =>
      route.fulfill({ body: '# Secret Internal Doc', contentType: 'text/markdown' }),
    );
    await page.route('**/v1/preview-grants', (route) =>
      route.fulfill({ json: { bootstrapUrl: ipBootstrap, expiresAt: new Date(Date.now() + 300_000).toISOString(), mode: 'ip-port' } }),
    );
    await page.route('https://127.0.0.1:5443/bootstrap**', (route) =>
      route.fulfill({ body: 'Preview OK', contentType: 'text/html' }),
    );
    await page.route('https://registry.npmjs.org/echarts/latest', (route) => route.fulfill({ json: officialFixture() }));
    await page.route('**/v1/components**', (route) => route.fulfill({ json: { items: [], page: 1, pageSize: 100, total: 0 } }));

    await page.goto(`${origin}/library/release-vue`);
    await expect(page.getByTestId('library-detail')).toBeVisible();
    await expect(page.locator('iframe.preview-frame')).toHaveCount(1);

    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.getByTestId('library-detail-unauthenticated')).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('# Secret Internal Doc');
  });

  test('revocation clears private detail and preview iframe upon window focus re-check', async ({ page }) => {
    let revoked = false;
    await page.route('**/v1/auth/oidc/session', (route) =>
      route.fulfill({ json: { authenticated: true, administrator: false, subject: 'alice', roles: ['reader'] } }),
    );
    await page.route('**/v1/me/components**', (route) =>
      revoked ? route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }) : route.fulfill({ json: catalogFixture('vue') }),
    );
    await page.route('**/v1/me/variant-releases/release-vue', (route) =>
      revoked ? route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }) : route.fulfill({ json: releaseFixture('vue') }),
    );
    await page.route('**/v1/me/variant-releases/release-vue/reports', (route) =>
      route.fulfill({ json: { variantReleaseId: 'release-vue', reports: [] } }),
    );
    await page.route('**/v1/me/variant-releases/release-vue/artifacts**', (route) =>
      route.fulfill({ body: '# Secret Internal Doc', contentType: 'text/markdown' }),
    );
    await page.route('**/v1/preview-grants', (route) =>
      route.fulfill({ json: { bootstrapUrl: ipBootstrap, expiresAt: new Date(Date.now() + 300_000).toISOString(), mode: 'ip-port' } }),
    );
    await page.route('https://127.0.0.1:5443/bootstrap**', (route) =>
      route.fulfill({ body: 'Preview OK', contentType: 'text/html' }),
    );
    await page.route('https://registry.npmjs.org/echarts/latest', (route) => route.fulfill({ json: officialFixture() }));
    await page.route('**/v1/components**', (route) => route.fulfill({ json: { items: [], page: 1, pageSize: 100, total: 0 } }));

    await page.goto(`${origin}/library/release-vue`);
    await expect(page.getByTestId('library-detail')).toBeVisible();
    await expect(page.locator('iframe.preview-frame')).toHaveCount(1);

    // Revoke permission on backend and trigger window focus re-check
    revoked = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));

    await expect(page.getByTestId('library-detail-forbidden')).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('# Secret Internal Doc');
  });
});
