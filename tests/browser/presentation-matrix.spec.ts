import { expect, test, type Page } from '@playwright/test';
import { darkTheme, lightTheme } from '../../packages/charts-core/src/theme.js';

/**
 * T09 收口：light/dark × Canvas/SVG 在 14 个框架实现上的真实证据。
 *
 * 背景：7 个逻辑组件的示例页此前全部硬编码 `theme:'light', renderer:'canvas'`，
 * 没有一条测试驱动过框架组件在主题 / 渲染器上的实际行为；`rules/platform.md`
 * 要求的「主题 / 渲染器切换重建」只有 core 单测级别的覆盖。本文件用 URL 查询参数
 * 覆盖示例页的展示配置，把四组合铺到每个实现上，并读回 ECharts 实例上真实生效的
 * 调色板与文本颜色，避免只断言「声明了什么」。
 */

const VUE_ORIGIN = 'http://127.0.0.1:5174';
const REACT_ORIGIN = 'http://127.0.0.1:5175';

/** 逻辑组件 → 示例页路径（line 走 index.html，与 T02 起一致）。 */
const COMPONENTS = [
  'line',
  'bar',
  'pie',
  'scatter',
  'trend-card',
  'ranking',
  'proportion',
] as const;

type ComponentName = (typeof COMPONENTS)[number];

const PAGE_PATH: Record<ComponentName, string> = {
  line: '/index.html',
  bar: '/bar.html',
  pie: '/pie.html',
  scatter: '/scatter.html',
  'trend-card': '/trend-card.html',
  ranking: '/ranking.html',
  proportion: '/proportion.html',
};

const THEMES = ['light', 'dark'] as const;
const RENDERERS = ['canvas', 'svg'] as const;

const THEME_TOKENS = {
  light: { paletteFirst: lightTheme.palette[0]!, textColor: lightTheme.textColor },
  dark: { paletteFirst: darkTheme.palette[0]!, textColor: darkTheme.textColor },
} as const;

type CheckResult = { name: string; status: 'passed' | 'failed'; message?: string };

type ExampleTestHook = {
  /** 实例上真实生效的展示配置：渲染器看 DOM，主题看 option 的调色板与文本颜色。 */
  appliedPresentation(): {
    canvases: number;
    svgs: number;
    paletteFirst: string;
    textColor: string;
  } | null;
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

/**
 * 图表宿主选择器：每个组件的根容器类名固定为 `charts-<组件名>`
 * （line / bar / pie / scatter / trend-card / ranking / proportion）。
 * 不用外层布局类名——trend-card / ranking / proportion 的示例页用的是
 * `trend-card-frame` / `ranking-frame` / `proportion-frame`，与前四个不一致。
 */
function chartHostSelector(component: ComponentName): string {
  return `.charts-${component}`;
}

/** 读回实例上真实生效的展示配置（渲染器由 DOM 判定，主题由 option 颜色反映）。 */
async function appliedPresentation(page: Page): Promise<{
  canvases: number;
  svgs: number;
  paletteFirst: string;
  textColor: string;
} | null> {
  return page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__?.appliedPresentation() ?? null);
}

async function openExample(
  page: Page,
  url: string,
): Promise<{ pageErrors: string[]; checks: CheckResult[] }> {
  const pageErrors = collectPageErrors(page);
  await page.goto(url);
  await page.waitForFunction(() => window.__COMPONENT_EXAMPLE__ !== undefined);
  await page.evaluate(() => window.__COMPONENT_EXAMPLE__!.ready);
  const checks = await page.evaluate(() => window.__COMPONENT_EXAMPLE__!.getChecks());
  return { pageErrors, checks };
}

function checkByName(checks: CheckResult[], name: string): CheckResult | undefined {
  return checks.find((check) => check.name === name);
}

for (const framework of ['vue', 'react'] as const) {
  const origin = framework === 'vue' ? VUE_ORIGIN : REACT_ORIGIN;
  for (const component of COMPONENTS) {
    for (const theme of THEMES) {
      for (const renderer of RENDERERS) {
        test(`${component}_${theme}_${renderer}_is_supported: ${framework}`, async ({ page }) => {
          const url = `${origin}${PAGE_PATH[component]}?theme=${theme}&renderer=${renderer}`;
          const { pageErrors, checks } = await openExample(page, url);

          // 1) 渲染器：声明的渲染器必须在 DOM 上真实落地，且只存在一个画布/一张 svg
          const expected = renderer === 'canvas'
            ? { canvases: 1, svgs: 0 }
            : { canvases: 0, svgs: 1 };
          await expect(
            page.locator(`${chartHostSelector(component)} canvas`),
            `${url} canvas 数量`,
          ).toHaveCount(expected.canvases);
          await expect(
            page.locator(`${chartHostSelector(component)} svg`),
            `${url} svg 数量`,
          ).toHaveCount(expected.svgs);

          // 2) 主题：读回实例上生效的调色板与文本颜色，必须与所选主题令牌一致
          const applied = await appliedPresentation(page);
          expect(applied, `${url} 未取到 ECharts 实例`).not.toBeNull();
          expect(applied!.paletteFirst, `${url} 调色板首色`).toBe(
            THEME_TOKENS[theme].paletteFirst,
          );
          expect(applied!.textColor, `${url} 文本颜色`).toBe(THEME_TOKENS[theme].textColor);

          // 3) 自检：单实例、无页面错误、系列匹配与渲染器匹配都必须通过
          for (const name of ['single-instance', 'no-page-error', 'series-match', 'renderer-match']) {
            expect(checkByName(checks, name)?.status, `${url} ${name}`).toBe('passed');
          }
          expect(pageErrors, `${url} 页面错误`).toEqual([]);
        });
      }
    }
  }
}
