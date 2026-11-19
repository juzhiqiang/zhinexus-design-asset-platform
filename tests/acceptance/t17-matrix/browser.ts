/**
 * T17 矩阵浏览器断言执行器：真实 Chromium + 有限 click/fill、DOM 观察、loopback 资源与视觉基线。
 *
 * 边界（对应设计文档 browser 规格）：
 * - 只用 click / fill 动作与 visible / text / count 断言，不做 evaluate、不注入模块；
 * - 新 Chromium context：无用户 profile/cookie/storage；
 * - 精确 readySelector + 有界超时；零尺寸、pageerror、断言失败都判失败；
 * - 截图的 PNG 解码像素按固定阈值比较（pixelThreshold=0.1 / maxDiffPixelRatio=0.001）；
 *   浏览器进程与静态服务均在本地验收端运行，环境签名不同不得 PASS。
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Route, WebSocketRoute } from '@playwright/test';
import { T17_TOOLCHAIN, T17_VISUAL, type T17BrowserAction, type T17BrowserAssertion, type T17Interaction, type T17PositiveScenario } from '../../fixtures/t17-matrix/scenarios.js';
import type { MatrixEnv } from './env.js';
import { canonicalJson, sha256Bytes, sha256Text } from './support.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.tsx': 'text/javascript; charset=utf-8',
  '.vue': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

export type BrowserAsset = { url: string; bytes: number; status: 'loaded' | 'missing' | 'failed'; contentType: string };

export type AssertionRecord = {
  assertion: T17BrowserAssertion;
  status: 'passed' | 'failed';
  observed: { visible?: boolean; text?: string; count?: number };
  detail?: string;
};

export type PageErrorRecord = { message: string };

export type BrowserBundle = {
  assets: BrowserAsset[];
  assertions: AssertionRecord[];
  pageErrors: PageErrorRecord[];
  interaction: { observed: boolean; before: number; after: number; action: string } | null;
  readySelector: string;
};

export type BrowserActionRecord = {
  action: T17BrowserAction;
  status: 'passed' | 'failed';
  observed: { count: number; text?: string };
  detail?: string;
};

export type VisualComparison = {
  status: 'PASS' | 'DIFF' | 'NEW' | 'INCOMPATIBLE';
  differingPixels?: number;
  diffPixelRatio?: number;
};

export type BrowserRunResult = BrowserBundle & {
  status: 'passed' | 'failed';
  actions: BrowserActionRecord[];
  observations: BrowserObservation[];
  screenshot: { bytes: Buffer; sha256: string; width: number; height: number };
  scriptDigests: { url: string; bytes: number; sha256: string }[];
  visual: VisualComparison;
  browser: { version: string; revision: string; environmentKey: string };
};

/**
 * 视觉对比：PNG 实际像素由 pixelThreshold 与最大差异比例共同判定（产品规格默认 0.1 / 0.001）。
 * 环境签名不同不得 PASS；没有同环境键基线为 NEW；超出差异比例为 DIFF。
 */
export type VisualCompareInput = {
  screenshot: { bytes: Uint8Array };
  baseline: { bytes: Uint8Array; environmentKey: string } | null;
  environment: { width: number; height: number; renderer: 'canvas' | 'svg'; theme: string; environmentKey: string };
  thresholds?: { pixelThreshold: number; maxDiffPixelRatio: number };
};
function decodePng(bytes: Uint8Array): PNG | null {
  try { return PNG.sync.read(Buffer.from(bytes)); } catch { return null; }
}

export function compareVisual(input: VisualCompareInput): VisualComparison {
  if (!input.baseline) return { status: 'NEW' };
  if (input.baseline.environmentKey !== input.environment.environmentKey) return { status: 'INCOMPATIBLE' };
  const screenshot = decodePng(input.screenshot.bytes);
  const baseline = decodePng(input.baseline.bytes);
  if (!screenshot || !baseline || screenshot.width !== baseline.width || screenshot.height !== baseline.height ||
      screenshot.width !== input.environment.width || screenshot.height !== input.environment.height) return { status: 'INCOMPATIBLE' };
  const thresholds = input.thresholds ?? { pixelThreshold: 0.1, maxDiffPixelRatio: 0.001 };
  if (!Number.isFinite(thresholds.pixelThreshold) || thresholds.pixelThreshold < 0 || thresholds.pixelThreshold > 1 ||
      !Number.isFinite(thresholds.maxDiffPixelRatio) || thresholds.maxDiffPixelRatio < 0 || thresholds.maxDiffPixelRatio > 1) return { status: 'INCOMPATIBLE' };
  const pixels = screenshot.width * screenshot.height;
  let differingPixels = 0;
  for (let offset = 0; offset < screenshot.data.length; offset += 4) {
    let delta = 0;
    for (let channel = 0; channel < 4; channel++) {
      delta = Math.max(delta, Math.abs(screenshot.data[offset + channel]! - baseline.data[offset + channel]!) / 255);
    }
    if (delta > thresholds.pixelThreshold) differingPixels++;
  }
  const diffPixelRatio = pixels ? differingPixels / pixels : 1;
  return { status: diffPixelRatio <= thresholds.maxDiffPixelRatio ? 'PASS' : 'DIFF', differingPixels, diffPixelRatio };
}

/** 由 run-seal 封存的矩阵侧 DOM 观察记录（动作/断言按真实 DOM querySelector 推导）。 */
export type BrowserObservation = {
  kind: 'action' | 'assertion' | 'asset' | 'pageerror';
  selectorOrUrl: string;
  status: 'passed' | 'failed' | 'loaded' | 'missing' | 'errored';
  detail: string;
};

/**
 * Network boundary for the isolated static preview. Context routing covers every page,
 * including a popup's first navigation; WebSocket upgrades are denied separately.
 */
export async function installBrowserNetworkGuards(
  context: Pick<BrowserContext, 'route' | 'routeWebSocket'>,
  allowedOrigin: string,
  onBlocked: (url: string) => void,
): Promise<void> {
  const allowed = new URL(allowedOrigin);
  if (allowed.protocol !== 'http:' || allowed.hostname !== '127.0.0.1' || !allowed.port || allowed.username || allowed.password || allowed.pathname !== '/' || allowed.search || allowed.hash) {
    throw new Error('Browser network allowlist must be an explicit 127.0.0.1 HTTP origin');
  }
  await context.route('**/*', async (route: Route) => {
    const request = route.request();
    let url: URL | undefined;
    try { url = new URL(request.url()); } catch { /* blocked below */ }
    if (!url || url.origin !== allowed.origin || url.username || url.password || !['GET', 'HEAD'].includes(request.method())) {
      onBlocked(request.url());
      await route.abort('blockedbyclient').catch(() => undefined);
      return;
    }
    await route.continue();
  });
  await context.routeWebSocket('**/*', async (route: WebSocketRoute) => {
    onBlocked(route.url());
    await route.close({ code: 1008, reason: 'WebSocket is outside the static preview boundary' }).catch(() => undefined);
  });
}

export function collectActionTypes(actions: readonly T17BrowserAction[]): string[] {
  const kinds = new Set<string>();
  for (const action of actions) kinds.add(action.kind);
  return [...kinds].sort();
}

/** 由预声明推导的断言种类序列（visible/text/count），供 spec 构造与证据绑定。 */
export function collectAssertionKinds(assertions: readonly T17BrowserAssertion[]): string[] {
  const kinds = new Set<string>();
  for (const assertion of assertions) kinds.add(assertion.kind);
  return [...kinds].sort();
}

/** 状态摘要：把 Scenario 的 hostMode 与预声明的动作/断言折叠为稳定字符串。 */
export function scenarioEvidenceKey(scenario: T17PositiveScenario): string {
  return canonicalJson({
    caseId: scenario.caseId,
    hostMode: scenario.hostMode,
    actions: scenario.browser.actions,
    assertions: scenario.browser.assertions,
    interaction: scenario.browser.interaction ?? null,
    visual: scenario.visual,
  });
}

/** ReadySelector 检查：实际产品 spec 上用同一选择器；静态判定只用于矩阵自检（不含浏览器，不参与通过结论）。 */
export function readySelectorShape(scenario: T17PositiveScenario): { selector: string; anchored: boolean } {
  return { selector: scenario.browser.readySelector, anchored: /\[data-testid=/.test(scenario.browser.readySelector) };
}

/** 由预声明构造 limited click/fill + 断言（产品 spec 使用同源场景；矩阵侧用于证据绑定）。 */
export function browserSpecFor(scenario: T17PositiveScenario): {
  readySelector: string;
  actions: T17BrowserAction[];
  assertions: T17BrowserAssertion[];
  actionsKinds: string[];
  assertionKinds: string[];
} {
  return {
    readySelector: scenario.browser.readySelector,
    actions: scenario.browser.actions,
    assertions: scenario.browser.assertions,
    actionsKinds: collectActionTypes(scenario.browser.actions),
    assertionKinds: collectAssertionKinds(scenario.browser.assertions),
  };
}

export function expectedInteraction(scenario: T17PositiveScenario): T17Interaction | undefined {
  return scenario.browser.interaction;
}

export function visualEnvironmentKey(input: {
  os: string; arch: string; browserVersion: string; browserRevision: string; fontDigest: string;
  locale: string; timezone: string; deviceScaleFactor: number; renderer: 'canvas' | 'svg';
  width: number; height: number; theme: string; frameworkVersion: string; echartsVersion: string;
}): string {
  // frameworkVersion / echartsVersion 不计入环境签名（与 contracts environmentProjection 一致）。
  const projection: Record<string, unknown> = {
    arch: input.arch,
    browserRevision: input.browserRevision,
    browserVersion: input.browserVersion,
    deviceScaleFactor: input.deviceScaleFactor,
    fontDigest: input.fontDigest,
    height: input.height,
    locale: input.locale,
    os: input.os,
    renderer: input.renderer,
    theme: input.theme,
    timezone: input.timezone,
    width: input.width,
  };
  const canonical = JSON.stringify(projection, Object.keys(projection).sort());
  return sha256Text(canonical);
}

/**
 * 默认浏览器安装路径：真实执行需要 .tools/playwright 下固定版本的 Playwright Chromium。
 */
export function browsersPath(env: MatrixEnv): string {
  const fromEnv = process.env.T17_MATRIX_PLAYWRIGHT_BROWSERS_PATH;
  if (fromEnv) return fromEnv;
  const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  return path.join(monorepoRoot, '.tools', 'playwright');
}

export function digestBytes(buffer: Buffer): string {
  return sha256Bytes(buffer);
}

/** 静态服务器握手：只暴露 build 产物（dist）目录，禁止直接服务项目源码。 */
export async function startStaticServer(distDir: string): Promise<{ server: ReturnType<typeof createServer>; origin: string; close: () => Promise<void> }> {
  const root = path.resolve(distDir);
  if (!existsSync(root) || !statSync(root).isDirectory() || lstatSync(root).isSymbolicLink() || realpathSync(root) !== root) {
    throw new Error('dist 根目录必须是未链接的普通目录');
  }
  const server = createServer((request, response) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') { response.statusCode = 405; response.setHeader('allow', 'GET, HEAD'); response.end('method not allowed'); return; }
      const rawUrl = request.url ?? '/';
      const url = new URL(rawUrl, 'http://127.0.0.1');
      if (url.origin !== 'http://127.0.0.1' || url.username || url.password) { response.statusCode = 404; response.end('not found'); return; }
      let decoded: string;
      try { decoded = decodeURIComponent(url.pathname); } catch { decoded = '\0'; }
      if (decoded.includes(String.fromCharCode(92)) || decoded.includes('\0') || decoded.split('/').includes('..')) {
        response.statusCode = 404; response.end('not found'); return;
      }
      const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
      const target = path.resolve(root, relative);
      const containment = path.relative(root, target);
      if (containment.startsWith('..') || path.isAbsolute(containment)) { response.statusCode = 404; response.end('not found'); return; }
      let current = root;
      for (const segment of relative.split(/[\\/]/).filter(Boolean)) {
        current = path.join(current, segment);
        if (!existsSync(current) || lstatSync(current).isSymbolicLink()) { response.statusCode = 404; response.end('not found'); return; }
      }
      if (!existsSync(target) || !statSync(target).isFile() || realpathSync(target) !== target) { response.statusCode = 404; response.end('not found'); return; }
      response.setHeader('content-type', MIME[path.extname(target)] ?? 'application/octet-stream');
      response.setHeader('x-content-type-options', 'nosniff');
      response.setHeader('cache-control', 'no-store');
      if (request.method === 'HEAD') response.end();
      else response.end(readFileSync(target));
    } catch { response.statusCode = 404; response.end('not found'); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  if (!address || typeof address === 'string') { await new Promise<void>((resolve) => server.close(() => resolve())); throw new Error('静态服务器未绑定 loopback'); }
  return { server, origin: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

export type BrowserRunInput = {
  /** 实际本轮 build 输出目录；服务器只读该目录并绑定 IPv4 loopback。 */
  distDir: string;
  scenario: T17PositiveScenario;
  viewport: { width: number; height: number };
  baseline?: { bytes: Uint8Array; environmentKey: string } | null;
  timeoutMs?: number;
};

let cachedFontDigest: string | undefined;

/** 环境签名以本机字体清单元数据构造；绝不接受场景或调用者提供的像素差异比例。 */
function fontInventoryDigest(): string {
  if (cachedFontDigest) return cachedFontDigest;
  const roots = process.platform === 'win32'
    ? [path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts')]
    : process.platform === 'darwin'
      ? ['/System/Library/Fonts', '/Library/Fonts', path.join(os.homedir(), 'Library/Fonts')]
      : ['/usr/share/fonts', '/usr/local/share/fonts', path.join(os.homedir(), '.fonts')];
  const files: { root: string; name: string; bytes: number; modified: number }[] = [];
  for (const root of roots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) continue;
    let entries: string[];
    try { entries = readdirSync(root); } catch { continue; }
    for (const name of entries.sort()) {
      if (!/\.(?:ttf|ttc|otf|woff2?)$/i.test(name)) continue;
      const target = path.join(root, name);
      try {
        const stat = lstatSync(target);
        if (stat.isFile() && !stat.isSymbolicLink()) files.push({ root: path.basename(root), name, bytes: stat.size, modified: Math.trunc(stat.mtimeMs) });
      } catch { /* A font can be replaced while the inventory is being read. */ }
    }
  }
  files.sort((left, right) => left.root.localeCompare(right.root) || left.name.localeCompare(right.name));
  cachedFontDigest = sha256Text(canonicalJson({ platform: process.platform, release: os.release(), files }));
  return cachedFontDigest;
}

function chromiumRevision(executablePath: string, browserVersion: string): string {
  return executablePath.match(/(?:chromium|chrome)-(\d+)(?:[\\/]|$)/i)?.[1] ?? browserVersion;
}

function cleanMessage(value: string): string {
  return value.replace(/(?:https?|wss?):\/\/[^\s"']+/gi, '[URL]').slice(0, 2048);
}

function parseInteraction(text: string, pattern: string): number | null {
  if (pattern.length > 128) return null;
  try {
    const match = new RegExp(pattern).exec(text.slice(0, 2048));
    if (!match?.[1]) return null;
    const value = Number(match[1]);
    return Number.isSafeInteger(value) ? value : null;
  } catch { return null; }
}

/**
 * 在全新 Chromium context 中访问本轮 dist 产物。浏览器只准请求该次随机 loopback origin；
 * DOM 行为、资源、pageerror 与 screenshot 都由真实 Playwright Chromium 观测。
 */
export async function runBrowserScenario(input: BrowserRunInput): Promise<BrowserRunResult> {
  const width = input.viewport.width;
  const height = input.viewport.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) {
    throw new Error('浏览器 viewport 必须是 1..4096 的整数尺寸');
  }
  const timeoutMs = input.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('浏览器步骤 timeout 必须在 1..120000ms');

  const server = await startStaticServer(input.distDir);
  let browser: import('@playwright/test').Browser | undefined;
  let context: import('@playwright/test').BrowserContext | undefined;
  let page: import('@playwright/test').Page | undefined;
  try {
    const browserRoot = path.resolve(browsersPath({} as MatrixEnv));
    if (!existsSync(browserRoot) || !statSync(browserRoot).isDirectory() || lstatSync(browserRoot).isSymbolicLink()) {
      throw new Error('T17 固定 Playwright Chromium 浏览器目录不可用');
    }
    process.env.PLAYWRIGHT_BROWSERS_PATH = browserRoot;
    const { chromium } = await import('@playwright/test');
    const browserEnv: NodeJS.ProcessEnv = { PLAYWRIGHT_BROWSERS_PATH: browserRoot };
    for (const key of ['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
      const value = process.env[key];
      if (value !== undefined) browserEnv[key] = value;
    }
    browser = await chromium.launch({ headless: true, env: browserEnv });
    context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      locale: 'en-US',
      timezoneId: 'UTC',
      colorScheme: input.scenario.visual.theme,
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    });
    page = await context.newPage();

    const assetsByUrl = new Map<string, BrowserAsset>();
    const assertions: AssertionRecord[] = [];
    const actions: BrowserActionRecord[] = [];
    const pageErrors: PageErrorRecord[] = [];
    const scriptDigests = new Map<string, { url: string; bytes: number; sha256: string }>();
    const observations: BrowserObservation[] = [];
    const pendingAssetObservations = new Set<Promise<void>>();
    let ready = false;
    let navigationFailed = false;
    let popupCount = 0;
    let dialogCount = 0;
    const assetUrl = (raw: string): string => {
      try { const url = new URL(raw); return url.origin + url.pathname; } catch { return raw.slice(0, 512); }
    };
    // A later successful request must never erase an earlier failure at the same redacted URL.
    const recordAsset = (asset: BrowserAsset): void => {
      const previous = assetsByUrl.get(asset.url);
      if (!previous || previous.status === 'loaded') assetsByUrl.set(asset.url, asset);
    };
    page.on('pageerror', (error) => pageErrors.push({ message: cleanMessage(error.message) }));
    page.on('crash', () => pageErrors.push({ message: 'Chromium page crashed' }));
    page.on('popup', () => { popupCount++; pageErrors.push({ message: 'Unexpected popup window' }); });
    page.on('dialog', (dialog) => { dialogCount++; pageErrors.push({ message: 'Unexpected browser dialog: ' + cleanMessage(dialog.message()) }); void dialog.dismiss().catch(() => undefined); });
    page.on('requestfailed', (request) => {
      const url = assetUrl(request.url());
      recordAsset({ url, bytes: 0, status: 'failed', contentType: '' });
    });
    page.on('response', (response) => {
      const task = (async () => {
        const url = assetUrl(response.url());
        let body: Buffer | undefined;
        try { body = await response.body(); } catch { /* An unreadable or aborted response cannot be a loaded asset. */ }
        const bytes = body?.byteLength ?? 0;
        const status = !body ? 'failed' : response.status() >= 200 && response.status() < 400 ? 'loaded' : response.status() === 404 ? 'missing' : 'failed';
        const contentType = response.headers()['content-type'] ?? '';
        recordAsset({ url, bytes, status, contentType });
        if (status === 'loaded' && body && response.request().resourceType() === 'script') {
          scriptDigests.set(url, { url, bytes: body.byteLength, sha256: digestBytes(body) });
        }
      })();
      pendingAssetObservations.add(task);
      void task.finally(() => pendingAssetObservations.delete(task));
    });

    await installBrowserNetworkGuards(context, server.origin, (rawUrl) => {
      const safeUrl = assetUrl(rawUrl);
      recordAsset({ url: safeUrl, bytes: 0, status: 'failed', contentType: '' });
      observations.push({ kind: 'asset', selectorOrUrl: safeUrl, status: 'errored', detail: 'Blocked request outside the read-only loopback HTTP GET/HEAD boundary' });
    });

    try { await page.goto(server.origin + '/', { waitUntil: 'domcontentloaded', timeout: timeoutMs }); }
    catch (error) { navigationFailed = true; pageErrors.push({ message: 'Navigation failed: ' + cleanMessage(error instanceof Error ? error.message : String(error)) }); }

    const readySelector = input.scenario.browser.readySelector;
    const readyLocator = page.locator(readySelector);
    try {
      const deadline = Date.now() + timeoutMs;
      await readyLocator.first().waitFor({ state: 'visible', timeout: timeoutMs });
      const count = await readyLocator.count();
      if (count < 1) throw new Error('readySelector must match at least one element');
      for (let index = 0; index < count; index++) {
        const element = readyLocator.nth(index);
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('readySelector timed out before all elements became ready');
        await element.waitFor({ state: 'visible', timeout: remaining });
        const box = await element.boundingBox();
        if (!box || box.width <= 0 || box.height <= 0) throw new Error('Every readySelector element must be visible with non-zero width and height');
      }
      if (await readyLocator.count() !== count) throw new Error('readySelector changed during readiness checks');
      ready = true;
      observations.push({ kind: 'assertion', selectorOrUrl: readySelector, status: 'passed', detail: count + ' visible elements have non-zero width and height' });
    } catch (error) {
      observations.push({ kind: 'assertion', selectorOrUrl: readySelector, status: 'failed', detail: cleanMessage(error instanceof Error ? error.message : String(error)) });
    }

    const interaction = input.scenario.browser.interaction;
    let before = -1;
    let after = -1;
    let interactionObserved = false;
    if (interaction) {
      try {
        const locator = page.locator(interaction.selector);
        const count = await locator.count();
        if (count !== 1) throw new Error('interaction selector matched ' + count + ' elements');
        before = parseInteraction(await locator.innerText({ timeout: timeoutMs }), interaction.pattern) ?? -1;
        if (before !== interaction.from) throw new Error('interaction started at ' + before + ', expected ' + interaction.from);
      } catch (error) {
        observations.push({ kind: 'assertion', selectorOrUrl: interaction.selector, status: 'failed', detail: cleanMessage(error instanceof Error ? error.message : String(error)) });
      }
    }

    for (const action of input.scenario.browser.actions) {
      const locator = page.locator(action.selector);
      let count = 0;
      try {
        count = await locator.count();
        if (!ready) throw new Error('readySelector failed');
        if (count !== 1) throw new Error('action selector matched ' + count + ' elements');
        if (!(await locator.isVisible())) throw new Error('action target is not visible');
        if (action.kind === 'click') await locator.click({ timeout: timeoutMs });
        else await locator.fill(action.value, { timeout: timeoutMs });
        const observed = action.kind === 'fill' ? await locator.inputValue({ timeout: timeoutMs }).catch(() => undefined) : undefined;
        actions.push({ action, status: 'passed', observed: { count, ...(observed === undefined ? {} : { text: observed }) } });
        observations.push({ kind: 'action', selectorOrUrl: action.selector, status: 'passed', detail: action.kind + ' completed on one visible DOM target' });
      } catch (error) {
        const detail = cleanMessage(error instanceof Error ? error.message : String(error));
        actions.push({ action, status: 'failed', observed: { count }, detail });
        observations.push({ kind: 'action', selectorOrUrl: action.selector, status: 'failed', detail });
      }
    }

    for (const assertion of input.scenario.browser.assertions) {
      const locator = page.locator(assertion.selector);
      let observed: AssertionRecord['observed'] = {};
      try {
        const count = await locator.count();
        if (assertion.kind === 'count') {
          observed = { count };
          if (count !== assertion.count) throw new Error('count=' + count + ', expected=' + assertion.count);
        } else {
          if (count !== 1) throw new Error('assertion selector matched ' + count + ' elements');
          if (assertion.kind === 'visible') {
            const visible = await locator.isVisible();
            observed = { visible };
            if (!visible) throw new Error('element is not visible');
            const box = await locator.boundingBox();
            if (!box || box.width <= 0 || box.height <= 0) throw new Error('visible element has zero dimensions');
          } else {
            const text = (await locator.innerText({ timeout: timeoutMs })).trim().slice(0, 2048);
            observed = { text };
            if (text !== assertion.value) throw new Error('text did not match the declared value');
          }
        }
        assertions.push({ assertion, status: 'passed', observed });
        observations.push({ kind: 'assertion', selectorOrUrl: assertion.selector, status: 'passed', detail: canonicalJson(observed) });
      } catch (error) {
        const detail = cleanMessage(error instanceof Error ? error.message : String(error));
        assertions.push({ assertion, status: 'failed', observed, detail });
        observations.push({ kind: 'assertion', selectorOrUrl: assertion.selector, status: 'failed', detail });
      }
    }

    if (interaction) {
      try {
        const locator = page.locator(interaction.selector);
        const count = await locator.count();
        if (count !== 1) throw new Error('interaction selector matched ' + count + ' elements after actions');
        after = parseInteraction(await locator.innerText({ timeout: timeoutMs }), interaction.pattern) ?? -1;
        interactionObserved = before === interaction.from && after === interaction.to;
        observations.push({ kind: 'assertion', selectorOrUrl: interaction.selector, status: interactionObserved ? 'passed' : 'failed', detail: 'interaction=' + before + '->' + after + ', expected=' + interaction.from + '->' + interaction.to });
      } catch (error) {
        observations.push({ kind: 'assertion', selectorOrUrl: interaction.selector, status: 'failed', detail: cleanMessage(error instanceof Error ? error.message : String(error)) });
      }
    }

    await Promise.allSettled([...pendingAssetObservations]);
    const screenshotBytes = Buffer.from(await page.screenshot({ type: 'png', animations: 'disabled', timeout: timeoutMs }));
    const screenshotImage = decodePng(screenshotBytes);
    if (!screenshotImage) throw new Error('Chromium did not produce a valid PNG screenshot');
    const screenshot = { bytes: screenshotBytes, sha256: digestBytes(screenshotBytes), width: screenshotImage.width, height: screenshotImage.height };
    const browserVersion = browser.version();
    const executablePath = (await import('@playwright/test')).chromium.executablePath();
    const browserRevision = chromiumRevision(executablePath, browserVersion);
    const environmentKey = visualEnvironmentKey({
      os: process.platform + '-' + os.release(),
      arch: process.arch,
      browserVersion,
      browserRevision,
      fontDigest: fontInventoryDigest(),
      locale: 'en-US',
      timezone: 'UTC',
      deviceScaleFactor: 1,
      renderer: input.scenario.visual.renderer,
      width,
      height,
      theme: input.scenario.visual.theme,
      frameworkVersion: input.scenario.framework === 'vue' ? T17_TOOLCHAIN.vue : T17_TOOLCHAIN.react,
      echartsVersion: T17_TOOLCHAIN.echarts,
    });
    const visual = compareVisual({
      screenshot,
      baseline: input.baseline ?? null,
      environment: { width, height, renderer: input.scenario.visual.renderer, theme: input.scenario.visual.theme, environmentKey },
      thresholds: { pixelThreshold: T17_VISUAL.pixelThreshold, maxDiffPixelRatio: T17_VISUAL.maxDiffPixelRatio },
    });
    for (const asset of assetsByUrl.values()) observations.push({
      kind: 'asset', selectorOrUrl: asset.url,
      status: asset.status === 'loaded' ? 'loaded' : asset.status === 'missing' ? 'missing' : 'errored',
      detail: asset.status + '; bytes=' + asset.bytes + '; content-type=' + asset.contentType,
    });
    observations.push({ kind: 'pageerror', selectorOrUrl: server.origin, status: pageErrors.length ? 'errored' : 'passed', detail: 'pageErrors=' + pageErrors.length + '; popups=' + popupCount + '; dialogs=' + dialogCount });
    const actionPassed = ready && !navigationFailed && actions.length === input.scenario.browser.actions.length && actions.every((item) => item.status === 'passed');
    const assertionsPassed = assertions.length === input.scenario.browser.assertions.length && assertions.every((item) => item.status === 'passed');
    const assetsPassed = [...assetsByUrl.values()].every((asset) => asset.status === 'loaded' && asset.bytes > 0);
    const status = actionPassed && assertionsPassed && (!interaction || interactionObserved) && !pageErrors.length && !popupCount && !dialogCount && assetsPassed && visual.status === 'PASS' ? 'passed' : 'failed';
    return {
      status,
      assets: [...assetsByUrl.values()],
      assertions,
      pageErrors,
      interaction: interaction ? { observed: interactionObserved, before, after, action: canonicalJson(input.scenario.browser.actions) } : null,
      readySelector,
      actions,
      observations,
      screenshot,
      scriptDigests: [...scriptDigests.values()].sort((left, right) => left.url.localeCompare(right.url)),
      visual,
      browser: { version: browserVersion, revision: browserRevision, environmentKey },
    };
  } finally {
    if (page) await page.close({ runBeforeUnload: false }).catch(() => undefined);
    if (context) await context.close().catch(() => undefined);
    if (browser) await browser.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

export const staticServerFor = (distDir: string) => {
  throw new Error('staticServerFor 已弃用，请使用 startStaticServer 并显式等待 loopback 监听');
};


/** 视觉基线的独立适用环境键：与 matrix 视觉参数一致，不含被测框架/echarts 版本。 */
export function baselineEnvironmentKey(input: {
  width: number; height: number; theme: string; renderer: 'canvas' | 'svg';
  fontDigest: string; browserVersion: string; browserRevision: string; locale: string; timezone: string;
  deviceScaleFactor: number; os: string; arch: string;
}): string {
  return sha256Text(canonicalJson({
    arch: input.arch,
    browserRevision: input.browserRevision,
    browserVersion: input.browserVersion,
    deviceScaleFactor: input.deviceScaleFactor,
    fontDigest: input.fontDigest,
    height: input.height,
    locale: input.locale,
    os: input.os,
    renderer: input.renderer,
    theme: input.theme,
    timezone: input.timezone,
    width: input.width,
  }));
}
