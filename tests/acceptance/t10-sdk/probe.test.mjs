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
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { symlink } from 'node:fs/promises';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, it } from 'node:test';

import {
  DEFAULT_FONT_DIGEST,
  FONT_PROBE_STRINGS,
  FONT_REFERENCE_FAMILIES,
  canonicalJson,
  computeEnvironmentKey,
  environmentProjection,
  fontDigestFromMeasurements,
  formatPresentation,
  parsePresentation,
  platformName,
  validateEnvironment,
} from './environment.mjs';
import { dedupeSupported, peerEchartsBaseline, readFrozenBundle, supportedCombinations } from './bundle.mjs';
import { loadFrozenPolicy, resolveCandidateSafely } from './policy.mjs';
import {
  CONSUMER_SOURCE_EXCLUSIONS,
  buildProbeTsconfig,
  checkOutsideRepo,
  classifyInstallFailure,
  consumerSourceFilter,
  createConsumer,
  findDirtySourceEntries,
  npm,
  npmInvocation,
  peerRetryPlan,
  removeConsumer,
  rewriteConsumerManifest,
  run,
  sdkSurfaceProbeSource,
  spawnOptions,
  verifyConsumerCandidateSource,
} from './consumer.mjs';
import {
  applyIntegrityGate,
  candidateResolutionLabel,
  evidenceName,
  fontDigestSourceLabel,
  mergeBaselineEvidence,
  nativePlatformNoteFor,
  parseBaselineOption,
  parseFontDigestOption,
  registryHostOf,
  runTeardown,
  sanitiseLabel,
  teardown,
} from './probe.mjs';
import {
  EXPECTED_FIRST_CLICK,
  FONT_MEASUREMENT_SOURCE,
  baselineScreenshots,
  compareWithBaseline,
  echartsRegistrySource,
  environmentAuditFor,
  injectEchartsRegistry,
  readBrowserRevision,
  resolveEffectiveFontDigest,
  summariseRuntime,
} from './browser.mjs';
import {
  collectUncovered,
  requiresVisualBaselineConfirmation,
  summariseDimensions,
  validateDimensions,
} from './evidence.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

/**
 * C 冻结的 0.0.10 bundle 目录。真实策略测试从这里的 tarball 加载，
 * 拿不到就 `t.skip`——不用合成策略顶替，那会让「测的是冻结产物」这句话落空。
 */
const FROZEN_BUNDLE_DIR = process.env.A10_FROZEN_BUNDLE ?? null;

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

/**
 * 最小 ustar 写入器 + gzip：合成 bundle 用，**不依赖外部 `tar` 可执行文件**。
 *
 * 原先用 `execFileSync('tar'|'cat')` 拼外部工具链，Windows 上没有这些命令，单测在
 * 第一处就 ENOENT。`pnpm pack` 的 tarball 就是 ustar + gzip，字段按 POSIX 写全即可，
 * `tar xzf`（policy.mjs 解包用）读得了。
 */
function tarHeader(name, size) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'ascii'); // mode
  header.write('0000000\0', 108, 8, 'ascii'); // uid
  header.write('0000000\0', 116, 8, 'ascii'); // gid
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii'); // size
  header.write('00000000000\0', 136, 12, 'ascii'); // mtime（固定值：保证字节可复现）
  header.write('        ', 148, 8, 'ascii'); // chksum 先填空格
  header.write('0', 156, 1, 'ascii'); // typeflag = 普通文件
  header.write('ustar\0', 257, 6, 'ascii'); // magic
  header.write('00', 263, 2, 'ascii'); // version
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return header;
}

function writeTarGz(entries) {
  const parts = [];
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    parts.push(tarHeader(entry.name, data.length), data);
    const padding = (512 - (data.length % 512)) % 512;
    if (padding > 0) parts.push(Buffer.alloc(padding));
  }
  parts.push(Buffer.alloc(1024)); // 两个全零块：归档结束
  return gzipSync(Buffer.concat(parts));
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
    const members = [];
    if (short === 'charts-core') {
      members.push({
        name: 'package/dist/engine/compatibility.js',
        data: [
          `export function resolveCandidate(){ throw new Error('unused in unit test'); }`,
          `export function verifyCandidate(){ throw new Error('unused in unit test'); }`,
          `export function recommend(){ return 'hold'; }`,
          `export function hasDualFrameworkCoverage(){ return true; }`,
          ``,
        ].join('\n'),
      });
    }
    members.push({
      name: 'package/package.json',
      data: `${JSON.stringify({ name: entry.name, version: '0.0.10', dependencies: entry.deps, peerDependencies: entry.peer }, null, 2)}\n`,
    });
    const tarball = path.join(root, 'packages', `company-${short}-0.0.10.tgz`);
    const bytes = writeTarGz(members);
    await writeFile(tarball, bytes);
    const digest = tamper && short === 'charts-core' ? sha256(Buffer.from('tampered')) : sha256(bytes);
    manifestPackages.push({
      name: entry.name,
      version: '0.0.10',
      tarball: { path: `packages/company-${short}-0.0.10.tgz`, sha256: digest, bytes: bytes.length },
      sourceDigest: sha256(Buffer.from(short)),
      dependencies: workspaceResidue ? { '@company/charts-core': 'workspace:*' } : entry.deps,
      peerDependencies: entry.peer,
    });
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

// RED：fontDigest 原先直接用一个写死的常量（与 CLI 的 DEFAULT_FONT_DIGEST 同一输入），
// 于是「本机字体」从未被测量过——同一台没装中文字体的机器与装了字体的机器会得到同一个
// environmentKey，视觉比对会静默判 PASS。字体摘要必须由浏览器里的真实度量算出。
describe('字体指纹必须来自实测，不能是常量', () => {
  const measurement = (families) => ({
    stack: 'system-ui, sans-serif',
    families: [
      // 参考族必须齐全，否则签名不可跨页面比较
      ...FONT_REFERENCE_FAMILIES.map((family) => ({ family, available: true, advances: [10, 20, 30] })),
      ...families.map((family) => ({ family, available: true, advances: [72.125, 210.5, 18.25] })),
    ],
    loadedFonts: [],
  });

  it('字体摘要由度量值算出，且对度量差异敏感', () => {
    const first = fontDigestFromMeasurements(measurement(['Arial']));
    const second = fontDigestFromMeasurements(measurement(['Arial']));
    const third = fontDigestFromMeasurements(measurement(['Helvetica']));
    assert.match(first, /^[0-9a-f]{64}$/);
    assert.equal(first, second, '同样的度量必须得到同样的摘要');
    assert.notEqual(first, third, '字体族不同必须得到不同摘要');
  });

  it('字形前进宽度不同即摘要不同——没装中文字体的机器不会被误判为同环境', () => {
    // 同一字体族名，但中文字形回退到不同字体文件：advance 宽度不同
    const reference = (advance) => ({
      stack: 'sans-serif',
      families: [
        ...FONT_REFERENCE_FAMILIES.map((family) => ({ family, available: true, advances: [10, 20, 30] })),
        { family: 'sans-serif', available: true, advances: [72.125, advance, 18.25] },
      ],
      loadedFonts: [],
    });
    const withCjk = fontDigestFromMeasurements(reference(210.5));
    const fallbackCjk = fontDigestFromMeasurements(reference(96.0));
    assert.notEqual(withCjk, fallbackCjk);
  });

  it('已加载 Web 字体进摘要：页面引入自定义字体必须改变签名', () => {
    const withoutWebfont = fontDigestFromMeasurements({ ...measurement(['Arial']), loadedFonts: [] });
    const withWebfont = fontDigestFromMeasurements({
      ...measurement(['Arial']),
      loadedFonts: ['Brand Sans normal 400'],
    });
    assert.notEqual(withoutWebfont, withWebfont);
  });

  it('字体度量缺项时拒绝出摘要，不退回常量', () => {
    assert.throws(() => fontDigestFromMeasurements(null), /字体度量/);
    assert.throws(() => fontDigestFromMeasurements({}), /字体度量/);
    assert.throws(() => fontDigestFromMeasurements({ stack: 'x', families: 'nope', loadedFonts: [] }), /families/);
    assert.throws(() => fontDigestFromMeasurements({ stack: '', families: [], loadedFonts: [] }), /stack/);
    // 有 stack 与 families 但缺 loadedFonts：同样拒绝
    assert.throws(
      () => fontDigestFromMeasurements({ stack: 'x', families: [{ family: 'Arial', advances: [1, 2, 3] }] }),
      /loadedFonts/,
    );
    // 度量项缺 advances
    assert.throws(
      () =>
        fontDigestFromMeasurements({
          stack: 'x',
          families: [{ family: 'Arial' }],
          loadedFonts: [],
        }),
      /advances/,
    );
  });

  it('CLI 常量只是声明值，探针不拿它冒充实测', () => {
    // 常量仍然保留：C 侧 CLI 用它，探针要用它复现 C 的 key。
    // 但探针的默认字体摘要路径必须是 measured，二者在证据里可区分。
    assert.equal(fontDigestSourceLabel('measured'), 'measured');
    assert.equal(fontDigestSourceLabel('operator-supplied'), 'operator-supplied');
    assert.equal(fontDigestSourceLabel('not-measured'), 'not-measured');
    assert.equal(fontDigestFromMeasurements(measurement(['Arial'])) === DEFAULT_FONT_DIGEST, false);
  });

  it('--font-digest 只接受 64 位十六进制', () => {
    assert.equal(parseFontDigestOption('a'.repeat(64)), 'a'.repeat(64));
    assert.equal(parseFontDigestOption('  ' + 'b'.repeat(64) + ' '), 'b'.repeat(64));
    assert.throws(() => parseFontDigestOption('xyz'), /--font-digest/);
    assert.throws(() => parseFontDigestOption(''), /--font-digest/);
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

  // RED：默认 peer=strict 被拒后原先会自动 --legacy-peer-deps 重试，等于「默认就绕过
  // peer」——绕过 peer 后能不能用会被读成「兼容」。只有显式 --peer legacy 才允许放宽。
  it('只有显式 --peer legacy 才允许放宽重试，strict / strict-only 一律拒绝', () => {
    // 严格安装成功：任何模式都不重试
    for (const peer of ['strict', 'legacy', 'strict-only']) {
      assert.deepEqual(peerRetryPlan(peer, 0), { retry: false, mode: 'strict' }, peer);
    }
    // 严格安装被拒：只有 legacy 重试
    assert.deepEqual(peerRetryPlan('legacy', 1), { retry: true, mode: 'legacy' });
    for (const peer of ['strict', 'strict-only']) {
      const plan = peerRetryPlan(peer, 1);
      assert.equal(plan.retry, false, `${peer} 不得自动放宽`);
      assert.equal(plan.mode, 'strict');
    }
  });

  // RED：Windows 上原先 `shell: process.platform === 'win32'`，命令行过一层 cmd.exe，
  // 带空格的路径被拆开。C 实测 run(execPath, ["C:/t10 path/script.mjs"]) 报
  // `Cannot find module C:\t10`。一律不过 shell，argv 原样传递。
  it('spawn 选项一律 shell:false，argv 原样传递（不过 shell 拆路径）', () => {
    const seen = [];
    const spawn = (command, args, options) => {
      seen.push({ command, args, options });
      return { status: 0, stdout: '', stderr: '' };
    };
    run(process.execPath, ['C:/t10 path/with space/script.mjs', '--out', 'a b'], '/tmp', { spawnImpl: spawn });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].options.shell, false, '不得为任何平台开启 shell');
    // 带空格的路径必须是**一个** argv 元素，不能被拆成多个
    assert.equal(seen[0].args[0], 'C:/t10 path/with space/script.mjs');
    assert.deepEqual(seen[0].args, ['C:/t10 path/with space/script.mjs', '--out', 'a b']);
    assert.equal(seen[0].command, process.execPath);
  });

  it('npm 一律走 node + npm-cli.js，不直接调 npm.cmd', () => {
    const invocation = npmInvocation();
    if (invocation.command !== 'npm') {
      assert.equal(invocation.command, process.execPath);
      assert.match(invocation.prefix[0], /npm-cli\.js$/);
      assert.equal(invocation.prefix.length, 1);
    } else {
      // 都找不到时退回 PATH 上的 npm；npm.cmd 无法脱离 shell 启动，
      // 因此这条退回路径只应出现在 npm 本身就是可执行文件的平台上
      assert.notEqual(process.platform, 'win32');
    }
    const seen = [];
    const spawn = (command, args) => {
      seen.push({ command, args });
      return { status: 0, stdout: '', stderr: '' };
    };
    npm(['run', 'build'], 'C:/t10 path/consumer', { spawnImpl: spawn });
    assert.equal(seen[0].args.at(-1), 'build');
    assert.equal(seen[0].args[0], invocation.prefix[0] ?? 'npm');
    assert.equal(seen[0].command, invocation.command);
  });

  it('带空格与元字符的路径真实可跑：不只断言选项形状', async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'a-t10-space-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const dir = path.join(root, 'a t10 consumer (x)');
    await mkdir(dir, { recursive: true });
    const script = path.join(dir, 'probe script.mjs');
    await writeFile(script, `process.stdout.write(JSON.stringify({ ok: process.argv[2] }));\n`);
    const result = run(process.execPath, [script, 'value with space'], root);
    assert.equal(result.status, 0, result.output);
    assert.equal(JSON.parse(result.output).ok, 'value with space');
  });

  // RED：候选来源原先只查「版本号相等 + integrity 以 sha512- 开头」。
  // 那只能证明字符串形状对，证明不了消费者装进来的字节来自官方源。
  describe('候选来源按消费者 lock 核对', () => {
    const expected = {
      packageName: 'echarts',
      version: '6.1.0',
      integrity: 'sha512-q0yaFPggC9FUdsWH4blavRWFmxdrIodbkoKNAjJudAI6CA9gNPxHtV2RcZNEepZVlk4yvBYkOkbk6HIVpIyHZA==',
      registryHost: 'registry.npmjs.org',
    };
    const lock = (entry) => ({ name: 'consumer', lockfileVersion: 3, packages: { '': {}, ...entry } });

    it('锁里的版本 / integrity / https 来源主机三方对上才认', async (t) => {
      const root = await mkdtemp(path.join(tmpdir(), 'a-t10-lock-ok-'));
      t.after(() => rm(root, { recursive: true, force: true }));
      await writeFile(
        path.join(root, 'package-lock.json'),
        JSON.stringify(
          lock({
            'node_modules/echarts': {
              version: '6.1.0',
              integrity: expected.integrity,
              resolved: 'https://registry.npmjs.org/echarts/-/echarts-6.1.0.tgz',
            },
          }),
        ),
      );
      const result = await verifyConsumerCandidateSource(root, expected);
      assert.equal(result.verified, true, result.reason);
    });

    it('integrity 与 registry 不一致即不认', async (t) => {
      const root = await mkdtemp(path.join(tmpdir(), 'a-t10-lock-int-'));
      t.after(() => rm(root, { recursive: true, force: true }));
      await writeFile(
        path.join(root, 'package-lock.json'),
        JSON.stringify(
          lock({
            'node_modules/echarts': {
              version: '6.1.0',
              integrity: 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
              resolved: 'https://registry.npmjs.org/echarts/-/echarts-6.1.0.tgz',
            },
          }),
        ),
      );
      const result = await verifyConsumerCandidateSource(root, expected);
      assert.equal(result.verified, false);
      assert.match(result.reason, /integrity 与 registry 不一致/);
    });

    it('版本被换成同名不同字节的来源即不认', async (t) => {
      const root = await mkdtemp(path.join(tmpdir(), 'a-t10-lock-ver-'));
      t.after(() => rm(root, { recursive: true, force: true }));
      await writeFile(
        path.join(root, 'package-lock.json'),
        JSON.stringify(
          lock({
            'node_modules/echarts': {
              version: '6.1.0-local',
              integrity: expected.integrity,
              resolved: 'https://registry.npmjs.org/echarts/-/echarts-6.1.0.tgz',
            },
          }),
        ),
      );
      const result = await verifyConsumerCandidateSource(root, expected);
      assert.equal(result.verified, false);
      assert.match(result.reason, /不一致/);
    });

    it('file: 本地 tarball 来源即不认', async (t) => {
      const root = await mkdtemp(path.join(tmpdir(), 'a-t10-lock-file-'));
      t.after(() => rm(root, { recursive: true, force: true }));
      await writeFile(
        path.join(root, 'package-lock.json'),
        JSON.stringify(
          lock({
            'node_modules/echarts': {
              version: '6.1.0',
              integrity: expected.integrity,
              resolved: 'file:../vendor/echarts-6.1.0.tgz',
            },
          }),
        ),
      );
      const result = await verifyConsumerCandidateSource(root, expected);
      assert.equal(result.verified, false);
      assert.match(result.reason, /不是 https 来源/);
    });

    it('来源主机不是 registry 主机即不认', async (t) => {
      const root = await mkdtemp(path.join(tmpdir(), 'a-t10-lock-host-'));
      t.after(() => rm(root, { recursive: true, force: true }));
      await writeFile(
        path.join(root, 'package-lock.json'),
        JSON.stringify(
          lock({
            'node_modules/echarts': {
              version: '6.1.0',
              integrity: expected.integrity,
              resolved: 'https://mirror.internal.example/echarts/-/echarts-6.1.0.tgz',
            },
          }),
        ),
      );
      const result = await verifyConsumerCandidateSource(root, expected);
      assert.equal(result.verified, false);
      assert.match(result.reason, /来源主机/);
    });

    it('link 条目（工作区/本地链接）即不认', async (t) => {
      const root = await mkdtemp(path.join(tmpdir(), 'a-t10-lock-link-'));
      t.after(() => rm(root, { recursive: true, force: true }));
      await writeFile(
        path.join(root, 'package-lock.json'),
        JSON.stringify(
          lock({
            'node_modules/echarts': {
              version: '6.1.0',
              integrity: expected.integrity,
              resolved: '../vendor/echarts',
              link: true,
            },
          }),
        ),
      );
      const result = await verifyConsumerCandidateSource(root, expected);
      assert.equal(result.verified, false);
      assert.match(result.reason, /link/);
    });

    it('没有 lock 文件即不认，不静默放行', async (t) => {
      const root = await mkdtemp(path.join(tmpdir(), 'a-t10-lock-none-'));
      t.after(() => rm(root, { recursive: true, force: true }));
      const result = await verifyConsumerCandidateSource(root, expected);
      assert.equal(result.verified, false);
      assert.match(result.reason, /package-lock\.json/);
    });
  });

// RED：createConsumer 原先接受任意 consumerRoot，包括仓库内部路径。
// AGENTS 的硬约束是「工作区外干净消费者」：消费者落在仓库内，类型检查与构建就可能
// 经由 workspace 链接或源码 alias 命中未提交改动，「验的是用户装到的包」就落了空。
describe('干净消费者必须建在仓库之外', () => {
  // 基准用**真实仓库根**，不写死任何机器的绝对路径
  const repo = REPO_ROOT;

  it('仓库根本身与仓库内子目录一律拒绝', () => {
    for (const candidate of [repo, path.join(repo, 'tmp'), path.join(repo, 'examples', 'vue')]) {
      const result = checkOutsideRepo(candidate, repo);
      assert.equal(result.ok, false, `${candidate} 不应被接受`);
      assert.match(result.reason, /仓库/);
    }
  });

  it('用 .. 折回仓库内的路径也拒绝（resolve 之后现形）', () => {
    // 起点在仓库外，但经 .. 折回仓库内：resolve 之后必须现形
    const sneaky = path.resolve(path.sep, 'tmp', '..', ...repo.split(path.sep).filter(Boolean), 'tmp');
    assert.equal(sneaky, path.join(repo, 'tmp'));
    const result = checkOutsideRepo(sneaky, repo);
    assert.equal(result.ok, false);
    assert.match(result.reason, /仓库/);
  });

  it('经 .. 折后仍在仓库外的路径照常允许：不是见 .. 就拒', () => {
    const candidate = path.resolve('/tmp', '..', 'tmp', 't10 consumers', 'a', '..', 'b');
    assert.equal(path.resolve(candidate).startsWith(repo), false);
    assert.equal(checkOutsideRepo(candidate, repo).ok, true);
  });

  it('符号链接指向仓库内部时拒绝（必须取真实路径才能发现）', async (t) => {
    const base = await mkdtemp(path.join(tmpdir(), 'a-t10-outside-'));
    t.after(() => rm(base, { recursive: true, force: true }));
    const link = path.join(base, 'looks-outside');
    if (process.platform === 'win32') {
      // Windows 上目录符号链接需要提权，普通用户会 EPERM；junction 不需要，
      // realpathSync.native 同样能解析出真实路径——绕回仓库的效果等价。
      await symlink(repo, link, 'junction');
    } else {
      await symlink(repo, link);
    }
    const result = checkOutsideRepo(link, repo);
    assert.equal(result.ok, false, '符号链接/Junction 绕回仓库必须被拒绝');
    assert.match(result.reason, /符号链接|Junction|真实路径/);
  });

  it('仓库内尚不存在的子路径同样拒绝（逐级向上找已存在祖先）', () => {
    const result = checkOutsideRepo(path.join(repo, 'deep', 'not', 'yet', 'created'), repo);
    assert.equal(result.ok, false);
    assert.match(result.reason, /仓库/);
  });

  it('仓库外部带空格、且尚不存在的路径允许', async (t) => {
    const base = await mkdtemp(path.join(tmpdir(), 'a-t10-outside-ok-'));
    t.after(() => rm(base, { recursive: true, force: true }));
    const candidate = path.join(base, 't10 consumers', 'not yet created');
    assert.equal(existsSync(candidate), false);
    const result = checkOutsideRepo(candidate, repo);
    assert.equal(result.ok, true, result.reason);
  });

  it('仓库外部已存在的普通目录允许', async (t) => {
    const base = await mkdtemp(path.join(tmpdir(), 'a-t10-outside-dir-'));
    t.after(() => rm(base, { recursive: true, force: true }));
    assert.equal(checkOutsideRepo(base, repo).ok, true);
  });
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
  });

  // RED：冲突原先只打日志、保留第一份，compareWithBaseline 照样能判 PASS——
  // 等于用一份来路不明的基线宣布通过。必须 fail-closed。
  it('基线有冲突时 fail-closed：任何组合都不判过', () => {
    const merged = mergeBaselineEvidence([
      { combinations: [{ framework: 'vue', screenshots: [shot('line', 'vue', 'light-canvas', 'aaa', 'key-1')] }] },
      { combinations: [{ framework: 'vue', screenshots: [shot('line', 'vue', 'light-canvas', 'zzz', 'key-2')] }] },
      { combinations: [{ framework: 'react', screenshots: [shot('line', 'react', 'light-canvas', 'ccc', 'key-1')] }] },
    ]);
    // 冲突在 vue/line 上，但 react 的比对同样不得通过：判据本身已不可信
    for (const candidate of [
      shot('line', 'vue', 'light-canvas', 'aaa', 'key-1'),
      shot('line', 'vue', 'light-canvas', 'zzz', 'key-2'),
      shot('line', 'react', 'light-canvas', 'ccc', 'key-1'),
      shot('bar', 'vue', 'light-canvas', 'aaa', 'key-1'),
    ]) {
      const result = compareWithBaseline(candidate, merged);
      assert.equal(result.result, 'INCOMPATIBLE', `${candidate.component} 不应判过`);
      assert.match(result.reason, /冲突/);
    }
  });

  it('同一组合在两份基线里完全一致时不记 conflict', () => {
    const merged = mergeBaselineEvidence([
      { combinations: [{ framework: 'vue', screenshots: [shot('line', 'vue', 'light-canvas', 'aaa')] }] },
      { combinations: [{ framework: 'vue', screenshots: [shot('line', 'vue', 'light-canvas', 'aaa')] }] },
    ]);
    assert.deepEqual(merged.conflicts, []);
    assert.equal(baselineScreenshots(merged).length, 1);
    assert.equal(compareWithBaseline(shot('line', 'vue', 'light-canvas', 'aaa'), merged).result, 'PASS');
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

  // RED：缺证据原先仍可判 runtime passed——一份只跑了 build 的证据会显示全绿。
  // 「没测」不是「通过」，缺 SSR / 生命周期 / 浏览器运行任一项都必须是 not-run。
  it('缺 SSR 证据时 runtime 记 not-run，不判通过', () => {
    const { dimensions, failures } = summariseDimensions({
      typecheckRuns: baseTypecheck,
      buildRun: { status: 0 },
      browserRuns: [okRun('line', 'light-canvas')],
      lifecycle: { status: 'passed' },
      visualComparisons: [{ result: 'PASS' }],
    });
    assert.equal(dimensions.runtime, 'not-run');
    assert.match(failures.map((failure) => failure.reason).join(' '), /缺少 SSR 安全导入 证据/);
  });

  it('缺生命周期证据时 runtime 记 not-run，不判通过', () => {
    const { dimensions, failures } = summariseDimensions({
      typecheckRuns: baseTypecheck,
      buildRun: { status: 0 },
      ssrRun: { status: 0, payload: { windowDefined: false, documentDefined: false } },
      browserRuns: [okRun('line', 'light-canvas')],
      visualComparisons: [{ result: 'PASS' }],
    });
    assert.equal(dimensions.runtime, 'not-run');
    assert.match(failures.map((failure) => failure.reason).join(' '), /缺少 生命周期 证据/);
  });

  it('生命周期本身 not-run 时 runtime 记 not-run，不判通过', () => {
    const { dimensions, failures } = summariseDimensions({
      typecheckRuns: baseTypecheck,
      buildRun: { status: 0 },
      ssrRun: { status: 0, payload: { windowDefined: false, documentDefined: false } },
      browserRuns: [okRun('line', 'light-canvas')],
      lifecycle: { status: 'not-run', reason: '示例页未暴露 __EXAMPLE_REMOUNT__' },
      visualComparisons: [{ result: 'PASS' }],
    });
    assert.equal(dimensions.runtime, 'not-run');
    assert.match(failures.map((failure) => failure.reason).join(' '), /生命周期未实测/);
  });

  it('缺浏览器运行证据时 runtime 记 not-run，不判通过', () => {
    const { dimensions, failures } = summariseDimensions({
      typecheckRuns: baseTypecheck,
      buildRun: { status: 0 },
      ssrRun: { status: 0, payload: { windowDefined: false, documentDefined: false } },
      browserRuns: [],
      lifecycle: { status: 'passed' },
      visualComparisons: [],
    });
    assert.equal(dimensions.runtime, 'not-run');
    assert.match(failures.map((failure) => failure.reason).join(' '), /缺少 浏览器运行 证据/);
  });

  it('SSR 退出码非 0 时仍判 failed，不是 not-run', () => {
    const { dimensions } = summariseDimensions({
      typecheckRuns: baseTypecheck,
      buildRun: { status: 0 },
      ssrRun: { status: 1, output: 'boom' },
      browserRuns: [okRun('line', 'light-canvas')],
      lifecycle: { status: 'passed' },
      visualComparisons: [{ result: 'PASS' }],
    });
    assert.equal(dimensions.runtime, 'failed');
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

  // 原先把 lifecycle: 'not-run' 仍判 runtime passed——「没测」被当成「通过」。
  // 现改为：生命周期未实测时 runtime 记 not-run；只有 lifecycle failed 才判 failed。
  it('生命周期 not-run 时 runtime 记 not-run，lifecycle failed 才判 failed', () => {
    const skipped = summariseDimensions({
      typecheckRuns: baseTypecheck,
      buildRun: { status: 0 },
      ssrRun: { status: 0, payload: { windowDefined: false, documentDefined: false } },
      browserRuns: [okRun('line', 'light-canvas')],
      lifecycle: { status: 'not-run', reason: 'no hook' },
      visualComparisons: [{ result: 'PASS' }],
    });
    assert.equal(skipped.dimensions.runtime, 'not-run');
    assert.match(skipped.failures.map((failure) => failure.reason).join(' '), /生命周期未实测/);
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
    const { uncovered, scopeNotes } = collectUncovered({
      browserSkipped: true,
      visualNotRunReasons: ['vue line/light-canvas: NEW'],
      lifecycleNotRunReasons: ['react: no hook'],
      registryUnavailable: true,
      candidateNotRegistryVerified: false,
      scopeNotes: ['peer 范围未改动：探针只出具报告'],
    });
    const text = uncovered.join(' | ');
    assert.match(text, /--skip-browser/);
    assert.match(text, /视觉基线未确认/);
    assert.match(text, /生命周期未实测/);
    assert.match(text, /registry 不可达/);
    assert.deepEqual(scopeNotes, ['peer 范围未改动：探针只出具报告']);
  });

  // RED：范围说明原先混在 uncovered 里。B 的 verify 把 uncovered 当本地必需检查门禁，
  // 于是「peer 范围未改动」「三存储不在本地范围」这类声明会让每次运行都无端 hold。
  // 范围说明必须单独放 scopeNotes，且不得从报告里删掉。
  it('范围说明进 scopeNotes，不进 uncovered 门禁', () => {
    const result = collectUncovered({
      browserSkipped: false,
      scopeNotes: [
        'peer 范围未改动：探针只出具报告，不修改任何 package.json 的 peerDependencies',
        'compatibility_records 落库需要 Verdaccio / PostgreSQL / MinIO 与 OIDC，不在本次本地范围内',
      ],
    });
    assert.deepEqual(result.uncovered, [], '纯范围说明不得进入门禁');
    assert.equal(result.scopeNotes.length, 2, '范围说明不得被删掉');
    assert.match(result.scopeNotes.join(' '), /peer 范围未改动/);
    assert.match(result.scopeNotes.join(' '), /compatibility_records/);
  });

  it('本地真没跑的项仍留 uncovered，范围说明不影响这一点', () => {
    const result = collectUncovered({
      browserSkipped: true,
      candidateNotRegistryVerified: true,
      scopeNotes: ['peer 范围未改动'],
    });
    assert.equal(result.uncovered.length, 2);
    assert.match(result.uncovered.join(' '), /--skip-browser/);
    assert.match(result.uncovered.join(' '), /候选版本未在官方源核对/);
    assert.equal(result.scopeNotes.length, 1);
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
    await writeFile(
      tarball,
      writeTarGz([
        { name: 'package/dist/engine/compatibility.js', data: `export function recommend(){ return 'hold'; }\n` },
        { name: 'package/package.json', data: `${JSON.stringify({ name: '@company/charts-core', version: '0.0.10' })}\n` },
      ]),
    );
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

// RED：候选差异与回退用例此前一条都没跑。纪律是「不得只按版本号判 passed、
// 不得用一个框架替代另一个、不得把放宽 peer 的测量说成通过、不得扩大支持范围」。
describe('候选差异与回退（非基线候选）', () => {
  const supported = [
    { framework: 'vue', frameworkVersion: '3.5.45', echartsVersion: '6.1.0' },
    { framework: 'react', frameworkVersion: '19.3.1', echartsVersion: '6.1.0' },
  ];

  /**
   * `CombinationResult` 是**扁平**的：`SupportedCombination & CombinationDimensions`，
   * 四维与 `differences` 直接挂在结果上，不是嵌套在 `dimensions` 里。
   * 用冻结策略本身判一遍，避免在测试里另写一套版本判定。
   */
  const result = (row, { echarts, outcomes }) => ({
    ...row,
    echartsVersion: echarts,
    baselineEchartsVersion: '6.1.0',
    ...outcomes,
  });
  const allPassed = { typecheck: 'passed', runtime: 'passed', interaction: 'passed', visual: 'passed', differences: [] };

  async function frozenRecommend(report, t) {
    if (!FROZEN_BUNDLE_DIR) {
      t.skip('未配置 A10_FROZEN_BUNDLE：没有真实冻结 bundle 可用，跳过而非用合成策略顶替');
      return undefined;
    }

    const bundle = await readFrozenBundle(FROZEN_BUNDLE_DIR);
    const core = bundle.packages.find((entry) => entry.name === '@company/charts-core');
    const loaded = await loadFrozenPolicy({ tarballFile: core.tarballFile });
    try {
      return loaded.module.recommend(report, supported);
    } finally {
      await loaded.cleanup();
    }
  }

  it('候选低于基线（回退方向）不满足 peer：recommend 必为 hold', async (t) => {
    const report = {
      candidate: { version: '6.0.0', integrity: 'sha512-x', releaseNotesSource: '', source: 'registry' },
      peerSatisfied: false,
      baselineEchartsVersion: '6.1.0',
      results: supported.map((row) => result(row, { echarts: '6.0.0', outcomes: allPassed })),
      supportedRangeUnchanged: true,
      requiresVisualBaselineConfirmation: false,
    };
    const verdict = await frozenRecommend(report, t);
    if (verdict === undefined) return;
    assert.equal(verdict, 'hold');
  });

  it('四维全过但 peer 不满足，仍不得判 adopt', async (t) => {
    const report = {
      candidate: { version: '6.0.0', integrity: 'sha512-x', releaseNotesSource: '', source: 'registry' },
      peerSatisfied: false,
      baselineEchartsVersion: '6.1.0',
      results: supported.map((row) => result(row, { echarts: '6.0.0', outcomes: allPassed })),
      supportedRangeUnchanged: true,
      requiresVisualBaselineConfirmation: false,
    };
    const verdict = await frozenRecommend(report, t);
    if (verdict === undefined) return;
    assert.equal(verdict, 'hold');
  });

  it('候选等于唯一基线且双框架各有一条实测时才 adopt（回退到 6.1.0 的判据）', async (t) => {
    const report = {
      candidate: { version: '6.1.0', integrity: 'sha512-y', releaseNotesSource: '', source: 'registry' },
      peerSatisfied: true,
      baselineEchartsVersion: '6.1.0',
      results: supported.map((row) => result(row, { echarts: '6.1.0', outcomes: allPassed })),
      supportedRangeUnchanged: true,
      requiresVisualBaselineConfirmation: false,
    };
    const verdict = await frozenRecommend(report, t);
    if (verdict === undefined) return;
    assert.equal(verdict, 'adopt');
  });

  it('只验了一个框架时不构成双框架覆盖，哪怕候选就是基线', async (t) => {
    const report = {
      candidate: { version: '6.1.0', integrity: 'sha512-y', releaseNotesSource: '', source: 'registry' },
      peerSatisfied: true,
      baselineEchartsVersion: '6.1.0',
      results: [result(supported[0], { echarts: '6.1.0', outcomes: allPassed })],
      supportedRangeUnchanged: true,
      requiresVisualBaselineConfirmation: false,
    };
    const verdict = await frozenRecommend(report, t);
    if (verdict === undefined) return;
    assert.equal(verdict, 'hold');
  });

  it('有一维 not-run 就不得 adopt：视觉无基线同样拦住采用', async (t) => {
    const report = {
      candidate: { version: '6.1.0', integrity: 'sha512-y', releaseNotesSource: '', source: 'registry' },
      peerSatisfied: true,
      baselineEchartsVersion: '6.1.0',
      results: supported.map((row) =>
        result(row, {
          echarts: '6.1.0',
          outcomes: { typecheck: 'passed', runtime: 'passed', interaction: 'passed', visual: 'not-run', differences: [] },
        }),
      ),
      supportedRangeUnchanged: true,
      requiresVisualBaselineConfirmation: true,
    };
    const verdict = await frozenRecommend(report, t);
    if (verdict === undefined) return;
    assert.equal(verdict, 'hold');
  });

  it('有差异就不得 adopt，哪怕四维全过', async (t) => {
    const report = {
      candidate: { version: '6.1.0', integrity: 'sha512-y', releaseNotesSource: '', source: 'registry' },
      peerSatisfied: true,
      baselineEchartsVersion: '6.1.0',
      results: supported.map((row) =>
        result(row, { echarts: '6.1.0', outcomes: { ...allPassed, differences: ['canvas 数量不同'] } }),
      ),
      supportedRangeUnchanged: true,
      requiresVisualBaselineConfirmation: false,
    };
    const verdict = await frozenRecommend(report, t);
    if (verdict === undefined) return;
    assert.equal(verdict, 'hold');
  });

  it('候选版本与 supported 唯一基线不一致就 hold（不得靠版本号相近放行）', async (t) => {
    for (const version of ['6.0.0', '6.2.0', '6.1.1', '^6.1.0']) {
      const report = {
        candidate: { version, integrity: 'sha512-y', releaseNotesSource: '', source: 'registry' },
        peerSatisfied: true,
        baselineEchartsVersion: '6.1.0',
        results: supported.map((row) => result(row, { echarts: version, outcomes: allPassed })),
        supportedRangeUnchanged: true,
        requiresVisualBaselineConfirmation: false,
      };
      const verdict = await frozenRecommend(report, t);
      if (verdict === undefined) return;
      assert.equal(verdict, 'hold', version);
    }
  });

  it('放宽 peer 只测量不通过：legacy 模式的两次安装都要留痕', () => {
    // 安装结果分类器认得 ERESOLVE；legacy 记录必须同时留下 strict 的拒绝原因
    const strict = classifyInstallFailure('npm error code ERESOLVE\npeer echarts@"6.1.0" from @company/charts-vue@0.0.10');
    assert.equal(strict.reason, 'peer-unresolved');
    assert.match(strict.detail, /ERESOLVE/);
    const installs = [
      { mode: 'strict', exitCode: 1, ...strict },
      { mode: 'legacy', exitCode: 0 },
    ];
    assert.equal(installs.filter((entry) => entry.mode === 'strict').length, 1);
    assert.equal(installs.find((entry) => entry.mode === 'legacy').exitCode, 0);
  });

  it('预发布候选被拒绝，不会静默回退到上一个稳定版', () => {
    const policy = {
      resolveCandidate() {
        const error = new Error('预发布版本不能作为升级候选');
        error.name = 'CandidateError';
        error.reason = 'prerelease';
        throw error;
      },
    };
    const result = resolveCandidateSafely(policy, '6.1.0-rc.2', {});
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'prerelease');
  });

  it('candidateResolution 区分「显式请求」「registry 拒绝」「peer 基线」', () => {
    assert.equal(candidateResolutionLabel('6.0.0', 'registry-explicit'), 'registry-explicit');
    assert.equal(candidateResolutionLabel(null, 'frozen-peer-baseline'), 'frozen-peer-baseline');
    assert.equal(candidateResolutionLabel('6.0.0', 'registry-rejected:prerelease'), 'registry-rejected:prerelease');
  });

  // RED：未覆盖项原先硬编码「只在隔离 Linux 工具链上跑过」。C 在 Windows 上跑完，
  // 报告里仍写着 Linux——未覆盖项必须是可按本机事实核查的陈述。
  it('未覆盖项的本机平台陈述按 process.platform 生成', () => {
    const onWindows = nativePlatformNoteFor('windows');
    assert.match(onWindows, /本机即 Windows/);
    assert.match(onWindows, /未复验/);
    // 不得再声称「只在 Linux 工具链上跑过」——那是另一台机器的经历
    assert.equal(/隔离 Linux 工具链/.test(onWindows), false);
    const onLinux = nativePlatformNoteFor('linux');
    assert.match(onLinux, /本机为 linux/);
    assert.match(onLinux, /不代表 Windows 原生验收/);
  });

  // RED：integrity 未经官方源核对时 recommend 仍可能是 adopt。
  // 「没核对过字节来源就宣布采用」必须被闸门拦住。
  it('integrity 未核对时 adopt 被改成 hold', () => {
    assert.equal(applyIntegrityGate('adopt', true), 'adopt');
    assert.equal(applyIntegrityGate('adopt', false), 'hold');
    // 策略层本来就 hold 的，不因闸门改变
    assert.equal(applyIntegrityGate('hold', false), 'hold');
    assert.equal(applyIntegrityGate('hold', true), 'hold');
  });
});


// RED：--registry offline 原先走 `new URL(options.registry).host`，直接抛 Invalid URL，
// 「离线」这种正当用法变成意外崩溃。离线应诚实 hold（候选来源无从核对），不是崩。
describe('registry 主机名解析', () => {
  it('offline 与无法解析的地址返回 null，不抛错', () => {
    assert.equal(registryHostOf('offline'), null);
    assert.equal(registryHostOf(''), null);
    assert.equal(registryHostOf('   '), null);
    assert.equal(registryHostOf(null), null);
    assert.equal(registryHostOf('not a url'), null);
    assert.equal(registryHostOf('registry.npmjs.org'), null);
  });

  it('正常 registry 地址取主机名', () => {
    assert.equal(registryHostOf('https://registry.npmjs.org/echarts'), 'registry.npmjs.org');
    assert.equal(registryHostOf('http://127.0.0.1:4873'), '127.0.0.1:4873');
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

  // RED：browserRevision 原先硬编码 '1000'（契约示例占位值）。修订号进 environmentKey，
  // 写错的后果是「签名声称的环境与真实跑的环境不是同一个」。必须从 playwright 自己的
  // browsers.json 读，且要沿依赖链解析——pnpm 根下直接 resolve playwright-core 会抛错。
  it('browserRevision 从 playwright-core/browsers.json 读出真实修订号', () => {
    const revision = readBrowserRevision(new URL('./browser.mjs', import.meta.url));
    assert.match(revision, /^\d+$/, `修订号应为纯数字，收到 ${revision}`);
    assert.notEqual(revision, '1000', '不得沿用契约示例里的占位值');
  });

  it('读不到 browsers.json 时抛错并说明原因，不退回占位值', () => {
    // 给一个不存在的 URL：依赖链与兜底路径全都落空，必须抛错而不是返回 '1000'
    const missing = pathToFileURL(path.resolve(tmpdir(), `a-t10-missing-${Date.now()}`, 'probe.mjs'));
    assert.throws(() => readBrowserRevision(missing.href), /PROBE_ENVIRONMENT/);
  });

  // RED：字体测量的页面函数原先在 page.evaluate 回调里引用了 Node 模块作用域的常量，
  // 浏览器执行时报 ReferenceError: FONT_MEASUREMENT_SOURCE is not defined。
  // 页面函数源码必须自包含：不引用任何 Node 侧绑定。
  it('字体测量源码自包含，不含 Node 作用域引用', () => {
    const source = FONT_MEASUREMENT_SOURCE.toString();
    // 页面里可用的只有 DOM / canvas / document.fonts；出现这些名字说明引用了 Node 侧绑定
    for (const forbidden of ['FONT_MEASUREMENT_SOURCE', 'import ', 'require(', 'process.', 'createHash']) {
      assert.equal(source.includes(forbidden), false, `页面函数源码不得包含 ${forbidden}`);
    }
    assert.match(source, /getComputedStyle/);
    assert.match(source, /measureText/);
    assert.match(source, /document\.fonts/);
  });

  it('字体测量源码在无 DOM 的 Node 环境被求值会失败，而不是静默返回假摘要', () => {
    // 页面函数依赖 document；在 Node 里跑必然抛错——这证明它没有被 Node 侧逻辑替代
    assert.throws(() => {
      const measure = new Function(`return (${FONT_MEASUREMENT_SOURCE.toString()})`)();
      measure('.charts-line', [...FONT_PROBE_STRINGS], [...FONT_REFERENCE_FAMILIES]);
    });
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

// RED：`rewritten` 原先在 try 内用 const 声明，而 try 外的 return 要读它——
// C 在 Windows 实跑 56 组合时踩到的第一个阻断：examples/<framework> 本机已被构建过，
// 带着 node_modules/.turbo/dist；原先 cp 不带 filter，把它们复制到工作区外，npm 复用
// pnpm 链接，锁里的 echarts 缺 resolved/integrity，CLI 只能判
// CANDIDATE_INTEGRITY_UNVERIFIED。这一组守住"消费者必须从 tarball 全新安装"。
describe('消费者源目录不得带入本地状态（阻断一）', () => {
  /** 造一个"本机刚构建过"的脏示例目录。 */
  const makeDirtyExample = async (root) => {
    const src = path.join(root, 'src');
    await mkdir(src, { recursive: true });
    await writeFile(path.join(root, 'index.html'), '<html></html>\n');
    await writeFile(path.join(root, 'package.json'), '{"name":"dirty-example"}\n');
    await writeFile(path.join(src, 'main.ts'), 'export const x = 1;\n');
    for (const name of CONSUMER_SOURCE_EXCLUSIONS) {
      await mkdir(path.join(root, name, 'nested'), { recursive: true });
      await writeFile(path.join(root, name, 'marker.txt'), 'local state\n');
    }
    await writeFile(path.join(root, 'tsconfig.tsbuildinfo'), '{}\n');
    await mkdir(path.join(src, 'node_modules'), { recursive: true });
    await writeFile(path.join(src, 'node_modules', 'marker.txt'), 'nested link\n');
    return root;
  };

  it('filter 拒绝全部本地状态名，放过示例源码', () => {
    const filter = consumerSourceFilter();
    for (const name of CONSUMER_SOURCE_EXCLUSIONS) {
      assert.equal(filter(path.join('/x', name)), false, `${name} 必须被排除`);
      assert.equal(filter(path.join('/x', 'src', name)), false, `嵌套的 ${name} 也必须被排除`);
    }
    assert.equal(filter('/x/index.html'), true);
    assert.equal(filter('/x/src'), true);
    assert.equal(filter('/x/src/main.ts'), true);
    assert.equal(filter('/x/package.json'), true);
    assert.equal(filter('/x/tsconfig.json'), true);
    // tsbuildinfo 是增量构建缓存，同样不属于源码
    assert.equal(filter('/x/tsconfig.tsbuildinfo'), false);
  });

  it('真实 cp 带 filter：目标目录干净，且源码一件不少', async (t) => {
    const work = await mkdtemp(path.join(tmpdir(), 'a-t10-dirty-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const source = await makeDirtyExample(path.join(work, 'example'));
    const target = path.join(work, 'consumer');
    await cp(source, target, { recursive: true, force: true, filter: consumerSourceFilter() });
    // 源码必须在
    for (const rel of ['index.html', 'package.json', path.join('src', 'main.ts')]) {
      assert.equal(existsSync(path.join(target, rel)), true, `${rel} 不该被过滤掉`);
    }
    // 本地状态必须不在
    for (const name of CONSUMER_SOURCE_EXCLUSIONS) {
      assert.equal(existsSync(path.join(target, name)), false, `${name} 泄漏进了消费者`);
    }
    assert.equal(existsSync(path.join(target, 'src', 'node_modules')), false, '嵌套 node_modules 泄漏');
    assert.equal(existsSync(path.join(target, 'tsconfig.tsbuildinfo')), false, 'tsbuildinfo 泄漏');
    // 哨兵复核同一棵树，必须报干净
    assert.deepEqual(findDirtySourceEntries(target), []);
  });

  it('哨兵不是空转：不带 filter 复制时它确实能检出', async (t) => {
    const work = await mkdtemp(path.join(tmpdir(), 'a-t10-dirty-2-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const source = await makeDirtyExample(path.join(work, 'example'));
    const target = path.join(work, 'consumer-no-filter');
    await cp(source, target, { recursive: true, force: true });
    const dirty = findDirtySourceEntries(target);
    assert.ok(dirty.length >= CONSUMER_SOURCE_EXCLUSIONS.length + 1, `哨兵应检出脏项，实际 ${dirty}`);
    assert.ok(dirty.includes('node_modules'));
    assert.ok(dirty.includes('.turbo'));
    assert.ok(dirty.includes('dist'));
    // findDirtySourceEntries 返回的是 path.relative 的原生分隔符：Windows 上是
    // `src\node_modules`，POSIX 上是 `src/node_modules`。断言必须用 path.join 拼，
    // 否则在 Windows 上必然失败——这是 C 在 Windows 固定 Node 下单测 114/115 的唯一败例。
    assert.ok(dirty.includes(path.join('src', 'node_modules')), '嵌套项也要检出');
    assert.ok(dirty.includes('tsconfig.tsbuildinfo'));
    // 带上 filter 后同一函数对同一棵树应报干净——RED/GREEN 成对
    const clean = path.join(work, 'consumer-with-filter');
    await cp(source, clean, { recursive: true, force: true, filter: consumerSourceFilter() });
    assert.deepEqual(findDirtySourceEntries(clean), []);
  });
});

// C 在 Windows 实跑 56 组合时踩到的第二、三个阻断：
// ② --font-digest 被浏览器实测无条件覆盖，顶层证据却记 operator-supplied——
//    签名与留痕对不上，等于拿一个没测过的环境出了视觉结论；
// ③ 宿主数 0 或 >1 时 environment 为 null，browser.mjs 调
//    environmentProjection(null) 直接 TypeError，一次截图失败带走整轮运行。
// 两条都抽成纯函数，于是不依赖真实浏览器也能先红后绿。
describe('字体摘要生效值与留痕（阻断二）', () => {
  const MEASURED = 'a'.repeat(64);
  const OPERATOR = 'b'.repeat(64);

  it('没传 --font-digest 时用实测值，来源记 measured', () => {
    const resolved = resolveEffectiveFontDigest({ operator: null, measured: MEASURED });
    assert.equal(resolved.fontDigest, MEASURED);
    assert.equal(resolved.fontDigestSource, 'measured');
    assert.equal(resolved.measuredFontDigest, MEASURED);
    assert.equal(resolved.override, null);
  });

  it('传了 --font-digest 时环境签名用显式值，实测值另行留痕', () => {
    const resolved = resolveEffectiveFontDigest({ operator: OPERATOR, measured: MEASURED });
    // 反例的核心：生效值必须是显式值，不是实测值
    assert.equal(resolved.fontDigest, OPERATOR);
    assert.notEqual(resolved.fontDigest, MEASURED);
    assert.equal(resolved.fontDigestSource, 'operator-supplied');
    // 但实测值不许丢，审核方要能看出两者不一致
    assert.equal(resolved.measuredFontDigest, MEASURED);
    assert.deepEqual(resolved.override, { requested: OPERATOR, measured: MEASURED });
  });

  it('显式值与实测值一致时不算覆盖', () => {
    const resolved = resolveEffectiveFontDigest({ operator: MEASURED, measured: MEASURED });
    assert.equal(resolved.fontDigest, MEASURED);
    assert.equal(resolved.fontDigestSource, 'operator-supplied');
    assert.equal(resolved.override, null);
  });

  it('实测值与显式值都缺时抛错，不拿常量伪造签名', () => {
    assert.throws(() => resolveEffectiveFontDigest({ operator: null, measured: null }), /PROBE_INTERNAL.*无法出具环境签名/s);
    assert.throws(() => resolveEffectiveFontDigest({}), /PROBE_INTERNAL/);
  });

  it('environmentAudit 里生效值、来源、实测值三者都在，且投影可由其重算', () => {
    const environment = {
      os: 'windows', arch: 'x64', browserVersion: '158.0.8127.18', browserRevision: '1254',
      fontDigest: OPERATOR, locale: 'zh-CN', timezone: 'Asia/Shanghai', deviceScaleFactor: 1,
      renderer: 'canvas', width: 800, height: 400, theme: 'light',
      frameworkVersion: '3.5.45', echartsVersion: '6.1.0',
    };
    const audit = environmentAuditFor({
      environment,
      fontDigest: OPERATOR,
      fontDigestSource: 'operator-supplied',
      measuredFontDigest: MEASURED,
      fontFingerprint: {
        fontDigest: MEASURED,
        canonical: '{"families":["Arial"]}',
        details: { stack: ['Arial'], families: ['Arial'], loadedFonts: [] },
      },
    });
    assert.equal(audit.fontDigest, OPERATOR, '审计块里的生效值必须与签名用的一致');
    assert.equal(audit.measuredFontDigest, MEASURED, '实测值必须单独留痕');
    assert.equal(audit.fontDigestSource, 'operator-supplied');
    // 投影与 canonical 必须与 environmentKey 同源，否则审核方重算不出来
    assert.equal(audit.projection.fontDigest, OPERATOR);
    assert.equal(audit.canonical, canonicalJson(environmentProjection(environment)));
    assert.equal(computeEnvironmentKey(audit.projection), computeEnvironmentKey(environment));
  });
});

// C 在 Windows 实跑时踩到的第三个阻断：宿主数不是 1 时 environment 为 null，
// 而 environmentAudit 无条件调 environmentProjection(null) → TypeError。
// 探针不崩在出具证据之前是硬要求：一次截图失败只该让该组合记为运行失败。
describe('没有环境投影时的审计块（阻断三）', () => {
  it('environment 为 null 时返回 null，不抛错', () => {
    const audit = environmentAuditFor({
      environment: null,
      fontDigest: 'c'.repeat(64),
      fontDigestSource: 'measured',
      measuredFontDigest: 'c'.repeat(64),
      fontFingerprint: { fontDigest: 'c'.repeat(64), canonical: '{}' },
    });
    assert.equal(audit, null);
  });

  it('environment 缺省（undefined）时同样返回 null', () => {
    assert.equal(environmentAuditFor({ fontDigest: 'c'.repeat(64), fontDigestSource: 'measured' }), null);
  });

  it('宿主数不为 1 必须被记为运行失败，而不是静默跳过', () => {
    for (const hostCount of [0, 2]) {
      const problems = summariseRuntime({
        hostCount,
        pageErrors: [],
        checks: [],
        presentation: 'light-canvas',
        appliedPresentation: null,
      });
      assert.ok(
        problems.some((problem) => problem.includes(`宿主元素数量=${hostCount}`)),
        `hostCount=${hostCount} 必须进运行时问题`,
      );
    }
  });
});

// 成功路径直接 ReferenceError，且崩在证据出具之前。真实建一次消费者来守。
describe('createConsumer 成功路径', () => {
  it('建出可用的干净消费者，manifest 与 digest 都能取到', async (t) => {
    const bundleRoot = await mkdtemp(path.join(tmpdir(), 'a-t10-cbundle-'));
    t.after(() => rm(bundleRoot, { recursive: true, force: true }));
    await makeSyntheticBundle(bundleRoot);
    const bundle = await readFrozenBundle(bundleRoot);
    const tarballs = Object.fromEntries(bundle.packages.map((entry) => [entry.name, entry.tarballFile]));
    // 消费者根可用 A10_CONSUMER_ROOT 指到空间充足的磁盘；缺省用系统临时目录。
    // 真实安装要落几百 MB，临时分区太小（ENOSPC）时明确 skip，不把环境问题记成代码缺陷。
    const consumerRoot = process.env.A10_CONSUMER_ROOT
      ? path.resolve(process.env.A10_CONSUMER_ROOT, `a-t10-consumer-root-${Date.now()}`)
      : await mkdtemp(path.join(tmpdir(), 'a-t10-consumer-root-'));
    await mkdir(consumerRoot, { recursive: true });
    t.after(() => rm(consumerRoot, { recursive: true, force: true }));
    // 真实 npm install 只装 file: 依赖（三个合成 tarball），不触网
    let consumer;
    try {
      consumer = await createConsumer({
        framework: 'vue',
        exampleDir: path.join(REPO_ROOT, 'examples', 'vue'),
        repoRoot: REPO_ROOT,
        tarballs,
        echartsVersion: '6.1.0',
        consumerRoot,
      });
    } catch (error) {
      if (/ENOSPC|no space left/i.test(String(error?.message ?? error))) {
        return t.skip(
          `临时分区空间不足，无法完成真实安装：${String(error.message).slice(0, 120)}。` +
            '可用 A10_CONSUMER_ROOT 指向空间充足的磁盘后重跑。',
        );
      }
      throw error;
    }
    t.after(() => removeConsumer(consumer).catch(() => {}));
    // 这几个字段任何一个取不到就是 C 报的作用域缺陷
    assert.ok(consumer.manifest, 'manifest 必须可取');
    assert.equal(typeof consumer.digest, 'string');
    assert.match(consumer.digest, /^[0-9a-f]{16}$/);
    assert.equal(consumer.applied, 'strict');
    assert.equal(consumer.installs.length, 1);
    assert.equal(consumer.installs[0].mode, 'strict');
    assert.equal(consumer.installs[0].status, 0, consumer.installs[0].output);
    assert.equal(consumer.resolved['@company/charts-vue'], '0.0.10');
    // staging 命名合规，removeConsumer 才肯删
    assert.match(path.basename(consumer.staging), /^a-t10-staging-/);
    // 清单里不得残留 workspace: 协议
    const manifest = JSON.parse(readFileSync(path.join(consumer.root, 'package.json'), 'utf8'));
    assert.equal(JSON.stringify(manifest).includes('workspace:'), false);
    // 阻断一的端到端断言：echarts 必须是从 registry 真装进来的，锁条目带 resolved +
    // integrity；复用 pnpm 链接时这两项会消失，CLI 就会判 CANDIDATE_INTEGRITY_UNVERIFIED。
    const lock = JSON.parse(readFileSync(path.join(consumer.root, 'package-lock.json'), 'utf8'));
    const echartsEntry = lock.packages['node_modules/echarts'];
    assert.ok(echartsEntry, '锁文件必须有 node_modules/echarts 条目');
    assert.equal(echartsEntry.version, '6.1.0');
    assert.match(String(echartsEntry.resolved ?? ''), /^https:/, 'echarts 必须带 https resolved');
    assert.match(String(echartsEntry.integrity ?? ''), /^sha512-/, 'echarts 必须带 integrity');
    assert.equal(echartsEntry.link, undefined, 'echarts 不得是 link 条目');
    // node_modules 里的 echarts 必须是实体目录，不能是指回仓库的符号链接
    assert.equal(
      lstatSync(path.join(consumer.root, 'node_modules', 'echarts')).isSymbolicLink(),
      false,
      'echarts 不得是符号链接（那是复用 pnpm 留下的痕迹）',
    );
  }, 300_000);

  it('拒绝把消费者建在仓库内', async (t) => {
    const bundleRoot = await mkdtemp(path.join(tmpdir(), 'a-t10-cbundle-2-'));
    t.after(() => rm(bundleRoot, { recursive: true, force: true }));
    await makeSyntheticBundle(bundleRoot);
    const bundle = await readFrozenBundle(bundleRoot);
    const tarballs = Object.fromEntries(bundle.packages.map((entry) => [entry.name, entry.tarballFile]));
    await assert.rejects(
      () =>
        createConsumer({
          framework: 'vue',
          exampleDir: path.join(REPO_ROOT, 'examples', 'vue'),
          repoRoot: REPO_ROOT,
          tarballs,
          echartsVersion: '6.1.0',
          consumerRoot: path.join(REPO_ROOT, 'tmp', 'should-not-happen'),
        }),
      /PROBE_INPUT.*仓库|仓库内部/s,
    );
    // 被拒时不得在仓库里留下任何目录
    assert.equal(existsSync(path.join(REPO_ROOT, 'tmp', 'should-not-happen')), false);
  });

  it('removeConsumer 拒绝删非探针创建的目录', async () => {
    await assert.rejects(() => removeConsumer({ staging: '/tmp' }), /拒绝删除非探针创建的目录/);
  });
});

// C 在双消费者锁文件回退里发现的第四个阻断：字节与摘要都恢复成 6.1.0 了，复检类型却失败——
// 注入生成的 src/a-t10-echarts-registry.ts:9 把 querySelector 返回的 Element 直接喂给
// getInstanceByDom（它要 HTMLElement），Vue TS2345 / React TS2740。
// 根因是 runTypechecks 跑在 injectEchartsRegistry **之前**，生成物从来不进任何一次类型检查。
// 这一组补上那个盲区：真实生成 → 真实 tsc，两种解析口径各跑一遍。
describe('注入的注册表必须自身可类型检查（阻断四）', () => {
  /** 建一个真消费者（合成 bundle + echarts 6.1.0 + typescript），返回其描述。 */
  const buildConsumer = async (t, framework) => {
    const bundleRoot = await mkdtemp(path.join(tmpdir(), 'a-t10-regbundle-'));
    t.after(() => rm(bundleRoot, { recursive: true, force: true }));
    await makeSyntheticBundle(bundleRoot);
    const bundle = await readFrozenBundle(bundleRoot);
    const tarballs = Object.fromEntries(bundle.packages.map((entry) => [entry.name, entry.tarballFile]));
    const consumerRoot = process.env.A10_CONSUMER_ROOT
      ? path.resolve(process.env.A10_CONSUMER_ROOT, `a-t10-reg-root-${Date.now()}`)
      : await mkdtemp(path.join(tmpdir(), 'a-t10-reg-root-'));
    await mkdir(consumerRoot, { recursive: true });
    t.after(() => rm(consumerRoot, { recursive: true, force: true }));
    let consumer;
    try {
      consumer = await createConsumer({
        framework,
        exampleDir: path.join(REPO_ROOT, 'examples', framework),
        repoRoot: REPO_ROOT,
        tarballs,
        echartsVersion: '6.1.0',
        consumerRoot,
      });
    } catch (error) {
      if (/ENOSPC|no space left/i.test(String(error?.message ?? error))) {
        return t.skip(
          `临时分区空间不足，无法完成真实安装：${String(error.message).slice(0, 120)}。` +
            '可用 A10_CONSUMER_ROOT 指向空间充足的磁盘后重跑。',
        );
      }
      throw error;
    }
    t.after(() => removeConsumer(consumer).catch(() => {}));
    return consumer;
  };

  /** 只对生成物本身跑一次 tsc；返回 {status, output}。 */
  const typecheckRegistry = async (consumer, base, resolution) => {
    const config = {
      ...buildProbeTsconfig(base, resolution),
      // 关键：include 只含生成物。真实探针里这个文件从不被 include，
      // 所以它里的类型错误一路漏到复检阶段才炸。
      include: ['src/a-t10-echarts-registry.ts'],
    };
    const configName = `tsconfig.probe-registry-${resolution}.json`;
    await writeFile(path.join(consumer.root, configName), `${JSON.stringify(config, null, 2)}\n`);
    const tool = consumer.framework === 'vue' ? 'vue-tsc' : 'tsc';
    const compilerPackage = tool === 'vue-tsc' ? 'vue-tsc' : 'typescript';
    const manifest = JSON.parse(await readFile(path.join(consumer.root, 'package.json'), 'utf8'));
    assert.ok(manifest.devDependencies?.[compilerPackage], `${consumer.framework}: 编译器 ${compilerPackage} 必须由消费者精确声明`);
    const compilerRoot = path.join(consumer.root, 'node_modules', compilerPackage);
    const compilerManifest = JSON.parse(await readFile(path.join(compilerRoot, 'package.json'), 'utf8'));
    assert.equal(compilerManifest.version, manifest.devDependencies[compilerPackage]);
    const entry = path.resolve(compilerRoot, compilerManifest.bin[tool]);
    assert.ok(existsSync(entry), `${consumer.framework}: 必须使用本地编译器，禁止 npx 隐式安装`);
    return run(
      process.execPath,
      [entry, '--noEmit', '-p', configName],
      consumer.root,
      { production: true },
    );
  };

  it('真实生成后，两个框架 × 两种解析口径都能通过类型检查', async (t) => {
    // C 报的是 Vue TS2345 与 React TS2740：同一处赋值错误，两个工具链给的错误码不同。
    // 生成物本身与框架无关（纯 TS、无 JSX、无 SFC），但两个消费者的 tsc 二进制
    // （vue-tsc / tsc）与 tsconfig 底子不同，因此两边都要真跑一遍才算守住。
    // 先把四个结果都收集齐再断言：谁失败都能在一条信息里看到，不会第一个断言就中断。
    const failures = [];
    for (const framework of ['vue', 'react']) {
      const consumer = await buildConsumer(t, framework);
      if (consumer === undefined) return;
      // 走真实注入函数，不是手抄一份源码
      await injectEchartsRegistry(consumer.root, [framework === 'vue' ? 'main.ts' : 'main.tsx']);
      const registryFile = path.join(consumer.root, 'src', 'a-t10-echarts-registry.ts');
      assert.equal(existsSync(registryFile), true, `${framework}: 注册表必须已生成`);
      const base = JSON.parse(await readFile(path.join(consumer.root, 'tsconfig.json'), 'utf8'));
      for (const resolution of ['Bundler', 'NodeNext']) {
        const result = await typecheckRegistry(consumer, base, resolution);
        if (result.status !== 0) {
          failures.push(`[${framework}/${resolution}]\n${result.output}`);
        }
      }
    }
    assert.equal(failures.length, 0, `生成物类型检查失败：\n${failures.join('\n---\n')}`);
  }, 300_000);

  it('宿主必须是 HTMLElement 才能喂给 getInstanceByDom（反例）', () => {
    const source = echartsRegistrySource();
    // 反例的核心：不能把 Element 直接传给只要 HTMLElement 的 API
    assert.equal(/getInstanceByDom\(host\)/.test(source), true);
    assert.match(
      source,
      /const host = element instanceof HTMLElement \? element : null;/,
      '宿主必须经 instanceof 真实收窄，而不是泛型断言',
    );
    // 生成物里不得再出现"裸 querySelector 的结果直接进 getInstanceByDom"
    assert.equal(
      /const host = document\.querySelector\(hostSelector\);\s*\n\s*const instance = host \? getInstanceByDom\(host\)/.test(source),
      false,
    );
  });
});
