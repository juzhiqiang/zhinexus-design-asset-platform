import { expect, test } from '@playwright/test';

const galleryOrigin = process.env.GALLERY_TEST_ORIGIN ?? 'http://127.0.0.1:5173';
const adminOrigin = process.env.ADMIN_TEST_ORIGIN ?? 'http://127.0.0.1:5177';

test('public gallery content and metadata are present in the initial HTML without fake preset fallback or admin nav', async ({ page }) => {
  const response = await page.goto(`${galleryOrigin}/components`);
  expect(response).not.toBeNull();
  expect(response!.status()).toBe(200);
  const html = await response!.text();

  expect(html).toContain('Zhinexus 组件资产平台');
  expect(html).toContain('公开组件目录正在建设中');
  expect(html).not.toContain('浏览官方预置资产规范');
  expect(html).not.toContain('/upload');
  expect(html).not.toContain('/access-settings');
  expect(html).not.toContain('/users');
  await expect(page).toHaveTitle(/组件目录.*Zhinexus/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Vue.*React/);
  await expect(page.getByRole('button', { name: /浏览官方预置资产规范/ })).toHaveCount(0);
  await expect(page.locator('header a[href="/upload"]')).toHaveCount(0);
});

test('old admin routes return 404 on gallery and sitemap excludes /upload and /library', async ({ request }) => {
  for (const path of ['/upload', '/match', '/users', '/access-settings', '/jobs/job-1']) {
    const res = await request.get(`${galleryOrigin}${path}`);
    expect(res.status(), `gallery ${path} should be 404`).toBe(404);
  }

  const sitemap = await request.get(`${galleryOrigin}/sitemap.xml`);
  const sitemapXml = await sitemap.text();
  expect(sitemap.status()).toBe(200);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (siteUrl) {
    expect(sitemapXml).toContain(new URL('/components', siteUrl).toString());
    expect(sitemapXml).toContain(new URL('/', siteUrl).toString());
  } else {
    expect(sitemapXml).not.toContain('<loc>');
  }
  expect(sitemapXml).not.toContain('/upload');
  expect(sitemapXml).not.toContain('/library');
});

test('public component detail paths return 404 until real public catalog API publishes them (no static bypass)', async ({ request }) => {
  for (const slug of ['not-published', 'line', 'bar', 'pie', 'scatter']) {
    const response = await request.get(`${galleryOrigin}/components/${slug}`);
    expect(response.status(), `/components/${slug} should be 404 without public API`).toBe(404);
  }
});

test('admin root redirects through assets to login and marks all pages noindex', async ({ page }) => {
  await page.route('**/v1/auth/oidc/session', route => route.fulfill({ status:401, json: { code:'UNAUTHENTICATED' } }));
  const response = await page.goto(`${adminOrigin}/`);
  expect(response).not.toBeNull();
  await expect(page).toHaveURL(/\/login\?next=%2Fassets$/);
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute('content', /noindex/);
  await expect(page.getByRole('heading', {name:'管理员登录'})).toBeVisible();
});
