import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, describe, expect, it } from 'vitest';
import { T17_POSITIVE_SCENARIOS } from '../../fixtures/t17-matrix/scenarios.js';
import { compareVisual, installBrowserNetworkGuards, runBrowserScenario, startStaticServer } from './browser.js';

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 't17-browser-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('T17 浏览器与视觉边界', () => {
  const png = (color: [number, number, number, number]): Buffer => {
    const image = new PNG({ width: 20, height: 10 });
    for (let offset = 0; offset < image.data.length; offset += 4) image.data.set(color, offset);
    return PNG.sync.write(image);
  };
  const visualInput = (overrides: Partial<Parameters<typeof compareVisual>[0]> = {}): Parameters<typeof compareVisual>[0] => ({
    screenshot: { bytes: png([255, 255, 255, 255]) },
    baseline: { bytes: png([255, 255, 255, 255]), environmentKey: 'env-current' },
    environment: { width: 20, height: 10, renderer: 'canvas', theme: 'light', environmentKey: 'env-current' },
    thresholds: { pixelThreshold: 0.1, maxDiffPixelRatio: 0.001 },
    ...overrides,
  });

  it('在 browser context 上安装 HTTP 白名单和 WebSocket 拒绝器', async () => {
    type HttpRoute = { request(): { url(): string; method(): string }; continue(): Promise<void>; abort(reason?: string): Promise<void> };
    type SocketRoute = { url(): string; close(options?: { code?: number; reason?: string }): Promise<void> };
    let httpHandler: ((route: HttpRoute) => Promise<void>) | undefined;
    let socketHandler: ((route: SocketRoute) => void) | undefined;
    const context = {
      route: async (_pattern: string, handler: (route: HttpRoute) => Promise<void>) => { httpHandler = handler; },
      routeWebSocket: async (_pattern: string, handler: (route: SocketRoute) => void) => { socketHandler = handler; },
    };
    const blocked: string[] = [];
    await installBrowserNetworkGuards(context as never, 'http://127.0.0.1:43210', (url) => blocked.push(url));
    expect(httpHandler).toBeDefined();
    expect(socketHandler).toBeDefined();

    const httpCalls: string[] = [];
    const handleHttp = (url: string, method: string) => httpHandler!({
      request: () => ({ url: () => url, method: () => method }),
      continue: async () => { httpCalls.push('continue'); },
      abort: async () => { httpCalls.push('abort'); },
    });
    await handleHttp('http://127.0.0.1:43210/app.js', 'GET');
    await handleHttp('http://127.0.0.1:43210/app.js', 'HEAD');
    await handleHttp('http://user:password@127.0.0.1:43210/app.js', 'GET');
    await handleHttp('https://outside.invalid/popup', 'GET');
    await handleHttp('http://127.0.0.1:43210/mutate', 'POST');
    expect(httpCalls).toEqual(['continue', 'continue', 'abort', 'abort', 'abort']);

    const closed: string[] = [];
    socketHandler!({ url: () => 'wss://outside.invalid/socket', close: async () => { closed.push('closed'); } });
    expect(closed).toEqual(['closed']);
    expect(blocked).toEqual(['http://user:password@127.0.0.1:43210/app.js', 'https://outside.invalid/popup', 'http://127.0.0.1:43210/mutate', 'wss://outside.invalid/socket']);
  });

  it('environment key differs 时不可按相同截图字节判通过', () => {
    const input = visualInput({
      baseline: { bytes: png([255, 255, 255, 255]), environmentKey: 'env-old' },
    });
    expect(compareVisual(input).status).toBe('INCOMPATIBLE');
  });

  it('无效 PNG 字节时失败关闭', () => {
    for (const bytes of [Buffer.from('not a png'), png([255, 255, 255, 255]).subarray(0, 8)]) {
      expect(compareVisual(visualInput({ screenshot: { bytes } })).status).toBe('INCOMPATIBLE');
    }
  });

  it('基于截图与基线的真实 PNG 像素计算差异，调用者元数据不能伪造 PASS', () => {
    const onePixelDifferent = PNG.sync.read(png([255, 255, 255, 255]));
    onePixelDifferent.data.set([0, 0, 0, 255], 0);
    const screenshot = PNG.sync.write(onePixelDifferent);
    const result = compareVisual(visualInput({ screenshot: { bytes: screenshot } }));
    expect(result).toMatchObject({ status: 'DIFF', differingPixels: 1, diffPixelRatio: 0.005 });
  });

  it('像素阈值与差异比例阈值均参与真实图像判定', () => {
    const edited = PNG.sync.read(png([255, 255, 255, 255]));
    edited.data.set([230, 230, 230, 255], 0);
    const screenshot = PNG.sync.write(edited);
    const input = visualInput({ screenshot: { bytes: screenshot } });
    expect(compareVisual({ ...input, thresholds: { pixelThreshold: 0.2, maxDiffPixelRatio: 0.001 } }).status).toBe('PASS');
    expect(compareVisual({ ...input, thresholds: { pixelThreshold: 0.05, maxDiffPixelRatio: 0.001 } }).status).toBe('DIFF');
    expect(compareVisual({ ...input, thresholds: { pixelThreshold: 0.05, maxDiffPixelRatio: 0.01 } }).status).toBe('PASS');
  });

  it('真实 Chromium 执行场景动作、DOM 断言并封存实际截图与观测', async () => {
    const root = await tempRoot();
    const dist = path.join(root, 'dist');
    await mkdir(dist);
    await writeFile(path.join(dist, 'index.html'), '<!doctype html><html><head><style>body{margin:0;background:#fff}</style></head><body><main data-testid="ready"><input data-testid="filter"><button data-testid="apply">Apply</button><span data-testid="filter-result"></span><span data-testid="events">events=0</span></main><script src="/app.js"></script></body></html>');
    const scriptBytes = Buffer.from('const input=document.querySelector("[data-testid=filter]");document.querySelector("[data-testid=apply]").addEventListener("click",()=>{document.querySelector("[data-testid=filter-result]").textContent=input.value;document.querySelector("[data-testid=events]").textContent="events=1"})');
    await writeFile(path.join(dist, 'app.js'), scriptBytes);
    const source = T17_POSITIVE_SCENARIOS[0]!;
    const scenario = {
      ...source,
      browser: {
        readySelector: '[data-testid="ready"]',
        actions: [
          { kind: 'fill' as const, selector: '[data-testid="filter"]', value: 'north' },
          { kind: 'click' as const, selector: '[data-testid="apply"]' },
        ],
        assertions: [
          { kind: 'visible' as const, selector: '[data-testid="ready"]' },
          { kind: 'text' as const, selector: '[data-testid="filter-result"]', value: 'north' },
          { kind: 'count' as const, selector: '[data-testid="apply"]', count: 1 },
        ],
        interaction: { selector: '[data-testid="events"]', pattern: 'events=(\\d+)', from: 0, to: 1 },
      },
    };

    const firstRun = await runBrowserScenario({ distDir: dist, scenario, viewport: { width: 320, height: 200 }, timeoutMs: 5_000 });
    expect(firstRun.visual.status).toBe('NEW');
    const result = await runBrowserScenario({ distDir: dist, scenario, viewport: { width: 320, height: 200 }, timeoutMs: 5_000,
      baseline: { bytes: firstRun.screenshot.bytes, environmentKey: firstRun.browser.environmentKey } });
    expect(result.status).toBe('passed');
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0]).toMatchObject({ status: 'passed', observed: { count: 1, text: 'north' } });
    expect(result.actions[1]).toMatchObject({ status: 'passed', observed: { count: 1 } });
    expect(result.assertions.map((record) => record.status)).toEqual(['passed', 'passed', 'passed']);
    expect(result.interaction).toMatchObject({ observed: true, before: 0, after: 1 });
    expect(result.pageErrors).toEqual([]);
    expect(result.screenshot.width).toBe(320);
    expect(result.screenshot.height).toBe(200);
    expect(result.screenshot.bytes.byteLength).toBeGreaterThan(100);
    expect(result.visual.status).toBe('PASS');
    expect(result.observations.some((item) => item.kind === 'action' && item.status === 'passed')).toBe(true);
    expect(result.assets.some((asset) => asset.url.endsWith('/'))).toBe(true);
    expect(result.browser.environmentKey).toBe(firstRun.browser.environmentKey);
    expect(result.scriptDigests).toEqual([{ url: expect.stringMatching(/\/app\.js$/), bytes: scriptBytes.byteLength,
      sha256: createHash('sha256').update(scriptBytes).digest('hex') }]);
  }, 60_000);

  it('多组件 readySelector 要求全部匹配元素可见且非零，保留场景数量断言', async () => {
    const root = await tempRoot();
    const dist = path.join(root, 'dist');
    await mkdir(dist);
    await writeFile(path.join(dist, 'index.html'), '<!doctype html><html><head><style>body{margin:0}.chart{width:100px;height:40px;background:#123456}</style></head><body><main data-testid="multi-host"><div class="chart"></div><div class="chart"></div><div class="chart"></div></main></body></html>');
    const source = T17_POSITIVE_SCENARIOS[0]!;
    const scenario = { ...source, browser: {
      readySelector: '[data-testid="multi-host"] .chart', actions: [],
      assertions: [{ kind: 'count' as const, selector: '[data-testid="multi-host"] .chart', count: 3 }],
      interaction: undefined,
    } };
    const first = await runBrowserScenario({ distDir: dist, scenario, viewport: { width: 320, height: 200 }, timeoutMs: 1_000 });
    expect(first.observations).toEqual(expect.arrayContaining([expect.objectContaining({
      selectorOrUrl: scenario.browser.readySelector, status: 'passed', detail: expect.stringContaining('3'),
    })]));
    const result = await runBrowserScenario({ distDir: dist, scenario, viewport: { width: 320, height: 200 }, timeoutMs: 1_000,
      baseline: { bytes: first.screenshot.bytes, environmentKey: first.browser.environmentKey } });
    expect(result.status).toBe('passed');
    expect(result.assertions).toEqual([expect.objectContaining({ status: 'passed', observed: { count: 3 } })]);
  }, 60_000);

  it.each(['display:none', 'height:0'])('多组件 readiness 拒绝任意不可见或零尺寸匹配项：%s', async (invalidStyle) => {
    const root = await tempRoot();
    const dist = path.join(root, 'dist');
    await mkdir(dist);
    await writeFile(path.join(dist, 'index.html'), '<!doctype html><html><head><style>.chart{width:100px;height:40px}</style></head><body><div class="chart"></div><div class="chart" style="' + invalidStyle + '"></div><button data-testid="run">Run</button></body></html>');
    const source = T17_POSITIVE_SCENARIOS[0]!;
    const readySelector = '.chart';
    const result = await runBrowserScenario({ distDir: dist, viewport: { width: 320, height: 200 }, timeoutMs: 250,
      scenario: { ...source, browser: { readySelector, actions: [{ kind: 'click', selector: '[data-testid="run"]' }], assertions: [], interaction: undefined } } });
    expect(result.status).toBe('failed');
    expect(result.observations).toEqual(expect.arrayContaining([expect.objectContaining({ selectorOrUrl: readySelector, status: 'failed' })]));
    expect(result.actions).toEqual([expect.objectContaining({ status: 'failed', detail: 'readySelector failed' })]);
  }, 60_000);

  it.each(['POST', 'PUT'])('真实 Chromium 保留同 URL 的先前拒绝，后续成功 GET 不能抹除：%s', async (method) => {
    const root = await tempRoot();
    const dist = path.join(root, 'dist');
    await mkdir(dist);
    const blockedFetch = 'fetch("/asset.js",{method:' + JSON.stringify(method) + '})';
    await writeFile(path.join(dist, 'asset.js'), 'window.fixtureReloaded=true;');
    await writeFile(path.join(dist, 'index.html'), '<!doctype html><html><body><main data-testid="result">pending</main><script>(async()=>{try{await ' + blockedFetch + '}catch{}const script=document.createElement("script");script.src="/asset.js";script.onload=()=>{document.querySelector("main").textContent="ready";document.querySelector("main").dataset.ready="true"};document.head.append(script)})()</script></body></html>');
    const source = T17_POSITIVE_SCENARIOS[0]!;
    const scenario = { ...source, browser: { readySelector: '[data-ready="true"]', actions: [],
      assertions: [{ kind: 'text' as const, selector: '[data-testid="result"]', value: 'ready' }], interaction: undefined } };
    const first = await runBrowserScenario({ distDir: dist, scenario, viewport: { width: 320, height: 200 }, timeoutMs: 2_000 });
    const result = await runBrowserScenario({ distDir: dist, scenario, viewport: { width: 320, height: 200 }, timeoutMs: 2_000,
      baseline: { bytes: first.screenshot.bytes, environmentKey: first.browser.environmentKey } });
    expect(result.visual.status).toBe('PASS');
    expect(result.assertions[0]?.status).toBe('passed');
    expect(result.pageErrors).toEqual([]);
    expect(result.scriptDigests).toEqual([expect.objectContaining({ url: expect.stringMatching(/\/asset\.js$/) })]);
    expect(result.observations).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'asset', status: 'errored' })]));
    expect(result.status).toBe('failed');
    expect(result.assets).toEqual(expect.arrayContaining([expect.objectContaining({ url: expect.stringMatching(/\/asset\.js$/), status: 'failed' })]));
  }, 60_000);

  it('真实 Chromium 拒绝非 loopback 子资源并将 ready/页面异常失败关闭', async () => {
    const root = await tempRoot();
    const dist = path.join(root, 'dist');
    await mkdir(dist);
    await writeFile(path.join(dist, 'index.html'), '<!doctype html><html><body><script src="http://example.invalid/bundle.js"></script><script>throw new Error("fixture page error")</script></body></html>');
    const source = T17_POSITIVE_SCENARIOS[0]!;
    const result = await runBrowserScenario({
      distDir: dist,
      scenario: { ...source, browser: { ...source.browser, readySelector: '[data-testid="never-ready"]', actions: [], assertions: [], interaction: undefined } },
      viewport: { width: 320, height: 200 },
      timeoutMs: 250,
    });
    expect(result.status).toBe('failed');
    expect(result.pageErrors.some((error) => error.message.includes('fixture page error'))).toBe(true);
    expect(result.assets.some((asset) => asset.url.startsWith('http://example.invalid/') && asset.status === 'failed')).toBe(true);
  }, 60_000);

  it('真实 Chromium context 拦截 popup 首导航和外部 WebSocket', async () => {
    const root = await tempRoot();
    const dist = path.join(root, 'dist');
    await mkdir(dist);
    await writeFile(path.join(dist, 'index.html'), '<!doctype html><html><body><main data-testid="ready">ready</main><script>window.open("https://example.invalid/popup");new WebSocket("wss://example.invalid/socket")</script></body></html>');
    const source = T17_POSITIVE_SCENARIOS[0]!;
    const result = await runBrowserScenario({
      distDir: dist,
      scenario: { ...source, browser: { ...source.browser, readySelector: '[data-testid="ready"]', actions: [], assertions: [], interaction: undefined } },
      viewport: { width: 320, height: 200 },
      timeoutMs: 2_000,
    });
    expect(result.status).toBe('failed');
    expect(result.assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: 'https://example.invalid/popup', status: 'failed' }),
      expect.objectContaining({ url: 'wss://example.invalid/socket', status: 'failed' }),
    ]));
  }, 60_000);

  it('旧环境基线保持 INCOMPATIBLE，即使像素完全相同也不能放行', () => {
    const bytes = png([255, 255, 255, 255]);
    expect(compareVisual(visualInput({
      screenshot: { bytes },
      baseline: { bytes, environmentKey: 'env-old' },
    })).status).toBe('INCOMPATIBLE');
  });

  it('loopback server 绑定在 127.0.0.1 且保留二进制资源原始字节', async () => {
    const root = await tempRoot();
    const dist = path.join(root, 'dist');
    await mkdir(dist);
    const bytes = Buffer.from([0, 255, 128, 13, 10, 42]);
    await writeFile(path.join(dist, 'asset.map'), bytes);

    const running = await startStaticServer(dist);
    try {
      expect(running.server.address()).toMatchObject({ address: '127.0.0.1' });
      const response = await fetch(new URL('/asset.map', running.origin));
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    } finally {
      await running.close();
    }
  });

  it('拒绝通过 dist 内的目录链接读取外部资源', async () => {
    const root = await tempRoot();
    const dist = path.join(root, 'dist');
    const external = path.join(root, 'external');
    await mkdir(dist);
    await mkdir(external);
    await writeFile(path.join(external, 'secret.js'), 'secret');
    await symlink(external, path.join(dist, 'linked'), 'junction');

    const running = await startStaticServer(dist);
    try {
      const response = await fetch(new URL('/linked/secret.js', running.origin));
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('not found');
    } finally {
      await running.close();
    }
  });
});
