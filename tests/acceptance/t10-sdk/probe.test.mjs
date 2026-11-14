/**
 * T10 探针纯逻辑回归（node:test）。
 *
 * 运行：`node --test tests/acceptance/t10-sdk/probe.test.mjs`
 * 或从本目录：`node --test probe.test.mjs`
 *
 * 为什么用 `node --test` 而不是 Vitest：本目录全部是 `.mjs`，仓库 Vitest 的
 * `include` 只收 `tests` 下的 `.test.ts`；探针又要能被 `node` 直接跑（B 侧调用入口
 * 不依赖构建）。纯逻辑部分因此用 Node 内置 runner，先 RED 后 GREEN。
 *
 * 涉及 npm 安装 / vite 构建 / Playwright 的部分不在这里单测——它们由
 * `probe.mjs` 的真实运行覆盖，见 `docs/verification/a-t10-probes-next-2026-11-13.md`。
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  DEFAULT_FONT_DIGEST,
  canonicalJson,
  computeEnvironmentKey,
  environmentProjection,
  formatPresentation,
  parsePresentation,
  platformName,
  validateEnvironment,
} from './environment.mjs';
import { dedupeSupported, peerEchartsBaseline, readFrozenBundle, supportedCombinations } from './bundle.mjs';
import { loadFrozenPolicy, resolveCandidateSafely } from './policy.mjs';
import { buildProbeTsconfig, classifyInstallFailure, rewriteConsumerManifest, sdkSurfaceProbeSource } from './consumer.mjs';
import { evidenceName, mergeBaselineEvidence, parseBaselineOption, runTeardown, sanitiseLabel, teardown } from './probe.mjs';
import { EXPECTED_FIRST_CLICK, baselineScreenshots, compareWithBaseline } from './browser.mjs';
import {
  collectUncovered,
  requiresVisualBaselineConfirmation,
  summariseDimensions,
  validateDimensions,
} from './evidence.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

/** C 在 Windows 上为 0.0.10 冻结 bundle 产出的真实 environmentKey（line-vue / light / canvas）。 */
const FROZEN_WINDOWS_ENVIRONMENT_KEY =
  '97c9cf055322458d64e4c37da6ff181be7d98514355ffbe09665340d03225c17';

/**
 * 按排行榜的公开语义从 fixture 推导「渲染后的首个数据点」。
 *
 * 规则全部来自 `examples/fixtures/ranking.json` 的 `description`（降序、并列保持输入顺序、
 * 缺失值不进入排行、`limit` 取前 N 名），不是探针自己发明的排序——否则就变成用 SDK 的
 * 规则考 SDK。推导结果与 `EXPECTED_FIRST_CLICK.ranking` 对齐，fixture 一改这里就红。
 */
function renderedRankingFirst(fixture) {
  const state = fixture.states.default;
  const points = state.data.series[0].points
    .filter((point) => point.y !== null && point.y !== undefined)
    // 稳定降序：等值时保持输入顺序（并列名次 1,2,2,4 的前提）
    .map((point, index) => ({ point, index }))
    .sort((left, right) => right.point.y - left.point.y || left.index - right.index)
    .map((entry) => entry.point)
    .slice(0, fixture.limit);
  return { seriesId: state.data.series[0].id, dataIndex: 0, value: [points[0].x, points[0].y], nativeType: 'click' };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** 用 `tar` 造一个最小合成 bundle：结构、命名与 `pnpm pack` / C 的冻结目录一致。 */
async function makeSyntheticBundle(root, { tamper = false, mixedPeer = false, workspaceResidue = false } = {}) {
  await mkdir(path.join(root, 'packages'), { recursive: true });
  const packages = [
    { name: '@company/charts-core', peer: { echarts: '6.1.0' }, deps: {} },
    { name: '@company/charts-vue', peer: { echarts: mixedPeer ? '6.0.0' : '6.1.0', vue: '3.5.45' }, deps: { '@company/charts-core': '0.0.10' } },
    { name: '@company/charts-react', peer: { echarts: '6.1.0', react: '19.3.1', 'react-dom': '19.3.1' }, deps: { '@company/charts-core': '0.0.10' } },
  ];
  const manifestPackages = [];
  for (const entry of packages) {
    const short = entry.name.split('/')[1];
    const stage = path.join(root, `.stage-${short}`);
    await mkdir(path.join(stage, 'package', 'dist', 'engine'), { recursive: true });
    if (short === 'charts-core') {
      await writeFile(
        path.join(stage, 'package', 'dist', 'engine', 'compatibility.js'),
        [
          `export function resolveCandidate(){ throw new Error('unused in unit test'); }`,
          `export function verifyCandidate(){ throw new Error('unused in unit test'); }`,
          `export function recommend(){ return 'hold'; }`,
          `export function hasDualFrameworkCoverage(){ return true; }`,
          ``,
        ].join('\n'),
      );
    }
    await writeFile(
      path.join(stage, 'package', 'package.json'),
      `${JSON.stringify({ name: entry.name, version: '0.0.10', dependencies: entry.deps, peerDependencies: entry.peer }, null, 2)}\n`,
    );
    const tarball = path.join(root, 'packages', `company-${short}-0.0.10.tgz`);
    execFileSync('tar', ['czf', tarball, '-C', stage, 'package']);
    const bytes = execFileSync('cat', [tarball]);
    const digest = tamper && short === 'charts-core' ? sha256(Buffer.from('tampered')) : sha256(bytes);
    manifestPackages.push({
      name: entry.name,
      version: '0.0.10',
      tarball: { path: `packages/company-${short}-0.0.10.tgz`, sha256: digest, bytes: bytes.length },
      sourceDigest: sha256(Buffer.from(short)),
      dependencies: workspaceResidue ? { '@company/charts-core': 'workspace:*' } : entry.deps,
      peerDependencies: entry.peer,
    });
    await rm(stage, { recursive: true, force: true });
  }
  const manifest = {
    schemaVersion: 1,
    channel: 'cli',
    packages: manifestPackages,
    variants: [
      {
        variantId: 'line-vue',
        framework: 'vue',
        packageName: '@company/charts-vue',
        packageVersion: '0.0.10',
        compatibility: [{ framework: 'vue', frameworkVersion: '3.5.45', echartsVersion: '6.1.0', status: 'passed', reportId: 'report-line-vue', verifiedAt: '2026-11-13T06:57:29.148Z' }],
      },
      {
        variantId: 'line-react',
        framework: 'react',
        packageName: '@company/charts-react',
        packageVersion: '0.0.10',
        compatibility: [
          { framework: 'react', frameworkVersion: '19.3.1', reactDomVersion: '19.3.1', echartsVersion: '6.1.0', status: 'passed', reportId: 'report-line-react', verifiedAt: '2026-11-13T06:57:38.089Z' },
          { framework: 'react', frameworkVersion: '19.3.1', reactDomVersion: '19.3.1', echartsVersion: '6.1.0', status: 'candidate', verifiedAt: '2026-11-13T06:57:38.089Z' },
        ],
      },
    ],
    files: [],
  };
  await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return root;
}

describe('环境签名', () => {
  it('canonicalJson 递归排序键、保持数组顺序、无空白', () => {
    assert.equal(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] }), '{"a":[{"c":2,"d":1}],"b":1}');
  });

  it('复现 C 在 Windows 冻结 bundle 上产出的真实 environmentKey', () => {
    // 这是同一口径实现跨代码路径的锁定：key 由 os/arch/browser/font/locale/... 决定，
    // 与跑在哪个操作系统上无关，因此 Linux 探针必须能算出 Windows 上那个值。
    const environment = {
      os: 'windows',
      arch: 'x64',
      browserVersion: '158.0.8127.18',
      browserRevision: '1000',
      fontDigest: DEFAULT_FONT_DIGEST,
      locale: 'zh-CN',
      timezone: 'Asia/Shanghai',
      deviceScaleFactor: 1,
      renderer: 'canvas',
      width: 800,
      height: 400,
      theme: 'light',
      frameworkVersion: '3.5.45',
      echartsVersion: '6.1.0',
    };
    assert.equal(computeEnvironmentKey(environment), FROZEN_WINDOWS_ENVIRONMENT_KEY);
  });

  it('被测框架版本与 ECharts 版本不计入 environmentKey', () => {
    const base = {
      os: 'linux', arch: 'x64', browserVersion: '158.0.8127.18', browserRevision: '1000',
      fontDigest: DEFAULT_FONT_DIGEST, locale: 'zh-CN', timezone: 'Asia/Shanghai',
      deviceScaleFactor: 1, renderer: 'canvas', width: 800, height: 400, theme: 'light',
      frameworkVersion: '3.5.45', echartsVersion: '6.1.0',
    };
    const changed = { ...base, frameworkVersion: '3.4.0', echartsVersion: '6.0.0' };
    assert.equal(computeEnvironmentKey(base), computeEnvironmentKey(changed));
  });

  it('os 与 arch 归一化为小写，其余字符串只做 trim + NFC', () => {
    const projection = environmentProjection({
      os: 'Windows', arch: 'X64', locale: ' zh-CN ', theme: 'light', frameworkVersion: '3.5.45', echartsVersion: '6.1.0',
    });
    assert.equal(projection.os, 'windows');
    assert.equal(projection.arch, 'x64');
    assert.equal(projection.locale, 'zh-CN');
    assert.equal('frameworkVersion' in projection, false);
    assert.equal('echartsVersion' in projection, false);
  });

  it('展示组合只认四组合之一', () => {
    assert.deepEqual(parsePresentation('dark-svg'), { theme: 'dark', renderer: 'svg' });
    assert.equal(formatPresentation({ theme: 'light', renderer: 'canvas' }), 'light-canvas');
    for (const bad of ['light', 'canvas', 'LIGHT-CANVAS', 'dark-webgl', '']) {
      assert.throws(() => parsePresentation(bad), /展示组合必须是/, `应当拒绝 ${bad}`);
    }
  });

  it('平台名把 win32 归一化为 windows', () => {
    assert.equal(platformName('win32'), 'windows');
    assert.equal(platformName('linux'), 'linux');
  });

  it('环境字段自检拦下非法值', () => {
    const base = {
      os: 'linux', arch: 'x64', browserVersion: '158.0.0.0', browserRevision: '1000',
      fontDigest: DEFAULT_FONT_DIGEST, locale: 'zh-CN', timezone: 'Asia/Shanghai',
      deviceScaleFactor: 1, renderer: 'canvas', width: 800, height: 400, theme: 'light',
      frameworkVersion: '3.5.45', echartsVersion: '6.1.0',
    };
    assert.deepEqual(validateEnvironment(base), []);
    assert.match(validateEnvironment({ ...base, fontDigest: 'nope' }).join(' '), /fontDigest/);
    assert.match(validateEnvironment({ ...base, theme: 'midnight' }).join(' '), /theme/);
    assert.match(validateEnvironment({ ...base, width: 0 }).join(' '), /width/);
    assert.match(validateEnvironment({ ...base, frameworkVersion: '^3.5.0' }).join(' '), /frameworkVersion/);
  });
});

describe('冻结 bundle 只读读取', () => {
  it('读取三个包并逐字节核对摘要', async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'a-t10-bundle-ok-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await makeSyntheticBundle(root);
    const bundle = await readFrozenBundle(root);
    assert.equal(bundle.version, '0.0.10');
    assert.deepEqual(bundle.packages.map((entry) => entry.name).sort(), [
      '@company/charts-core', '@company/charts-react', '@company/charts-vue',
    ]);
    for (const entry of bundle.packages) {
      assert.match(entry.sha256, /^[0-9a-f]{64}$/);
      assert.ok(entry.bytes > 0);
    }
    assert.equal(peerEchartsBaseline(bundle), '6.1.0');
    const supported = await supportedCombinations(bundle);
    assert.deepEqual(
      supported.map((row) => `${row.framework}@${row.frameworkVersion}@${row.echartsVersion}`).sort(),
      ['react@19.3.1@6.1.0', 'vue@3.5.45@6.1.0'],
    );
  });

  it('摘要被改写的 bundle 一律拒绝', async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'a-t10-bundle-tamper-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await makeSyntheticBundle(root, { tamper: true });
    await assert.rejects(() => readFrozenBundle(root), /冻结摘要不符/);
  });

  it('依赖里残留 workspace: 协议的 bundle 一律拒绝', async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'a-t10-bundle-ws-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await makeSyntheticBundle(root, { workspaceResidue: true });
    await assert.rejects(() => readFrozenBundle(root), /workspace:/);
  });

  it('三个包 echarts peer 混合时拒绝取首项', async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'a-t10-bundle-mixed-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await makeSyntheticBundle(root, { mixedPeer: true });
    const bundle = await readFrozenBundle(root);
    assert.throws(() => peerEchartsBaseline(bundle), /peer 不一致/);
  });

  it('精确组合去重：同一组合只保留一条', () => {
    const rows = [
      { framework: 'vue', frameworkVersion: '3.5.45', echartsVersion: '6.1.0', reportId: 'a', verifiedAt: 'x' },
      { framework: 'vue', frameworkVersion: '3.5.45', echartsVersion: '6.1.0', reportId: 'b', verifiedAt: 'y' },
      { framework: 'react', frameworkVersion: '19.3.1', echartsVersion: '6.1.0', reportId: 'c', verifiedAt: 'z' },
    ];
    assert.equal(dedupeSupported(rows).length, 2);
  });
});

describe('干净消费者清单改写', () => {
  const tarballs = {
    '@company/charts-core': '/freeze/company-charts-core-0.0.10.tgz',
    '@company/charts-vue': '/freeze/company-charts-vue-0.0.10.tgz',
    '@company/charts-react': '/freeze/company-charts-react-0.0.10.tgz',
  };

  it('workspace:* 换成 file: 冻结 tarball，echarts 换成候选版本，并写 overrides', () => {
    const manifest = {
      name: '@company/example-vue',
      dependencies: { vue: '3.5.45', '@company/charts-vue': 'workspace:*', echarts: '6.1.0' },
      devDependencies: { typescript: '6.0.3' },
    };
    const rewritten = rewriteConsumerManifest(manifest, { tarballs, echartsVersion: '6.0.0', framework: 'vue' });
    assert.equal(rewritten.dependencies['@company/charts-vue'], 'file:/freeze/company-charts-vue-0.0.10.tgz');
    assert.equal(rewritten.dependencies.echarts, '6.0.0');
    assert.equal(rewritten.dependencies.vue, '3.5.45');
    assert.equal(rewritten.overrides['@company/charts-core'], 'file:/freeze/company-charts-core-0.0.10.tgz');
    assert.equal(rewritten.devDependencies['vue-tsc'], '3.3.14');
    assert.equal(JSON.stringify(rewritten).includes('workspace:'), false);
  });

  it('框架特定的开发依赖按框架分派', () => {
    const vue = rewriteConsumerManifest({ dependencies: {} }, { tarballs, echartsVersion: '6.1.0', framework: 'vue' });
    const react = rewriteConsumerManifest({ dependencies: {} }, { tarballs, echartsVersion: '6.1.0', framework: 'react' });
    assert.equal(vue.devDependencies['@vitejs/plugin-vue'], '6.0.10');
    assert.equal(react.devDependencies['@vitejs/plugin-react'], '6.3.0');
    assert.equal(react.devDependencies['@types/react'], '19.3.0');
    assert.equal(vue.devDependencies['@vitejs/plugin-react'], undefined);
  });

  it('bundle 里没有对应 tarball 时直接抛错', () => {
    assert.throws(
      () => rewriteConsumerManifest({ dependencies: { '@company/charts-vue': 'workspace:*' } }, { tarballs: {}, echartsVersion: '6.1.0', framework: 'vue' }),
      /没有 @company\/charts-vue 的 tarball/,
    );
  });

  it('安装失败原因按 reason 分流，不解析整段日志', () => {
    assert.equal(classifyInstallFailure('npm error code ERESOLVE\npeer echarts@"6.1.0"').reason, 'peer-unresolved');
    assert.equal(classifyInstallFailure('npm error code ETARGET').reason, 'version-not-found');
    assert.equal(classifyInstallFailure('npm error code E404').reason, 'not-found');
    assert.equal(classifyInstallFailure('getaddrinfo ENOTFOUND registry.npmjs.org').reason, 'network');
    assert.equal(classifyInstallFailure('something else entirely').reason, 'install-failed');
  });

  // RED：探针的 tsconfig 曾经从零写，丢掉示例的 `jsx` / `resolveJsonModule`，
  // React 于是报一片 TS17004——那是探针配置缺陷，不是 SDK 缺陷。合并必须留住它们。
  it('探针 tsconfig 以示例配置为底，只覆盖解析模式与跳过库检查', () => {
    const example = {
      extends: '../../tsconfig.base.json',
      compilerOptions: {
        module: 'ESNext',
        moduleResolution: 'Bundler',
        jsx: 'react-jsx',
        resolveJsonModule: true,
        esModuleInterop: true,
        allowImportingTsExtensions: true,
        skipLibCheck: true,
        paths: { '@/*': ['src/*'] },
        outDir: 'dist',
      },
      include: ['src/**/*'],
    };
    const bundler = buildProbeTsconfig(example, 'Bundler');
    assert.equal(bundler.compilerOptions.jsx, 'react-jsx');
    assert.equal(bundler.compilerOptions.resolveJsonModule, true);
    assert.equal(bundler.compilerOptions.esModuleInterop, true);
    assert.equal(bundler.compilerOptions.allowImportingTsExtensions, true);
    assert.equal(bundler.compilerOptions.moduleResolution, 'Bundler');
    assert.equal(bundler.compilerOptions.skipLibCheck, false);
    assert.equal(bundler.compilerOptions.types.length, 2);
    // 探针配置自包含：不能再 extends 仓库根（工作区外已断链），也不能留输出路径
    assert.equal(bundler.extends, undefined);
    assert.equal(bundler.compilerOptions.paths, undefined);
    assert.equal(bundler.compilerOptions.outDir, undefined);
    assert.equal(bundler.compilerOptions.noEmit, true);

    const nodenext = buildProbeTsconfig(example, 'NodeNext');
    assert.equal(nodenext.compilerOptions.module, 'NodeNext');
    assert.equal(nodenext.compilerOptions.moduleResolution, 'NodeNext');
    assert.equal(nodenext.compilerOptions.jsx, 'react-jsx');
  });

  it('NodeNext 只测 SDK 公开入口，不把示例应用的风格问题算进 SDK 结论', () => {
    const source = sdkSurfaceProbeSource('@company/charts-react', ['', '/line', '/bar']);
    assert.match(source, /import type \* as surface0 from "@company\/charts-react";/);
    assert.match(source, /import type \* as surface1 from "@company\/charts-react\/line";/);
    assert.match(source, /import type \* as root from "@company\/charts-react";/);
    assert.equal(source.includes('require('), false);
  });
});

describe('期望点击载荷与真实 fixture 对齐', () => {
  const readFixture = (component) =>
    JSON.parse(readFileSync(path.join(REPO_ROOT, 'examples', 'fixtures', `${component}.json`), 'utf8'));

  it('排行榜：期望载荷按降序 + limit 推导，不是输入顺序的第一项', () => {
    const fixture = readFixture('ranking');
    // 输入第一项是「折线图 120」，但降序后渲染第一项是「柱状图 180」
    assert.equal(fixture.states.default.data.series[0].points[0].x, '折线图');
    assert.equal(fixture.limit, 5);
    assert.deepEqual(renderedRankingFirst(fixture), EXPECTED_FIRST_CLICK.ranking);
  });

  it('其余组件：期望载荷就是 default 状态的第一个数据点', () => {
    for (const component of ['line', 'bar', 'pie', 'scatter', 'trend-card', 'proportion']) {
      const fixture = readFixture(component);
      const first = fixture.states.default.data.series[0].points[0];
      const expected = EXPECTED_FIRST_CLICK[component];
      assert.equal(expected.seriesId, fixture.states.default.data.series[0].id, component);
      assert.equal(expected.dataIndex, 0, component);
      assert.equal(expected.nativeType, 'click', component);
      assert.equal(expected.value[0], first.x, component);
      assert.equal(expected.value[1], first.y, component);
    }
  });
});

describe('视觉基线比对', () => {
  const shot = (component, framework, presentation, sha256, environmentKey = 'key-1') => ({
    component,
    framework,
    presentation,
    sha256,
    environmentKey,
  });
  // 证据 JSON 里截图挂在 combinations[] 下，不在顶层
  const evidence = {
    combinations: [
      { framework: 'vue', screenshots: [shot('line', 'vue', 'light-canvas', 'aaa'), shot('bar', 'vue', 'light-canvas', 'bbb')] },
      { framework: 'react', screenshots: [shot('line', 'react', 'light-canvas', 'ccc')] },
    ],
  };

  // RED：baselineScreenshots 之前不存在，compareWithBaseline 只读顶层 screenshots，
  // 于是任何真实证据 JSON 传进去都判 NEW——「没基线」被误报成「有新差异」。
  it('从证据 JSON 里摊平 combinations[] 的截图', () => {
    assert.deepEqual(
      baselineScreenshots(evidence).map((entry) => `${entry.component}/${entry.framework}`),
      ['line/vue', 'bar/vue', 'line/react'],
    );
    assert.deepEqual(baselineScreenshots(null), []);
    assert.deepEqual(baselineScreenshots({}), []);
  });

  it('同 environmentKey 同字节判 PASS', () => {
    assert.equal(compareWithBaseline(shot('line', 'vue', 'light-canvas', 'aaa'), evidence).result, 'PASS');
  });

  it('同 environmentKey 不同字节判 DIFF', () => {
    const result = compareWithBaseline(shot('line', 'vue', 'light-canvas', 'zzz'), evidence);
    assert.equal(result.result, 'DIFF');
    assert.match(result.reason, /同环境下截图字节不同/);
  });

  it('environmentKey 不同判 INCOMPATIBLE，不自动判过', () => {
    const result = compareWithBaseline(shot('line', 'vue', 'light-canvas', 'aaa', 'key-2'), evidence);
    assert.equal(result.result, 'INCOMPATIBLE');
    assert.match(result.reason, /environmentKey 不一致/);
  });

  it('基线缺同一组合判 NEW，缺基线整体也判 NEW', () => {
    assert.equal(compareWithBaseline(shot('pie', 'vue', 'light-canvas', 'aaa'), evidence).result, 'NEW');
    assert.equal(compareWithBaseline(shot('line', 'vue', 'light-canvas', 'aaa'), null).result, 'NEW');
  });

  // RED：mergeBaselineEvidence 原先按框架去重，于是同一框架的其他展示基线被整份丢掉，
  // 只有第一份证据里的展示能比上，其余全判 NEW——「有基线」被误报成「没基线」。
  it('多份基线证据按截图组合合并，不按框架去重', () => {
    const merged = mergeBaselineEvidence([
      { combinations: [{ framework: 'vue', screenshots: [shot('line', 'vue', 'light-canvas', 'aaa')] }] },
      { combinations: [{ framework: 'vue', screenshots: [shot('line', 'vue', 'dark-canvas', 'bbb')] }] },
      { combinations: [{ framework: 'react', screenshots: [shot('line', 'react', 'light-canvas', 'ccc')] }] },
    ]);
    assert.equal(merged.conflicts.length, 0);
    assert.deepEqual(
      baselineScreenshots(merged).map((entry) => `${entry.framework}/${entry.component}/${entry.presentation}`),
      ['vue/line/light-canvas', 'vue/line/dark-canvas', 'react/line/light-canvas'],
    );
    // 三种展示都该比上，而不是只有第一份里的那一个
    assert.equal(compareWithBaseline(shot('line', 'vue', 'light-canvas', 'aaa'), merged).result, 'PASS');
    assert.equal(compareWithBaseline(shot('line', 'vue', 'dark-canvas', 'bbb'), merged).result, 'PASS');
    assert.equal(compareWithBaseline(shot('line', 'react', 'light-canvas', 'ccc'), merged).result, 'PASS');
  });

  it('同一组合在两份基线里不一致时记 conflict，不静默选一个', () => {
    const merged = mergeBaselineEvidence([
      { combinations: [{ framework: 'vue', screenshots: [shot('line', 'vue', 'light-canvas', 'aaa', 'key-1')] }] },
      { combinations: [{ framework: 'vue', screenshots: [shot('line', 'vue', 'light-canvas', 'zzz', 'key-2')] }] },
    ]);
    assert.equal(merged.conflicts.length, 1);
    assert.equal(merged.conflicts[0].combination, 'vue/line/light-canvas');
    assert.equal(merged.conflicts[0].kept.sha256, 'aaa');
    assert.equal(merged.conflicts[0].dropped.sha256, 'zzz');
    // 保留第一份
    assert.equal(baselineScreenshots(merged).length, 1);
    assert.equal(compareWithBaseline(shot('line', 'vue', 'light-canvas', 'aaa', 'key-1'), merged).result, 'PASS');
  });

  it('同一组合在两份基线里完全一致时不记 conflict', () => {
    const merged = mergeBaselineEvidence([
      { combinations: [{ framework: 'vue', screenshots: [shot('line', 'vue', 'light-canvas', 'aaa')] }] },
      { combinations: [{ framework: 'vue', screenshots: [shot('line', 'vue', 'light-canvas', 'aaa')] }] },
    ]);
    assert.deepEqual(merged.conflicts, []);
    assert.equal(baselineScreenshots(merged).length, 1);
  });
});

describe('四维结论映射', () => {
  const baseTypecheck = [{ resolution: 'Bundler', status: 0 }, { resolution: 'NodeNext', status: 0 }];
  const okRun = (component, presentation) => ({
    component,
    presentation,
    runtimeProblems: [],
    interactionProblems: [],
    clickError: null,
    screenshot: { sha256: 'a'.repeat(64) },
  });

  it('全通过时四维都是 passed', () => {
    const { dimensions, failures } = summariseDimensions({
      typecheckRuns: baseTypecheck,
      buildRun: { status: 0 },
      ssrRun: { status: 0, payload: { windowDefined: false, documentDefined: false } },
      browserRuns: [okRun('line', 'light-canvas')],
      lifecycle: { status: 'passed' },
      visualComparisons: [{ component: 'line', presentation: 'light-canvas', result: 'PASS' }],
    });
    assert.deepEqual(dimensions, { typecheck: 'passed', runtime: 'passed', interaction: 'passed', visual: 'passed' });
    assert.equal(failures.length, 0);
  });

  it('任一解析模式类型检查失败即 failed，并带退出码', () => {
    const { dimensions, failures } = summariseDimensions({
      typecheckRuns: [{ resolution: 'Bundler', status: 0 }, { resolution: 'NodeNext', status: 2 }],
      buildRun: { status: 0 },
      ssrRun: { status: 0, payload: { windowDefined: false, documentDefined: false } },
      browserRuns: [okRun('line', 'light-canvas')],
      lifecycle: { status: 'passed' },
      visualComparisons: [{ result: 'PASS' }],
    });
    assert.equal(dimensions.typecheck, 'failed');
    assert.match(failures.map((failure) => failure.reason).join(' '), /NodeNext 退出码 2/);
  });

  it('SSR 导入触碰浏览器全局对象时 runtime 失败', () => {
    const { dimensions } = summariseDimensions({
      typecheckRuns: baseTypecheck,
      buildRun: { status: 0 },
      ssrRun: { status: 0, payload: { windowDefined: true, documentDefined: false } },
      browserRuns: [okRun('line', 'light-canvas')],
      lifecycle: { status: 'passed' },
      visualComparisons: [{ result: 'PASS' }],
    });
    assert.equal(dimensions.runtime, 'failed');
  });

  it('生产构建失败即 runtime 失败', () => {
    const { dimensions } = summariseDimensions({
      typecheckRuns: baseTypecheck,
      buildRun: { status: 1, output: 'boom' },
      ssrRun: { status: 0, payload: { windowDefined: false, documentDefined: false } },
      browserRuns: [okRun('line', 'light-canvas')],
      lifecycle: { status: 'passed' },
      visualComparisons: [{ result: 'PASS' }],
    });
    assert.equal(dimensions.runtime, 'failed');
  });

  it('跳过浏览器时 runtime / interaction / visual 全部 not-run', () => {
    const { dimensions } = summariseDimensions({ typecheckRuns: baseTypecheck, browserSkipped: true });
    assert.equal(dimensions.runtime, 'not-run');
    assert.equal(dimensions.interaction, 'not-run');
    assert.equal(dimensions.visual, 'not-run');
  });

  it('没有视觉基线（NEW）与环境签名不同（INCOMPATIBLE）都记 not-run，不记 passed', () => {
    for (const result of ['NEW', 'INCOMPATIBLE']) {
      const { dimensions } = summariseDimensions({
        typecheckRuns: baseTypecheck,
        buildRun: { status: 0 },
        ssrRun: { status: 0, payload: { windowDefined: false, documentDefined: false } },
        browserRuns: [okRun('line', 'light-canvas')],
        lifecycle: { status: 'passed' },
        visualComparisons: [{ component: 'line', presentation: 'light-canvas', result, reason: 'because' }],
      });
      assert.equal(dimensions.visual, 'not-run', `${result} 不得记为 passed`);
    }
  });

  it('同环境基线下字节不同（DIFF）记 failed', () => {
    const { dimensions } = summariseDimensions({
      typecheckRuns: baseTypecheck,
      buildRun: { status: 0 },
      ssrRun: { status: 0, payload: { windowDefined: false, documentDefined: false } },
      browserRuns: [okRun('line', 'light-canvas')],
      lifecycle: { status: 'passed' },
      visualComparisons: [{ component: 'line', presentation: 'light-canvas', result: 'DIFF', reason: 'bytes differ' }],
    });
    assert.equal(dimensions.visual, 'failed');
  });

  it('生命周期 not-run 不拖垮 runtime，lifecycle failed 才拖垮', () => {
    const skipped = summariseDimensions({
      typecheckRuns: baseTypecheck,
      buildRun: { status: 0 },
      ssrRun: { status: 0, payload: { windowDefined: false, documentDefined: false } },
      browserRuns: [okRun('line', 'light-canvas')],
      lifecycle: { status: 'not-run', reason: 'no hook' },
      visualComparisons: [{ result: 'PASS' }],
    });
    assert.equal(skipped.dimensions.runtime, 'passed');
    const failed = summariseDimensions({
      typecheckRuns: baseTypecheck,
      buildRun: { status: 0 },
      ssrRun: { status: 0, payload: { windowDefined: false, documentDefined: false } },
      browserRuns: [okRun('line', 'light-canvas')],
      lifecycle: { status: 'failed', reason: 'instance leaked' },
      visualComparisons: [{ result: 'PASS' }],
    });
    assert.equal(failed.dimensions.runtime, 'failed');
    assert.match(failed.failures.map((failure) => failure.reason).join(' '), /instance leaked/);
  });

  it('维度集合必须齐备且取值合法', () => {
    assert.deepEqual(validateDimensions({ typecheck: 'passed', runtime: 'passed', interaction: 'passed', visual: 'passed' }), []);
    assert.match(validateDimensions({ typecheck: 'ok', runtime: 'passed', interaction: 'passed', visual: 'passed' }).join(' '), /typecheck/);
  });

  it('视觉未通过或存在视觉失败时要求人工基线确认', () => {
    assert.equal(
      requiresVisualBaselineConfirmation({ typecheck: 'passed', runtime: 'passed', interaction: 'passed', visual: 'passed' }, []),
      false,
    );
    assert.equal(
      requiresVisualBaselineConfirmation({ typecheck: 'passed', runtime: 'passed', interaction: 'passed', visual: 'not-run' }, []),
      true,
    );
    assert.equal(
      requiresVisualBaselineConfirmation({ typecheck: 'passed', runtime: 'passed', interaction: 'passed', visual: 'passed' }, [
        { dimension: 'visual', reason: 'DIFF' },
      ]),
      true,
    );
  });

  it('未覆盖项把「跳过」与「未核对」分开列', () => {
    const uncovered = collectUncovered({
      browserSkipped: true,
      visualNotRunReasons: ['vue line/light-canvas: NEW'],
      lifecycleNotRunReasons: ['react: no hook'],
      registryUnavailable: true,
      candidateNotRegistryVerified: false,
    });
    const text = uncovered.join(' | ');
    assert.match(text, /--skip-browser/);
    assert.match(text, /视觉基线未确认/);
    assert.match(text, /生命周期未实测/);
    assert.match(text, /registry 不可达/);
  });
});

describe('冻结 tarball 内的兼容策略', () => {
  it('从冻结 tarball 解包并加载四个公开函数', async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'a-t10-policy-ok-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await makeSyntheticBundle(root);
    const bundle = await readFrozenBundle(root);
    const core = bundle.packages.find((entry) => entry.name === '@company/charts-core');
    const loaded = await loadFrozenPolicy({ tarballFile: core.tarballFile });
    t.after(() => loaded.cleanup());
    for (const name of ['resolveCandidate', 'verifyCandidate', 'recommend', 'hasDualFrameworkCoverage']) {
      assert.equal(typeof loaded.module[name], 'function', name);
    }
  });

  it('缺导出的冻结包拒绝出报告', async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'a-t10-policy-bad-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const stage = path.join(root, 'stage');
    await mkdir(path.join(stage, 'package', 'dist', 'engine'), { recursive: true });
    await writeFile(path.join(stage, 'package', 'dist', 'engine', 'compatibility.js'), `export function recommend(){ return 'hold'; }\n`);
    await writeFile(path.join(stage, 'package', 'package.json'), `${JSON.stringify({ name: '@company/charts-core', version: '0.0.10' })}\n`);
    const tarball = path.join(root, 'bad.tgz');
    execFileSync('tar', ['czf', tarball, '-C', stage, 'package']);
    await assert.rejects(() => loadFrozenPolicy({ tarballFile: tarball }), /缺少导出/);
  });

  it('CandidateError 按 reason 分流，不解析消息文本', () => {
    const policy = {
      resolveCandidate() {
        const error = new Error('预发布版本不能作为升级候选');
        error.name = 'CandidateError';
        error.reason = 'prerelease';
        throw error;
      },
    };
    const result = resolveCandidateSafely(policy, '6.2.0-rc.1', {});
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'prerelease');
  });

  it('未知异常也归一为可分流结果', () => {
    const result = resolveCandidateSafely({ resolveCandidate() { throw new Error('boom'); } }, '6.1.0', {});
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unexpected');
  });
});

describe('入口自身健全性', () => {
  it('入口文件与纯逻辑模块都存在且可被 node 解析', async () => {
    for (const name of ['probe.mjs', 'environment.mjs', 'bundle.mjs', 'policy.mjs', 'consumer.mjs', 'browser.mjs', 'evidence.mjs']) {
      const file = path.join(HERE, name);
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      assert.equal(result.status, 0, `${name} 语法检查失败：${result.stderr}`);
    }
  });

  it('--help 输出用法且退出码为 0', () => {
    const result = spawnSync(process.execPath, [path.join(HERE, 'probe.mjs'), '--help'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /--bundle/);
    assert.match(result.stdout, /--presentations/);
  });

  it('缺少 --bundle 时退出码为 1 并提示必填', () => {
    const result = spawnSync(process.execPath, [path.join(HERE, 'probe.mjs')], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /缺少必填选项 --bundle/);
  });

  it('未知选项退出码为 1', () => {
    const result = spawnSync(process.execPath, [path.join(HERE, 'probe.mjs'), '--bundle', '/tmp', '--nope'], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /未知选项 --nope/);
  });

  it('--label 参与证据文件名，分片跑互不覆盖', () => {
    // RED：没有 --label 时两次分片会写同一个 probe-evidence.json，先证明会覆盖。
    const unlabelled = evidenceName('probe-evidence', null, 'json');
    assert.equal(unlabelled, 'probe-evidence.json');
    const first = evidenceName('probe-evidence', sanitiseLabel('Vue Line Bar'), 'json');
    const second = evidenceName('probe-evidence', sanitiseLabel('react/pie'), 'json');
    assert.equal(first, 'probe-evidence-vue-line-bar.json');
    assert.equal(second, 'probe-evidence-react-pie.json');
    assert.notEqual(first, second);
    assert.equal(evidenceName('summary', sanitiseLabel('dark-svg'), 'md'), 'summary-dark-svg.md');
  });

  it('--label 只接受 [a-z0-9-]，空标签被拒绝', () => {
    assert.equal(sanitiseLabel('  Vue  '), 'vue');
    assert.equal(sanitiseLabel('A_B'), 'a-b');
    assert.throws(() => sanitiseLabel('///'), /--label 不能为空/);
    assert.throws(() => sanitiseLabel('   '), /--label 不能为空/);
  });

  // RED：临时目录原先只在成功路径清理，一次中途失败就在临时目录留一份，
  // 沙箱小分区被填满后每次运行都 ENOSPC。收尾必须成功失败都跑。
  it('收尾栈：全部任务都执行，单个任务失败不影响其余，且栈被清空', async () => {
    const done = [];
    teardown.length = 0;
    teardown.push(async () => done.push('policy'));
    teardown.push(async () => {
      throw new Error('boom');
    });
    teardown.push(async () => done.push('consumer'));
    await runTeardown();
    assert.deepEqual(done, ['consumer', 'policy']);
    assert.equal(teardown.length, 0);
  });

  it('--baseline 支持逗号分隔多份（分片跑矩阵后合并比对）', () => {
    assert.deepEqual(parseBaselineOption('a.json, b.json ,c.json'), ['a.json', 'b.json', 'c.json']);
    assert.deepEqual(parseBaselineOption(''), []);
    assert.deepEqual(parseBaselineOption('   '), []);
    assert.deepEqual(parseBaselineOption(null), []);
  });
});
