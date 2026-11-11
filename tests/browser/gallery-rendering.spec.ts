import { expect, test } from '@playwright/test';

test('public gallery content and metadata are present in the initial HTML', async ({ page }) => {
  const response = await page.goto('http://127.0.0.1:5173/components');
  expect(response).not.toBeNull();
  const html = await response!.text();

  expect(html).toContain('Zhinexus 组件资产平台');
  expect(html).toContain('公开组件目录正在建设中');
  await expect(page).toHaveTitle(/组件目录.*Zhinexus/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Vue.*React/);
});

test('console placeholder is marked noindex and excluded from the sitemap', async ({ page, request }) => {
  const response = await page.goto('http://127.0.0.1:5173/upload');
  expect(response).not.toBeNull();
  const html = await response!.text();

  expect(html).toContain('登录后开放');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  const sitemap = await request.get('http://127.0.0.1:5173/sitemap.xml');
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
});

test('component detail paths stay unavailable until public catalog data exists', async ({ request }) => {
  const response = await request.get('http://127.0.0.1:5173/components/not-published');
  expect(response.status()).toBe(404);
});
