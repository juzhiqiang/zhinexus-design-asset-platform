import { expect, test, type Page } from '@playwright/test';
import { catalogFixture, officialFixture } from '../gallery/echarts-compatibility-fixtures.js';

const origin = process.env.GALLERY_TEST_ORIGIN ?? 'http://127.0.0.1:5173';
const ipMode = process.env.NEXT_PUBLIC_PLATFORM_PREVIEW_MODE === 'ip-port';
const bearer = 'test-gallery-session';
const bootstrap = (host: string, token: string) => `https://${host}/bootstrap?grant=${token.repeat(43)}`;
const ipHost = '127.0.0.1:5443';
const domainHost = 'r-release-vue.preview.example.test';
const vueFallback = 'http://127.0.0.1:5174/index.html';

async function mockCatalog(page: Page, signedIn = true) {
  if (signedIn) await page.addInitScript(token => {
    localStorage.setItem('zhinexus_console_auth', JSON.stringify({ token, subject: 'gallery-reader', roles: ['read'], channel: 'web' }));
  }, bearer);
  await page.route('https://registry.npmjs.org/echarts/latest', route => route.fulfill({ json: officialFixture() }));
  await page.route('**/v1/components?**', route => {
    const framework = new URL(route.request().url()).searchParams.get('framework') === 'react' ? 'react' : 'vue';
    return route.fulfill({ json: catalogFixture(framework) });
  });
  await page.route('**/v1/variant-releases/**', route => route.fulfill({ status: 404, json: {} }));
  await page.route('https://**/bootstrap?**', route => route.fulfill({ body: 'Preview', contentType: 'text/html' }));
  await page.route(url => url.hostname === '127.0.0.1' && ['5174', '5175'].includes(url.port), route => route.fulfill({ body: 'Local preview', contentType: 'text/html' }));
}

const grantJson = (bootstrapUrl: string) => ({ bootstrapUrl, expiresAt: new Date(Date.now() + 300_000).toISOString() });

test('grants use the selected ready release and keep IP previews in an opaque sandbox', async ({ page }) => {
  await mockCatalog(page);
  const requests: Array<{ id: string; authorization?: string }> = [];
  let finishReact!: () => void;
  const reactResponse = new Promise<void>(resolve => { finishReact = resolve; });
  await page.route('**/v1/preview-grants', async route => {
    const request = route.request();
    const id = request.postDataJSON().variantReleaseId;
    requests.push({ id, authorization: request.headers().authorization });
    const sequence = requests.length;
    if (sequence === 3) await reactResponse;
    const url = bootstrap(ipHost, String(sequence));
    await route.fulfill({ json: grantJson(url) }).catch(() => undefined);
  });

  await page.goto(`${origin}/components/line`, { waitUntil: 'domcontentloaded' });
  const preview = page.getByRole('region', { name: '组件沙箱隔离预览' });
  const iframe = preview.locator('iframe');
  await expect.poll(() => requests[0]).toEqual({ id: 'release-vue', authorization: `Bearer ${bearer}` });
  await expect(iframe).toHaveAttribute('src', bootstrap(ipHost, '1'));
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(preview.getByText('独立窗口', { exact: false })).toHaveCount(0);

  await preview.getByRole('button', { name: '刷新预览' }).click();
  await expect(iframe).toHaveAttribute('src', bootstrap(ipHost, '2'));
  expect(requests[1]?.id).toBe('release-vue');

  await page.getByRole('tab', { name: /React 19/ }).click();
  await expect.poll(() => requests[2]?.id).toBe('release-react');
  await expect(preview.locator(`iframe[src="${bootstrap(ipHost, '2')}"]`)).toHaveCount(0);
  await page.getByRole('tab', { name: /Vue 3/ }).click();
  await expect(iframe).toHaveAttribute('src', bootstrap(ipHost, '4'));
  finishReact();
  await expect(iframe).toHaveAttribute('title', /Vue 3/);
  await expect(iframe).toHaveAttribute('src', bootstrap(ipHost, '4'));

  await page.getByRole('tab', { name: /React 19/ }).click();
  await expect(iframe).toHaveAttribute('src', bootstrap(ipHost, '5'));
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  expect(requests[4]?.id).toBe('release-react');
});

test('registered domain preview keeps its origin and opens a fresh grant in a separate window', async ({ page }) => {
  test.skip(ipMode, 'Registered domain behavior uses the default gallery mode.');
  await mockCatalog(page);
  let requests = 0;
  await page.route('**/v1/preview-grants', route => route.fulfill({ json: grantJson(bootstrap(domainHost, String(++requests))) }));
  const navigated = page.context().waitForEvent('request', { predicate: request => request.url() === bootstrap(domainHost, '2') });
  await page.context().route(`https://${domainHost}/bootstrap?**`, route => route.fulfill({ body: 'Preview', contentType: 'text/html' }));
  await page.goto(`${origin}/components/line`, { waitUntil: 'domcontentloaded' });
  const iframe = page.locator('iframe.preview-frame');
  await expect(iframe).toHaveAttribute('src', bootstrap(domainHost, '1'));
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByText('独立窗口', { exact: false }).click()]);
  const popupRequest = await navigated;
  expect(popupRequest.headers().referer).toBeUndefined();
  await popup.waitForURL(bootstrap(domainHost, '2'));
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await expect(iframe).toHaveAttribute('src', bootstrap(domainHost, '1'));
});

for (const [caseName, host] of [['unexpected IP', '127.0.0.2:5443'], ['gallery host and port', new URL(origin).host]] as const) {
  test(`declines an IP bootstrap with ${caseName}`, async ({ page }) => {
    await mockCatalog(page);
    await page.route('**/v1/preview-grants', route => route.fulfill({ json: grantJson(bootstrap(host, '1')) }));
    const response = page.waitForResponse('**/v1/preview-grants');
    await page.goto(`${origin}/components/line`, { waitUntil: 'domcontentloaded' });
    await response;
    const preview = page.getByRole('region', { name: '组件沙箱隔离预览' });
    if (ipMode) {
      await expect(preview).toContainText('暂时无法打开预览');
      await expect(preview.locator('iframe')).toHaveCount(0);
      await expect(preview.getByText('独立窗口', { exact: false })).toHaveCount(0);
    } else {
      await expect(preview.locator('iframe')).toHaveAttribute('src', vueFallback);
    }
  });
}

test('failed authorization in IP mode leaves no fallback frame or window action', async ({ page }) => {
  test.skip(!ipMode, 'Failure behavior requires the explicit gallery IP mode.');
  await mockCatalog(page, false);
  await page.route('**/v1/preview-grants', route => route.fulfill({ status: 401, json: {} }));
  await page.goto(`${origin}/components/line`, { waitUntil: 'domcontentloaded' });
  const preview = page.getByRole('region', { name: '组件沙箱隔离预览' });
  await expect(preview).toContainText('暂时无法打开预览');
  await expect(preview.locator('iframe')).toHaveCount(0);
  await expect(preview.getByText('独立窗口', { exact: false })).toHaveCount(0);
  await expect(preview.getByRole('button', { name: '刷新预览' })).toBeEnabled();
});
