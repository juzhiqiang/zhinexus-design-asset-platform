import { expect, test, type Page } from '@playwright/test';
import { catalogFixture, compatibilityFixture, officialFixture, releaseFixture } from '../gallery/echarts-compatibility-fixtures.js';

const origin = process.env.GALLERY_TEST_ORIGIN ?? 'http://127.0.0.1:5173';

async function mockSources(page: Page, options: { officialFailure?: boolean; measuredFailure?: boolean; empty?: boolean; unpublished?: boolean } = {}) {
  await page.route('https://registry.npmjs.org/echarts/latest', route => route.fulfill({ status: options.officialFailure ? 503 : 200, json: officialFixture() }));
  await page.route('**/v1/**', async route => {
    const url = new URL(route.request().url());
    const framework = url.searchParams.get('framework') === 'react' || url.pathname.includes('release-react') ? 'react' : 'vue';
    if (url.pathname === '/v1/components') {
      await route.fulfill({ json: options.unpublished ? { items: [], page: 1, pageSize: 100, total: 0 } : catalogFixture(framework) });
    } else if (url.pathname.endsWith('/compatibility')) {
      await route.fulfill({ status: options.measuredFailure ? 503 : 200, json: options.empty ? { variantReleaseId: `release-${framework}`, items: [] } : compatibilityFixture(framework) });
    } else if (url.pathname.startsWith('/v1/variant-releases/')) {
      await route.fulfill({ json: releaseFixture(framework) });
    } else await route.fulfill({ status: 404, json: {} });
  });
}

test('official discovery and actual measured support remain distinct', async ({ page }) => {
  await mockSources(page);
  await page.goto(`${origin}/components/line`);
  const panel = page.getByRole('region', { name: 'ECharts 版本与实测兼容', exact: true });
  const official = panel.getByRole('region', { name: '官方 ECharts 发现', exact: true });
  const measured = panel.getByRole('region', { name: '已接收实测支持', exact: true });
  await expect(official).toContainText('6.2.0');
  await expect(official).toContainText('发现结果不代表组件已兼容');
  await expect(official.getByRole('link')).toHaveAttribute('href', 'https://registry.npmjs.org/echarts/latest');
  await expect(official.locator('time')).toHaveAttribute('datetime', /T/);
  await expect(measured).toContainText('@company/charts-vue@0.0.12');
  await expect(measured).toContainText('ECharts 6.1.0');
  await expect(measured).toContainText('Vue 3.5.45');
  await expect(measured).toContainText('accepted-vue');
  await expect(measured).not.toContainText('6.2.0');
  await page.getByRole('tab', { name: /React 19/ }).click();
  await expect(measured).toContainText('@company/charts-react@0.0.12');
  await expect(measured).toContainText('React 19.3.1');
  await expect(measured).toContainText('accepted-react');
  await expect(measured).not.toContainText('accepted-vue');
});

test('a published implementation without records has no verified support claim', async ({ page }) => {
  await mockSources(page, { empty: true });
  await page.goto(`${origin}/components/line`);
  const measured = page.getByRole('region', { name: '已接收实测支持', exact: true });
  await expect(measured).toContainText('暂无已接收的实测兼容记录');
  await expect(measured).not.toContainText('accepted-vue');
  await expect(measured).not.toContainText('ECharts 6.1.0');
});

test('an unpublished implementation does not inherit static accepted metadata', async ({ page }) => {
  await mockSources(page, { unpublished: true });
  await page.goto(`${origin}/components/line`);
  const measured = page.getByRole('region', { name: '已接收实测支持', exact: true });
  await expect(measured).toContainText('当前框架实现尚无公开发布，未验证兼容性');
  await expect(measured).not.toContainText('6.1.0');
});

test('an official discovery failure leaves measured records visible', async ({ page }) => {
  await mockSources(page, { officialFailure: true });
  await page.goto(`${origin}/components/line`);
  await expect(page.getByRole('region', { name: '官方 ECharts 发现', exact: true })).toContainText('官方源暂不可用');
  await expect(page.getByRole('region', { name: '已接收实测支持', exact: true })).toContainText('accepted-vue');
});

test('a compatibility service failure does not become accepted support', async ({ page }) => {
  await mockSources(page, { measuredFailure: true });
  await page.goto(`${origin}/components/line`);
  const measured = page.getByRole('region', { name: '已接收实测支持', exact: true });
  await expect(measured).toContainText('实测记录暂不可用');
  await expect(measured).not.toContainText('accepted-vue');
  await expect(page.getByRole('region', { name: '官方 ECharts 发现', exact: true })).toContainText('6.2.0');
});

test('switching frameworks suppresses both stale visible records and late responses', async ({ page }) => {
  await mockSources(page);
  await page.goto(`${origin}/components/line`);
  const measured = page.getByRole('region', { name: '已接收实测支持', exact: true });
  await expect(measured).toContainText('accepted-vue');
  let releaseResponse: (() => void) | undefined;
  const released = new Promise<void>(resolve => { releaseResponse = resolve; });
  let requested: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/v1/variant-releases/release-react/compatibility', async route => {
    requested?.();
    await released;
    await route.fulfill({ json: compatibilityFixture('react') }).catch(() => undefined);
  });
  await page.getByRole('tab', { name: /React 19/ }).click();
  await pending;
  await expect(measured).toContainText('正在读取实测记录');
  await expect(measured).not.toContainText('accepted-vue');
  await page.getByRole('tab', { name: /Vue 3/ }).click();
  await expect(measured).toContainText('accepted-vue');
  releaseResponse?.();
  await expect(measured).not.toContainText('accepted-react');
  await expect(measured).toContainText('@company/charts-vue@0.0.12');
});
