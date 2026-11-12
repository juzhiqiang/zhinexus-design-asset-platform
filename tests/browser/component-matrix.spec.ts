import { expect, test, type Page } from '@playwright/test';
import type { ChartEvent } from '../../packages/charts-core/src/index.js';

const VUE_BAR = 'http://127.0.0.1:5174/bar.html';
const REACT_BAR = 'http://127.0.0.1:5175/bar.html';
// StrictMode 的 Effect 双调用只发生在开发态，预览产物无法覆盖
const REACT_BAR_DEV = 'http://127.0.0.1:5176/bar.html';

const VUE_PIE = 'http://127.0.0.1:5174/pie.html';
const REACT_PIE = 'http://127.0.0.1:5175/pie.html';
const REACT_PIE_DEV = 'http://127.0.0.1:5176/pie.html';

const VUE_SCATTER = 'http://127.0.0.1:5174/scatter.html';
const REACT_SCATTER = 'http://127.0.0.1:5175/scatter.html';
const REACT_SCATTER_DEV = 'http://127.0.0.1:5176/scatter.html';

const VUE_TREND_CARD = 'http://127.0.0.1:5174/trend-card.html';
const REACT_TREND_CARD = 'http://127.0.0.1:5175/trend-card.html';
const REACT_TREND_CARD_DEV = 'http://127.0.0.1:5176/trend-card.html';

const VUE_RANKING = 'http://127.0.0.1:5174/ranking.html';
const REACT_RANKING = 'http://127.0.0.1:5175/ranking.html';
const REACT_RANKING_DEV = 'http://127.0.0.1:5176/ranking.html';

const VUE_PROPORTION = 'http://127.0.0.1:5174/proportion.html';
const REACT_PROPORTION = 'http://127.0.0.1:5175/proportion.html';
const REACT_PROPORTION_DEV = 'http://127.0.0.1:5176/proportion.html';

type CheckResult = { name: string; status: 'passed' | 'failed'; message?: string };

type ExampleTestHook = {
  pointClientPosition(seriesIndex: number, dataIndex: number): { x: number; y: number } | null;
  getClicks(): ChartEvent[];
  clearClicks(): void;
  remount(): void;
  seriesData(): (number | null)[][];
  /** 饼图 / 环形图的内外半径（百分比字符串），用于断言 donut 只改变内半径。 */
  seriesRadius(seriesIndex: number): [string, string] | null;
  /**
   * 扇形在画布上的实际内外半径（像素）。option 里的半径只是声明值，
   * 实心饼图必须由渲染几何证明内半径为 0。
   */
  sectorRadii(seriesIndex: number, dataIndex: number): { inner: number; outer: number } | null;
  /** 趋势卡片数值摘要槽位文本（[标题, 当前值, meta]）；ignore 槽位为 null。 */
  summarySlots(): (string | null)[];
  /** 类目轴标签文本（已应用 axisLabel.formatter）：断言排行榜名次标签。 */
  categoryLabels(): string[];
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
 * 重新挂载后测试钩子会异步替换，先等待当前钩子报告文档内的有效坐标再点击。
 */
const BAR_BODY_OFFSET_Y = 8;

async function clickFirstBar(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const hook = window.__COMPONENT_EXAMPLE_TEST__;
    if (!hook) {
      return false;
    }
    const position = hook.pointClientPosition(0, 0);
    return position != null && position.x > 0 && position.y > 0;
  });
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

/**
 * 点击饼图扇形：`pointClientPosition` 对无坐标轴图表回退到扇形几何中心
 * （环带中点角度 + 内外半径中点），坐标落在扇形内部，无需额外偏移。
 */
async function clickFirstSlice(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const hook = window.__COMPONENT_EXAMPLE_TEST__;
    if (!hook) {
      return false;
    }
    const position = hook.pointClientPosition(0, 0);
    return position != null && position.x > 0 && position.y > 0;
  });
  const position = await page.evaluate(() =>
    window.__COMPONENT_EXAMPLE_TEST__!.pointClientPosition(0, 0),
  );
  expect(position).not.toBeNull();
  await page.mouse.click(position!.x, position!.y);
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

  // 重新挂载后回到单系列状态（柱条居中，点击坐标稳定），点击只产生一次事件
  await runState(page, 'single');
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

  await runState(page, 'single');
  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());
  await clickFirstBar(page);
  expect(await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks())).toHaveLength(1);
  await assertChecksPass(page, VUE_BAR);
  expect(pageErrors).toEqual([]);
});

for (const url of [VUE_PIE, REACT_PIE]) {
  test(`pie_empty_data_renders_no_series: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    await expect(page.locator('.charts-pie canvas')).toHaveCount(1);

    await runState(page, 'empty');
    expect(await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData())).toEqual([]);
    await expect(page.locator('.charts-pie canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`pie_missing_values_stay_missing: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    await runState(page, 'missing');

    const data = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData());
    expect(data).toHaveLength(1);
    // 缺失值必须是 null，任何位置都不允许被写成 0
    expect(data[0]).toContain(null);
    expect(data[0]).not.toContain(0);
    expect(JSON.stringify(data)).not.toContain(',0,');
    await expect(page.locator('.charts-pie canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`pie_zero_total_never_produces_nan: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    await runState(page, 'zero-total');

    const data = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData());
    expect(data).toEqual([[0, 0]]);
    // 总量为零时占比不可算，任何序列化结果都不得出现 NaN
    expect(JSON.stringify(data)).not.toContain('NaN');
    await expect(page.locator('.charts-pie canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`pie_nested_rings_and_update_remove_series: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    expect(
      (await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData())).length,
    ).toBe(1);

    // 1 → 2 环：嵌套环按稳定 id 合并
    await runState(page, 'nested');
    expect(
      (await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData())).length,
    ).toBe(2);
    await expect(page.locator('.charts-pie canvas')).toHaveCount(1);

    // 2 → 1 环：replaceMerge 删除系列，不残留旧环，也不产生第二个画布
    await runState(page, 'updated');
    expect(
      (await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData())).length,
    ).toBe(1);
    await expect(page.locator('.charts-pie canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`pie_click_payload_is_consistent: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());

    await clickFirstSlice(page);

    const clicks = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks());
    expect(clicks, `${url} 点击次数`).toHaveLength(1);
    expect(clicks[0]).toEqual({
      seriesId: 'share',
      dataIndex: 0,
      value: ['搜索', 120],
      nativeType: 'click',
    });
    expect(pageErrors).toEqual([]);
  });

  test(`pie_donut_inner_radius_is_applied: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    // 示例固定使用环形图：内半径必须大于 0，且由外半径的 50% 预留
    expect(
      await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesRadius(0)),
    ).toEqual(['35%', '70%']);

    // 嵌套环在内孔之外均分带宽，donut 只改变内半径
    await runState(page, 'nested');
    expect(
      await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesRadius(0)),
    ).toEqual(['52.5%', '70%']);
    expect(
      await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesRadius(1)),
    ).toEqual(['35%', '52.5%']);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });
}

/**
 * 实心饼图（`donut` 缺省或 `false`）：内半径为 0，扇形从圆心画到外半径。
 * 环形图与实心饼图只差内半径，数据、顺序、图例与事件语义必须完全一致。
 */
for (const url of [VUE_PIE, REACT_PIE]) {
  test(`pie_solid_renders_from_the_center: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    // 示例初始是环形图：内半径由外半径的 50% 预留
    expect(
      await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesRadius(0)),
    ).toEqual(['35%', '70%']);

    // 切到实心饼图：donut 变化触发控制器重建，半径与渲染几何同步改变
    await runState(page, 'solid');
    expect(
      await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesRadius(0)),
    ).toEqual(['0%', '70%']);

    // 渲染几何才是实心的证据：内半径必须为 0，外半径必须大于 0
    const radii = await page.evaluate(() =>
      window.__COMPONENT_EXAMPLE_TEST__!.sectorRadii(0, 0),
    );
    expect(radii, `${url} 第一个扇形几何`).toEqual({ inner: 0, outer: expect.any(Number) });
    expect(radii!.outer).toBeGreaterThan(0);
    await expect(page.locator('.charts-pie canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`pie_solid_nested_rings_share_the_center: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    await runState(page, 'solid-nested');

    // 两环在 70% 内均分：外环 ['35%','70%']，内环 ['0%','35%']
    expect(
      await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesRadius(0)),
    ).toEqual(['35%', '70%']);
    expect(
      await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesRadius(1)),
    ).toEqual(['0%', '35%']);

    // 内环贴着圆心，外环与内环外侧相接：内环内半径为 0，外环内半径等于内环外半径
    const innerRing = await page.evaluate(() =>
      window.__COMPONENT_EXAMPLE_TEST__!.sectorRadii(1, 0),
    );
    const outerRing = await page.evaluate(() =>
      window.__COMPONENT_EXAMPLE_TEST__!.sectorRadii(0, 0),
    );
    expect(innerRing!.inner).toBe(0);
    expect(outerRing!.inner).toBeGreaterThan(0);
    expect(outerRing!.inner).toBeCloseTo(innerRing!.outer, 5);
    await expect(page.locator('.charts-pie canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`pie_solid_missing_values_stay_missing: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    await runState(page, 'solid-missing');

    const data = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData());
    expect(data).toHaveLength(1);
    // 缺失值必须是 null，实心饼图同样不允许把缺口补成 0
    expect(data[0]).toContain(null);
    expect(data[0]).not.toContain(0);
    expect(JSON.stringify(data)).not.toContain(',0,');

    // 缺失扇形在显示列表里占位但没有角度：几何取得到，几何中心取不到，因此点不到它
    expect(
      await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.sectorRadii(0, 1)),
    ).toEqual({ inner: 0, outer: expect.any(Number) });
    expect(
      await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.pointClientPosition(0, 1)),
    ).toBeNull();
    await expect(page.locator('.charts-pie canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`pie_solid_zero_total_renders_equal_halves: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    await runState(page, 'solid-zero-total');

    const data = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData());
    expect(data).toEqual([[0, 0]]);
    // 总量为零时占比不可算，任何序列化结果都不得出现 NaN
    expect(JSON.stringify(data)).not.toContain('NaN');

    // 零总量按等分处理：两个半圆都从圆心画到外半径
    const first = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.sectorRadii(0, 0));
    const second = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.sectorRadii(0, 1));
    expect(first).toEqual({ inner: 0, outer: expect.any(Number) });
    expect(second).toEqual({ inner: 0, outer: expect.any(Number) });
    expect(second!.outer).toBeCloseTo(first!.outer, 5);
    await expect(page.locator('.charts-pie canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`pie_solid_empty_data_renders_no_geometry: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    // 经 solid 中转：空数据下 zrender 不创建画布，若从上一步环形状态直接切过来
    // 会同时触发控制器重建，画布计数与 single-instance / renderer-match 都会失败。
    // 这样走最后一步不发生重建，与环形图空数据用例保持同一口径。
    await runState(page, 'solid');
    await runState(page, 'solid-empty');

    expect(await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData())).toEqual([]);
    // 没有任何扇形，也就没有任何可点击的几何中心
    expect(
      await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.sectorRadii(0, 0)),
    ).toBeNull();
    expect(
      await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.pointClientPosition(0, 0)),
    ).toBeNull();
    await expect(page.locator('.charts-pie canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`pie_solid_click_payload_is_consistent: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());

    await runState(page, 'solid');
    await clickFirstSlice(page);

    const clicks = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks());
    expect(clicks, `${url} 点击次数`).toHaveLength(1);
    // 实心与环形的点击载荷同构：只有数据与位置不同，事件语义不变
    expect(clicks[0]).toEqual({
      seriesId: 'share',
      dataIndex: 0,
      value: ['搜索', 120],
      nativeType: 'click',
    });
    expect(pageErrors).toEqual([]);
  });
}

test('pie_click_payload_matches_in_both_frameworks', async ({ page }) => {
  const payloads: ChartEvent[] = [];
  for (const url of [VUE_PIE, REACT_PIE]) {
    const pageErrors = await openExample(page, url);
    await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());
    await clickFirstSlice(page);
    const clicks = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks());
    expect(clicks, `${url} 点击次数`).toHaveLength(1);
    payloads.push(clicks[0]!);
    expect(pageErrors, `${url} 页面错误`).toEqual([]);
  }
  // 两个框架对同一扇形产生完全等价的事件载荷
  expect(payloads[0]).toEqual(payloads[1]);
  expect(payloads[0]).toEqual({
    seriesId: 'share',
    dataIndex: 0,
    value: ['搜索', 120],
    nativeType: 'click',
  });
});

test('react_pie_strictmode_cleans_and_remounts', async ({ page }) => {
  const pageErrors = await openExample(page, REACT_PIE_DEV);

  await expect(page.locator('.charts-pie canvas')).toHaveCount(1);
  await assertChecksPass(page, REACT_PIE_DEV);

  // 卸载后重新挂载：清理彻底，不残留实例、画布或重复监听
  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.remount());
  await page.evaluate(() => window.__COMPONENT_EXAMPLE__!.ready);
  await expect(page.locator('.charts-pie canvas')).toHaveCount(1);

  // 重新挂载后点击只产生一次事件
  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());
  await clickFirstSlice(page);
  expect(await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks())).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

/**
 * 点击散点符号：`pointClientPosition` 对双数值轴图表按数据项 [x, y] 换算像素，
 * 返回的即符号中心，无需额外偏移。
 */
async function clickFirstScatterPoint(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const hook = window.__COMPONENT_EXAMPLE_TEST__;
    if (!hook) {
      return false;
    }
    const position = hook.pointClientPosition(0, 0);
    return position != null && position.x > 0 && position.y > 0;
  });
  const position = await page.evaluate(() =>
    window.__COMPONENT_EXAMPLE_TEST__!.pointClientPosition(0, 0),
  );
  expect(position).not.toBeNull();
  await page.mouse.click(position!.x, position!.y);
}

for (const url of [VUE_SCATTER, REACT_SCATTER]) {
  test(`scatter_empty_data_renders_no_series: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    await expect(page.locator('.charts-scatter canvas')).toHaveCount(1);

    await runState(page, 'empty');
    expect(await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData())).toEqual([]);
    await expect(page.locator('.charts-scatter canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`scatter_missing_values_stay_missing: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    await runState(page, 'missing');

    const data = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData());
    expect(data).toHaveLength(2);
    // 缺失值必须是 null，任何位置都不允许被写成 0
    expect(data[0]).toEqual([120, null, 150, null]);
    expect(data[1]).toEqual([40, 60, null, 80]);
    expect(JSON.stringify(data)).not.toContain(',0,');
    // 缺失点没有像素坐标（不渲染符号）
    expect(
      await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.pointClientPosition(0, 1)),
    ).toBeNull();
    await expect(page.locator('.charts-scatter canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`scatter_negative_values_render_below_zero: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    await runState(page, 'negative');

    const data = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData());
    expect(data[0]).toEqual([120, -40, 60, null]);
    expect(data[0]).toContain(-40);

    // 几何断言：负值点必须画在零轴以下（屏幕坐标 y 更大）
    const positive = await page.evaluate(() =>
      window.__COMPONENT_EXAMPLE_TEST__!.pointClientPosition(0, 0),
    );
    const negative = await page.evaluate(() =>
      window.__COMPONENT_EXAMPLE_TEST__!.pointClientPosition(0, 1),
    );
    expect(positive).not.toBeNull();
    expect(negative).not.toBeNull();
    expect(negative!.y).toBeGreaterThan(positive!.y);

    await expect(page.locator('.charts-scatter canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`scatter_update_removes_series_without_ghosts: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    expect(
      (await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData())).length,
    ).toBe(2);

    // A/B → A：只剩一个系列，不残留旧系列，也不产生第二个画布
    await runState(page, 'single');
    expect(
      (await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData())).length,
    ).toBe(1);
    await expect(page.locator('.charts-scatter canvas')).toHaveCount(1);

    // A → A/B：replaceMerge 恢复两个系列
    await runState(page, 'updated');
    expect(
      (await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData())).length,
    ).toBe(2);
    await expect(page.locator('.charts-scatter canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`scatter_click_payload_is_consistent: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    // 单系列状态：符号互不重叠，点击坐标稳定命中符号中心
    await runState(page, 'single');
    await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());

    await clickFirstScatterPoint(page);

    const clicks = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks());
    expect(clicks, `${url} 点击次数`).toHaveLength(1);
    // 散点图载荷为 [x, y] 数值对，与折线 / 柱状的 [类目, 值] 显式区分
    expect(clicks[0]).toEqual({
      seriesId: 'revenue',
      dataIndex: 0,
      value: [1, 120],
      nativeType: 'click',
    });
    expect(pageErrors).toEqual([]);
  });
}

test('scatter_click_payload_matches_in_both_frameworks', async ({ page }) => {
  const payloads: ChartEvent[] = [];
  for (const url of [VUE_SCATTER, REACT_SCATTER]) {
    const pageErrors = await openExample(page, url);
    await runState(page, 'single');
    await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());
    await clickFirstScatterPoint(page);
    const clicks = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks());
    expect(clicks, `${url} 点击次数`).toHaveLength(1);
    payloads.push(clicks[0]!);
    expect(pageErrors, `${url} 页面错误`).toEqual([]);
  }
  // 两个框架对同一符号产生完全等价的事件载荷
  expect(payloads[0]).toEqual(payloads[1]);
  expect(payloads[0]).toEqual({
    seriesId: 'revenue',
    dataIndex: 0,
    value: [1, 120],
    nativeType: 'click',
  });
});

test('react_scatter_strictmode_cleans_and_remounts', async ({ page }) => {
  const pageErrors = await openExample(page, REACT_SCATTER_DEV);

  await expect(page.locator('.charts-scatter canvas')).toHaveCount(1);
  await assertChecksPass(page, REACT_SCATTER_DEV);

  // 卸载后重新挂载：清理彻底，不残留实例、画布或重复监听
  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.remount());
  await page.evaluate(() => window.__COMPONENT_EXAMPLE__!.ready);
  await expect(page.locator('.charts-scatter canvas')).toHaveCount(1);

  // 重新挂载后回到单系列状态，点击只产生一次事件
  await runState(page, 'single');
  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());
  await clickFirstScatterPoint(page);
  expect(await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks())).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

test('vue_scatter_remount_leaves_single_instance', async ({ page }) => {
  const pageErrors = await openExample(page, VUE_SCATTER);
  await expect(page.locator('.charts-scatter canvas')).toHaveCount(1);

  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.remount());
  await page.evaluate(() => window.__COMPONENT_EXAMPLE__!.ready);
  await expect(page.locator('.charts-scatter canvas')).toHaveCount(1);

  await runState(page, 'single');
  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());
  await clickFirstScatterPoint(page);
  expect(await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks())).toHaveLength(1);
  await assertChecksPass(page, VUE_SCATTER);
  expect(pageErrors).toEqual([]);
});

test('vue_pie_remount_leaves_single_instance', async ({ page }) => {
  const pageErrors = await openExample(page, VUE_PIE);
  await expect(page.locator('.charts-pie canvas')).toHaveCount(1);

  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.remount());
  await page.evaluate(() => window.__COMPONENT_EXAMPLE__!.ready);
  await expect(page.locator('.charts-pie canvas')).toHaveCount(1);

  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());
  await clickFirstSlice(page);
  expect(await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks())).toHaveLength(1);
  await assertChecksPass(page, VUE_PIE);
  expect(pageErrors).toEqual([]);
});

/**
 * 点击趋势卡片 sparkline 数据点：类目轴折线系列，`pointClientPosition` 按类目取 x、
 * 按数值取 y，返回符号中心（showSymbol 保证可命中），无需额外偏移。
 */
async function clickFirstTrendPoint(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const hook = window.__COMPONENT_EXAMPLE_TEST__;
    if (!hook) {
      return false;
    }
    const position = hook.pointClientPosition(0, 0);
    return position != null && position.x > 0 && position.y > 0;
  });
  const position = await page.evaluate(() =>
    window.__COMPONENT_EXAMPLE_TEST__!.pointClientPosition(0, 0),
  );
  expect(position).not.toBeNull();
  await page.mouse.click(position!.x, position!.y);
}

for (const url of [VUE_TREND_CARD, REACT_TREND_CARD]) {
  test(`trend-card_empty_data_shows_no_series: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    await expect(page.locator('.charts-trend-card canvas')).toHaveCount(1);

    await runState(page, 'empty');
    expect(await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData())).toEqual([]);
    await expect(page.locator('.charts-trend-card canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`trend-card_missing_values_stay_missing: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    await runState(page, 'missing');

    const data = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData());
    expect(data).toHaveLength(1);
    // 缺失值必须是 null，任何位置都不允许被写成 0
    expect(data[0]).toEqual([120, null, 180, 200]);
    expect(JSON.stringify(data)).not.toContain(',0,');
    await expect(page.locator('.charts-trend-card canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`trend-card_single_point_renders_one_symbol: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    await runState(page, 'single');

    const data = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData());
    expect(data).toEqual([[200]]);
    // 单点仍有像素坐标（sparkline 符号可点击）
    expect(
      await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.pointClientPosition(0, 0)),
    ).not.toBeNull();
    await expect(page.locator('.charts-trend-card canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`trend-card_update_reflects_new_series: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    expect(
      (await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData()))[0],
    ).toEqual([120, 150, 180, 200]);

    // default → updated：数据更新，sparkline 反映新序列，仍为单系列单画布
    await runState(page, 'updated');
    expect(
      (await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData()))[0],
    ).toEqual([210, 190, 230, 240]);

    // updated → down：再次更新，系列数与画布不变
    await runState(page, 'down');
    expect(
      (await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData()))[0],
    ).toEqual([200, 180, 150, 120]);
    await expect(page.locator('.charts-trend-card canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`trend-card_empty_state_clears_previous_summary: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    // default：标题 / 当前值 / meta 三个槽位都有可见文本
    const initial = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.summarySlots());
    expect(initial).toEqual(['近 7 日活跃用户', '200', expect.stringContaining('前期')]);

    // empty：当前值槽显示「暂无数据」，meta 槽必须被清空，
    // 不得残留上一次状态（如 down）的「▼ 40」摘要
    await runState(page, 'empty');
    const slots = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.summarySlots());
    expect(slots[1]).toBe('暂无数据');
    expect(slots[2]).toBeNull();
    expect(JSON.stringify(slots)).not.toContain('前期');

    // down：meta 槽重新出现并带下降箭头
    await runState(page, 'down');
    const down = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.summarySlots());
    expect(down[1]).toBe('120');
    expect(down[2]).toContain('▼');
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`trend-card_click_payload_is_consistent: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    // 单点状态：符号孤立，点击坐标稳定命中
    await runState(page, 'single');
    await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());

    await clickFirstTrendPoint(page);

    const clicks = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks());
    expect(clicks, `${url} 点击次数`).toHaveLength(1);
    // sparkline 为折线系列，载荷为 [类目, 值]，与折线 / 柱状同构
    expect(clicks[0]).toEqual({
      seriesId: 'active',
      dataIndex: 0,
      value: ['周一', 200],
      nativeType: 'click',
    });
    expect(pageErrors).toEqual([]);
  });
}

test('trend-card_click_payload_matches_in_both_frameworks', async ({ page }) => {
  const payloads: ChartEvent[] = [];
  for (const url of [VUE_TREND_CARD, REACT_TREND_CARD]) {
    const pageErrors = await openExample(page, url);
    await runState(page, 'single');
    await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());
    await clickFirstTrendPoint(page);
    const clicks = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks());
    expect(clicks, `${url} 点击次数`).toHaveLength(1);
    payloads.push(clicks[0]!);
    expect(pageErrors, `${url} 页面错误`).toEqual([]);
  }
  // 两个框架对同一数据点产生完全等价的事件载荷
  expect(payloads[0]).toEqual(payloads[1]);
  expect(payloads[0]).toEqual({
    seriesId: 'active',
    dataIndex: 0,
    value: ['周一', 200],
    nativeType: 'click',
  });
});

test('react_trend-card_strictmode_cleans_and_remounts', async ({ page }) => {
  const pageErrors = await openExample(page, REACT_TREND_CARD_DEV);

  await expect(page.locator('.charts-trend-card canvas')).toHaveCount(1);
  await assertChecksPass(page, REACT_TREND_CARD_DEV);

  // 卸载后重新挂载：清理彻底，不残留实例、画布或重复监听
  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.remount());
  await page.evaluate(() => window.__COMPONENT_EXAMPLE__!.ready);
  await expect(page.locator('.charts-trend-card canvas')).toHaveCount(1);

  // 重新挂载后回到单点状态，点击只产生一次事件
  await runState(page, 'single');
  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());
  await clickFirstTrendPoint(page);
  expect(await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks())).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

test('vue_trend-card_remount_leaves_single_instance', async ({ page }) => {
  const pageErrors = await openExample(page, VUE_TREND_CARD);
  await expect(page.locator('.charts-trend-card canvas')).toHaveCount(1);

  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.remount());
  await page.evaluate(() => window.__COMPONENT_EXAMPLE__!.ready);
  await expect(page.locator('.charts-trend-card canvas')).toHaveCount(1);

  await runState(page, 'single');
  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());
  await clickFirstTrendPoint(page);
  expect(await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks())).toHaveLength(1);
  await assertChecksPass(page, VUE_TREND_CARD);
  expect(pageErrors).toEqual([]);
});

/**
 * 点击横向条形（排行榜 / 占比）第一条：`pointClientPosition` 对横向条形按数值取 x、
 * 按类目取 y，返回条形末端。末端在条体边界上，向左偏移若干像素保证落在条体内部。
 */
const HORIZONTAL_BAR_BODY_OFFSET_X = -8;

async function clickFirstHorizontalBar(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const hook = window.__COMPONENT_EXAMPLE_TEST__;
    if (!hook) {
      return false;
    }
    const position = hook.pointClientPosition(0, 0);
    return position != null && position.x > 0 && position.y > 0;
  });
  const position = await page.evaluate(() =>
    window.__COMPONENT_EXAMPLE_TEST__!.pointClientPosition(0, 0),
  );
  expect(position).not.toBeNull();
  await page.mouse.click(position!.x + HORIZONTAL_BAR_BODY_OFFSET_X, position!.y);
}

for (const url of [VUE_RANKING, REACT_RANKING]) {
  test(`ranking_empty_data_renders_no_series: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    await expect(page.locator('.charts-ranking canvas')).toHaveCount(1);

    await runState(page, 'empty');
    expect(await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData())).toEqual([]);
    // 空数据下统计行必须隐藏、提示必须出现，不得残留上一次的「共 N 项」
    const slots = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.summarySlots());
    expect(slots[1]).toBeNull();
    expect(slots[2]).toBe('暂无数据');
    await expect(page.locator('.charts-ranking canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`ranking_missing_values_do_not_enter_ranking: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    await runState(page, 'missing');

    // 「柱状图」为缺失值：不进入排行，也不占用名次（5 项而非 6 项）
    const data = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData());
    expect(data).toEqual([[180, 120, 90, 60, 30]]);
    const slots = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.summarySlots());
    expect(slots[1]).toBe('共 5 项');
    await expect(page.locator('.charts-ranking canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`ranking_sorts_descending_with_tied_ranks: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);

    // default：180/180/120/90/60 降序；并列的柱状图与饼图共享第 1 名，其后跳到第 3 名
    expect(
      (await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData()))[0],
    ).toEqual([180, 180, 120, 90, 60]);
    expect(
      await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.categoryLabels()),
    ).toEqual(['1. 柱状图', '1. 饼图', '3. 折线图', '4. 散点图', '5. 趋势卡片']);
    // limit 固定为 5：default 有 6 项，统计行必须说明取前 5 名
    const slots = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.summarySlots());
    expect(slots[0]).toBe('热门组件 Top 5');
    expect(slots[1]).toBe('共 6 项 · 取前 5 名');

    // tied：三项并列 150，名次为 1,1,1,4,5；并列项之间保持输入顺序
    await runState(page, 'tied');
    expect(
      (await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData()))[0],
    ).toEqual([150, 150, 150, 90, 60]);
    expect(
      await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.categoryLabels()),
    ).toEqual(['1. 折线图', '1. 柱状图', '1. 饼图', '4. 散点图', '5. 趋势卡片']);
    await expect(page.locator('.charts-ranking canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`ranking_update_reflects_new_series: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);

    // updated：7 项取前 5 名，排序结果完全换血
    await runState(page, 'updated');
    expect(
      (await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData()))[0],
    ).toEqual([270, 260, 250, 240, 230]);
    const slots = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.summarySlots());
    expect(slots[1]).toBe('共 7 项 · 取前 5 名');

    // single：只剩一项，名次为 1
    await runState(page, 'single');
    expect(
      (await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData()))[0],
    ).toEqual([200]);
    expect(
      await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.categoryLabels()),
    ).toEqual(['1. 折线图']);
    await expect(page.locator('.charts-ranking canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`ranking_click_payload_is_consistent: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());

    await clickFirstHorizontalBar(page);

    const clicks = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks());
    expect(clicks, `${url} 点击次数`).toHaveLength(1);
    // 横向条形系列数据项带 name：载荷为 [条目名称, 数值]，与折线 / 柱状 / 饼图同构
    expect(clicks[0]).toEqual({
      seriesId: 'hot',
      dataIndex: 0,
      value: ['柱状图', 180],
      nativeType: 'click',
    });
    expect(pageErrors).toEqual([]);
  });
}

test('ranking_click_payload_matches_in_both_frameworks', async ({ page }) => {
  const payloads: ChartEvent[] = [];
  for (const url of [VUE_RANKING, REACT_RANKING]) {
    const pageErrors = await openExample(page, url);
    await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());
    await clickFirstHorizontalBar(page);
    const clicks = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks());
    expect(clicks, `${url} 点击次数`).toHaveLength(1);
    payloads.push(clicks[0]!);
    expect(pageErrors, `${url} 页面错误`).toEqual([]);
  }
  expect(payloads[0]).toEqual(payloads[1]);
  expect(payloads[0]).toEqual({
    seriesId: 'hot',
    dataIndex: 0,
    value: ['柱状图', 180],
    nativeType: 'click',
  });
});

test('react_ranking_strictmode_cleans_and_remounts', async ({ page }) => {
  const pageErrors = await openExample(page, REACT_RANKING_DEV);

  await expect(page.locator('.charts-ranking canvas')).toHaveCount(1);
  await assertChecksPass(page, REACT_RANKING_DEV);

  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.remount());
  await page.evaluate(() => window.__COMPONENT_EXAMPLE__!.ready);
  await expect(page.locator('.charts-ranking canvas')).toHaveCount(1);

  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());
  await clickFirstHorizontalBar(page);
  expect(await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks())).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

test('vue_ranking_remount_leaves_single_instance', async ({ page }) => {
  const pageErrors = await openExample(page, VUE_RANKING);
  await expect(page.locator('.charts-ranking canvas')).toHaveCount(1);

  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.remount());
  await page.evaluate(() => window.__COMPONENT_EXAMPLE__!.ready);
  await expect(page.locator('.charts-ranking canvas')).toHaveCount(1);

  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());
  await clickFirstHorizontalBar(page);
  expect(await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks())).toHaveLength(1);
  await assertChecksPass(page, VUE_RANKING);
  expect(pageErrors).toEqual([]);
});

/**
 * 占比场景的就绪探针限制：`zero-total`（全零）与 `empty`（无系列）渲染结果完全相同
 * （都没有系列、都显示「暂无数据」），系列快照不会变化，`arm()` 会一直等到超时。
 * 因此这两个状态必须各自从 `default` 单独进入，不能连续切换。
 */
for (const url of [VUE_PROPORTION, REACT_PROPORTION]) {
  test(`proportion_zero_total_shows_no_data: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);

    // zero-total：总量不可算，系列整体撤下、展示「暂无数据」，不得产出 NaN%
    await runState(page, 'zero-total');
    expect(await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData())).toEqual([]);
    const zero = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.summarySlots());
    expect(zero[1]).toBeNull();
    expect(zero[2]).toBe('暂无数据');
    expect(JSON.stringify(zero)).not.toContain('NaN');
    await expect(page.locator('.charts-proportion canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`proportion_empty_data_renders_no_series: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);

    await runState(page, 'empty');
    expect(await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData())).toEqual([]);
    const empty = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.summarySlots());
    expect(empty[1]).toBeNull();
    expect(empty[2]).toBe('暂无数据');
    await expect(page.locator('.charts-proportion canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`proportion_missing_values_are_excluded_from_total: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);

    // default：总量 300，缺失的「自然」不进入系列数据
    expect(
      (await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData()))[0],
    ).toEqual([120, 80, 100]);
    const initial = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.summarySlots());
    expect(initial[1]).toBe('总量 300次');

    // missing：「直投」缺失，分母变为 280 而不是 300
    await runState(page, 'missing');
    expect(
      (await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData()))[0],
    ).toEqual([120, 60, 100]);
    const missing = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.summarySlots());
    expect(missing[1]).toBe('总量 280次');
    await expect(page.locator('.charts-proportion canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`proportion_keeps_input_order: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);

    // 占比场景不排序：类目轴顺序必须与输入一致（搜索 / 直投 / 合作），
    // 需要排序时用排行榜组件，两个场景的顺序口径因此可对照
    expect(
      await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.categoryLabels()),
    ).toEqual(['搜索', '直投', '合作']);

    // updated：数值整体变化，顺序仍然保持输入顺序
    await runState(page, 'updated');
    expect(
      await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.categoryLabels()),
    ).toEqual(['搜索', '直投', '自然', '合作']);
    expect(
      (await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData()))[0],
    ).toEqual([210, 90, 30, 170]);
    const updated = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.summarySlots());
    expect(updated[1]).toBe('总量 500次');
    await expect(page.locator('.charts-proportion canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`proportion_single_entry_owns_the_whole_total: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    await runState(page, 'single');

    expect(
      (await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.seriesData()))[0],
    ).toEqual([300]);
    const single = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.summarySlots());
    expect(single[1]).toBe('总量 300次');
    await expect(page.locator('.charts-proportion canvas')).toHaveCount(1);
    await assertChecksPass(page, url);
    expect(pageErrors).toEqual([]);
  });

  test(`proportion_click_payload_is_consistent: ${url}`, async ({ page }) => {
    const pageErrors = await openExample(page, url);
    await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());

    await clickFirstHorizontalBar(page);

    const clicks = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks());
    expect(clicks, `${url} 点击次数`).toHaveLength(1);
    expect(clicks[0]).toEqual({
      seriesId: 'source',
      dataIndex: 0,
      value: ['搜索', 120],
      nativeType: 'click',
    });
    expect(pageErrors).toEqual([]);
  });
}

test('proportion_click_payload_matches_in_both_frameworks', async ({ page }) => {
  const payloads: ChartEvent[] = [];
  for (const url of [VUE_PROPORTION, REACT_PROPORTION]) {
    const pageErrors = await openExample(page, url);
    await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());
    await clickFirstHorizontalBar(page);
    const clicks = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks());
    expect(clicks, `${url} 点击次数`).toHaveLength(1);
    payloads.push(clicks[0]!);
    expect(pageErrors, `${url} 页面错误`).toEqual([]);
  }
  expect(payloads[0]).toEqual(payloads[1]);
  expect(payloads[0]).toEqual({
    seriesId: 'source',
    dataIndex: 0,
    value: ['搜索', 120],
    nativeType: 'click',
  });
});

test('react_proportion_strictmode_cleans_and_remounts', async ({ page }) => {
  const pageErrors = await openExample(page, REACT_PROPORTION_DEV);

  await expect(page.locator('.charts-proportion canvas')).toHaveCount(1);
  await assertChecksPass(page, REACT_PROPORTION_DEV);

  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.remount());
  await page.evaluate(() => window.__COMPONENT_EXAMPLE__!.ready);
  await expect(page.locator('.charts-proportion canvas')).toHaveCount(1);

  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());
  await clickFirstHorizontalBar(page);
  expect(await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks())).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

test('vue_proportion_remount_leaves_single_instance', async ({ page }) => {
  const pageErrors = await openExample(page, VUE_PROPORTION);
  await expect(page.locator('.charts-proportion canvas')).toHaveCount(1);

  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.remount());
  await page.evaluate(() => window.__COMPONENT_EXAMPLE__!.ready);
  await expect(page.locator('.charts-proportion canvas')).toHaveCount(1);

  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.clearClicks());
  await clickFirstHorizontalBar(page);
  expect(await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks())).toHaveLength(1);
  await assertChecksPass(page, VUE_PROPORTION);
  expect(pageErrors).toEqual([]);
});
