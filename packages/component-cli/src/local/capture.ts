import * as path from 'node:path';
import * as fs from 'node:fs';
import { chromium } from '@playwright/test';
import { createArtifactRef } from './digest.js';
import { detectEnvironment, computeEnvironmentKey } from './environment.js';
import type { EnvironmentV1 } from '../contracts/reports.js';
import type { CheckResult, ComponentExample, Renderer, ScreenshotRef } from '../contracts/examples.js';
import type { Framework } from '../contracts/release-manifest.js';

export type CaptureOptions = {
  url: string;
  states: string[];
  outputDir: string;
  baseDir?: string;
  logicalDir?: string;
  framework: Framework;
  frameworkVersion?: string;
  echartsVersion?: string;
  exampleId: string;
  variantId: string;
  packageSha256: string;
  packageVersion: string;
  timeoutMs?: number;
  viewport?: { width: number; height: number };
  theme?: string;
  renderer?: Renderer;
};

export type CaptureResult = {
  environment: EnvironmentV1;
  environmentKey: string;
  screenshots: ScreenshotRef[];
  checks: CheckResult[];
};

/**
 * 驱动示例就绪协议 (ready -> runState -> getChecks)，执行确定性截图并返回环境与报告材料。
 */
export async function captureExample(options: CaptureOptions): Promise<CaptureResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const viewport = options.viewport ?? { width: 800, height: 400 };
  const renderer: Renderer = options.renderer ?? 'canvas';
  const theme = options.theme ?? 'light';
  const statesToRun = options.states.length > 0 ? options.states : ['default'];

  await fs.promises.mkdir(options.outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    });

    const page = await context.newPage();
    const pageErrors: string[] = [];

    page.on('pageerror', (err: Error) => {
      pageErrors.push(err.message);
    });

    // 导航到示例页面
    try {
      await page.goto(options.url, { timeout: timeoutMs });
    } catch (err: unknown) {
      throw new Error(`PAGE_NAVIGATION_FAILED: 无法访问示例页面 ${options.url}: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 1. 等待 window.__COMPONENT_EXAMPLE__ 挂载
    try {
      await page.waitForFunction(
        () => (window as unknown as { __COMPONENT_EXAMPLE__?: unknown }).__COMPONENT_EXAMPLE__ !== undefined,
        undefined,
        { timeout: timeoutMs },
      );
    } catch {
      throw new Error(`READY_TIMEOUT: 页面未在超时内就绪 (__COMPONENT_EXAMPLE__ 未挂载)`);
    }

    // 2. 等待 example.ready 解析
    try {
      await page.evaluate(async ({ timeout, requiredStates }) => {
        const input: unknown = (window as unknown as { __COMPONENT_EXAMPLE__?: unknown }).__COMPONENT_EXAMPLE__;
        if (!input || typeof input !== 'object') throw new Error('INVALID_EXAMPLE_PROTOCOL: Expected an example object');
        const example = input as Partial<ComponentExample>;
        if (!example.ready || typeof example.ready.then !== 'function' ||
          typeof example.runState !== 'function' || typeof example.getChecks !== 'function') {
          throw new Error('INVALID_EXAMPLE_PROTOCOL: ready, runState and getChecks are required');
        }
        if (example.states !== undefined && (!Array.isArray(example.states) ||
          example.states.some(state => typeof state !== 'string' || !state.trim()) ||
          new Set(example.states).size !== example.states.length)) {
          throw new Error('INVALID_EXAMPLE_PROTOCOL: states must be unique nonempty names');
        }
        if (example.states !== undefined) {
          const missing = requiredStates.filter(state => !example.states!.includes(state));
          if (missing.length) throw new Error('INVALID_EXAMPLE_PROTOCOL: Missing required states: ' + missing.join(', '));
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([example.ready, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('READY_TIMEOUT: 页面就绪超时')), timeout);
          })]);
        } finally { clearTimeout(timer); }
      }, { timeout: timeoutMs, requiredStates: statesToRun });
    } catch (err: unknown) {
      throw new Error(err instanceof Error ? err.message : String(err));
    }

    // 3. 等待字体与有效渲染尺寸
    await page.evaluate(async () => {
      if (document.fonts) {
        await document.fonts.ready;
      }
    });

    const dimensions = await page.evaluate(() => {
      const el =
        document.querySelector('.charts-line') ||
        document.querySelector('.charts-bar') ||
        document.querySelector('.charts-pie') ||
        document.querySelector('.charts-scatter') ||
        document.querySelector('.charts-trend-card') ||
        document.querySelector('.charts-ranking') ||
        document.querySelector('.charts-proportion') ||
        document.querySelector('.chart-frame') ||
        document.querySelector('#chart') ||
        document.querySelector('#app');
      if (!el) return { width: 0, height: 0 };
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });

    if (dimensions.width <= 0 || dimensions.height <= 0) {
      throw new Error(`INVALID_DIMENSIONS: 图表容器尺寸无效: ${dimensions.width}x${dimensions.height}`);
    }

    const browserVersion = browser.version();
    const environment = detectEnvironment({
      browserVersion,
      renderer,
      width: viewport.width,
      height: viewport.height,
      theme,
      framework: options.framework,
      frameworkVersion: options.frameworkVersion,
      echartsVersion: options.echartsVersion,
    });
    const environmentKey = computeEnvironmentKey(environment);

    const screenshots: ScreenshotRef[] = [];
    const checks: CheckResult[] = [];

    // 4. 驱动 runState 并截取确定性图像
    for (const stateName of statesToRun) {
      const stateChecks = await page.evaluate(async ({ state, timeout }) => {
        const example = (window as unknown as { __COMPONENT_EXAMPLE__?: ComponentExample }).__COMPONENT_EXAMPLE__;
        if (!example || typeof example.runState !== 'function' || typeof example.getChecks !== 'function') {
          throw new Error('INVALID_EXAMPLE_PROTOCOL: runState and getChecks are required');
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([(async () => {
            await example.runState(state);
            if (!example.ready || typeof example.ready.then !== 'function') throw new Error('INVALID_EXAMPLE_PROTOCOL: ready must be a Promise');
            await example.ready;
          })(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('READY_TIMEOUT: 状态就绪超时: ' + state)), timeout);
          })]);
        } finally { clearTimeout(timer); }
        const input: unknown = example.getChecks();
        if (!Array.isArray(input) || input.length === 0 || input.some(check =>
          !check || typeof check !== 'object' || Array.isArray(check) ||
          typeof check.name !== 'string' || !check.name.trim() ||
          !['passed', 'failed'].includes(check.status) ||
          (check.message !== undefined && typeof check.message !== 'string') ||
          Object.keys(check).some(key => !['name', 'status', 'message'].includes(key)))) {
          throw new Error('INVALID_EXAMPLE_PROTOCOL: getChecks must return nonempty CheckResult[] for ' + state);
        }
        return input as CheckResult[];
      }, { state: stateName, timeout: timeoutMs });
      const failedChecks = stateChecks.filter(check => check.status === 'failed');
      if (failedChecks.length) throw new Error('CHECKS_FAILED: ' + stateName + ': ' + failedChecks.map(check => check.name + ': ' + (check.message ?? 'failed')).join('; '));
      if (pageErrors.length) throw new Error('PAGE_ERROR: ' + pageErrors.join('; '));
      checks.push(...stateChecks);

      // 短暂确认绘制循环完成
      await page.evaluate(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });

      const shotFileName = `${options.variantId}-${stateName}.png`;
      const shotPath = path.join(options.outputDir, shotFileName);

      await page.screenshot({ path: shotPath, type: 'png' });

      const logicalPath = options.baseDir
        ? path.relative(options.baseDir, shotPath).replace(/\\/g, '/')
        : options.logicalDir
          ? `${options.logicalDir.replace(/\/+$/, '')}/${shotFileName}`
          : path.relative(options.outputDir, shotPath).replace(/\\/g, '/');

      const artifact = await createArtifactRef(shotPath, logicalPath);
      screenshots.push({
        id: `shot-${stateName}-${artifact.sha256.slice(0, 8)}`,
        variantId: options.variantId,
        framework: options.framework,
        packageVersion: options.packageVersion,
        exampleId: options.exampleId,
        state: stateName,
        source: 'local-automatic',
        image: artifact,
        packageSha256: options.packageSha256,
        environmentKey,
      });
    }

    // 6. 严禁忽略页面运行错误：即使已有截图，发生 pageerror 也必须阻断退出
    if (pageErrors.length > 0) {
      throw new Error(`PAGE_ERROR: 页面在渲染或截图过程中发生错误: ${pageErrors.join('; ')}`);
    }

    await context.close();

    return {
      environment,
      environmentKey,
      screenshots,
      checks,
    };
  } finally {
    await browser.close();
  }
}
