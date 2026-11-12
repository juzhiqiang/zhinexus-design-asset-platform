import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { packPackage } from '../../packages/component-cli/src/local/pack.js';
import {
  setupCleanConsumer,
  verifyConsumerTypes,
  verifyConsumerRuntime,
} from '../../packages/component-cli/src/local/consumer.js';

describe('T03: outside-workspace clean consumer verification', () => {
  it(
    'installs packed @company/charts-core candidate tarball in isolated directory, verifying exports, types, SSR import, and browser rendering/events',
    async () => {
    const repoRoot = path.resolve(__dirname, '../../');
    const corePkgDir = path.join(repoRoot, 'packages', 'charts-core');

    // 1. 生成并冻结候选包 tarball
    const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-pack-'));
    const consumerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-consumer-'));

    try {
      const { tarballPath, sha256, tarballName } = await packPackage({
        packageDir: corePkgDir,
        outputDir: packDir,
      });

      expect(tarballName).toMatch(/^company-charts-core-.*\.tgz$/);
      expect(sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(fs.existsSync(tarballPath)).toBe(true);

      // 2. 在工作区外的干净目录安装候选包与 peer 依赖
      await setupCleanConsumer({
        targetDir: consumerDir,
        tarballs: {
          '@company/charts-core': tarballPath,
        },
        dependencies: {
          echarts: '6.1.0',
        },
      });

      // 3. 验证安装真实性：非工作区软链，无 workspace:* 协议
      const installedPkgDir = path.join(consumerDir, 'node_modules', '@company', 'charts-core');
      expect(fs.existsSync(installedPkgDir)).toBe(true);
      const realInstalledPath = fs.realpathSync(installedPkgDir);
      expect(realInstalledPath.startsWith(path.resolve(consumerDir))).toBe(true);
      expect(realInstalledPath.includes(corePkgDir)).toBe(false);

      const installedPkgJson = JSON.parse(
        fs.readFileSync(path.join(installedPkgDir, 'package.json'), 'utf8'),
      );
      expect(installedPkgJson.name).toBe('@company/charts-core');
      // 版本号唯一事实来源是 packages/charts-core/package.json，测试不硬编码
      const coreVersion = JSON.parse(
        fs.readFileSync(path.join(corePkgDir, 'package.json'), 'utf8'),
      ).version as string;
      expect(installedPkgJson.version).toBe(coreVersion);
      expect(installedPkgJson.dependencies).toBeUndefined();

      // 4. 验证类型声明与公开导出
      const validConsumerTs = `
import {
  createChartController,
  buildLineOption,
  normalizeChartData,
  formatValue,
  resolveTheme,
  getCoreRuntimeInfo,
  MISSING_VALUE_DISPLAY,
  lightTheme,
  darkTheme,
  ChartDataError,
} from '@company/charts-core';
import type {
  ChartData,
  ChartEvent,
  ChartConfig,
  LineChartConfig,
  ChartController,
  PointClickListener,
  Unsubscribe,
} from '@company/charts-core';

const data: ChartData = {
  series: [
    {
      id: 's1',
      name: 'Alpha',
      points: [{ x: '2026-Q1', y: 100 }],
    },
  ],
};

const normalized = normalizeChartData(data);
const option = buildLineOption(normalized, { renderer: 'canvas', theme: 'light' });
const info = getCoreRuntimeInfo();
const theme = resolveTheme('light');
const formatted = formatValue(100, { suffix: '%' });

export { option, info, theme, formatted, MISSING_VALUE_DISPLAY, lightTheme, darkTheme, ChartDataError };
`;

      const typeCheckResult = await verifyConsumerTypes({
        consumerDir,
        testFileName: 'verify-valid.ts',
        content: validConsumerTs,
      });
      if (!typeCheckResult.ok) {
        console.error('Type check failed with output:', typeCheckResult.output);
      }
      expect(typeCheckResult.ok).toBe(true);

      // 5. 反例类型测试：不存在的导出或错误类型必须引发 tsc 报错
      const invalidConsumerTs = `
import { NonExistentChartMethod } from '@company/charts-core';
console.log(NonExistentChartMethod);
`;
      const invalidTypeCheck = await verifyConsumerTypes({
        consumerDir,
        testFileName: 'verify-invalid.ts',
        content: invalidConsumerTs,
      });
      expect(invalidTypeCheck.ok).toBe(false);

      // 6. 验证 Node / SSR 宿主安全导入：不得访问 window / document 全局对象
      const ssrScript = `
import { getCoreRuntimeInfo, normalizeChartData, buildLineOption, formatValue, resolveTheme } from '@company/charts-core';

const info = getCoreRuntimeInfo();
if (info.stage !== 'bootstrap' || info.echartsVersion !== '6.1.0') {
  throw new Error('Unexpected runtime info: ' + JSON.stringify(info));
}

const data = normalizeChartData({
  series: [{ id: 'test', name: '测试系列', points: [{ x: 'A', y: 42 }] }],
});
const option = buildLineOption(data, { renderer: 'canvas' });
if (!option.series || option.series.length !== 1) {
  throw new Error('Unexpected line option');
}

console.log(JSON.stringify({ ssrOk: true, info }));
`;
      const ssrResult = await verifyConsumerRuntime({
        consumerDir,
        scriptFileName: 'verify-ssr.mjs',
        content: ssrScript,
      });
      if (!ssrResult.ok) {
        console.error('SSR test failed with stderr:', ssrResult.stderr, 'stdout:', ssrResult.stdout);
      }
      expect(ssrResult.ok).toBe(true);
      expect(ssrResult.stdout).toContain('"ssrOk":true');

      // 7. 验证真实浏览器渲染与点击事件 (Vite + Playwright Chromium)
      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Packed Consumer Test</title>
</head>
<body>
  <div id="chart-host" style="width: 400px; height: 300px;"></div>
  <script type="module" src="./verify-render.ts"></script>
</body>
</html>
`;
      const renderScriptContent = `
import { createChartController } from '@company/charts-core';

declare global {
  interface Window {
    __CONTROLLER__?: any;
    __CLICKED_EVENT__?: any;
  }
}

const host = document.getElementById('chart-host');
if (!host) throw new Error('Host not found');

const controller = createChartController(host, {
  renderer: 'canvas',
  theme: 'light',
  animation: false,
});

window.__CONTROLLER__ = controller;

const testData = {
  series: [
    {
      id: 's-sales',
      name: '销量',
      points: [
        { x: '周一', y: 120 },
        { x: '周二', y: 200 },
      ],
    },
  ],
};

controller.update(testData);

controller.onPointClick((evt) => {
  window.__CLICKED_EVENT__ = evt;
});
`;

      await fs.promises.writeFile(path.join(consumerDir, 'index.html'), htmlContent, 'utf8');
      await fs.promises.writeFile(
        path.join(consumerDir, 'verify-render.ts'),
        renderScriptContent,
        'utf8',
      );

      // 启动轻量 Vite 开发服务服务于消费者目录
      const viteServer = await createServer({
        root: consumerDir,
        server: {
          host: '127.0.0.1',
          port: 0,
        },
        logLevel: 'error',
      });
      await viteServer.listen();
      const address = viteServer.httpServer?.address();
      const port = typeof address === 'object' && address ? address.port : viteServer.config.server.port;

      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const pageErrors: string[] = [];
        page.on('pageerror', (err) => pageErrors.push(err.message));

        await page.goto(`http://127.0.0.1:${port}/index.html`);
        await page.waitForFunction(() => (window as any).__CONTROLLER__ !== undefined);
        await page.evaluate(() => (window as any).__CONTROLLER__.whenRendered());

        // 验证真实 Canvas 已成功渲染且数量为 1
        const canvasCount = await page.locator('#chart-host canvas').count();
        expect(canvasCount).toBe(1);

        // 触发真实图表数据点点击并捕获标准 ChartEvent
        await page.evaluate(() => {
          const instance = (window as any).__CONTROLLER__.getInstance();
          instance.trigger('click', {
            componentType: 'series',
            seriesId: 's-sales',
            dataIndex: 1,
            name: '周二',
            value: 200,
            type: 'click',
            event: { event: { type: 'pointerdown' } },
          });
        });

        const clickedEvent = await page.evaluate(() => (window as any).__CLICKED_EVENT__);
        expect(clickedEvent).toEqual({
          seriesId: 's-sales',
          dataIndex: 1,
          value: ['周二', 200],
          nativeType: 'pointerdown',
        });

        // 验证生命周期清理：dispose 销毁实例并移除画布
        await page.evaluate(() => (window as any).__CONTROLLER__.dispose());
        const canvasCountAfterDispose = await page.locator('#chart-host canvas').count();
        expect(canvasCountAfterDispose).toBe(0);
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
        await viteServer.close();
      }
    } finally {
      fs.rmSync(packDir, { recursive: true, force: true });
      fs.rmSync(consumerDir, { recursive: true, force: true });
    }
  }, 60_000);
});
