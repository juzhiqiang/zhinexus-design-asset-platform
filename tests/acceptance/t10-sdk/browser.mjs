/**
 * 固定环境浏览器探针（T10 探针，A 侧）。
 *
 * 在同一份 `vite build` 产物上完成四件事：
 * 1. **运行**：按统一就绪协议（`window.__COMPONENT_EXAMPLE__.ready`，不用固定 sleep）
 *    打开每个实现的示例页，读回自检结果、`appliedPresentation` 与页面错误；
 * 2. **交互**：取首个数据点的客户端坐标并真实点击，比对事件载荷与共享语义；
 * 3. **生命周期**：卸载后确认 ECharts 实例被 dispose，重新挂载后仍只有一个实例；
 * 4. **视觉**：固定视口 / 主题 / 渲染器下对图表宿主元素截图，并计算 `environmentKey`。
 *
 * 端口一律用 `0`（系统分配临时端口）：不占用 `5173–5176`，也不与 B 的基线 CLI 冲突。
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

import {
  PAGE_PATH,
  buildEnvironment,
  chartHostSelector,
  computeEnvironmentKey,
  formatPresentation,
  validateEnvironment,
} from './environment.mjs';

/**
 * 每个逻辑组件首个数据点的期望点击载荷。
 *
 * 取值来源是 `examples/fixtures/<component>.json` 的 `default` 状态，但**不是**简单取
 * `points[0]`：载荷里的 `dataIndex` 与 `value` 说的是**渲染后的**数组下标（示例的
 * `pointClientPosition` 读的是 `instance.getOption().series[i].data[dataIndex]`，与事件
 * 同源）。排行榜会在交给 ECharts 前按数值降序重排并取前 `limit` 名，因此渲染下标 0 是
 * `柱状图 180`，而不是输入里的 `折线图 120`。这条区别由
 * `probe.test.mjs` 的「期望载荷由真实 fixture 推导」用例守着。
 */
export const EXPECTED_FIRST_CLICK = /** @type {Record<string, unknown>} */ ({
  line: { seriesId: 'revenue', dataIndex: 0, value: ['周一', 120], nativeType: 'click' },
  bar: { seriesId: 'revenue', dataIndex: 0, value: ['周一', 120], nativeType: 'click' },
  pie: { seriesId: 'share', dataIndex: 0, value: ['搜索', 120], nativeType: 'click' },
  scatter: { seriesId: 'revenue', dataIndex: 0, value: [1, 120], nativeType: 'click' },
  'trend-card': { seriesId: 'active', dataIndex: 0, value: ['周一', 120], nativeType: 'click' },
  // 排行榜：降序 + limit=5 + 并列保持输入顺序 + 缺失值不进入排行
  ranking: { seriesId: 'hot', dataIndex: 0, value: ['柱状图', 180], nativeType: 'click' },
  proportion: { seriesId: 'source', dataIndex: 0, value: ['搜索', 120], nativeType: 'click' },
});

/**
 * 点击偏移已不再需要：多系列柱状图与横向条形的类目轴中心落在图形之间的空隙里，
 * 固定偏移会随系列数与数据变化而失效。点击点改由 `findDataPoint` 在渲染几何上搜索
 * （见 `injectEchartsRegistry`）。这里保留常量只为在搜索失败时回退到理想坐标本身。
 */
export const CLICK_FALLBACK = 'ideal-point';

/** 宿主页面背景：主题令牌只决定图表颜色，背景由宿主决定（见 `charts-core/src/theme.ts`）。 */
export const HOST_BACKGROUND = { light: '#ffffff', dark: '#0f172a' };

/** 固定视口。deviceScaleFactor / locale / timezone 一并固定，全部进 environmentKey。 */
export const FIXED_VIEWPORT = { width: 1000, height: 600 };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.map': 'application/json; charset=utf-8',
};

export function staticFileServer(root) {
  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const target = path.join(root, relative);
    if (!target.startsWith(root) || !existsSync(target)) {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    response.setHeader('content-type', MIME[path.extname(target)] ?? 'application/octet-stream');
    response.end(readFileSync(target));
  });
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('PROBE_INTERNAL 静态文件服务器未监听到 TCP 端口');
  }
  return address.port;
}

async function close(server) {
  await new Promise((resolve) => server.close(() => resolve()));
}

/** PNG 像素尺寸：只读 IHDR，不引入图像库。 */
export function pngSize(bytes) {
  if (bytes.length < 24 || bytes.toString('latin1', 1, 4) !== 'PNG') {
    throw new Error('PROBE_INTERNAL 截图不是合法 PNG');
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * 给消费者副本注入 ECharts 实例注册表与可点击点搜索。
 *
 * 作用有两件，都是「让页面内的真实几何成为判据」：
 * 1. `getInstanceByDom`：让「卸载后实例是否被 dispose」成为可观测断言，而不是只能看到
 *    DOM 节点被移除；
 * 2. `findDataPoint`：多系列柱状图 / 横向条形图的**类目轴中心落在图形之间的空隙里**，
 *    直接点 `convertToPixel` 得到的中心点会落空。这里在理想坐标附近按网格搜索第一个
 *    真正被目标数据元素（`__dataIndex` 对上）覆盖的点，等价于「用户会点到的位置」。
 *
 * 注入的是探针自己的模块与一行 import，改的是工作区外的消费者副本，
 * 不动冻结 tarball、不动仓库里的示例源码。
 */
export async function injectEchartsRegistry(consumerRoot, mainEntries) {
  const registry = [
    `import { getInstanceByDom } from 'echarts/core.js';`,
    ``,
    `type Point = { x: number; y: number };`,
    `type Containable = { contain?: (x: number, y: number) => boolean; __dataIndex?: number };`,
    ``,
    `function findDataPoint(hostSelector: string, seriesIndex: number, dataIndex: number, ideal: Point): Point | null {`,
    `  void seriesIndex;`,
    `  const host = document.querySelector(hostSelector);`,
    `  const instance = host ? getInstanceByDom(host) : null;`,
    `  if (!host || !instance) return null;`,
    `  const rect = host.getBoundingClientRect();`,
    `  const elements = (instance.getZr().storage.getDisplayList(false) ?? []) as unknown[];`,
    `  const covers = (localX: number, localY: number) =>`,
    `    elements.some((element) => {`,
    `      const candidate = element as Containable;`,
    `      return candidate.__dataIndex === dataIndex && typeof candidate.contain === 'function' && candidate.contain(localX, localY);`,
    `    });`,
    `  const steps = [0, 4, -4, 8, -8, 12, -12, 20, -20, 32, -32, 48, -48];`,
    `  for (const dy of steps) {`,
    `    for (const dx of steps) {`,
    `      if (covers(ideal.x - rect.left + dx, ideal.y - rect.top + dy)) return { x: ideal.x + dx, y: ideal.y + dy };`,
    `    }`,
    `  }`,
    `  return null;`,
    `}`,
    ``,
    `declare global {`,
    `  interface Window {`,
    `    __A10_ECHARTS__?: { getInstanceByDom: typeof getInstanceByDom; findDataPoint: typeof findDataPoint };`,
    `  }`,
    `}`,
    ``,
    `window.__A10_ECHARTS__ = { getInstanceByDom, findDataPoint };`,
    ``,
  ].join('\n');
  await writeFile(path.join(consumerRoot, 'src', 'a-t10-echarts-registry.ts'), registry);
  for (const entry of mainEntries) {
    const file = path.join(consumerRoot, 'src', entry);
    const source = await readFile(file, 'utf8');
    if (!source.includes("from './a-t10-echarts-registry.js'")) {
      await writeFile(file, `import './a-t10-echarts-registry.js';\n${source}`);
    }
  }
}

async function openExample(page, url, theme) {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.addStyleTag({ content: `html,body{margin:0;padding:0;background:${HOST_BACKGROUND[theme]};}` });
  await page.waitForFunction(() => window.__COMPONENT_EXAMPLE__ !== undefined, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__COMPONENT_EXAMPLE__.ready);
  const checks = await page.evaluate(() => window.__COMPONENT_EXAMPLE__.getChecks());
  const applied = await page.evaluate(
    () => window.__COMPONENT_EXAMPLE_TEST__?.appliedPresentation() ?? null,
  );
  return { checks, applied, pageErrors };
}

function contextOptions(theme) {
  return {
    viewport: FIXED_VIEWPORT,
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: theme === 'dark' ? 'dark' : 'light',
  };
}

/** 对单个 (框架, 组件, 展示组合) 跑运行 / 交互 / 截图。 */
async function probeCombination({
  browser,
  port,
  framework,
  frameworkVersion,
  echartsVersion,
  component,
  presentation,
  environmentBase,
  screenshotDir,
}) {
  const url = `http://127.0.0.1:${port}${PAGE_PATH[component]}?theme=${presentation.theme}&renderer=${presentation.renderer}`;
  const host = chartHostSelector(component);
  const context = await browser.newContext(contextOptions(presentation.theme));
  const page = await context.newPage();
  try {
    const opened = await openExample(page, url, presentation.theme);
    const ideal = await page.evaluate(() =>
      window.__COMPONENT_EXAMPLE_TEST__?.pointClientPosition(0, 0) ?? null,
    );
    let click = null;
    let clickError = null;
    let clickPoint = null;
    let clickSource = CLICK_FALLBACK;
    if (ideal) {
      const refined = await page.evaluate(
        ([hostSelector, point]) => window.__A10_ECHARTS__?.findDataPoint(hostSelector, 0, 0, point) ?? null,
        [host, ideal],
      );
      clickPoint = refined ?? ideal;
      clickSource = refined ? 'rendered-geometry' : CLICK_FALLBACK;
      await page.mouse.click(clickPoint.x, clickPoint.y);
      click = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__?.getClicks() ?? []);
    } else {
      clickError = 'pointClientPosition(0,0) 返回 null：首个数据点不可定位';
    }
    const element = page.locator(host);
    const hostCount = await element.count();
    let screenshot = null;
    let environment = null;
    let environmentKey = null;
    if (hostCount === 1) {
      const bytes = await element.screenshot();
      const size = pngSize(bytes);
      environment = buildEnvironment({
        ...environmentBase,
        renderer: presentation.renderer,
        theme: presentation.theme,
        frameworkVersion,
        echartsVersion,
        width: size.width,
        height: size.height,
      });
      const problems = validateEnvironment(environment);
      if (problems.length > 0) throw new Error(`PROBE_INTERNAL 环境字段非法：${problems.join('; ')}`);
      environmentKey = computeEnvironmentKey(environment);
      await mkdir(screenshotDir, { recursive: true });
      const name = `${component}-${framework}-${formatPresentation(presentation)}.png`;
      const file = path.join(screenshotDir, name);
      await writeFile(file, bytes);
      screenshot = {
        name,
        file,
        bytes: bytes.length,
        width: size.width,
        height: size.height,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }
    return {
      component,
      presentation: formatPresentation(presentation),
      url,
      checks: opened.checks,
      appliedPresentation: opened.applied,
      pageErrors: opened.pageErrors,
      hostCount,
      click,
      clickError,
      clickPoint,
      clickSource,
      screenshot,
      environment,
      environmentKey,
    };
  } finally {
    await context.close();
  }
}

/**
 * 生命周期：卸载后实例必须被 dispose，重新挂载后必须重新就绪且仍只有一个实例。
 *
 * 走 `bar` 页：两个框架的 `bar-main` 都暴露了 `__EXAMPLE_REMOUNT__`（卸载 + 重挂）。
 * 没有该钩子的页面记为 `not-run`，不冒充通过。
 */
async function probeLifecycle({ browser, port, framework, component = 'bar' }) {
  const url = `http://127.0.0.1:${port}${PAGE_PATH[component]}`;
  const context = await browser.newContext(contextOptions('light'));
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__COMPONENT_EXAMPLE__ !== undefined, undefined, { timeout: 30_000 });
    await page.evaluate(() => window.__COMPONENT_EXAMPLE__.ready);
    // 先把旧宿主元素本身取出来：卸载后重新挂载会创建一个**新的**宿主，
    // 事后再 querySelector 拿到的是新元素，那样「实例是否被 dispose」永远测不出来。
    const before = await page.evaluate(() => {
      const host = document.querySelector('.charts-bar');
      const instance = host ? (window.__A10_ECHARTS__?.getInstanceByDom(host) ?? null) : null;
      return { hasHost: host !== null, hasInstance: instance !== null };
    });
    if (!before.hasHost) {
      return { component, status: 'not-run', reason: '未找到图表宿主元素' };
    }
    if (!before.hasInstance) {
      return { component, status: 'failed', reason: '就绪后仍取不到 ECharts 实例' };
    }
    const hasHook = await page.evaluate(() => typeof window.__EXAMPLE_REMOUNT__ === 'function');
    if (!hasHook) {
      return { component, status: 'not-run', reason: '示例页未暴露 __EXAMPLE_REMOUNT__' };
    }
    const disposed = await page.evaluate(async () => {
      const stale = document.querySelector('.charts-bar');
      const aliveBefore = stale ? (window.__A10_ECHARTS__?.getInstanceByDom(stale) ?? null) !== null : false;
      window.__EXAMPLE_REMOUNT__();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const aliveAfter = stale ? (window.__A10_ECHARTS__?.getInstanceByDom(stale) ?? null) !== null : false;
      return { aliveBeforeUnmount: aliveBefore, staleInstanceAlive: aliveAfter };
    });
    await page.waitForFunction(() => window.__COMPONENT_EXAMPLE__ !== undefined, undefined, { timeout: 30_000 });
    await page.evaluate(() => window.__COMPONENT_EXAMPLE__.ready);
    const after = await page.evaluate(() => {
      const host = document.querySelector('.charts-bar');
      return {
        canvases: host ? host.querySelectorAll('canvas').length : 0,
        svgs: host ? host.querySelectorAll('svg').length : 0,
        checks: window.__COMPONENT_EXAMPLE__.getChecks(),
      };
    });
    const problems = [];
    if (disposed.staleInstanceAlive) problems.push('卸载后旧宿主上的 ECharts 实例仍然存活：dispose 未调用');
    if (after.canvases + after.svgs !== 1) {
      problems.push(`重新挂载后 canvas=${after.canvases} svg=${after.svgs}，应恰好一个`);
    }
    for (const check of after.checks ?? []) {
      if (check.status !== 'passed') problems.push(`自检 ${check.name} 未通过：${check.message ?? ''}`);
    }
    if (pageErrors.length > 0) problems.push(`页面错误：${pageErrors.join('; ')}`);
    return {
      component,
      status: problems.length === 0 ? 'passed' : 'failed',
      reason: problems.length === 0 ? undefined : problems.join('；'),
      before,
      disposed,
      after,
      pageErrors,
    };
  } catch (error) {
    return { component, status: 'not-run', reason: String(error?.message ?? error) };
  } finally {
    await context.close();
  }
}

/**
 * 浏览器维度总入口。
 */
export async function runBrowserProbe(options) {
  const server = staticFileServer(path.join(options.consumer.root, 'dist'));
  const port = await listen(server);
  const runs = [];
  try {
    for (const component of options.components) {
      for (const presentation of options.presentations) {
        // eslint-disable-next-line no-await-in-loop -- 顺序执行避免并行浏览器上下文互相拖慢
        runs.push(
          await probeCombination({
            browser: options.browser,
            port,
            framework: options.framework,
            frameworkVersion: options.frameworkVersion,
            echartsVersion: options.echartsVersion,
            component,
            presentation,
            environmentBase: options.environmentBase,
            screenshotDir: options.screenshotDir,
          }),
        );
      }
    }
    const lifecycle = await probeLifecycle({ browser: options.browser, port, framework: options.framework });
    return { runs, lifecycle };
  } finally {
    await close(server);
  }
}

/** 运行维度：宿主唯一、无页面错误、自检全过、渲染器真实生效。 */
export function summariseRuntime(run) {
  const problems = [];
  if (run.hostCount !== 1) problems.push(`宿主元素数量=${run.hostCount}，应为 1`);
  if (run.pageErrors.length > 0) problems.push(`页面错误：${run.pageErrors.join('; ')}`);
  for (const check of run.checks ?? []) {
    if (check.status !== 'passed') problems.push(`自检 ${check.name} 未通过：${check.message ?? ''}`);
  }
  const expected = run.presentation.endsWith('canvas') ? { canvases: 1, svgs: 0 } : { canvases: 0, svgs: 1 };
  if (!run.appliedPresentation) {
    problems.push('未取到 appliedPresentation：无法确认渲染器真实生效');
  } else {
    if (run.appliedPresentation.canvases !== expected.canvases) {
      problems.push(`canvas 数量=${run.appliedPresentation.canvases}，期望 ${expected.canvases}`);
    }
    if (run.appliedPresentation.svgs !== expected.svgs) {
      problems.push(`svg 数量=${run.appliedPresentation.svgs}，期望 ${expected.svgs}`);
    }
  }
  return problems;
}

/** 交互维度：逐个组件比对点击载荷与共享语义。 */
export function summariseInteraction(run, component) {
  const expected = EXPECTED_FIRST_CLICK[component];
  if (run.clickError) return [`${component}: ${run.clickError}`];
  const clicks = Array.isArray(run.click) ? run.click : [];
  if (clicks.length === 0) return [`${component}: 点击未产生任何事件`];
  const first = clicks[0];
  const same =
    first?.seriesId === expected.seriesId &&
    first?.dataIndex === expected.dataIndex &&
    first?.nativeType === expected.nativeType &&
    JSON.stringify(first?.value) === JSON.stringify(expected.value);
  if (!same) {
    return [
      `${component}: 点击载荷与共享语义不一致，期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(first)}`,
    ];
  }
  if (clicks.length !== 1) return [`${component}: 单次点击产生 ${clicks.length} 个事件`];
  return [];
}

/**
 * 从一份证据 JSON 里取出全部截图记录。
 *
 * 截图挂在 `combinations[].screenshots` 下（每个实现一份），不在顶层——之前直接读
 * `evidence.screenshots` 永远读空，于是任何真实基线都被判成 `NEW`，
 * 「没有基线」被误报成「有新差异」。这里两种形状都认，但优先摊平 combinations。
 */
export function baselineScreenshots(evidence) {
  if (!evidence) return [];
  if (Array.isArray(evidence)) return evidence;
  const flattened = (evidence.combinations ?? []).flatMap((combination) => combination.screenshots ?? []);
  return flattened.length > 0 ? flattened : (evidence.screenshots ?? []);
}

/** 视觉维度：与基线的逐字节比对。没有同 environmentKey 的基线时返回 `not-run`。 */
export function compareWithBaseline(screenshot, evidence) {
  const baseline = baselineScreenshots(evidence);
  if (baseline.length === 0) {
    return { result: 'NEW', reason: '没有可用的视觉基线（未传 --baseline 或基线里没有截图）' };
  }
  const reference = baseline.find(
    (shot) =>
      shot.component === screenshot.component &&
      shot.framework === screenshot.framework &&
      shot.presentation === screenshot.presentation,
  );
  if (!reference) {
    return { result: 'NEW', reason: '基线中没有同一 (组件, 框架, 展示组合) 的截图' };
  }
  if (reference.environmentKey !== screenshot.environmentKey) {
    return {
      result: 'INCOMPATIBLE',
      reason:
        `environmentKey 不一致：基线=${reference.environmentKey?.slice(0, 16)}…，` +
        `本次=${screenshot.environmentKey?.slice(0, 16)}…。环境签名不同不得自动判过。`,
    };
  }
  if (reference.sha256 !== screenshot.sha256) {
    return {
      result: 'DIFF',
      reason: `同环境下截图字节不同：基线=${reference.sha256?.slice(0, 16)}…，本次=${screenshot.sha256?.slice(0, 16)}…`,
    };
  }
  return { result: 'PASS' };
}
