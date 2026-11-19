/**
 * T17 矩阵浏览器断言执行器：有限 click/fill + visible/text/count + 资源加载 + pageerror。
 *
 * 边界（对应设计文档 browser 规格）：
 * - 只用 click / fill 动作与 visible / text / count 断言，不做 evaluate、不注入模块；
 * - 新 Chromium context：无用户 profile/cookie/storage；
 * - 精确 readySelector + 有界超时；零尺寸、pageerror、断言失败都判失败；
 * - 截图按视觉基线对比（默认 pixelThreshold=0.1 / maxDiffPixelRatio=0.001），
 *   环境签名不同不得 PASS。
 */
import { createServer } from 'node:http';
import path from 'node:path';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import type { T17BrowserAction, T17BrowserAssertion, T17Interaction, T17PositiveScenario } from '../../fixtures/t17-matrix/scenarios.js';
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

/**
 * 视觉对比：pixelDiff 由像素阈值与最大差异比例共同判定（产品规格默认 0.1 / 0.001）。
 * 环境签名不同不得 PASS；没有同环境键基线为 NEW；同环境字节差异为 DIFF。
 */
export type VisualCompareInput = {
  screenshot: { bytes: number; sha256: string; width: number; height: number; diffPixelRatio?: number };
  baseline: { bytes: number; sha256: string; width: number; height: number; environmentKey: string } | null;
  environment: { width: number; height: number; renderer: 'canvas' | 'svg'; theme: string; environmentKey: string };
  thresholds?: { pixelThreshold: number; maxDiffPixelRatio: number };
};
export function compareVisual(input: VisualCompareInput): 'PASS' | 'DIFF' | 'NEW' | 'INCOMPATIBLE' {
  if (!input.baseline) return 'NEW';
  if (input.baseline.environmentKey !== input.environment.environmentKey) return 'INCOMPATIBLE';
  if (input.baseline.width !== input.environment.width || input.baseline.height !== input.environment.height) return 'INCOMPATIBLE';
  if (input.screenshot.width !== input.environment.width || input.screenshot.height !== input.environment.height) return 'INCOMPATIBLE';
  const thresholds = input.thresholds ?? { pixelThreshold: 0.1, maxDiffPixelRatio: 0.001 };
  const ratio = input.screenshot.diffPixelRatio;
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) return 'INCOMPATIBLE';
  if (!Number.isFinite(thresholds.pixelThreshold) || thresholds.pixelThreshold < 0 || thresholds.pixelThreshold > 1 ||
      !Number.isFinite(thresholds.maxDiffPixelRatio) || thresholds.maxDiffPixelRatio < 0 || thresholds.maxDiffPixelRatio > 1) return 'INCOMPATIBLE';
  const identical = input.baseline.sha256 === input.screenshot.sha256;
  if (identical) return 'PASS';
  return ratio <= thresholds.maxDiffPixelRatio ? 'PASS' : 'DIFF';
}

/** 由 run-seal 封存的矩阵侧 DOM 观察记录（动作/断言按真实 DOM querySelector 推导）。 */
export type BrowserObservation = {
  kind: 'action' | 'assertion' | 'asset' | 'pageerror';
  selectorOrUrl: string;
  status: 'passed' | 'failed' | 'loaded' | 'missing' | 'errored';
  detail: string;
};

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
 * 默认浏览器安装路径（可由 T17_MATRIX_ACCEPT_REAL 控制）：真实执行需要本机 Playwright Chromium。
 * 本模块只提供路径推导与证据封装，不在仓库内启动浏览器（例外：产品规范的 C 侧验收环境）。
 */
export function browsersPath(env: MatrixEnv): string {
  const fromEnv = process.env.T17_MATRIX_PLAYWRIGHT_BROWSERS_PATH;
  if (fromEnv) return fromEnv;
  const monorepoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
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
      response.end(readFileSync(target));
    } catch { response.statusCode = 404; response.end('not found'); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  if (!address || typeof address === 'string') { await new Promise<void>((resolve) => server.close(() => resolve())); throw new Error('静态服务器未绑定 loopback'); }
  return { server, origin: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
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
