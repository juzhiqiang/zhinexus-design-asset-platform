#!/usr/bin/env node
/**
 * T10 双框架精确版本兼容探针 —— B 可调用的本地入口（A 侧 SDK 交付）。
 *
 * 用法（在仓库根目录执行）：
 *   node tests/acceptance/t10-sdk/probe.mjs --bundle <冻结 bundle 目录> [选项]
 *   node tests/acceptance/t10-sdk/probe.mjs --help
 *
 * 入口只做编排：读冻结 bundle → 从**冻结 tarball** 里加载兼容策略 →
 * 在工作区外建干净消费者（安装同一份 tarball + 候选 ECharts）→ 跑类型 / 构建 /
 * SSR 安全导入 / 真实挂载 / 交互 / 生命周期 / 固定环境截图 → 出具证据 JSON。
 *
 * 边界（与 `AGENTS.md`、`rules/testing-release.md` 一致）：
 * - 不打包、不重新 pack、不改写任何已冻结产物；只读；
 * - 不修改 `package.json` / `pnpm-lock.yaml` / `packages/contracts`；
 * - 不 push、不 merge、不启动共享服务；端口一律用系统临时端口；
 * - 四维结论里的 `not-run` 保持 `not-run`，绝不为了好看写成 `passed`。
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  COMPONENTS,
  DEFAULT_FONT_DIGEST,
  RENDERERS,
  THEMES,
  formatPresentation,
  parsePresentation,
  platformName,
} from './environment.mjs';
import { peerEchartsBaseline, readFrozenBundle, supportedCombinations, variantPackageDigests } from './bundle.mjs';
import { loadFrozenPolicy, readRegistrySnapshot, resolveCandidateSafely } from './policy.mjs';
import {
  PUBLIC_SUBPATHS,
  createConsumer,
  readResolvedVersions,
  removeConsumer,
  runBuild,
  runSsrImport,
  runTypechecks,
  verifyConsumerCandidateSource,
} from './consumer.mjs';
import { baselineScreenshots, compareWithBaseline, injectEchartsRegistry, measureFontFingerprint, readBrowserRevision, runBrowserProbe, summariseInteraction, summariseRuntime } from './browser.mjs';
import {
  buildCombinationRecord,
  collectUncovered,
  requiresVisualBaselineConfirmation,
  summariseDimensions,
  validateDimensions,
} from './evidence.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');
const EVIDENCE_SCHEMA_VERSION = 1;

const USAGE = `T10 双框架精确版本兼容探针

  node tests/acceptance/t10-sdk/probe.mjs --bundle <目录> [选项]

必填：
  --bundle <dir>            冻结 bundle 目录（含 manifest.json 与 packages/*.tgz）。只读。

候选与矩阵：
  --echarts <x.y.z>         候选 ECharts 精确版本。缺省 = 冻结 manifest 的 echarts peer 基线。
  --frameworks <列表>       vue / react / vue,react（缺省两者）
  --components <列表>       ${COMPONENTS.join(',')}（缺省全部）
  --presentations <列表>    ${THEMES.map((t) => RENDERERS.map((r) => `${t}-${r}`).join(',')).join(',')}（缺省全部）
  --registry <url|offline>  官方 registry，缺省 https://registry.npmjs.org/echarts；offline 跳过核对
  --peer <strict|legacy|strict-only>
                            缺省 strict。strict 与 strict-only 在严格 peer 安装被拒时
                            **都直接失败，不会自动放宽**；只有显式 legacy 才用
                            --legacy-peer-deps 重试，以测量「绕过 peer 后能不能用」
                            （不改变 SDK 声明，也不构成通过结论）。

输出与消费者：
  --out <dir>               证据输出目录。缺省 test-results/t10-sdk-probes/<UTC 时间戳>
  --label <name>            证据文件名后缀（probe-evidence-<name>.json），用于分片跑同一批矩阵
  --font-digest <sha256>    显式指定字体摘要（64 位十六进制）。缺省在浏览器里实测；
                            实测不可用而必须出图时，没有可信字体签名会直接失败而非用常量顶替
  --consumer-root <dir>     干净消费者根目录。缺省系统临时目录
  --baseline <file>[,<file>]  上一次探针证据 JSON（可逗号分隔多份，分片跑矩阵后合并比对）
  --keep                    保留消费者目录（调试用）
  --skip-browser            跳过浏览器维度（runtime/interaction/visual 记 not-run）
  --json                    stdout 打印证据 JSON
  --fail-on-hold            recommendation 为 hold 时以退出码 2 结束
  --help
`;

function parseArguments(argv) {
  const options = {
    bundle: null,
    echarts: null,
    frameworks: ['vue', 'react'],
    components: [...COMPONENTS],
    presentations: THEMES.flatMap((theme) => RENDERERS.map((renderer) => `${theme}-${renderer}`)),
    registry: 'https://registry.npmjs.org/echarts',
    peer: 'strict',
    out: null,
    label: null,
    fontDigest: null,
    consumerRoot: null,
    baseline: null,
    keep: false,
    skipBrowser: false,
    json: false,
    failOnHold: false,
  };
  const readList = (value, allowed, label) => {
    const items = String(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    for (const item of items) {
      if (allowed && !allowed.includes(item)) {
        throw new Error(`${label} 含未知值 ${JSON.stringify(item)}；可用：${allowed.join(', ')}`);
      }
    }
    if (items.length === 0) throw new Error(`${label} 不能为空`);
    return items;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      index += 1;
      const value = argv[index];
      if (value === undefined) throw new Error(`选项 ${argument} 缺少取值`);
      return value;
    };
    switch (argument) {
      case '--help':
      case '-h':
        return { help: true };
      case '--bundle':
        options.bundle = next();
        break;
      case '--echarts':
        options.echarts = next();
        break;
      case '--frameworks':
        options.frameworks = readList(next(), ['vue', 'react'], '--frameworks');
        break;
      case '--components':
        options.components = readList(next(), COMPONENTS, '--components');
        break;
      case '--presentations':
        options.presentations = readList(next(), null, '--presentations').map(parsePresentation).map(formatPresentation);
        break;
      case '--registry':
        options.registry = next();
        break;
      case '--peer':
        options.peer = next();
        if (!['strict', 'legacy', 'strict-only'].includes(options.peer)) {
          throw new Error(`--peer 只能是 strict / legacy / strict-only，收到 ${options.peer}`);
        }
        break;
      case '--out':
        options.out = next();
        break;
      case '--font-digest':
        options.fontDigest = parseFontDigestOption(next());
        break;
      case '--label':
        options.label = sanitiseLabel(next());
        break;
      case '--consumer-root':
        options.consumerRoot = next();
        break;
      case '--baseline':
        options.baseline = next();
        break;
      case '--keep':
        options.keep = true;
        break;
      case '--skip-browser':
        options.skipBrowser = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--fail-on-hold':
        options.failOnHold = true;
        break;
      default:
        throw new Error(`未知选项 ${argument}\n\n${USAGE}`);
    }
  }
  if (!options.bundle) throw new Error(`缺少必填选项 --bundle\n\n${USAGE}`);
  return { options };
}

/**
 * 收尾任务栈：成功与失败路径都要跑。
 *
 * 策略解包目录、消费者暂存根都是探针自己建的临时目录。只在成功路径清理的话，
 * 任何一次中途失败都会在临时目录留一份——沙箱的小分区被这么填满过，
 * 于是后面每次运行都 ENOSPC。失败路径同样要收干净。
 */
export const teardown = [];

export async function runTeardown() {
  while (teardown.length > 0) {
    const task = teardown.pop();
    try {
      await task();
    } catch (error) {
      log(`[probe] 收尾清理失败：${String(error?.message ?? error)}`);
    }
  }
}

/** `--baseline` 取值解析：逗号分隔、去空项。空串视为未传。 */
export function parseBaselineOption(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

/**
 * 标签清洗：分片跑同一批矩阵时用标签区分证据文件，标签会进文件名，
 * 因此只允许 `[a-z0-9-]`，且不可能是空串（空则视为未传）。
 */
export function sanitiseLabel(raw) {
  const label = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
  if (label.length === 0) {
    throw new Error('--label 不能为空，且至少包含一个 [a-z0-9-] 字符');
  }
  return label;
}

/** 证据文件名：`<base>[-<label>].<ext>`。 */
export function evidenceName(base, label, extension) {
  return label ? `${base}-${label}.${extension}` : `${base}.${extension}`;
}

/** `--font-digest` 只接受 64 位小写十六进制；空串或非十六进制一律拒绝。 */
export function parseFontDigestOption(value) {
  const digest = String(value ?? '').trim();
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error('--font-digest 必须是 64 位小写十六进制的 SHA-256');
  }
  return digest;
}

/** 字体摘要来源标签，进证据：让人分得清「实测」「操作者指定」「没测」。 */
export function fontDigestSourceLabel(source) {
  if (['measured', 'operator-supplied', 'not-measured'].includes(source)) return source;
  throw new Error(`未知的字体摘要来源：${source}`);
}

/** 候选解析结果标签，进证据：区分显式请求、registry 拒绝与 peer 基线兜底。 */
export function candidateResolutionLabel(requested, resolution) {
  if (requested === null || requested === undefined) return resolution;
  return resolution;
}

/**
 * registry 主机名；`offline` 或无法解析时返回 `null`。
 *
 * 不能直接 `new URL(registry).host`：`--registry offline` 会抛 `Invalid URL`，
 * 于是「离线」这种正当用法变成意外崩溃。离线应当**诚实 hold**（候选来源无从核对），
 * 而不是崩在报告出具之前。
 */
export function registryHostOf(registry) {
  const value = String(registry ?? '').trim();
  if (value.length === 0 || value === 'offline') return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

/**
 * 本机平台陈述：按 `process.platform` 事实生成，不写死某一台机器的经历。
 *
 * 原先硬编码「只在隔离 Linux 工具链上跑过」——C 在 Windows 上跑完，报告里仍写着 Linux。
 * 未覆盖项是承诺，必须可按本机事实核查。
 */
export function nativePlatformNoteFor(hostPlatform) {
  return hostPlatform === 'windows'
    ? '本机即 Windows：本次结论来自 Windows 原生运行，但跨操作系统（Linux / macOS）未复验'
    : `本机为 ${hostPlatform}：本次结论不代表 Windows 原生验收，需在 Windows 上复跑同一条命令`;
}

/**
 * integrity 闸门：候选未经官方源核对时，四维再好看也不判 adopt。
 *
 * 策略层的 `recommend` 只看四维与覆盖，不知道字节来源；这一层补上「没核对就不采用」。
 */
export function applyIntegrityGate(policyRecommendation, integrityVerified) {
  return policyRecommendation === 'adopt' && !integrityVerified ? 'hold' : policyRecommendation;
}

/**
 * 合并多份基线证据：`combinations` 全部保留，截图按 (框架, 组件, 展示组合) 去重。
 *
 * 分片跑矩阵时（一个框架一份、一种展示一份）必须能合并后再比对。去重键**必须是截图
 * 组合，不能是框架**——按框架去重会把同一框架其他展示的基线整份丢掉，于是只有第一份
 * 证据里的展示能比上，其余全被判 `NEW`，「有基线」被误报成「没基线」。
 *
 * 同一组合重复出现且字节或 environmentKey 不同时，保留第一份并记进 `conflicts`：
 * 合并阶段不静默选一个，冲突要让人看见。
 */
export function mergeBaselineEvidence(list) {
  const combinations = [];
  const seen = new Map();
  const conflicts = [];
  for (const evidence of list) {
    for (const combination of evidence?.combinations ?? []) {
      const screenshots = [];
      for (const shot of combination.screenshots ?? []) {
        const key = `${shot.framework}/${shot.component}/${shot.presentation}`;
        const previous = seen.get(key);
        if (previous) {
          if (previous.sha256 !== shot.sha256 || previous.environmentKey !== shot.environmentKey) {
            conflicts.push({
              combination: key,
              kept: { sha256: previous.sha256, environmentKey: previous.environmentKey },
              dropped: { sha256: shot.sha256, environmentKey: shot.environmentKey },
            });
          }
          continue;
        }
        seen.set(key, shot);
        screenshots.push(shot);
      }
      combinations.push({ ...combination, screenshots });
    }
  }
  return { combinations, conflicts };
}

async function main(argv) {
  let parsed;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
  if (parsed.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const options = parsed.options;
  const startedAt = new Date();
  // 记录「怎么跑的」要用真实 argv，不能用目录名：否则复现命令时少一段 probe.mjs。
  const invokedAs =
    process.argv[1] === undefined
      ? path.relative(REPO_ROOT, HERE).replaceAll('\\', '/')
      : path.relative(REPO_ROOT, process.argv[1]).replaceAll('\\', '/');
  const command = [process.execPath, invokedAs, ...argv];

  const bundle = await readFrozenBundle(options.bundle);
  log(`[probe] 冻结 bundle：${bundle.root}（channel=${bundle.channel}，版本 ${bundle.version}）`);
  for (const entry of bundle.packages) {
    log(`[probe]   ${entry.name}@${entry.version} sha256=${entry.sha256.slice(0, 16)}… bytes=${entry.bytes}`);
  }

  const baselineEcharts = peerEchartsBaseline(bundle);
  const requestedEcharts = options.echarts ?? baselineEcharts;
  log(`[probe] ECharts：peer 基线 ${baselineEcharts}，候选 ${requestedEcharts}`);

  const coreTarball = bundle.packages.find((entry) => entry.name === '@company/charts-core').tarballFile;
  // 解包目录跟消费者同一个根：沙箱的 os.tmpdir() 可能只剩几百 MB。
  const policyRoot = options.consumerRoot ? path.resolve(options.consumerRoot) : null;
  const policyBundle = await loadFrozenPolicy({ tarballFile: coreTarball, root: policyRoot });
  const policy = policyBundle.module;
  teardown.push(() => policyBundle.cleanup());

  let registrySnapshot = null;
  let registryUnavailable = false;
  let candidateResolution = 'frozen-peer-baseline';
  let candidate = {
    version: requestedEcharts,
    integrity: null,
    source: 'local-request',
    releaseNotesSource: `https://github.com/apache/echarts/releases/tag/${requestedEcharts}`,
  };
  if (options.registry !== 'offline') {
    try {
      registrySnapshot = await readRegistrySnapshot({ registry: options.registry, version: requestedEcharts });
      const resolved = resolveCandidateSafely(policy, requestedEcharts, registrySnapshot);
      if (resolved.ok) {
        candidate = { ...resolved.candidate };
        candidateResolution = options.echarts ? 'registry-explicit' : 'registry-latest-equals-baseline';
      } else {
        candidateResolution = `registry-rejected:${resolved.reason}`;
        log(`[probe] resolveCandidate 拒绝候选：${resolved.reason} — ${resolved.message}`);
      }
    } catch (error) {
      registryUnavailable = true;
      log(`[probe] registry 不可达（${String(error?.message ?? error)}）；候选按本地请求处理，integrity 未核对`);
    }
  }
  // 候选的 registry 声明侧自检：dist.integrity 必须存在且来自官方源。
  // 这只是**必要条件**——充分条件还要看每个消费者的 package-lock.json（见下面
  // `verifyConsumerCandidateSource`）：官方源怎么声明是一回事，消费者装进来的字节
  // 是不是那些字节是另一回事。
  const candidateDeclaredByRegistry =
    !registryUnavailable &&
    candidateResolution !== 'frozen-peer-baseline' &&
    !candidateResolution.startsWith('registry-rejected') &&
    typeof candidate.integrity === 'string' &&
    candidate.integrity.startsWith('sha512-') &&
    String(candidate.source ?? '').length > 0;
  if (!candidateDeclaredByRegistry) {
    log(
      '[probe] 候选未经 registry 声明（' +
        `${candidateResolution}），按纪律不判 adopt：本次只出具测量报告，不建议采用`,
    );
  }

  const supported = await supportedCombinations(bundle);
  if (supported.length === 0) {
    throw new Error('PROBE_INPUT 冻结 manifest 中没有 status=passed 的 compatibility 记录，无法构成 supported 基线');
  }
  const supportedEcharts = new Set(supported.map((row) => row.echartsVersion));
  if (supportedEcharts.size !== 1) {
    throw new Error(`PROBE_INPUT supported 的 ECharts 基线不一致：${[...supportedEcharts].join(' 与 ')}`);
  }
  log(`[probe] supported 精确组合：${supported.map((row) => `${row.framework}@${row.frameworkVersion}@${row.echartsVersion}`).join(', ')}`);

  const digests = await variantPackageDigests(bundle);

  let baselineEvidence = null;
  const baselinePaths = parseBaselineOption(options.baseline);
  if (baselinePaths.length > 0) {
    // 允许逗号分隔多份：分片跑矩阵时每个框架／每种展示各出一份证据，
    // 合并后才能一次比完全部组合。
    const loaded = [];
    for (const file of baselinePaths) {
      loaded.push(JSON.parse(await readFile(path.resolve(file), 'utf8')));
    }
    baselineEvidence = mergeBaselineEvidence(loaded);
    log(`[probe] 视觉基线：${baselinePaths.length} 份证据，共 ${baselineScreenshots(baselineEvidence).length} 张截图`);
    for (const conflict of baselineEvidence.conflicts) {
      log(
        `[probe] 基线冲突：${conflict.combination} 在两份证据里字节/environmentKey 不同，` +
          `保留第一份（${conflict.kept.sha256?.slice(0, 16)}…），丢弃 ${conflict.dropped.sha256?.slice(0, 16)}…`,
      );
    }
  }

  const outDir = path.resolve(
    options.out ?? path.join(REPO_ROOT, 'test-results', 't10-sdk-probes', startedAt.toISOString().replace(/[:.]/g, '-')),
  );
  await mkdir(outDir, { recursive: true });
  const screenshotDir = path.join(outDir, 'screenshots');

  const tarballs = Object.fromEntries(bundle.packages.map((entry) => [entry.name, entry.tarballFile]));
  const combinations = [];
  const consumers = [];
  const browserInfo = { browserVersion: null, playwright: null, browserRevision: null };
  // 每个消费者对候选来源的核对结果；全部通过才认 integrity 已核实
  const candidateSources = [];
  // 浏览器里实测出的字体指纹（--font-digest 显式指定时为 null）
  let measuredFontDigest = null;
  // 字体指纹：显式指定 > 浏览器实测。都不做且要出截图时，下面的 browser 分支会抛错。
  const fontDigest = options.fontDigest ?? null;
  const fontDigestSource = options.fontDigest ? 'operator-supplied' : options.skipBrowser ? 'not-measured' : 'measured';
  // browserRevision 读一次就够：同一次运行里浏览器不会变
  const browserRevision = options.skipBrowser ? null : readBrowserRevision(import.meta.url);
  if (browserRevision !== null) {
    browserInfo.browserRevision = browserRevision;
    log(`[probe] 浏览器修订号（playwright-core/browsers.json）：${browserRevision}`);
  }

  for (const framework of options.frameworks) {
    const consumer = await createConsumer({
      framework,
      exampleDir: path.join(REPO_ROOT, 'examples', framework),
      repoRoot: REPO_ROOT,
      tarballs,
      echartsVersion: requestedEcharts,
      consumerRoot: options.consumerRoot,
      peer: options.peer,
    });
    consumers.push(consumer);
    // 消费者暂存根也走收尾栈：中途失败（例如 @playwright/test 没装）时同样要删掉，
    // 否则每次失败都在临时目录留一个上百 MB 的 node_modules。
    if (!options.keep) {
      teardown.push(() =>
        removeConsumer(consumer).catch((error) => {
          log(`[probe] 消费者目录清理失败（${consumer.root}）：${String(error?.message ?? error)}`);
        }),
      );
    }
    log(`[probe] 消费者目录 ${consumer.root}（peer=${consumer.applied}）`);
    log(`[probe] 解析到 echarts=${consumer.resolved.echarts} zrender=${consumer.resolved.zrender} vue=${consumer.resolved.vue} react=${consumer.resolved.react}`);

    // 框架版本必须取**消费者里真实解析到的精确版本**，不能取 supported 里的声明值。
    // 原先直接用 supported：万一装到的版本与声明不符，报告会把声明值当真值写上去，
    // 「声称的版本」冒充了「实测的版本」。对不上就拒绝出这一框架的报告。
    const frameworkVersion = framework === 'vue' ? consumer.resolved.vue : consumer.resolved.react;
    const declaredVersion = supported.find((row) => row.framework === framework).frameworkVersion;
    if (!frameworkVersion) {
      throw new Error(
        `PROBE_INPUT 消费者里读不到 ${framework} 的已安装版本，无法出具报告：` +
          '「声称的版本」不算证据。',
      );
    }
    if (frameworkVersion !== declaredVersion) {
      throw new Error(
        `PROBE_INPUT ${framework} 实际安装版本 ${frameworkVersion} 与 supported 声明的 ${declaredVersion} 不一致。` +
          '按纪律不得用声明值冒充实测值，本次不出具该框架的报告。',
      );
    }
    log(`[probe] === ${framework}@${frameworkVersion}（实测） × echarts ${requestedEcharts} ===`);

    // 候选来源核对：读消费者自己的 package-lock.json，核对 echarts 的版本、integrity
    // 与来源主机。只看「版本号相等 + integrity 以 sha512- 开头」证明不了字节来自官方源。
    // registry 离线或地址无法解析时无从核对：记下原因、判未核实，让结论保持 hold，
    // 而不是抛 Invalid URL 崩掉。
    const registryHost = registryHostOf(options.registry);
    if (registryHost === null || !candidateDeclaredByRegistry) {
      const reason =
        registryHost === null
          ? `registry 为 ${options.registry}，无法确定官方源主机，跳过 lock 核对`
          : '候选未经 registry 声明（无 dist.integrity），跳过 lock 核对';
      candidateSources.push({ framework, verified: false, reason });
      log(`[probe] 候选来源核对跳过（${framework}）：${reason}`);
    } else {
      const candidateSource = await verifyConsumerCandidateSource(consumer.root, {
        packageName: 'echarts',
        version: requestedEcharts,
        integrity: candidate.integrity,
        registryHost,
      });
      candidateSources.push({ framework, ...candidateSource });
      if (candidateSource.verified) {
        log(`[probe] 候选来源核对通过：echarts@${candidateSource.entry.version} ← ${candidateSource.entry.resolved}`);
      } else {
        log(`[probe] 候选来源核对未通过（${framework}）：${candidateSource.reason}`);
      }
    }

    const packageName = `@company/charts-${framework}`;
    const typecheckRuns = await runTypechecks(consumer, { packageName, subpaths: PUBLIC_SUBPATHS });
    for (const run of typecheckRuns) {
      log(`[probe] typecheck ${run.tool}/${run.resolution}（${run.scope}）退出码=${run.status}`);
    }

    const buildRun = runBuild(consumer);
    log(`[probe] build 退出码=${buildRun.status}`);

    const ssrRun = await runSsrImport(consumer, { packageName, subpaths: PUBLIC_SUBPATHS });
    log(`[probe] SSR 导入退出码=${ssrRun.status} window=${ssrRun.payload?.windowDefined} document=${ssrRun.payload?.documentDefined}`);

    let browserResult = { runs: [], lifecycle: null };
    if (!options.skipBrowser) {
      let playwrightModule;
      try {
        playwrightModule = await import('@playwright/test');
      } catch (error) {
        // 明确失败而不是静默跳过：浏览器维度不跑就一律 not-run，
        // 但「没装依赖」和「主动 --skip-browser」必须让人分得清。
        throw new Error(
          'PROBE_DEPENDENCY 无法加载 @playwright/test（根 devDependency，1.65.0）。' +
            '请先在仓库根执行 pnpm install；若确实只想跑类型 / 构建 / SSR，请显式传 --skip-browser。' +
            `原始错误：${String(error?.message ?? error)}`,
        );
      }
      const { chromium } = playwrightModule;
      const browser = await chromium.launch();
      try {
        browserInfo.browserVersion = browser.version();
        browserInfo.playwright = playwrightModule.default?.version ?? null;
        const mainEntries = framework === 'vue'
          ? ['main.ts', 'bar-main.ts', 'pie-main.ts', 'scatter-main.ts', 'trend-card-main.ts', 'ranking-main.ts', 'proportion-main.ts', 'keepalive-main.ts']
          : ['main.tsx', 'bar-main.tsx', 'pie-main.tsx', 'scatter-main.tsx', 'trend-card-main.tsx', 'ranking-main.tsx', 'proportion-main.tsx'];
        await injectEchartsRegistry(consumer.root, mainEntries);
        // 注入注册表后必须重新构建，否则跑的是未注入的产物
        const rebuilt = runBuild(consumer);
        if (rebuilt.status !== 0) {
          throw new Error(`PROBE_INTERNAL 注入实例注册表后重新构建失败：\n${rebuilt.output}`);
        }
        const environmentBase = {
          os: platformName(),
          arch: process.arch,
          browserVersion: browser.version(),
          // browserRevision 必须来自 playwright 自己的 browsers.json。原先硬编码 '1000'
          // （契约示例里的占位值），于是签名声称的环境与真实跑的环境不是同一个。
          browserRevision: browserRevision,
          fontDigest: fontDigest ?? DEFAULT_FONT_DIGEST,
          locale: 'zh-CN',
          timezone: 'Asia/Shanghai',
          deviceScaleFactor: 1,
        };
        browserResult = await runBrowserProbe({
          browser,
          consumer,
          framework,
          frameworkVersion,
          echartsVersion: consumer.resolved.echarts ?? requestedEcharts,
          components: options.components,
          presentations: options.presentations.map((literal) => parsePresentation(literal)),
          environmentBase,
          screenshotDir,
        });
        for (const run of browserResult.runs) {
          const problems = summariseRuntime(run);
          run.runtimeProblems = problems;
          run.interactionProblems = summariseInteraction(run, run.component);
        }
        log(`[probe] 浏览器维度：${browserResult.runs.length} 次运行，生命周期=${browserResult.lifecycle?.status}`);
        if (browserResult.fontFingerprint) {
          measuredFontDigest = browserResult.fontFingerprint.fontDigest;
          log(`[probe] 字体指纹（实测）：${measuredFontDigest.slice(0, 16)}…`);
        }
      } finally {
        await browser.close();
      }
    }

    const visualComparisons = browserResult.runs
      .filter((run) => run.screenshot)
      .map((run) => {
        const comparison = compareWithBaseline(
          {
            component: run.component,
            framework,
            presentation: run.presentation,
            sha256: run.screenshot.sha256,
            environmentKey: run.environmentKey,
          },
          baselineEvidence,
        );
        return { component: run.component, presentation: run.presentation, ...comparison };
      });

    const dimensions = summariseDimensions({
      typecheckRuns,
      buildRun,
      ssrRun,
      browserRuns: browserResult.runs,
      lifecycle: browserResult.lifecycle,
      visualComparisons,
      browserSkipped: options.skipBrowser,
    });
    const dimensionProblems = validateDimensions(dimensions.dimensions);
    if (dimensionProblems.length > 0) {
      throw new Error(`PROBE_INTERNAL 维度结论非法：${dimensionProblems.join('; ')}`);
    }
    log(`[probe] 四维：${JSON.stringify(dimensions.dimensions)}`);

    combinations.push(
      buildCombinationRecord({
        framework,
        frameworkVersion,
        baselineEchartsVersion: baselineEcharts,
        echartsVersion: consumer.resolved.echarts ?? requestedEcharts,
        consumer: { ...consumer, kept: options.keep },
        dimensions: dimensions.dimensions,
        failures: dimensions.failures,
        typecheckRuns,
        buildRun,
        ssrRun,
        browserRuns: browserResult.runs,
        lifecycle: browserResult.lifecycle,
        visualComparisons,
      }),
    );
  }

  // 策略层判定：报告由冻结 tarball 里的 recommend() / hasDualFrameworkCoverage() 出具。
  // 报告是**实测结果的忠实转述**（results 来自上面真实跑出来的四维结论），
  // 不调用 verifyCandidate——那个函数接受注入探针，而探针的实测已经在这里跑完了。
  const policySupported = supported.map((row) => ({
    framework: row.framework,
    frameworkVersion: row.frameworkVersion,
    echartsVersion: row.echartsVersion,
  }));
  const reportResults = combinations.map((combination) => ({
    framework: combination.framework,
    frameworkVersion: combination.frameworkVersion,
    echartsVersion: combination.echartsVersion,
    baselineEchartsVersion: combination.baselineEchartsVersion,
    typecheck: combination.dimensions.typecheck,
    runtime: combination.dimensions.runtime,
    interaction: combination.dimensions.interaction,
    visual: combination.dimensions.visual,
    differences: combination.failures.map((failure) => `${failure.dimension}: ${failure.reason}`),
  }));
  const report = {
    candidate,
    peerSatisfied: policy.candidateSatisfiesPeer
      ? policy.candidateSatisfiesPeer(candidate, { echarts: baselineEcharts })
      : null,
    baselineEchartsVersion: baselineEcharts,
    results: reportResults,
    supportedRangeUnchanged: true,
    requiresVisualBaselineConfirmation: combinations.some((combination) =>
      requiresVisualBaselineConfirmation(combination.dimensions, combination.failures),
    ),
  };
  const dualCoverage = policy.hasDualFrameworkCoverage(report, policySupported);
  const policyRecommendation = policy.recommend(report, policySupported);
  // 闸门：候选 integrity 未经官方源核对时，无论四多维好看都判 hold。
  // 策略层的 recommend 只看四维与覆盖，不知道字节来源；这一层补上「没核对就不采用」。
  const candidateIntegrityVerified =
    candidateDeclaredByRegistry &&
    candidateSources.length === options.frameworks.length &&
    candidateSources.every((entry) => entry.verified === true);
  const recommendation = applyIntegrityGate(policyRecommendation, candidateIntegrityVerified);
  if (recommendation !== policyRecommendation) {
    log(`[probe] 策略层建议 ${policyRecommendation}，但候选 integrity 未核对，最终结论改为 ${recommendation}`);
  }

  const visualNotRunReasons = [];
  const lifecycleNotRunReasons = [];
  for (const combination of combinations) {
    for (const comparison of combination.evidence.visual) {
      if (comparison.result !== 'PASS' && comparison.result !== 'DIFF') {
        visualNotRunReasons.push(`${combination.framework} ${comparison.component}/${comparison.presentation}: ${comparison.result} — ${comparison.reason ?? ''}`);
      }
    }
    if (combination.evidence.lifecycle && combination.evidence.lifecycle.status === 'not-run') {
      lifecycleNotRunReasons.push(`${combination.framework}: ${combination.evidence.lifecycle.reason ?? '未运行'}`);
    }
  }

  // 未覆盖项按**本机事实**生成。原先硬编码一句「只在隔离 Linux 工具链上跑过」，
  // 于是 C 在 Windows 上跑完，报告里仍写着 Linux——未覆盖项必须是可核查的陈述。
  const hostPlatform = platformName();
  const nativePlatformNote = nativePlatformNoteFor(hostPlatform);

  const uncoveredResult = collectUncovered({
    browserSkipped: options.skipBrowser,
    visualNotRunReasons,
    lifecycleNotRunReasons,
    registryUnavailable,
    candidateNotRegistryVerified: !candidateIntegrityVerified,
    // 本地真没跑的项才进门禁。跨平台复验是范围声明而非本地检查失败：
    // 本机跑齐了就是跑齐了，把它塞进 uncovered 会让每一台机器都永远 hold。
    uncoveredExtra: [],
    // 范围说明单独放：B 的 verify 只把 uncovered 当门禁，范围声明不该让结论无端 hold
    scopeNotes: [
      nativePlatformNote,
      'peer 范围未改动：探针只出具报告，不修改任何 package.json 的 peerDependencies',
      'compatibility_records 落库需要 Verdaccio / PostgreSQL / MinIO 与 OIDC，不在本次本地范围内',
      ...(fontDigestSource === 'operator-supplied'
        ? ['字体摘要由 --font-digest 显式指定，非本机实测：视觉结论的可信度取决于该值的来源']
        : []),
      ...(fontDigestSource === 'not-measured'
        ? ['未测量字体指纹（--skip-browser）：未产出截图，视觉维度无结论']
        : []),
      ...(options.peer === 'legacy'
        ? ['使用 --peer legacy 放宽安装：peer 不符合已被记录，本次仅为测量，不构成通过结论，也未改变任何 peerDependencies']
        : []),
    ],
  });
  const { uncovered, scopeNotes } = uncoveredResult;

  const evidence = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: 'a-t10-sdk-probe',
    generatedAt: startedAt.toISOString(),
    probe: {
      entry: path.relative(REPO_ROOT, HERE).replaceAll('\\', '/'),
      repoRoot: REPO_ROOT,
      command,
      node: process.version,
      npm: process.env.npm_config_user_agent ?? null,
      platform: platformName(),
      arch: process.arch,
      hostIsWindows: process.platform === 'win32',
      browserVersion: browserInfo.browserVersion,
      browserRevision: browserInfo.browserRevision,
      playwright: browserInfo.playwright,
      fontDigestSource,
      fontDigest: options.fontDigest ?? measuredFontDigest,
    },
    bundle: {
      root: bundle.root,
      schemaVersion: bundle.schemaVersion,
      channel: bundle.channel,
      version: bundle.version,
      packages: bundle.packages.map((entry) => ({
        name: entry.name,
        version: entry.version,
        tarballPath: entry.tarballPath,
        sha256: entry.sha256,
        bytes: entry.bytes,
        sourceDigest: entry.sourceDigest,
        peerDependencies: entry.peerDependencies,
        dependencies: entry.dependencies,
      })),
      variants: [...digests.entries()].map(([variantId, digest]) => ({ variantId, ...digest })),
    },
    candidate: {
      ...candidate,
      resolution: candidateResolution,
      integrityVerified: candidateIntegrityVerified,
      declaredByRegistry: candidateDeclaredByRegistry,
      consumerSources: candidateSources.map((entry) => ({
        framework: entry.framework,
        verified: entry.verified,
        reason: entry.reason ?? null,
        resolved: entry.entry?.resolved ?? null,
        version: entry.entry?.version ?? null,
      })),
    },
    requestedEchartsVersion: requestedEcharts,
    baselineEchartsVersion: baselineEcharts,
    supported: supported,
    combinations,
    policy: {
      peerSatisfied: report.peerSatisfied,
      supportedRangeUnchanged: true,
      requiresVisualBaselineConfirmation: report.requiresVisualBaselineConfirmation,
      hasDualFrameworkCoverage: dualCoverage,
      // 策略层的原始建议与最终结论分开记：被 integrity 闸门改过就必须看得见
      policyRecommendation: policyRecommendation,
      recommendationOverriddenBy: recommendation === policyRecommendation ? null : 'candidate-integrity-unverified',
      candidateIntegrityVerified,
      fontDigestSource,
    },
    recommendation,
    uncovered,
    scopeNotes,
  };

  const evidenceFile = path.join(outDir, evidenceName('probe-evidence', options.label, 'json'));
  await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
  const summaryFile = path.join(outDir, evidenceName('summary', options.label, 'md'));
  await writeFile(summaryFile, renderSummary(evidence));

  if (!options.keep) {
    for (const consumer of consumers) {
      await removeConsumer(consumer).catch((error) => {
        log(`[probe] 消费者目录清理失败（${consumer.root}）：${String(error?.message ?? error)}`);
      });
    }
  }
  await runTeardown();

  log(`[probe] 证据：${evidenceFile}`);
  log(`[probe] 摘要：${summaryFile}`);
  log(`[probe] recommendation=${recommendation} dualFrameworkCoverage=${dualCoverage} peerSatisfied=${report.peerSatisfied}`);
  if (options.json) process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (options.failOnHold && recommendation === 'hold') return 2;
  return 0;
}

function renderSummary(evidence) {
  const lines = [];
  lines.push('# T10 探针运行摘要');
  lines.push('');
  lines.push(`- 生成时间：${evidence.generatedAt}`);
  lines.push(`- 冻结 bundle：${evidence.bundle.version}（channel ${evidence.bundle.channel}）`);
  lines.push(`- 候选 ECharts：${evidence.candidate.version}（${evidence.candidate.resolution}）`);
  lines.push(`- 基线 ECharts：${evidence.baselineEchartsVersion}`);
  lines.push(`- 平台：${evidence.probe.platform}/${evidence.probe.arch}，Node ${evidence.probe.node}，Chromium ${evidence.probe.browserVersion ?? 'n/a'}`);
  lines.push(`- 结论：recommendation=${evidence.recommendation}`);
  lines.push('');
  lines.push('| 实现 | 框架版本 | ECharts | typecheck | runtime | interaction | visual |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const combination of evidence.combinations) {
    lines.push(
      `| ${combination.framework} | ${combination.frameworkVersion} | ${combination.echartsVersion} | ${combination.dimensions.typecheck} | ${combination.dimensions.runtime} | ${combination.dimensions.interaction} | ${combination.dimensions.visual} |`,
    );
  }
  lines.push('');
  lines.push('## 失败与未运行原因');
  for (const combination of evidence.combinations) {
    if (combination.failures.length === 0) continue;
    lines.push(`### ${combination.framework}`);
    for (const failure of combination.failures) {
      lines.push(`- [${failure.dimension}] ${failure.reason}${failure.detail ? ` — ${failure.detail}` : ''}`);
    }
  }
  lines.push('');
  lines.push('## 未覆盖项（本地必需检查门禁，任一未跑即 hold）');
  for (const item of evidence.uncovered) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## 范围说明（不参与门禁）');
  for (const item of evidence.scopeNotes ?? []) lines.push(`- ${item}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

// 入口守卫：被 import（单测）时不执行，只有作为脚本直接运行时才跑探针。
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch(async (error) => {
      // 失败也要收尾：临时目录不清理，下一次运行可能直接 ENOSPC。
      await runTeardown();
      process.stderr.write(`PROBE_FAILED ${String(error?.stack ?? error)}\n`);
      process.exitCode = 1;
    });
}
