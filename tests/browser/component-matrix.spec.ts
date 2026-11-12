import { expect, test, type Page } from '@playwright/test';
import type { ChartEvent } from '../../packages/charts-core/src/index.js';

const VUE_BAR = 'http://127.0.0.1:5174/bar.html';
const REACT_BAR = 'http://127.0.0.1:5175/bar.html';
// StrictMode 的 Effect 双调用只发生在开发态，预览产物无法覆盖
const REACT_BAR_DEV = 'http://127.0.0.1:5176/bar.html';

const VUE_PIE = 'http://127.0.0.1:5174/pie.html';
const REACT_PIE = 'http://127.0.0.1:5175/pie.html';
const REACT_PIE_DEV = 'http://127.0.0.1:5176/pie.html';

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

    // 缺失扇形没有角度，取不到几何中心，因此点不到它
    expect(
      await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.sectorRadii(0, 1)),
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
