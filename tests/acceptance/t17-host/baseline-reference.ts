/**
 * T17 owned-host 独立参考视觉基线生成器。
 *
 * 边界：
 * - 使用独立手写的直接 SDK 宿主（直接 import `@company/charts-vue/line` / `@company/charts-react/line`
 *   及对应 `style.css`），绝不读取被测生成模块，也不从被测报告推导预期；
 * - 使用可注入的 `EnvironmentMeasurer` 采集真实 `EnvironmentV1`，不硬编码假 `fontDigest`/`browserRevision`；
 * - 临时参考工程创建在仓外 `OwnedRun` 根下，生成并封存参考 PNG 与 `EnvironmentV1` 后在 `finally` 中彻底清理，
 *   保留外部可核验 `run-seal.json` 证据。
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { canonicalJson, type EnvironmentV1 } from '@company/contracts';
import { createOwnedRun, startBuiltHost, type BuiltHost, type Framework, type OwnedRun } from './host.js';
import { assertLifecycleHooksSuppressed, runNativeScript, type FixedToolchain } from './runtime.js';
import { preserveFailedInspectEvidence } from './runner.js';
import type { ApprovedVisualBaseline } from './host-browser.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const FIXED_REFERENCE_DATA = {
  series: [
    {
      id: 'revenue',
      name: 'Revenue',
      points: [
        { x: 'Monday', y: 42 },
        { x: 'Tuesday', y: 75 },
        { x: 'Wednesday', y: 56 },
      ],
    },
  ],
};

export type EnvironmentMeasurerContext = {
  page: Page;
  browser: Browser;
  framework: Framework;
  frameworkVersion: string;
  echartsVersion: string;
  viewport: { width: number; height: number };
  renderer: 'canvas' | 'svg';
  theme: string;
  locale: string;
  timezone: string;
  deviceScaleFactor: number;
};

export type EnvironmentMeasurer = (ctx: EnvironmentMeasurerContext) => Promise<EnvironmentV1>;

export type IndependentReferenceBaselineResult = {
  runId: string;
  evidenceRoot: string;
  sealPath: string;
  sealSha256: string;
  baselines: Record<Framework, ApprovedVisualBaseline>;
};

const REF_FONT_PROBE_STRINGS = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  '中文图表标签折线柱状饼图散点排行榜占比趋势卡片暂无数据',
  'iIlL1.,;:!|',
] as const;
const REF_FONT_REFERENCE_FAMILIES = ['sans-serif', 'serif', 'monospace'] as const;

type RefFontMeasurements = {
  stack: string;
  families: { family: string; available: boolean; advances: number[] }[];
  loadedFonts: string[];
};

function normalizeFontFingerprintV1(input: RefFontMeasurements): string {
  const families = input.families.map(family => ({
    family: family.family,
    available: family.available,
    advances: family.advances.map(advance => Math.round(advance * 1000) / 1000),
  }));
  return canonicalJson({
    kind: 'font-fingerprint-v1',
    stack: input.stack.trim().normalize('NFC'),
    families,
    loadedFonts: [...input.loadedFonts].sort(),
  });
}

async function launchReferenceChromium(): Promise<{ browser: Browser; executablePath?: string }> {
  try {
    return { browser: await chromium.launch({ headless: true }) };
  } catch (err) {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const msPlaywright = join(localAppData, 'ms-playwright');
      if (fs.existsSync(msPlaywright)) {
        const dirs = fs
          .readdirSync(msPlaywright, { withFileTypes: true })
          .filter(d => d.isDirectory() && d.name.startsWith('chromium_headless_shell-'))
          .map(d => d.name)
          .sort()
          .reverse();
        for (const dir of dirs) {
          const exe = join(msPlaywright, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
          if (fs.existsSync(exe)) {
            return { browser: await chromium.launch({ headless: true, executablePath: exe }), executablePath: exe };
          }
        }
      }
    }
    throw err;
  }
}

/**
 * 独立真实浏览器环境测量器（依据 font-fingerprint-v1 与 CDP Browser.getVersion 独立测量，绝不读取候选报告）。
 */
export async function measureRealBrowserEnvironment(
  ctx: EnvironmentMeasurerContext & { executablePath?: string },
): Promise<EnvironmentV1> {
  const cdp = await ctx.browser.newBrowserCDPSession();
  let browserRevision: string;
  try {
    const identity = await cdp.send('Browser.getVersion');
    if (
      typeof identity.revision !== 'string' ||
      !/^@[0-9a-f]{7,64}$/i.test(identity.revision) ||
      typeof identity.product !== 'string' ||
      !identity.product.endsWith('/' + ctx.browser.version())
    ) {
      throw new Error('Independent reference host could not read Chromium CDP Browser.getVersion revision.');
    }
    browserRevision = identity.revision;
  } finally {
    await cdp.detach();
  }

  const measured = await ctx.page.locator('[data-testid="ready"]').first().evaluate(
    async (host, { probes, references }) => {
      if (!document.fonts || !document.fonts.ready) {
        throw new Error('Font readiness is unavailable');
      }
      await document.fonts.ready;
      if (document.fonts.status !== 'loaded') {
        throw new Error('Fonts are not ready');
      }
      const stack = getComputedStyle(host).fontFamily;
      const families: { family: string; available: boolean; advances: number[] }[] = [];
      const seen = new Set<string>();
      for (const raw of [...stack.split(','), ...references]) {
        const family = raw.trim().replace(/^["']|["']$/g, '');
        if (!family || seen.has(family)) continue;
        seen.add(family);
        const context = document.createElement('canvas').getContext('2d');
        if (!context) throw new Error('Font measurement context is unavailable');
        context.font = `16px ${JSON.stringify(family)}`;
        families.push({
          family,
          available: document.fonts.check(`16px ${JSON.stringify(family)}`),
          advances: probes.map(text => context.measureText(text).width),
        });
      }
      const loadedFonts: string[] = [];
      document.fonts.forEach(face => {
        loadedFonts.push(`${face.family} ${face.style} ${face.weight} ${face.status}`);
      });
      return {
        fonts: { stack, families, loadedFonts },
        locale: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        deviceScaleFactor: window.devicePixelRatio,
        width: window.innerWidth,
        height: window.innerHeight,
        dark: matchMedia('(prefers-color-scheme: dark)').matches,
      };
    },
    { probes: [...REF_FONT_PROBE_STRINGS], references: [...REF_FONT_REFERENCE_FAMILIES] },
  );

  if (
    measured.locale !== ctx.locale ||
    measured.timezone !== ctx.timezone ||
    measured.deviceScaleFactor !== ctx.deviceScaleFactor ||
    measured.width !== ctx.viewport.width ||
    measured.height !== ctx.viewport.height ||
    measured.dark !== (ctx.theme === 'dark')
  ) {
    throw new Error('Independent reference host page context does not match declared capture environment.');
  }

  const canonical = normalizeFontFingerprintV1(measured.fonts);
  return {
    os: process.platform === 'win32' ? 'windows' : process.platform,
    arch: os.arch(),
    browserVersion: ctx.browser.version(),
    browserRevision,
    fontDigest: sha(canonical),
    locale: measured.locale,
    timezone: measured.timezone,
    deviceScaleFactor: measured.deviceScaleFactor,
    renderer: ctx.renderer,
    width: measured.width,
    height: measured.height,
    theme: ctx.theme,
    frameworkVersion: ctx.frameworkVersion,
    echartsVersion: ctx.echartsVersion,
  };
}

/**
 * 手写直接 SDK 参考宿主：直接导入 `@company/charts-{vue,react}/line` 与 `style.css`，
 * 不依赖也不读取任何被测生成模块。
 */
export async function scaffoldReferenceSdkProject(
  run: OwnedRun,
  framework: Framework,
  sdkVersion: string,
): Promise<{ root: string; framework: Framework }> {
  const root = run.projectRoots[framework];
  await mkdir(join(root, 'src'), { recursive: true });

  const pkgName = `@company/charts-${framework}`;
  const deps =
    framework === 'vue'
      ? { [pkgName]: sdkVersion, vue: '3.5.45', echarts: '6.1.0' }
      : { [pkgName]: sdkVersion, react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' };
  const devDeps =
    framework === 'vue'
      ? { vite: '8.3.8', typescript: '6.0.3', 'vue-tsc': '3.3.14', '@vitejs/plugin-vue': '6.0.10' }
      : { vite: '8.3.8', typescript: '6.0.3', '@types/react': '19.3.0', '@types/react-dom': '19.3.0', '@vitejs/plugin-react': '6.3.0' };

  const scripts = {
    typecheck: framework === 'vue' ? 'vue-tsc --noEmit -p tsconfig.json' : 'tsc --noEmit -p tsconfig.json',
    build: 'vite build',
    preinstall: 'node .t17-hook.cjs preinstall',
    postinstall: 'node .t17-hook.cjs postinstall',
    prebuild: 'node .t17-hook.cjs prebuild',
    postbuild: 'node .t17-hook.cjs postbuild',
  };

  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: `t17-reference-${framework}-host`,
      version: '1.0.0',
      private: true,
      type: 'module',
      packageManager: 'npm@11.20.0',
      scripts,
      dependencies: deps,
      devDependencies: devDeps,
    }, null, 2) + '\n',
    { flag: 'wx' },
  );
  await writeFile(
    join(root, '.t17-hook.cjs'),
    "require('node:fs').mkdirSync('.t17-hooks',{recursive:true});require('node:fs').writeFileSync('.t17-hooks/'+process.argv[2],'executed');\n",
    { flag: 'wx' },
  );
  await writeFile(
    join(root, 'index.html'),
    `<div id="app"></div><script type="module" src="/src/main.${framework === 'vue' ? 'ts' : 'tsx'}"></script>\n`,
    { flag: 'wx' },
  );
  await writeFile(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        noUncheckedIndexedAccess: true,
        skipLibCheck: true,
        jsx: 'react-jsx',
        lib: ['ES2022', 'DOM'],
        noEmit: true,
      },
      include: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.vue'],
    }, null, 2) + '\n',
    { flag: 'wx' },
  );
  await writeFile(
    join(root, 'src/vite-env.d.ts'),
    '/// <reference types="vite/client" />\ndeclare module "*.vue" { import type { DefineComponent } from "vue"; const component: DefineComponent<Record<string, unknown>, {}, unknown>; export default component; }\n',
    { flag: 'wx' },
  );

  const dataLiteral = JSON.stringify(FIXED_REFERENCE_DATA);
  if (framework === 'vue') {
    const appVue = `<script setup lang="ts">
import { ref } from 'vue';
import type { ChartEvent } from '@company/charts-core';
import { LineChart } from '@company/charts-vue/line';
import '@company/charts-vue/style.css';
const n = ref(0);
const eventPayload = ref('none');
const data = ${dataLiteral};
const config = { width: 720, height: 360, animation: false };
const optionOverrides = { grid: { left: 40, right: 40, top: 40, bottom: 40, containLabel: false }, yAxis: { min: 0, max: 150 } };
const onPointClick = (event: ChartEvent) => { n.value += 1; eventPayload.value = JSON.stringify(event); };
</script>
<template>
  <main>
    <h1 data-testid="ready">T17 Vue host</h1>
    <div style="width:720px;height:360px">
      <div class="zhinexus-chart-host" data-layout="grid cell 1">
        <LineChart :data="data" :config="config" :option-overrides="optionOverrides" @point-click="onPointClick" />
      </div>
    </div>
    <output data-testid="event-count">{{ n }}</output>
    <output data-testid="event-payload">{{ eventPayload }}</output>
  </main>
</template>
`;
    await writeFile(join(root, 'src/App.vue'), appVue, { flag: 'wx' });
    await writeFile(
      join(root, 'src/main.ts'),
      'import { createApp } from "vue";\nimport App from "./App.vue";\ncreateApp(App).mount("#app");\n',
      { flag: 'wx' },
    );
    await writeFile(
      join(root, 'vite.config.mts'),
      "import { defineConfig } from 'vite';\nimport vue from '@vitejs/plugin-vue';\nexport default defineConfig({ plugins: [vue()] });\n",
      { flag: 'wx' },
    );
  } else {
    const mainTsx = `import React from 'react';
import { createRoot } from 'react-dom/client';
import type { ChartEvent } from '@company/charts-core';
import { LineChart } from '@company/charts-react/line';
import '@company/charts-react/style.css';
const root = document.getElementById('app');
if (!root) throw new Error('missing root');
const data = ${dataLiteral};
const config = { width: 720, height: 360, animation: false };
const optionOverrides = { grid: { left: 40, right: 40, top: 40, bottom: 40, containLabel: false }, yAxis: { min: 0, max: 150 } };
function App() {
  const [n, setN] = React.useState(0);
  const [eventPayload, setEventPayload] = React.useState('none');
  const onPointClick = (event: ChartEvent) => { setN(x => x + 1); setEventPayload(JSON.stringify(event)); };
  return (
    <main>
      <h1 data-testid="ready">T17 React host</h1>
      <div style={{ width: 720, height: 360 }}>
        <div className="zhinexus-chart-host" data-layout="grid cell 1">
          <LineChart data={data} config={config} optionOverrides={optionOverrides} onPointClick={onPointClick} />
        </div>
      </div>
      <output data-testid="event-count">{n}</output>
      <output data-testid="event-payload">{eventPayload}</output>
    </main>
  );
}
createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);
`;
    await writeFile(join(root, 'src/main.tsx'), mainTsx, { flag: 'wx' });
    await writeFile(
      join(root, 'vite.config.mts'),
      "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });\n",
      { flag: 'wx' },
    );
  }

  await registerReferencePaths(run, framework);
  return { root, framework };
}

/**
 * 通过真实无头 Chromium 访问独立参考宿主，采集参考 PNG、测量真实 EnvironmentV1 并验证点击交互。
 */
export async function captureReferenceBaselineFromHost(params: {
  host: BuiltHost;
  framework: Framework;
  frameworkVersion: string;
  echartsVersion: string;
  viewport?: { width: number; height: number };
  renderer?: 'canvas' | 'svg';
  theme?: string;
  locale?: string;
  timezone?: string;
  deviceScaleFactor?: number;
  timeoutMs?: number;
  measureEnvironment?: EnvironmentMeasurer;
}): Promise<{ pngBytes: Buffer; environment: EnvironmentV1; clickObserved: boolean }> {
  const viewport = params.viewport ?? { width: 800, height: 400 };
  const renderer = params.renderer ?? 'canvas';
  const theme = params.theme ?? 'light';
  const locale = params.locale ?? 'zh-CN';
  const timezone = params.timezone ?? 'Asia/Shanghai';
  const deviceScaleFactor = params.deviceScaleFactor ?? 1;
  const timeoutMs = params.timeoutMs ?? 30_000;
  const origin = new URL(params.host.url).origin;

  const { browser, executablePath } = await launchReferenceChromium();
  try {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor,
      locale,
      timezoneId: timezone,
      colorScheme: theme === 'dark' ? 'dark' : 'light',
      acceptDownloads: false,
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await context.route('**/*', async route => {
      try {
        if (new URL(route.request().url()).origin !== origin) {
          await route.abort();
          return;
        }
      } catch {
        await route.abort();
        return;
      }
      await route.continue();
    });

    await page.goto(params.host.url, { timeout: timeoutMs, waitUntil: 'networkidle' });
    await page.locator('[data-testid="ready"]').first().waitFor({ state: 'visible', timeout: timeoutMs });
    const canvas = page.locator('canvas').first();
    await canvas.waitFor({ state: 'visible', timeout: timeoutMs });
    const box = await canvas.boundingBox();
    if (!box || box.width <= 0 || box.height <= 0) {
      throw new Error(`Independent reference host (${params.framework}) rendered a zero-size canvas.`);
    }

    const beforeCount = Number((await page.locator('[data-testid="event-count"]').first().textContent())?.trim() ?? '0');
    if (beforeCount !== 0) throw new Error('Independent reference SDK click counter was not initially zero.');
    await canvas.click({ timeout: timeoutMs });
    const expectedPayload = '{"seriesId":"revenue","dataIndex":1,"value":["Tuesday",75],"nativeType":"click"}';
    try {
      await page.waitForFunction(expected =>
        document.querySelector('[data-testid="event-count"]')?.textContent?.trim() === '1' &&
        document.querySelector('[data-testid="event-payload"]')?.textContent?.trim() === expected,
      expectedPayload, { timeout: timeoutMs });
    } catch {
      throw new Error(`Independent reference host (${params.framework}) did not observe the expected real SDK point-click event and data payload.`);
    }
    const clickObserved = true;

    if (pageErrors.length > 0) {
      throw new Error(`Independent reference host (${params.framework}) threw pageerror: ${pageErrors.join('; ')}`);
    }

    const measurerCtx: EnvironmentMeasurerContext & { executablePath?: string } = {
      page,
      browser,
      framework: params.framework,
      frameworkVersion: params.frameworkVersion,
      echartsVersion: params.echartsVersion,
      viewport,
      renderer,
      theme,
      locale,
      timezone,
      deviceScaleFactor,
      executablePath,
    };
    const environment = params.measureEnvironment
      ? await params.measureEnvironment(measurerCtx)
      : await measureRealBrowserEnvironment(measurerCtx);

    const pngBytes = await page.screenshot({ fullPage: false });
    return { pngBytes, environment, clickObserved };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function installReferenceDependenciesWithToken(
  run: OwnedRun,
  framework: Framework,
  projectRoot: string,
  toolchain: FixedToolchain,
  registryUrl: string,
  registryToken: string,
): Promise<void> {
  const installDir = join(projectRoot, '.t17-install');
  await mkdir(installDir, { recursive: true });
  const cacheDir = join(installDir, 'cache');
  await mkdir(cacheDir, { recursive: true });
  const registryHostPath = registryUrl.replace(/^https?:/, '') + '/';
  const userconfig = join(installDir, 'userconfig');
  const globalconfig = join(installDir, 'globalconfig');
  await writeFile(userconfig, `registry=${registryUrl}/\n${registryHostPath}:_authToken=${registryToken}\n`, { flag: 'wx' });
  await writeFile(globalconfig, '', { flag: 'wx' });

  const env: NodeJS.ProcessEnv = {
    PATH: [dirname(resolve(toolchain.nodeExecutable)), process.env.SystemRoot ? join(process.env.SystemRoot, 'System32') : undefined].filter(Boolean).join(';'),
    TEMP: installDir,
    TMP: installDir,
    CI: 'true',
    NODE_DISABLE_COMPILE_CACHE: '1',
    npm_config_userconfig: userconfig,
    npm_config_globalconfig: globalconfig,
    npm_config_cache: cacheDir,
  };
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT']) {
    if (process.env[key]) env[key] = process.env[key];
  }

  let installLog = '';
  try {
    await new Promise<void>((ok, fail) => {
      const child = spawn(
        resolve(toolchain.nodeExecutable),
        [
          resolve(toolchain.npmCliPath),
          'install',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--maxsockets=2',
          '--fetch-retries=5',
          '--fetch-retry-mintimeout=2000',
          '--fetch-retry-maxtimeout=15000',
          '--registry',
          registryUrl,
        ],
        { cwd: projectRoot, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      child.stdout?.on('data', (chunk: Buffer) => { stdoutChunks.push(chunk); });
      child.stderr?.on('data', (chunk: Buffer) => { stderrChunks.push(chunk); });
      const closed = new Promise<void>(r => child.once('close', () => r()));
      const unregister = run.trackOwnedProcess(async () => {
        if (child.exitCode === null) child.kill();
        await closed;
      });
      child.once('error', err => { unregister(); fail(err); });
      child.once('close', code => {
        unregister();
        const outText = Buffer.concat(stdoutChunks).toString('utf8').replaceAll(registryToken, '[REDACTED]');
        const errText = Buffer.concat(stderrChunks).toString('utf8').replaceAll(registryToken, '[REDACTED]');
        installLog = `exitCode=${String(code)}\n--- stdout ---\n${outText}\n--- stderr ---\n${errText}\n`;
        if (code === 0) ok();
        else {
          fail(new Error(`Independent reference npm install exited with code ${String(code)}: ${errText.slice(-600)}`));
        }
      });
    });
  } finally {
    if (installLog) {
      await run.writeEvidence(`${framework}-reference-npm-install.log`, Buffer.from(installLog, 'utf8')).catch(() => undefined);
    }
    // 立刻清除含令牌的临时 userconfig 凭据
    await writeFile(userconfig, '').catch(() => undefined);
  }
  await assertLifecycleHooksSuppressed(projectRoot);
}

async function registerReferencePaths(run: OwnedRun, framework: Framework): Promise<void> {
  const root = run.projectRoots[framework];
  const candidates = [
    'package.json', '.t17-hook.cjs', 'index.html', 'tsconfig.json',
    'src/vite-env.d.ts', 'src/App.vue', 'src/main.ts', 'src/main.tsx',
    'vite.config.mts', '.t17-install', 'node_modules', 'package-lock.json', 'dist',
  ];
  const existing: string[] = [];
  for (const rel of candidates) {
    if (await lstat(resolve(root, rel)).then(() => true).catch(() => false)) {
      existing.push(rel);
    }
  }
  await run.registerOwnedPath(root, existing);
}

/**
 * 端到端生成并封存独立的 Vue + React 参考视觉基线（使用手写直接 SDK 宿主，清理临时工程并保留外部封存证据）。
 */
export async function generateIndependentReferenceBaselines(options: {
  sdkVersionByFramework: Record<Framework, string>;
  registryUrl: string;
  registryToken: string;
  toolchain: FixedToolchain;
  viewport?: { width: number; height: number };
  renderer?: 'canvas' | 'svg';
  theme?: string;
  measureEnvironment?: EnvironmentMeasurer;
  timeoutMs?: number;
}): Promise<IndependentReferenceBaselineResult> {
  const run = await createOwnedRun({ baseDirectory: os.tmpdir() });
  let sealed = false;
  try {
    const baselines = {} as Record<Framework, ApprovedVisualBaseline>;
    for (const framework of ['vue', 'react'] as const) {
      const proj = await scaffoldReferenceSdkProject(run, framework, options.sdkVersionByFramework[framework]);
      try {
        await installReferenceDependenciesWithToken(
          run,
          framework,
          proj.root,
          options.toolchain,
          options.registryUrl,
          options.registryToken,
        );
        const scriptTmp = join(proj.root, '.t17-install', 'tmp');
        await mkdir(scriptTmp, { recursive: true });
        const buildRes = await runNativeScript(run, {
          projectRoot: proj.root,
          manager: 'npm',
          script: 'build',
          toolchain: options.toolchain,
          extraEnv: { TEMP: scriptTmp, TMP: scriptTmp, NODE_DISABLE_COMPILE_CACHE: '1' },
          timeoutMs: options.timeoutMs,
        });
        if (buildRes.exitCode !== 0 || buildRes.timedOut) {
          throw new Error(`Independent reference ${framework} host build failed (exit=${String(buildRes.exitCode)}).`);
        }
        await assertLifecycleHooksSuppressed(proj.root);
      } finally {
        await registerReferencePaths(run, framework);
      }

      const host = await startBuiltHost({ projectRoot: proj.root, run });
      let captured: { pngBytes: Buffer; environment: EnvironmentV1; clickObserved: boolean };
      try {
        captured = await captureReferenceBaselineFromHost({
          host,
          framework,
          frameworkVersion: framework === 'vue' ? '3.5.45' : '19.3.1',
          echartsVersion: '6.1.0',
          viewport: options.viewport,
          renderer: options.renderer,
          theme: options.theme,
          timeoutMs: options.timeoutMs,
          measureEnvironment: options.measureEnvironment,
        });
      } finally {
        await host.close();
      }

      const pngRef = await run.writeEvidence(`${framework}-reference-baseline.png`, captured.pngBytes);
      await run.writeEvidence(
        `${framework}-reference-env.json`,
        Buffer.from(JSON.stringify(captured.environment, null, 2) + '\n'),
      );
      baselines[framework] = {
        imagePath: pngRef.path,
        sha256: pngRef.sha256,
        bytes: pngRef.bytes,
        environment: captured.environment,
      };
    }

    await run.stopOwnedProcesses();
    const sealPath = await run.sealEvidence({
      kind: 't17-independent-reference-baselines',
      productionAcceptance: false,
      baselines,
    });
    sealed = true;
    const sealSha256 = sha(await readFile(sealPath));
    await run.cleanup();

    const result: IndependentReferenceBaselineResult = {
      runId: run.runId,
      evidenceRoot: run.evidenceRoot,
      sealPath,
      sealSha256,
      baselines,
    };
    await verifyIndependentReferenceBaselineSeal(result);
    return result;
  } catch (error) {
    if (sealed) throw error;
    const retained = await preserveFailedInspectEvidence(run);
    const name = error instanceof Error ? error.name : 'Error';
    const rawMsg = error instanceof Error ? error.message : String(error);
    const safeMsg = rawMsg.replaceAll(options.registryToken, '[REDACTED]');
    throw new Error(`Independent reference baseline generation failed (${name}: ${safeMsg}). Evidence retained at ${retained.evidenceRoot}.`);
  }
}

export async function verifyIndependentReferenceBaselineSeal(
  result: IndependentReferenceBaselineResult,
): Promise<void> {
  const evidenceRoot = resolve(result.evidenceRoot);
  const rootStat = await lstat(evidenceRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (await realpath(evidenceRoot)) !== evidenceRoot) {
    throw new Error('Reference baseline evidence root is not a retained real directory.');
  }
  const sealPath = resolve(result.sealPath);
  if (!isAbsolute(sealPath) || relative(evidenceRoot, sealPath) !== 'run-seal.json') {
    throw new Error('Reference baseline seal escapes its retained evidence root.');
  }
  const sealBytes = await readFile(sealPath);
  if (sha(sealBytes) !== result.sealSha256) {
    throw new Error('Reference baseline seal SHA-256 mismatch.');
  }
  const seal = JSON.parse(sealBytes.toString('utf8')) as {
    schemaVersion?: unknown;
    runId?: unknown;
    evidenceRoot?: unknown;
    files?: unknown;
    payload?: unknown;
  };
  if (
    seal.schemaVersion !== 1 ||
    seal.runId !== result.runId ||
    seal.evidenceRoot !== evidenceRoot ||
    !Array.isArray(seal.files) ||
    !isRecord(seal.payload)
  ) {
    throw new Error('Reference baseline seal structure or identity is invalid.');
  }
  if (
    canonicalJson(seal.payload) !==
    canonicalJson({
      kind: 't17-independent-reference-baselines',
      productionAcceptance: false,
      baselines: result.baselines,
    })
  ) {
    throw new Error('Reference baseline payload differs from its retained seal.');
  }

  for (const framework of ['vue', 'react'] as const) {
    const baseline = result.baselines[framework];
    const abs = resolve(baseline.imagePath);
    const rel = relative(evidenceRoot, abs);
    if (!isAbsolute(abs) || !rel.startsWith('files' + sep) || rel.split(sep).length !== 2) {
      throw new Error(`Reference baseline image (${framework}) escapes retained files directory.`);
    }
    const stat = await lstat(abs);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) {
      throw new Error(`Reference baseline image (${framework}) is not an ordinary unlinked file.`);
    }
    const bytes = await readFile(abs);
    if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
      throw new Error(`Reference baseline image (${framework}) is not a valid PNG.`);
    }
    const actualSha = sha(bytes);
    const name = rel.slice(('files' + sep).length).replaceAll(sep, '/');
    const sealed = seal.files.find((entry: unknown) => isRecord(entry) && entry.name === name);
    if (
      bytes.length !== baseline.bytes ||
      actualSha !== baseline.sha256 ||
      !isRecord(sealed) ||
      sealed.bytes !== bytes.length ||
      sealed.sha256 !== actualSha
    ) {
      throw new Error(`Reference baseline image (${framework}) digest differs from its retained seal.`);
    }
  }
}
