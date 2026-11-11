import { expect, test, type Page } from '@playwright/test';
import type { ChartEvent } from '../../packages/charts-core/src/index.js';

const VUE_EXAMPLE = 'http://127.0.0.1:5174/';
const REACT_EXAMPLE = 'http://127.0.0.1:5175/';
const REACT_DEV_EXAMPLE = 'http://127.0.0.1:5176/';
const VUE_KEEPALIVE_EXAMPLE = 'http://127.0.0.1:5174/keepalive.html';

type CheckResult = { name: string; status: 'passed' | 'failed'; message?: string };

type ExampleTestHook = {
  pointClientPosition(seriesIndex: number, dataIndex: number): { x: number; y: number } | null;
  getClicks(): ChartEvent[];
  clearClicks(): void;
  remount(): void;
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

async function checkByName(page: Page, name: string): Promise<CheckResult | undefined> {
  const checks = await page.evaluate(() => window.__COMPONENT_EXAMPLE__!.getChecks());
  return checks.find((check) => check.name === name);
}

test('same_click_payload_in_both_frameworks', async ({ page }) => {
  const payloads: ChartEvent[] = [];
  for (const url of [VUE_EXAMPLE, REACT_EXAMPLE]) {
    const pageErrors = await openExample(page, url);
    const position = await page.evaluate(() =>
      window.__COMPONENT_EXAMPLE_TEST__!.pointClientPosition(0, 0),
    );
    expect(position, `${url} 数据点坐标`).not.toBeNull();
    await page.mouse.click(position!.x, position!.y);
    const clicks = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks());
    expect(clicks, `${url} 点击次数`).toHaveLength(1);
    payloads.push(clicks[0]!);
    expect(pageErrors, `${url} 页面错误`).toEqual([]);
  }
  // 两个框架对同一数据点产生完全等价的事件载荷
  expect(payloads[0]).toEqual(payloads[1]);
  expect(payloads[0]).toEqual({
    seriesId: 'revenue',
    dataIndex: 0,
    value: ['周一', 120],
    nativeType: 'click',
  });
});

test('react_strictmode_cleans_and_remounts', async ({ page }) => {
  const pageErrors = await openExample(page, REACT_DEV_EXAMPLE);

  // StrictMode 开发态 Effect 双调用之后只允许存在一个实例
  await expect(page.locator('canvas')).toHaveCount(1);
  expect((await checkByName(page, 'single-instance'))?.status).toBe('passed');
  expect((await checkByName(page, 'no-page-error'))?.status).toBe('passed');

  // 卸载后重新挂载：清理彻底，不残留实例、画布或重复监听
  await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.remount());
  await page.evaluate(() => window.__COMPONENT_EXAMPLE__!.ready);
  await expect(page.locator('canvas')).toHaveCount(1);
  expect((await checkByName(page, 'single-instance'))?.status).toBe('passed');

  // 重新挂载后点击只产生一次事件，证明旧监听已解除
  const position = await page.evaluate(() =>
    window.__COMPONENT_EXAMPLE_TEST__!.pointClientPosition(0, 0),
  );
  expect(position).not.toBeNull();
  await page.mouse.click(position!.x, position!.y);
  const clicks = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__!.getClicks());
  expect(clicks).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

test('vue_keepalive_resizes_on_activate', async ({ page }) => {
  const pageErrors = await openExample(page, VUE_KEEPALIVE_EXAMPLE);
  await expect(page.locator('canvas')).toHaveCount(1);
  const canvasWidthBefore = await page.evaluate(() =>
    Number(document.querySelector('canvas')?.getAttribute('width') ?? '0'),
  );
  expect(canvasWidthBefore).toBeGreaterThan(0);

  // 切到占位视图：KeepAlive 停用图表，实例与数据保留
  await page.getByRole('button', { name: '占位视图' }).click();
  await expect(page.getByTestId('keepalive-placeholder')).toBeVisible();

  // 切回折线图：onActivated 后尺寸恢复，仍只有一个实例
  await page.getByRole('button', { name: '折线图' }).click();
  await page.evaluate(() => window.__COMPONENT_EXAMPLE__!.ready);
  await expect(page.locator('canvas')).toHaveCount(1);
  expect((await checkByName(page, 'single-instance'))?.status).toBe('passed');
  expect((await checkByName(page, 'series-match'))?.status).toBe('passed');

  // 停用期间改变视口，激活后画布必须跟随新尺寸
  await page.getByRole('button', { name: '占位视图' }).click();
  await page.setViewportSize({ width: 900, height: 700 });
  await page.getByRole('button', { name: '折线图' }).click();
  await page.evaluate(() => window.__COMPONENT_EXAMPLE__!.ready);
  const canvasWidthAfter = await page.evaluate(() =>
    Number(document.querySelector('canvas')?.getAttribute('width') ?? '0'),
  );
  expect(canvasWidthAfter).toBeGreaterThan(0);
  expect(canvasWidthAfter).not.toBe(canvasWidthBefore);
  await expect(page.locator('canvas')).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});

test('ssr_import_has_no_dom_access', async () => {
  // Node 环境（无 window/document）直接导入构建产物：顶层不得访问浏览器全局
  expect(typeof window).toBe('undefined');
  expect(typeof document).toBe('undefined');
  for (const entry of [
    '../../packages/charts-vue/dist/index.js',
    '../../packages/charts-vue/dist/line.js',
    '../../packages/charts-react/dist/index.js',
    '../../packages/charts-react/dist/line.js',
  ]) {
    const loaded = (await import(entry)) as Record<string, unknown>;
    expect(loaded.LineChart, entry).toBeDefined();
  }
});
