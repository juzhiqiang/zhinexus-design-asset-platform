import { expect, test } from '@playwright/test';
import type { ChartData } from '../../packages/charts-core/src/index.js';

const HARNESS_URL = 'http://127.0.0.1:5174/harness.html';

type CoreHarness = {
  create(host: HTMLElement, config?: Record<string, unknown>): void;
  update(data: ChartData): void;
  setPresentation(theme: 'light' | 'dark', renderer: 'canvas' | 'svg'): void;
  whenRendered(): Promise<void>;
  hasInstance(): boolean;
  seriesIds(): string[];
  dispose(): void;
};

declare global {
  interface Window {
    __CORE_HARNESS__?: CoreHarness;
  }
}

const withTwoSeries: ChartData = {
  series: [
    {
      id: 'alpha',
      name: '甲',
      points: [
        { x: 'Q1', y: 10 },
        { x: 'Q2', y: 20 },
      ],
    },
    {
      id: 'beta',
      name: '乙',
      points: [
        { x: 'Q1', y: 5 },
        { x: 'Q2', y: 15 },
      ],
    },
  ],
};

const withOneSeries: ChartData = { series: [withTwoSeries.series[0]!] };

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS_URL);
  await page.waitForFunction(() => window.__CORE_HARNESS__ !== undefined);
});

test('removes_series_without_ghosts', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.evaluate((data) => {
    const host = document.getElementById('host');
    if (!host) throw new Error('harness host missing');
    window.__CORE_HARNESS__!.create(host, { renderer: 'canvas', theme: 'light', animation: false });
    window.__CORE_HARNESS__!.update(data);
  }, withTwoSeries);
  await page.evaluate(() => window.__CORE_HARNESS__!.whenRendered());
  expect(await page.evaluate(() => window.__CORE_HARNESS__!.seriesIds())).toEqual(['alpha', 'beta']);

  // 从 A/B 更新为 A 后，实例只含 A，不残留 B 系列，也不产生第二个画布
  await page.evaluate((data) => window.__CORE_HARNESS__!.update(data), withOneSeries);
  await page.evaluate(() => window.__CORE_HARNESS__!.whenRendered());
  expect(await page.evaluate(() => window.__CORE_HARNESS__!.seriesIds())).toEqual(['alpha']);
  await expect(page.locator('#host canvas')).toHaveCount(1);

  expect(pageErrors).toEqual([]);
});

test('does_not_initialize_zero_size', async ({ page }) => {
  await page.evaluate(() => {
    const wrapper = document.createElement('div');
    wrapper.id = 'zero-host';
    wrapper.style.width = '0px';
    wrapper.style.height = '0px';
    document.body.appendChild(wrapper);
    window.__CORE_HARNESS__!.create(wrapper, { renderer: 'canvas', theme: 'light', animation: false });
  });

  // 零宽高容器不得初始化实例，也不得留下画布
  expect(await page.evaluate(() => window.__CORE_HARNESS__!.hasInstance())).toBe(false);
  await expect(page.locator('#zero-host canvas')).toHaveCount(0);

  // 容器恢复有效尺寸后才创建实例并完成渲染
  await page.evaluate(() => {
    const wrapper = document.getElementById('zero-host');
    if (!wrapper) throw new Error('zero-host missing');
    wrapper.style.width = '320px';
    wrapper.style.height = '200px';
  });
  await page.waitForFunction(() => window.__CORE_HARNESS__?.hasInstance() === true);
  await page.evaluate(() => window.__CORE_HARNESS__!.whenRendered());
  await expect(page.locator('#zero-host canvas')).toHaveCount(1);
});

test('dispose_is_idempotent_and_releases_the_instance', async ({ page }) => {
  await page.evaluate((data) => {
    const host = document.getElementById('host');
    if (!host) throw new Error('harness host missing');
    window.__CORE_HARNESS__!.create(host, { renderer: 'canvas', theme: 'light', animation: false });
    window.__CORE_HARNESS__!.update(data);
  }, withTwoSeries);
  await page.evaluate(() => window.__CORE_HARNESS__!.whenRendered());
  expect(await page.evaluate(() => window.__CORE_HARNESS__!.hasInstance())).toBe(true);

  // 重复 dispose 安全，并解除监听、断开观察器、销毁实例
  await page.evaluate(() => {
    window.__CORE_HARNESS__!.dispose();
    window.__CORE_HARNESS__!.dispose();
  });
  expect(await page.evaluate(() => window.__CORE_HARNESS__!.hasInstance())).toBe(false);
  await expect(page.locator('#host canvas')).toHaveCount(0);

  // 销毁后的 update 不再创建实例，也不抛错
  await page.evaluate((data) => {
    window.__CORE_HARNESS__!.update(data);
  }, withOneSeries);
  expect(await page.evaluate(() => window.__CORE_HARNESS__!.hasInstance())).toBe(false);
});

test('set_presentation_rebuilds_without_losing_data', async ({ page }) => {
  await page.evaluate((data) => {
    const host = document.getElementById('host');
    if (!host) throw new Error('harness host missing');
    window.__CORE_HARNESS__!.create(host, { renderer: 'canvas', theme: 'light', animation: false });
    window.__CORE_HARNESS__!.update(data);
  }, withTwoSeries);
  await page.evaluate(() => window.__CORE_HARNESS__!.whenRendered());

  // 主题 / 渲染器切换销毁重建，数据保留，且只存在一个实例
  await page.evaluate(() => {
    window.__CORE_HARNESS__!.setPresentation('dark', 'svg');
  });
  await page.evaluate(() => window.__CORE_HARNESS__!.whenRendered());
  expect(await page.evaluate(() => window.__CORE_HARNESS__!.seriesIds())).toEqual(['alpha', 'beta']);
  await expect(page.locator('#host svg')).toHaveCount(1);
  await expect(page.locator('#host canvas')).toHaveCount(0);
});
