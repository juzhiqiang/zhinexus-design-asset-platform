import { expect, test, type Page } from '@playwright/test';
import type { ChartEvent } from '../../packages/charts-core/src/index.js';

const VUE_BAR = 'http://127.0.0.1:5174/bar.html';
const REACT_BAR = 'http://127.0.0.1:5175/bar.html';
// StrictMode 的 Effect 双调用只发生在开发态，预览产物无法覆盖
const REACT_BAR_DEV = 'http://127.0.0.1:5176/bar.html';

type CheckResult = { name: string; status: 'passed' | 'failed'; message?: string };

type ExampleTestHook = {
  pointClientPosition(seriesIndex: number, dataIndex: number): { x: number; y: number } | null;
  getClicks(): ChartEvent[];
  clearClicks(): void;
  remount(): void;
  seriesData(): (number | null)[][];
};

declare global {
  interface Window {
    __COMPONENT_EXAMPLE__?: {
      readonly ready: Promise<void>;
      readonly states: readonly string[];
      runState(name: string): Promise<void>;
      getChecks(): CheckResult[];
    };
    __COMPONENT_EXAMPLE_TEST__?: ExampleTestHook;
  }
}

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function openExample(page: Page, url: string): Promise<string[]> {
  const pageErrors = collectPageErrors(page);
  await page.goto(url);
  await page.waitForFunction(() => window.__COMPONENT_EXAMPLE__ !== undefined);
  await page.evaluate(() => window.__COMPONENT_EXAMPLE__!.ready);
  return pageErrors;
}

async function runState(page: Page, name: string): Promise<void> {
  await page.evaluate((state) => window.__COMPONENT_EXAMPLE__!.runState(state), name);
}

async function checkByName(page: Page, name: string): Promise<CheckResult | undefined> {
  const checks = await page.evaluate(() => window.__COMPONENT_EXAMPLE__!.getChecks());
  return checks.find((check) => check.name === name);
}

/**
 * 点击柱条内部：`pointClientPosition` 返回柱条顶边像素，直接点顶边容易落在描边上，
 * 向下偏移若干像素保证落在柱体内部。单系列状态下柱条居中于类目带，坐标即柱条中心。
 */
const BAR_BODY_OFFSET_Y = 8;

async function clickFirstBar(page: Page): Promise<void> {
  const position = await page.evaluate(() =>
    window.__COMPONENT_EXAMPLE_TEST__!.pointClientPosition(0, 0),
  );
  expect(position).not.toBeNull();
  await page.mouse.click(position!.x, position!.y + BAR_BODY_OFFSET_Y);
}

async function assertChecksPass(page: Page, url: string): Promise<void> {
  for (const name of ['single-instance', 'no-page-error', 'series-match', 'renderer-match']) {
    expect((await checkByName(page, name))?.status, `${url} ${name}`).toBe('passed');
  }
}

for (const url of [VUE_BAR, REACT_BAR]) {
  test(`bar_empty_data_renders_no_series: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    await expect(page.locator('.charts-bar canvas')).toHaveCount(1);

    await runState(page, 'empty');
    expect(await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData())).toEqual([]);
    await expect(page.locator('.charts-bar canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`bar_missing_values_stay_missing: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    await runState(page, 'missing');

    const data = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData());
    expect(data).toHaveLength(2);
    // 缺失值必须是 null，任何位置都不允许被写成 0
    expect(data[0]).toEqual([null, 55, null, 60]);
    expect(data[1]).toEqual([40, null, 80, null]);
    expect(JSON.stringify(data)).not.toContain(',0,');
    await expect(page.locator('.charts-bar canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`bar_negative_values_render_below_zero: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    await runState(page, 'negative');

    const data = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData());
    expect(data[0]).toEqual([120, -40, 60, null]);
    expect(data[0]).toContain(-40);

    // 几何断言：负值柱条必须画在正值柱条下方（屏幕坐标 y 更大）
    const positive = await page.evaluate(() =>
      window.__COMPONENT_EXAMPLE_TEST__!.pointClientPosition(0, 0),
    );
    const negative = await page.evaluate(() =>
      window.__COMPONENT_EXAMPLE_TEST__!.pointClientPosition(0, 1),
    );
    expect(positive).not.toBeNull();
    expect(negative).not.toBeNull();
    expect(negative!.y).toBeGreaterThan(positive!.y);

    await expect(page.locator('.charts-bar canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`bar_update_removes_series_without_ghosts: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    expect(
      (await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData())).length,
    ).toBe(2);

    // A/B → A：只剩一个系列，不残留旧系列，也不产生第二个画布
    await runState(page, 'single');
    expect(
      (await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData())).length,
    ).toBe(1);
    await expect(page.locator('.charts-bar canvas')).toHaveCount(1);

    // A → A/B：replaceMerge 恢复两个系列
    await runState(page, 'updated');
    expect(
      (await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData())).length,
    ).toBe(2);
    await expect(page.locator('.charts-bar canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`bar_click_payload_is_consistent: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    // 单系列状态：柱条居中于类目带，点击坐标稳定命中柱体
    await runState(page, 'single');
    await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());

    await clickFirstBar(page);

    const clicks = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks());
    expect(clicks, `${url} 点击次数`).toHaveLength(1);
    expect(clicks[0]).toEqual({
      seriesId: 'revenue',
      dataIndex: 0,
      value: ['周一', 120],
      nativeType: 'click',
    });
    expect(pageErrors).toEqual([]);
  });
}

test('bar_click_payload_matches_in_both_frameworks', async ({ page }) => {
  const payloads: ChartEvent[] = [];
  for (const url of [VUE_BAR, REACT_BAR]) {
    const pageErrors = await openExample(page, url);
    await runState(page, 'single');
    await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());
    await clickFirstBar(page);
    const clicks = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks());
    expect(clicks, `${url} 点击次数`).toHaveLength(1);
    payloads.push(clicks[0]!);
    expect(pageErrors, `${url} 页面错误`).toEqual([]);
  }
  // 两个框架对同一柱条产生完全等价的事件载荷
  expect(payloads[0]).toEqual(payloads[1]);
  expect(payloads[0]).toEqual({
    seriesId: 'revenue',
    dataIndex: 0,
    value: ['周一', 120],
    nativeType: 'click',
  });
});

test('react_bar_strictmode_cleans_and_remounts', async ({ page }) => {
  const pageErrors = await openExample(page, REACT_BAR_DEV);

  await expect(page.locator('.charts-bar canvas')).toHaveCount(1);
  await assertChecksPass(page, REACT_BAR_DEV);

  // 卸载后重新挂载：清理彻底，不残留实例、画布或重复监听
  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.remount());
  await page.evaluate(() => window.__COMPONENT_EXAMPLE__!.ready);
  await expect(page.locator('.charts-bar canvas')).toHaveCount(1);

  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());
  await clickFirstBar(page);
  expect(await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks())).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

test('vue_bar_remount_leaves_single_instance', async ({ page }) => {
  const pageErrors = await openExample(page, VUE_BAR);
  await expect(page.locator('.charts-bar canvas')).toHaveCount(1);

  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.remount());
  await page.evaluate(() => window.__COMPONENT_EXAMPLE__!.ready);
  await expect(page.locator('.charts-bar canvas')).toHaveCount(1);

  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());
  await clickFirstBar(page);
  expect(await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks())).toHaveLength(1);
  await assertChecksPass(page, VUE_BAR);
  expect(pageErrors).toEqual([]);
});
