/**
 * T11 平台验收：合成试点工程的浏览器点击/更新交互与页面核对
 *
 * 依据 docs/plans/2026-11-11-component-platform-implementation.md T11 第 1 项
 * 「完成类型/构建、点击/更新交互和页面核对，记录框架/引擎版本」，
 * 以及 T11 Files 要求创建 `tests/browser/platform-acceptance.spec.ts`。
 *
 * 断言语义沿用已冻结的 T17 浏览器契约（CLI 0.0.23，docs/verification/phase3-t17.md）：
 * - 动作之后所有断言共用同一等待预算 `BROWSER_TIMEOUT_MS`，允许页面异步更新；
 * - 条件满足即继续，永久不匹配在预算耗尽后仍失败；
 * - 文本保留首个匹配元素的 `textContent().trim()`；数量必须精确相等；可见性须非零宽高；
 * - pageerror 与非 loopback 外发请求均失败。
 *
 * 明确边界：本 spec 的页面是**合成夹具**，不是真实业务项目页面。
 * 它证明 harness 与断言链能在真实 Chromium 中跑通，**不满足** T11「两个真实业务项目」标准项；
 * 真实业务项目由用户提供访问范围后另行接入。
 */
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { expect, test, type Page, type Request } from '@playwright/test';
import { identifyProject, pilotRoot, releasePilotDirs } from '../integration/t11-support/pilot-harness.js';

const LOOPBACK = '127.0.0.1';
/** 动作后断言阶段的共享等待预算；不放宽超时，永久不匹配仍失败。 */
const BROWSER_TIMEOUT_MS = 5_000;

/** 合成 Vue/React 消费者页面夹具：真实 HTML + 真实点击/更新交互，但不来自任何业务工程。 */
function consumerPageHtml(framework: 'vue' | 'react'): string {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><title>T11 pilot ${framework}</title></head>
<body>
  <main>
    <h1 data-testid="title">T11 合成试点（${framework}）</h1>
    <button data-testid="refresh" type="button">刷新</button>
    <output data-testid="value">pending</output>
    <ul data-testid="series"><li data-testid="point">a</li><li data-testid="point">b</li></ul>
  </main>
  <script>
    // 点击后约 250ms 异步更新：用于验证共享等待预算内的异步断言，不放宽超时。
    var button = document.querySelector('[data-testid="refresh"]');
    var value = document.querySelector('[data-testid="value"]');
    button.addEventListener('click', function () {
      value.textContent = 'updating';
      setTimeout(function () { value.textContent = 'done'; }, 250);
    });
  </script>
</body>
</html>
`;
}

function startLoopbackServer(root: string): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer((request, response) => {
    const url = request.url ?? '/';
    if (url !== '/' && url !== '/index.html') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    const body = fs.readFileSync(path.join(root, 'index.html'));
    response.statusCode = 200;
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.setHeader('content-length', String(body.length));
    response.end(body);
  });
  return new Promise(resolve => {
    server.listen(0, LOOPBACK, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        origin: `http://${LOOPBACK}:${port}`,
        close: () => new Promise<void>(done => server.close(() => done())),
      });
    });
  });
}

/** 采集页面错误与非 loopback 外发请求；事件处理器内不抛错，统一在断言阶段复核。 */
function watchPage(page: Page): { pageErrors: string[]; externalRequests: string[] } {
  const pageErrors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', error => {
    pageErrors.push(error.message);
  });
  page.on('request', (request: Request) => {
    let parsed: URL;
    try {
      parsed = new URL(request.url());
    } catch {
      externalRequests.push(request.url());
      return;
    }
    if (parsed.hostname !== LOOPBACK && parsed.protocol !== 'data:' && parsed.protocol !== 'about:') {
      externalRequests.push(request.url());
    }
  });
  return { pageErrors, externalRequests };
}

for (const framework of ['vue', 'react'] as const) {
  test.describe(`T11 合成试点浏览器核对（${framework}）`, () => {
    let root: string;
    let origin: string;
    let close: (() => Promise<void>) | undefined;

    test.beforeEach(async () => {
      releasePilotDirs();
      root = pilotRoot(framework);
      fs.writeFileSync(path.join(root, 'index.html'), consumerPageHtml(framework), 'utf8');
      const server = await startLoopbackServer(root);
      origin = server.origin;
      close = server.close;
    });

    test.afterEach(async () => {
      await close?.();
      releasePilotDirs();
    });

    test('只读识别合成工程并留痕框架版本，随后完成点击/更新交互与页面核对', async ({ page }) => {
      const { pageErrors, externalRequests } = watchPage(page);

      // 只读识别：框架版本在访问页面前留痕；识别不到时必须是 undefined，不得猜测。
      const identity = identifyProject(root);
      expect(identity.framework).toBe('unknown');
      expect(identity.frameworkVersion).toBeUndefined();

      expect(origin.startsWith(`http://${LOOPBACK}:`)).toBe(true);
      await page.goto(origin, { waitUntil: 'load' });

      // 页面核对：标题、初始值与数量均为精确断言，共用同一等待预算。
      await expect(page.getByTestId('title')).toBeVisible({ timeout: BROWSER_TIMEOUT_MS });
      await expect(page.getByTestId('title')).toHaveText(`T11 合成试点（${framework}）`, { timeout: BROWSER_TIMEOUT_MS });
      await expect(page.getByTestId('value')).toHaveText('pending', { timeout: BROWSER_TIMEOUT_MS });
      await expect(page.getByTestId('point')).toHaveCount(2, { timeout: BROWSER_TIMEOUT_MS });
      for (const point of await page.getByTestId('point').all()) {
        const box = await point.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThan(0);
        expect(box?.height ?? 0).toBeGreaterThan(0);
      }

      // 点击/更新交互：异步更新由共享等待预算覆盖，不放宽超时。
      await page.getByTestId('refresh').click();
      await expect(page.getByTestId('value')).toHaveText('done', { timeout: BROWSER_TIMEOUT_MS });

      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
    });
  });
}
