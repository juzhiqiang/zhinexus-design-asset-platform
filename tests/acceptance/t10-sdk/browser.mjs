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
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FONT_PROBE_STRINGS,
  FONT_REFERENCE_FAMILIES,
  PAGE_PATH,
  buildEnvironment,
  canonicalJson,
  chartHostSelector,
  computeEnvironmentKey,
  environmentProjection,
  fontDigestFromMeasurements,
  fontFingerprintCanonical,
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

/**
 * 在页面里测量字体指纹。
 *
 * 测量的是**真正参与渲染的字形**，不是字体族名——同一个族名在不同机器上可能落到完全不同
 * 的字体文件（尤其是中文字形）。因此取三样东西：
 * 1. 宿主元素上真实生效的 `font-family` 栈（`getComputedStyle`）；
 * 2. 每个族的 `document.fonts.check` 可用性 + 固定探针串的 canvas 前进宽度；
 * 3. 页面已加载的 Web 字体清单（`document.fonts` 条目）。
 *
 * 任意一项测不到就抛错，不退回常量：没有可信字体签名的截图不构成视觉证据。
 */
export const FONT_MEASUREMENT_SOURCE = (hostSelector, probeStrings, referenceFamilies) => {
  const host = document.querySelector(hostSelector);
  if (!host) throw new Error(`未找到图表宿主 ${hostSelector}，无法测量字体`);
  const stack = getComputedStyle(host).fontFamily;
  const families = [];
  const seen = new Set();
  const add = (family) => {
    const name = family.trim().replace(/^["']|["']$/g, '');
    if (name.length === 0 || seen.has(name)) return;
    seen.add(name);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('拿不到 2d context，无法测量字形前进宽度');
    context.font = `16px ${JSON.stringify(name)}`;
    families.push({
      family: name,
      available: document.fonts.check(`16px ${JSON.stringify(name)}`),
      advances: probeStrings.map((text) => context.measureText(text).width),
    });
  };
  for (const family of String(stack).split(',')) add(family);
  for (const family of referenceFamilies) add(family);
  const loadedFonts = [];
  document.fonts.forEach((face) => {
    loadedFonts.push(`${face.family} ${face.style} ${face.weight} ${face.status}`);
  });
  return { stack, families, loadedFonts };
};

/**
 * 读 Playwright 自己声明的浏览器修订号。
 *
 * 原先把 `browserRevision` 硬编码成 `'1000'`——那是契约示例里的占位值，不是本机事实。
 * 修订号进 environmentKey，写错的后果是「签名声称的环境与真实跑的环境不是同一个」。
 *
 * 定位 `playwright-core/browsers.json` 必须**沿依赖链解析**，不能按 node_modules 固定层数找：
 * pnpm 工作区里仓库根并不是 `playwright-core` 的直接依赖，`require.resolve` 从探针文件出发
 * 会直接抛 `ERR_PACKAGE_PATH_NOT_EXPORTED` / `MODULE_NOT_FOUND`。真正可达的路径是
 * `@playwright/test` → `playwright` → `playwright-core`（pnpm 给每个包自己的 node_modules）。
 * 每一步单独 try：某一步失败不能跳过其余候选。
 */
export function readBrowserRevision(importMetaUrl) {
  const candidates = [];
  // 沿依赖链逐级解析：从探针文件出发 → @playwright/test → playwright → playwright-core。
  // 每一级的 createRequire 以上一级**已解析出的 package.json 路径**为基准，
  // 因此不受 node_modules 固定层数影响，pnpm 与 npm 布局都能走通。
  let previous = null;
  for (const spec of ['@playwright/test/package.json', 'playwright/package.json', 'playwright-core/package.json']) {
    try {
      const base = previous === null ? createRequire(importMetaUrl) : createRequire(previous);
      const resolved = base.resolve(spec);
      candidates.push(path.join(path.dirname(resolved), 'browsers.json'));
      previous = resolved;
    } catch {
      // 单独失败不中断：换下一级
    }
  }
  // 兜底：仓库根的 node_modules 与 Node 发行版自带布局
  try {
    const rootRequire = createRequire(
      path.join(path.dirname(fileURLToPath(importMetaUrl)), '..', '..', '..', 'package.json'),
    );
    const resolved = rootRequire.resolve('playwright-core/package.json');
    candidates.push(path.join(path.dirname(resolved), 'browsers.json'));
  } catch {
    // 忽略
  }
  candidates.push(
    path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '..', '..', '..', 'node_modules', 'playwright-core', 'browsers.json'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'playwright-core', 'browsers.json'),
    path.join(path.dirname(process.execPath), 'node_modules', 'playwright-core', 'browsers.json'),
  );
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const manifest = JSON.parse(readFileSync(candidate, 'utf8'));
      const entry = (manifest.browsers ?? []).find((browser) => browser.name === 'chromium');
      if (entry && /^\d+$/.test(String(entry.revision))) return String(entry.revision);
    } catch {
      // 读了解析不了就试下一个候选，不猜
    }
  }
  throw new Error(
    'PROBE_ENVIRONMENT 读不到 playwright-core/browsers.json 的 chromium 修订号。' +
      'browserRevision 进 environmentKey，不能用占位值冒充；请确认仓库根已 pnpm install。',
  );
}

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

/**
 * 构造可复核的环境审计块。
 *
 * 宿主数不是 1 时拿不到环境投影，整个审计块必须是 `null`。原先这里无条件调
 * `environmentProjection(environment)`，`environment` 为 null 时直接抛
 * TypeError——探针不崩在出具证据之前是硬要求，一次截图失败不该带走整轮运行。
 *
 * @returns {object|null} `null` 表示本次没有环境投影，调用方应记为运行失败
 */
export function environmentAuditFor({
  environment,
  fontDigest,
  fontDigestSource,
  measuredFontDigest = null,
  fontFingerprint = null,
}) {
  if (environment === null || environment === undefined) return null;
  const projection = environmentProjection(environment);
  return {
    projection,
    canonical: canonicalJson(projection),
    fontDigest,
    fontDigestSource,
    measuredFontDigest,
    fontFingerprint: fontFingerprintAudit(fontFingerprint),
  };
}

/**
 * 解析**生效**的字体摘要：操作者显式值优先，否则用浏览器实测值。
 *
 * 这条规则原先散落在调用链里没人负责：浏览器侧无条件拿实测值覆盖，`probe.mjs` 顶层
 * 却按"有没有传 --font-digest"记 `operator-supplied`，于是签名与留痕可以对不上。
 * 抽成纯函数后，三方（生效值、来源、覆盖事实）一起返回，缺一不可。
 *
 * @param {{operator?: string|null; measured?: string|null}} input
 * @returns {{fontDigest: string; fontDigestSource: 'operator-supplied'|'measured'; measuredFontDigest: string|null; override: {requested: string; measured: string}|null}}
 */
export function resolveEffectiveFontDigest({ operator = null, measured = null } = {}) {
  if (operator) {
    return {
      fontDigest: operator,
      fontDigestSource: 'operator-supplied',
      measuredFontDigest: measured,
      override: measured && measured !== operator ? { requested: operator, measured } : null,
    };
  }
  if (measured) {
    return {
      fontDigest: measured,
      fontDigestSource: 'measured',
      measuredFontDigest: measured,
      override: null,
    };
  }
  // 两者都没有：不伪造签名。调用方必须把它当运行时失败处理，而不是兜一个常量。
  throw new Error(
    'PROBE_INTERNAL 既没有 --font-digest 也没有实测字体指纹，无法出具环境签名。' +
      '请改用 --skip-browser 明确放弃视觉维度，不要用常量顶替。',
  );
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
  fontDigest,
  measuredFontDigest,
  fontDigestSource,
  fontFingerprint,
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
        // 字体摘要取"实际生效"的那个值：操作者显式给了 --font-digest 就用它，
        // 否则用本页真实度量值。两者都在 environmentAudit 里分开留痕，可复核。
        fontDigest,
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
      // 让审核方能**重算** environmentKey，而不是只能看到一个 64 位摘要：
      // 规范化投影、被哈希的规范化 JSON、字体度量的原始依据一并留下。
      // 宿主数不是 1 时拿不到环境投影，审计块整体为 null——不能拿半个投影糊上去。
      environmentAudit: environmentAuditFor({
        environment,
        fontDigest,
        fontDigestSource,
        measuredFontDigest,
        fontFingerprint,
      }),
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
    // 字体指纹只测一次：同一台机器同一次运行里，各页面的字体栈相同。
    // 测不到就抛错——没有可信字体签名的截图不构成视觉证据，不用常量顶替。
    const fontFingerprint = await measureFontFingerprint({
      browser: options.browser,
      port,
      component: options.components[0],
      digest: fontDigestFromMeasurements,
    });
    // 操作者显式给了 --font-digest 时，环境签名必须用那个值；实测值照样保留在审计里，
    // 但不得悄悄覆盖显式声明。没给就用实测值。两者都不能缺：缺了就不出环境签名。
    const resolved = resolveEffectiveFontDigest({
      operator: options.fontDigest ?? null,
      measured: fontFingerprint.fontDigest,
    });
    const { fontDigest, fontDigestSource, measuredFontDigest, override: fontDigestOverride } = resolved;
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
            fontDigest,
            measuredFontDigest,
            fontDigestSource,
            fontFingerprint,
          }),
        );
      }
    }
    const lifecycle = await probeLifecycle({ browser: options.browser, port, framework: options.framework });
    return { runs, lifecycle, fontFingerprint, fontDigest, fontDigestSource, measuredFontDigest, fontDigestOverride };
  } finally {
    await close(server);
  }
}

/**
 * 打开示例页测量字体指纹。
 *
 * @param {{browser: object; port: number; component: string; digest: (m: unknown) => string}} options
 * @returns {Promise<{fontDigest: string; source: 'measured'; details: object}>}
 */
export async function measureFontFingerprint({ browser, port, component, digest }) {
  const hostSelector = chartHostSelector(component);
  const context = await browser.newContext(contextOptions('light'));
  const page = await context.newPage();
  try {
    const problems = [];
    page.on('pageerror', (error) => problems.push(error.message));
    await page.goto(`http://127.0.0.1:${port}${PAGE_PATH[component]}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__COMPONENT_EXAMPLE__ !== undefined, undefined, { timeout: 30_000 });
    await page.evaluate(() => window.__COMPONENT_EXAMPLE__.ready);
    const measurements = await page.evaluate(
      // 回调体只能引用**自己的参数**：page.evaluate 会把函数源码序列化后送进浏览器执行，
      // Node 模块作用域里的常量（FONT_MEASUREMENT_SOURCE）在页面里不存在。
      // 因此把源码字符串当参数传进去，页面内再用 new Function 还原成函数。
      ([fnSource, selector, probes, references]) => {
        const measure = new Function(`return (${fnSource})`)();
        return measure(selector, probes, references);
      },
      [
        `(${FONT_MEASUREMENT_SOURCE.toString()})`,
        hostSelector,
        [...FONT_PROBE_STRINGS],
        [...FONT_REFERENCE_FAMILIES],
      ],
    );
    if (problems.length > 0) {
      throw new Error(`PROBE_ENVIRONMENT 字体测量页面报错：${problems.join('; ')}`);
    }
    return {
      fontDigest: digest(measurements),
      source: 'measured',
      details: measurements,
      canonical: fontFingerprintCanonical(measurements),
    };
  } finally {
    await context.close();
  }
}

/**
 * 字体指纹的可审核依据：原始度量 + 被哈希的规范化字符串。
 *
 * 只给 64 位摘要，审核方无法验证「这个摘要真的来自这些字体」；只给原始度量，
 * 又得让人去猜规范化规则。两者都留下，重算就是一次 SHA-256。
 */
export function fontFingerprintAudit(fingerprint) {
  return {
    stack: fingerprint.details.stack,
    families: fingerprint.details.families,
    loadedFonts: fingerprint.details.loadedFonts,
    fontDigest: fingerprint.fontDigest,
    canonical: fingerprint.canonical,
  };
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

/** 合并基线时留下的冲突清单（见 `probe.mjs` 的 `mergeBaselineEvidence`）。 */
export function baselineConflicts(evidence) {
  if (!evidence || Array.isArray(evidence)) return [];
  return evidence.conflicts ?? [];
}

/** 视觉维度：与基线的逐字节比对。没有同 environmentKey 的基线时返回 `not-run`。 */
export function compareWithBaseline(screenshot, evidence) {
  // 冲突 fail-closed：两份基线对同一组合给了不同字节/environmentKey 时，
  // 任何一份都不能当判据。原先只打日志保留第一份，比对仍可能判 PASS——
  // 等于用一份来路不明的基线宣布通过。
  const conflicts = baselineConflicts(evidence);
  if (conflicts.length > 0) {
    return {
      result: 'INCOMPATIBLE',
      reason:
        `基线存在 ${conflicts.length} 处冲突（同一组合在不同证据里字节或 environmentKey 不同），` +
        '无法确定哪份是判据，按 fail-closed 不判过。',
    };
  }
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
