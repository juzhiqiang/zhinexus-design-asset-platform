import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChartEvent } from '../../packages/charts-core/src/index.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const LONG_TIMEOUT = 900_000;

type ConsumerTestHook = {
  pointClientPosition(seriesIndex: number, dataIndex: number): { x: number; y: number } | null;
  getClicks(): ChartEvent[];
};

declare global {
  interface Window {
    __CONSUMER_TEST__?: ConsumerTestHook;
  }
}

type Tarball = { file: string; sha256: string; bytes: number; version: string };
type Framework = 'vue' | 'react';

const packages = ['charts-core', 'charts-vue', 'charts-react'] as const;
const tarballs = new Map<string, Tarball>();
const consumers = new Map<Framework, string>();
const bundleBaseline: { framework: Framework; jsBytes: number; cssBytes: number }[] = [];
let workDir = '';

type RunResult = { status: number; stdout: string; stderr: string };

function run(command: string, args: string[], cwd: string, production = false): RunResult {
  const result = spawnSync(command, args, {
    cwd,
    shell: process.platform === 'win32',
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    // 构建/类型检查强制生产模式：避免调用方（测试进程 NODE_ENV=test）让 vite 产出开发态代码
    env: production ? { ...process.env, NODE_ENV: 'production' } : process.env,
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function runPnpm(args: string[], cwd: string): RunResult {
  const cli = process.env.npm_execpath;
  if (cli && cli.endsWith('.js')) {
    return run(process.execPath, [cli, ...args], cwd);
  }
  return run('pnpm', args, cwd);
}

function mustSucceed(result: RunResult, label: string): void {
  expect(result.status, `${label} 失败:\n${result.stdout}\n${result.stderr}`).toBe(0);
}

async function packageVersion(name: string): Promise<string> {
  const manifest = JSON.parse(
    await readFile(path.join(repoRoot, 'packages', name, 'package.json'), 'utf8'),
  ) as { version: string };
  return manifest.version;
}

function staticFileServer(root: string): Server {
  const mime: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  };
  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const target = path.join(root, relative);
    if (!target.startsWith(root) || !existsSync(target)) {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    response.setHeader('content-type', mime[path.extname(target)] ?? 'application/octet-stream');
    response.end(readFileSync(target));
  });
}

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 't03-packed-consumer-'));
  const freezeDir = path.join(workDir, 'freeze');
  await mkdir(freezeDir, { recursive: true });

  // 构建 → 冻结：与发布链路同一口径，消费者只接受 dist 产物
  mustSucceed(
    runPnpm(
      ['--filter', '@company/charts-core', '--filter', '@company/charts-vue', '--filter', '@company/charts-react', 'run', 'build'],
      repoRoot,
    ),
    '构建三个组件包',
  );
  for (const name of packages) {
    const version = await packageVersion(name);
    const file = path.join(freezeDir, `company-${name}-${version}.tgz`);
    mustSucceed(runPnpm(['pack', '--pack-destination', freezeDir], path.join(repoRoot, 'packages', name)), `pnpm pack ${name}`);
    expect(existsSync(file), `${name} tarball 应存在于冻结目录`).toBe(true);
    const bytes = await readFile(file);
    tarballs.set(name, {
      file,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      version,
    });
  }

  for (const framework of ['vue', 'react'] as const) {
    const dir = path.join(workDir, framework);
    await cp(path.join(repoRoot, 'tests/consumers', framework), dir, { recursive: true });
    const manifestPath = path.join(dir, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      dependencies: Record<string, string>;
      overrides: Record<string, string>;
    };
    const packageName = `@company/charts-${framework}`;
    const coreVersion = await packageVersion('charts-core');
    const frameworkVersion = await packageVersion(`charts-${framework}`);
    manifest.dependencies[packageName] = manifest.dependencies[packageName]!.replace(
      `../freeze/charts-${framework}.tgz`,
      `../freeze/company-charts-${framework}-${frameworkVersion}.tgz`,
    );
    manifest.overrides['@company/charts-core'] = manifest.overrides['@company/charts-core']!.replace(
      '../freeze/charts-core.tgz',
      `../freeze/company-charts-core-${coreVersion}.tgz`,
    );
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    mustSucceed(run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], dir), `${framework} 消费者 npm install`);
    consumers.set(framework, dir);
  }
}, LONG_TIMEOUT);

afterAll(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true });
  }
}, LONG_TIMEOUT);

describe('冻结产物', () => {
  it('tarball 只包含 dist，workspace 协议已转为精确版本', async () => {
    for (const name of packages) {
      const tarball = tarballs.get(name)!;
      const listing = execFileSync('tar', ['tzf', tarball.file], { encoding: 'utf8' });
      expect(listing, name).toContain('package/dist/index.js');
      expect(listing, name).not.toContain('package/src/');
      const packed = JSON.parse(
        execFileSync('tar', ['xzf', tarball.file, '-O', 'package/package.json'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }),
      ) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
      expect(JSON.stringify(packed), name).not.toContain('workspace:');
      for (const [dep, version] of Object.entries(packed.dependencies ?? {})) {
        if (dep.startsWith('@company/')) {
          expect(version, `${name} → ${dep}`).toMatch(/^\d+\.\d+\.\d+$/);
        }
      }
      if (name === 'charts-vue') {
        expect(packed.peerDependencies?.vue).toBe('3.5.45');
      }
      if (name === 'charts-react') {
        expect(packed.peerDependencies?.react).toBe('19.3.1');
        expect(packed.peerDependencies?.['react-dom']).toBe('19.3.1');
      }
      if (name === 'charts-core') {
        expect(packed.peerDependencies?.echarts).toBe('6.1.0');
      }
    }
  });

  it('每个 tarball 都有稳定摘要记录', () => {
    for (const [name, tarball] of tarballs) {
      expect(tarball.sha256, name).toMatch(/^[0-9a-f]{64}$/);
      expect(tarball.bytes, name).toBeGreaterThan(1024);
    }
  });
});

describe('工作区外消费者安装', () => {
  it('解析到临时消费者自身，而不是工作区源码', async () => {
    for (const [framework, dir] of consumers) {
      const packageName = `@company/charts-${framework}`;
      const resolved = await realpath(path.join(dir, 'node_modules', packageName));
      expect(resolved.startsWith(await realpath(dir)), `${framework} 应解析到消费者自身 node_modules`).toBe(true);
      expect(resolved.startsWith(repoRoot), `${framework} 不得解析到工作区源码`).toBe(false);
      expect(existsSync(path.join(resolved, 'dist/index.js')), framework).toBe(true);
    }
  });

  it('冻结包内的正式依赖声明没有被 overrides 重写，候选 core 被解析', async () => {
    for (const framework of ['vue', 'react'] as const) {
      const dir = consumers.get(framework)!;
      const installed = JSON.parse(
        await readFile(path.join(dir, 'node_modules', `@company/charts-${framework}`, 'package.json'), 'utf8'),
      ) as { version: string; dependencies: Record<string, string> };
      expect(installed.version).toBe(await packageVersion(`charts-${framework}`));
      expect(installed.dependencies['@company/charts-core']).toMatch(/^\d+\.\d+\.\d+$/);
      const core = JSON.parse(
        await readFile(path.join(dir, 'node_modules', '@company/charts-core', 'package.json'), 'utf8'),
      ) as { version: string };
      expect(core.version).toBe(await packageVersion('charts-core'));
      for (const entry of [
        'dist/line.js',
        'dist/style.css',
        'dist/index.js',
        'dist/pie.js',
        'dist/scatter.js',
        'dist/trend-card.js',
        'dist/ranking.js',
        'dist/proportion.js',
      ]) {
        expect(existsSync(path.join(dir, 'node_modules', `@company/charts-${framework}`, entry)), `${framework} ${entry}`).toBe(true);
      }
    }
  });

  it('Node 环境导入安装的 ESM 不访问 DOM 且导出完整', async () => {
    for (const framework of ['vue', 'react'] as const) {
      const dir = consumers.get(framework)!;
      const probe = path.join(dir, 'node-import-probe.mjs');
      await writeFile(
        probe,
        [
          `import { existsSync } from 'node:fs';`,
          `import path from 'node:path';`,
          `import { fileURLToPath } from 'node:url';`,
          `const root = await import('@company/charts-${framework}');`,
          `const line = await import('@company/charts-${framework}/line');`,
          `const bar = await import('@company/charts-${framework}/bar');`,
          `const pie = await import('@company/charts-${framework}/pie');`,
          `const scatter = await import('@company/charts-${framework}/scatter');`,
          `const trendCard = await import('@company/charts-${framework}/trend-card');`,
          `const ranking = await import('@company/charts-${framework}/ranking');`,
          `const proportion = await import('@company/charts-${framework}/proportion');`,
          `const entryUrl = new URL(import.meta.resolve('@company/charts-${framework}'));`,
          `const entryDir = path.dirname(fileURLToPath(entryUrl));`,
          `if (!existsSync(path.join(entryDir, 'style.css'))) throw new Error('missing dist/style.css');`,
          `const component = root.LineChart ?? line.LineChart;`,
          `if (typeof component !== 'object' && typeof component !== 'function') throw new Error('missing LineChart export');`,
          `if (typeof root.useChart !== 'function') throw new Error('missing useChart export');`,
          `if (typeof line.LineChart === 'undefined') throw new Error('missing ./line entry');`,
          `if (typeof bar.BarChart === 'undefined') throw new Error('missing ./bar entry');`,
          `if (typeof bar.useChart !== 'function') throw new Error('missing useChart export from ./bar');`,
          `if (typeof pie.PieChart === 'undefined') throw new Error('missing ./pie entry');`,
          `if (typeof pie.useChart !== 'function') throw new Error('missing useChart export from ./pie');`,
          `if (typeof scatter.ScatterChart === 'undefined') throw new Error('missing ./scatter entry');`,
          `if (typeof scatter.useChart !== 'function') throw new Error('missing useChart export from ./scatter');`,
          `if (typeof trendCard.TrendCard === 'undefined') throw new Error('missing ./trend-card entry');`,
          `if (typeof trendCard.useChart !== 'function') throw new Error('missing useChart export from ./trend-card');`,
          `if (typeof ranking.Ranking === 'undefined') throw new Error('missing ./ranking entry');`,
          `if (typeof ranking.useChart !== 'function') throw new Error('missing useChart export from ./ranking');`,
          `if (typeof proportion.Proportion === 'undefined') throw new Error('missing ./proportion entry');`,
          `if (typeof proportion.useChart !== 'function') throw new Error('missing useChart export from ./proportion');`,
          `console.log(JSON.stringify({ windowDefined: typeof window !== 'undefined', documentDefined: typeof document !== 'undefined' }));`,
        ].join('\n'),
      );
      const result = run(process.execPath, [probe], dir);
      expect(result.status, `${framework} Node 导入失败:\n${result.stderr}`).toBe(0);
      const payload = JSON.parse(result.stdout.trim().split('\n').pop()!) as {
        windowDefined: boolean;
        documentDefined: boolean;
      };
      expect(payload.windowDefined, framework).toBe(false);
      expect(payload.documentDefined, framework).toBe(false);
      await rm(probe, { force: true });
    }
  });
});

describe('消费者类型检查', () => {
  it('模板工程类型检查通过', () => {
    for (const framework of ['vue', 'react'] as const) {
      const result = run('npm', ['run', 'typecheck'], consumers.get(framework)!, true);
      expect(result.status, `${framework} 类型检查失败:\n${result.stdout}\n${result.stderr}`).toBe(0);
    }
  }, LONG_TIMEOUT);

  it('缺导出与源码 alias 必须失败', async () => {
    for (const framework of ['vue', 'react'] as const) {
      const consumerDir = consumers.get(framework)!;
      const negativeDir = path.join(consumerDir, 'negative');
      await mkdir(negativeDir, { recursive: true });
      await writeFile(
        path.join(negativeDir, 'missing-export.ts'),
        `import { NotARealChart } from '@company/charts-${framework}';\nvoid NotARealChart;\n`,
      );
      await writeFile(
        path.join(negativeDir, 'source-alias.ts'),
        `import { buildLineOption } from '@company/charts-core/src/index.js';\nvoid buildLineOption;\n`,
      );
      await writeFile(
        path.join(negativeDir, 'tsconfig.json'),
        JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              module: 'ESNext',
              moduleResolution: 'Bundler',
              strict: true,
              noEmit: true,
              skipLibCheck: true,
              types: [],
            },
            include: ['*.ts'],
          },
          null,
          2,
        ),
      );
      const tscEntry = path.join(consumerDir, 'node_modules', 'typescript', 'bin', 'tsc');
      const result = run(process.execPath, [tscEntry, '-p', 'tsconfig.json'], negativeDir);
      expect(result.status, `${framework} 负例应当失败:\n${result.stdout}`).not.toBe(0);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(output, framework).toMatch(/NotARealChart|charts-core\/src/);
    }
  }, LONG_TIMEOUT);
});

describe('消费者构建与真实渲染', () => {
  it('构建通过，line/bar/pie/scatter/trend-card/ranking/proportion 产物不含其他图表模块与跨包源码路径', async () => {
    for (const framework of ['vue', 'react'] as const) {
      const dir = consumers.get(framework)!;
      const result = run('npm', ['run', 'build'], dir, true);
      expect(result.status, `${framework} 构建失败:\n${result.stdout}\n${result.stderr}`).toBe(0);
      const distDir = path.join(dir, 'dist');
      // 多页入口：折线 / 柱状 / 饼图 / 散点 / 趋势卡片 / 排行榜 / 占比 七个页面都必须构建成功（各子路径可解析）
      for (const entry of [
        'index.html',
        'bar.html',
        'pie.html',
        'scatter.html',
        'trend-card.html',
        'ranking.html',
        'proportion.html',
      ]) {
        expect(existsSync(path.join(distDir, entry)), `${framework} ${entry}`).toBe(true);
      }
      const assetsDir = path.join(distDir, 'assets');
      const assets = await readdir(assetsDir);
      const jsNames = assets.filter((asset) => asset.endsWith('.js'));
      expect(jsNames.length, `${framework} 应有 JS 产物`).toBeGreaterThan(0);
      const cssName = assets.find((asset) => asset.endsWith('.css'));
      let bundle = '';
      let jsBytes = 0;
      for (const name of jsNames) {
        const content = await readFile(path.join(assetsDir, name));
        bundle += content.toString('utf8');
        jsBytes += Buffer.byteLength(content);
      }
      expect(bundle, `${framework} 不得包含工作区源码路径`).not.toContain('packages/charts-core/src');
      expect(bundle, `${framework} 不得包含工作区源码路径`).not.toContain(`packages/charts-${framework}/src`);
      // 未按需注册的图表类型不得进入产物
      for (const marker of ['FunnelView', 'GaugeView', 'MapView', 'EffectScatter', 'BoxplotView', 'SankeyView']) {
        expect(bundle, `${framework} 出现未注册图表 ${marker}`).not.toContain(marker);
      }
      const cssBytes = cssName ? (await readFile(path.join(assetsDir, cssName))).length : 0;
      bundleBaseline.push({ framework, jsBytes, cssBytes });
      // 体积护栏为初始校准值（实测见 docs/verification/t03-adapters.md 与 test-results 基线），
      // 用于捕获意外全量引入 ECharts 或其他图表模块的回归，不作为发布指标
      expect(jsBytes, `${framework} 产物体积超出基线`).toBeLessThan(1024 * 1024);
    }
    // 打包体积基线落盘（gitignored），供验证记录引用
    await mkdir(path.join(repoRoot, 'test-results'), { recursive: true });
    await writeFile(
      path.join(repoRoot, 'test-results', 't03-bundle-baseline.json'),
      `${JSON.stringify({ generatedAt: new Date().toISOString(), tarballs: Object.fromEntries(tarballs), bundleBaseline }, null, 2)}\n`,
    );
  }, LONG_TIMEOUT);

  it('构建产物在真实浏览器中渲染，点击载荷与共享语义一致', async () => {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch();
    try {
      for (const framework of ['vue', 'react'] as const) {
        const dir = consumers.get(framework)!;
        const server = staticFileServer(path.join(dir, 'dist'));
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = (server.address() as AddressInfo).port;
        const page = await browser.newPage();
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        try {
          const entries = [
            // 折线图点击数据点符号本身；柱状图需落在柱体内部（顶边向下偏移）；
            // 饼图 / 环形图取扇形几何中心，落在扇形内部；
            // 散点图按 [x, y] 数值对换算符号中心，无需偏移；
            // 趋势卡片 sparkline 为类目轴折线系列，按类目取 x，无需偏移；
            // 排行榜与占比是横向条形（x 数值轴 / y 类目轴），落在条形末端后需向左偏移进入条体
            { path: 'index.html', host: '.charts-line', offsetY: 0, offsetX: 0 },
            { path: 'bar.html', host: '.charts-bar', offsetY: 8, offsetX: 0 },
            { path: 'pie.html', host: '.charts-pie', offsetY: 0, offsetX: 0 },
            { path: 'scatter.html', host: '.charts-scatter', offsetY: 0, offsetX: 0 },
            { path: 'trend-card.html', host: '.charts-trend-card', offsetY: 0, offsetX: 0 },
            { path: 'ranking.html', host: '.charts-ranking', offsetY: 0, offsetX: -8 },
            { path: 'proportion.html', host: '.charts-proportion', offsetY: 0, offsetX: -8 },
          ];
          for (const entry of entries) {
            await page.goto(`http://127.0.0.1:${port}/${entry.path}`);
            await page.waitForFunction(
              (host) => document.querySelector(`${host} canvas`) !== null,
              entry.host,
            );
            const position = await page.evaluate(() =>
              window.__CONSUMER_TEST__!.pointClientPosition(0, 0),
            );
            expect(position, `${framework} ${entry.path} 数据点坐标`).not.toBeNull();
            await page.mouse.click(position!.x + entry.offsetX, position!.y + entry.offsetY);
            const clicks = await page.evaluate(() => window.__CONSUMER_TEST__!.getClicks());
            // 折线与柱状共用「收入 / 周一 / 120」，饼图为「占比 / 搜索 / 120」，
            // 散点图为「收入 / (1, 120)」，趋势卡片为「活跃用户 / 周一 / 120」，
            // 排行榜与占比为「热度 / 柱状图 / 180」「来源 / 搜索 / 120」：
            // 七个入口的点击载荷都必须与 core 的共享语义一致
            const expected =
              entry.path === 'pie.html'
                ? [{ seriesId: 'share', dataIndex: 0, value: ['搜索', 120], nativeType: 'click' }]
                : entry.path === 'scatter.html'
                  ? [{ seriesId: 'revenue', dataIndex: 0, value: [1, 120], nativeType: 'click' }]
                  : entry.path === 'trend-card.html'
                    ? [{ seriesId: 'active', dataIndex: 0, value: ['周一', 120], nativeType: 'click' }]
                    : entry.path === 'ranking.html'
                      ? [{ seriesId: 'hot', dataIndex: 0, value: ['柱状图', 180], nativeType: 'click' }]
                      : entry.path === 'proportion.html'
                        ? [{ seriesId: 'source', dataIndex: 0, value: ['搜索', 120], nativeType: 'click' }]
                        : [{ seriesId: 'revenue', dataIndex: 0, value: ['周一', 120], nativeType: 'click' }];
            expect(clicks, `${framework} ${entry.path}`).toEqual(expected);
            expect(await page.locator(`${entry.host} canvas`).count(), framework).toBe(1);
          }
          expect(pageErrors, framework).toEqual([]);
        } finally {
          await page.close();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      }
    } finally {
      await browser.close();
    }
  }, LONG_TIMEOUT);
});
