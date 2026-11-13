/**
 * ECharts 升级候选的精确兼容策略（T10，A 侧 SDK 交付）。
 *
 * 边界：本模块只**生成报告**，从不修改支持范围、从不写 `package.json`、从不发布。
 * CLI（B 侧 `component echarts verify`）负责从官方源抓取 registry 快照并调用这里，
 * 因此网络与文件系统都留在 CLI，SDK 内只剩可单测的纯策略。
 *
 * 三条不可绕过的纪律，全部由下面的类型与函数强制：
 * 1. **候选失败不扩大 peer 范围**：`verifyCandidate` 返回的报告里
 *    `supportedRangeUnchanged` 恒为 `true`，且不提供任何「建议扩范围」字段；
 *    是否扩大范围是人在审阅报告后的显式决定。
 * 2. **预发布不当候选**：`latest` 指向预发布，或显式请求预发布版本，一律拒绝。
 * 3. **共享核心变化必须双框架齐验**：少任何一个已支持框架的实测结果，
 *    报告不得建议采纳（`recommend` 返回 `'hold'`）。
 */

/** 候选来源标识：官方源地址或本地代理地址，用于报告留痕。 */
export type CandidateSource = string;

/** registry 快照：由调用方（CLI）抓取后传入，SDK 自己不发起网络请求。 */
export type RegistrySnapshot = {
  /** 来源地址，例如 `https://registry.npmjs.org/echarts` 或本地 Verdaccio。 */
  source: CandidateSource;
  /** dist-tag `latest` 解析到的版本号。 */
  latest: string;
  /** 精确版本 → 该版本的 dist 元数据。 */
  versions: Record<string, { integrity: string; releaseNotes?: string }>;
};

/** 候选输入：`'latest'` 或一个精确版本字面量。 */
export type CandidateInput = 'latest' | string;

export type EChartsCandidate = {
  /** 精确版本 `x.y.z`。 */
  version: string;
  /** registry dist.integrity（`sha512-...`），缺失即拒绝。 */
  integrity: string;
  /** 发布说明来源：上游 release 页，与包来源解耦，便于区分官方源与代理。 */
  releaseNotesSource: string;
  /** 包来源：官方源或本地代理。 */
  source: CandidateSource;
};

export type CandidateRejectionReason =
  | 'not-exact-version'
  | 'prerelease'
  | 'unknown-version'
  | 'missing-integrity';

/** 候选被拒绝。`reason` 供调用方分流处理，不靠解析消息文本。 */
export class CandidateError extends Error {
  readonly reason: CandidateRejectionReason;

  constructor(reason: CandidateRejectionReason, message: string) {
    super(message);
    this.name = 'CandidateError';
    this.reason = reason;
  }
}

/**
 * 双框架标识。与 `@company/contracts` 的 `Framework` 同构，但 `charts-core` 是公开包，
 * 按架构约束不得依赖私有 `@company/contracts`，因此在这里本地定义；
 * 两边取值集合必须保持一致，变更时同步。
 */
export type CompatibilityFramework = 'vue' | 'react';

/** 一个已支持（已实测通过）的精确组合。 */
export type SupportedCombination = {
  framework: CompatibilityFramework;
  frameworkVersion: string;
  echartsVersion: string;
};

/** 单个维度的实测结论。`not-run` 不是通过，不得计入建议采纳。 */
export type DimensionOutcome = 'passed' | 'failed' | 'not-run';

export type CombinationDimensions = {
  typecheck: DimensionOutcome;
  runtime: DimensionOutcome;
  interaction: DimensionOutcome;
  visual: DimensionOutcome;
  /** 与基线的差异描述；视觉差异必须留原文，供人工基线确认。 */
  differences: string[];
};

/** 单个组合的探针：由调用方注入（CLI 跑真实构建/渲染），SDK 不执行任何构建。 */
export type CombinationProbe = (
  combination: SupportedCombination,
) => Promise<CombinationDimensions>;

export type CombinationResult = SupportedCombination & CombinationDimensions;

export type CompatibilityReport = {
  candidate: EChartsCandidate;
  /** 候选是否落在当前已锁定的 peer 精确版本上。 */
  peerSatisfied: boolean;
  /** 当前已支持的基线 ECharts 版本（取自 `supported` 首项）。 */
  baselineEchartsVersion: string;
  results: CombinationResult[];
  /**
   * 恒为 `true`：本模块只生成报告。扩大支持范围必须由人显式修改
   * `peerDependencies` 并重新走完整验证，不存在「报告自动扩范围」的路径。
   */
  supportedRangeUnchanged: true;
  /** 视觉维度有失败或差异时为 `true`：必须人工确认基线，不得自动判过。 */
  requiresVisualBaselineConfirmation: boolean;
};

export type Recommendation = 'adopt' | 'hold';

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const PRERELEASE = /^\d+\.\d+\.\d+-.+$/;

/** 精确版本字面量：只认 `x.y.z`，范围、通配、`latest`、缺段一律不接受。 */
export function isExactVersion(input: string): boolean {
  return EXACT_VERSION.test(input);
}

/** 预发布标识（`6.2.0-rc.1`）；构建元数据（`+build`）不算预发布。 */
export function isPrerelease(version: string): boolean {
  return PRERELEASE.test(version);
}

/**
 * 版本比较：按数值段逐段比较，预发布排在同版本正式版之前。
 * 不能用字符串比较——`'10.0.0' < '9.0.0'` 会得到相反结论。
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let index = 0; index < 3; index += 1) {
    if (left.numbers[index] !== right.numbers[index]) {
      return left.numbers[index]! < right.numbers[index]! ? -1 : 1;
    }
  }
  if (left.prerelease === right.prerelease) {
    return 0;
  }
  // 无预发布标识者排在后（即更「新」）
  if (left.prerelease === '') {
    return 1;
  }
  if (right.prerelease === '') {
    return -1;
  }
  return left.prerelease < right.prerelease ? -1 : 1;
}

function parseVersion(version: string): { numbers: number[]; prerelease: string } {
  const [core, ...rest] = version.split('-');
  const numbers = (core ?? '0').split('.').map((part) => Number.parseInt(part, 10));
  while (numbers.length < 3) {
    numbers.push(0);
  }
  return { numbers, prerelease: rest.join('-') };
}

/**
 * 解析升级候选。
 *
 * 拒绝路径全部显式：非精确字面量、预发布、官方源里不存在、缺完整性摘要。
 * 特别地，`latest` 命中预发布时**不会**回退到上一个稳定版——那会让报告里的
 * 版本与实际验证的版本不一致。
 */
export function resolveCandidate(input: CandidateInput, registry: RegistrySnapshot): EChartsCandidate {
  const version = input === 'latest' ? registry.latest : input;
  // 先判预发布：`6.2.0-rc.1` 是合法 semver，只是不能作为升级候选，
  // 必须先给出「预发布」而不是「不是精确版本」这个误导性原因。
  if (isPrerelease(version)) {
    throw new CandidateError(
      'prerelease',
      `预发布版本不能作为升级候选：${version}。请改用已发布的稳定版。`,
    );
  }
  if (!isExactVersion(version)) {
    throw new CandidateError(
      'not-exact-version',
      `候选版本必须是精确 x.y.z：收到 ${JSON.stringify(input)}（latest 解析为 ${registry.latest}）`,
    );
  }
  const meta = registry.versions[version];
  if (!meta) {
    throw new CandidateError(
      'unknown-version',
      `${registry.source} 中不存在版本 ${version}；拒绝静默回退到 ${registry.latest}`,
    );
  }
  if (!meta.integrity) {
    throw new CandidateError('missing-integrity', `版本 ${version} 缺少 dist.integrity，无法冻结产物`);
  }
  return {
    version,
    integrity: meta.integrity,
    releaseNotesSource: meta.releaseNotes ?? `https://github.com/apache/echarts/releases/tag/${version}`,
    source: registry.source,
  };
}

/**
 * 候选是否落在当前声明的 peer 范围上。
 *
 * 本仓库 `strictPeerDependencies: true` 且 `saveExact: true`，peerDependencies
 * 锁定精确版本，因此符合性即版本相等。**候选低于或高于基线都不算符合**：
 * 低于说明是回退，高于说明是未验证的新版本，两者都要走完整矩阵后才由人显式改范围。
 * 若将来改为范围声明，必须同步扩展本函数并补测试，不得静默放宽。
 */
export function candidateSatisfiesPeer(
  candidate: EChartsCandidate,
  peer: { echarts: string },
): boolean {
  return compareVersions(candidate.version, peer.echarts) === 0;
}

/** 双框架覆盖是否完整：`supported` 里出现的每个框架都要有非 `not-run` 的实测结果。 */
export function hasDualFrameworkCoverage(
  report: CompatibilityReport,
  supported: readonly SupportedCombination[],
): boolean {
  const required = new Set(supported.map((combination) => combination.framework));
  for (const framework of required) {
    const runs = report.results.filter((result) => result.framework === framework);
    const measured = runs.filter((result) =>
      [result.typecheck, result.runtime, result.interaction, result.visual].every(
        (dimension) => dimension !== 'not-run',
      ),
    );
    if (measured.length === 0) {
      return false;
    }
  }
  return required.size > 0;
}

/**
 * 生成兼容报告。
 *
 * `supported` 提供当前已实测通过的精确组合（基线），`probe` 对每个组合跑真实验证。
 * 报告不含任何「建议的新支持范围」字段——扩大范围是人在审阅后的显式动作。
 */
export async function verifyCandidate(
  candidate: EChartsCandidate,
  supported: readonly SupportedCombination[],
  probe: CombinationProbe,
): Promise<CompatibilityReport> {
  if (supported.length === 0) {
    throw new Error('verifyCandidate 需要至少一个已支持组合作为基线');
  }
  const results: CombinationResult[] = [];
  for (const combination of supported) {
    results.push({ ...combination, ...(await probe(combination)) });
  }
  const baselineEchartsVersion = supported[0]!.echartsVersion;
  return {
    candidate,
    peerSatisfied: candidateSatisfiesPeer(candidate, { echarts: baselineEchartsVersion }),
    baselineEchartsVersion,
    results,
    supportedRangeUnchanged: true,
    requiresVisualBaselineConfirmation: results.some(
      (result) => result.visual !== 'passed' || result.differences.length > 0,
    ),
  };
}

/**
 * 由报告得出建议：只有「peer 符合 + 双框架齐验 + 四个维度全过 + 无差异」才建议采纳，
 * 其余一律 `'hold'`。`'hold'` 不意味着候选不可用，只意味着**不自动改支持范围**。
 */
export function recommend(
  report: CompatibilityReport,
  supported: readonly SupportedCombination[],
): Recommendation {
  if (!report.peerSatisfied) {
    return 'hold';
  }
  if (!hasDualFrameworkCoverage(report, supported)) {
    return 'hold';
  }
  const allPassed = report.results.every((result) =>
    [result.typecheck, result.runtime, result.interaction, result.visual].every(
      (dimension) => dimension === 'passed',
    ),
  );
  return allPassed && report.results.every((result) => result.differences.length === 0)
    ? 'adopt'
    : 'hold';
}

/** 探针默认维度：未运行。便于调用方只覆盖自己跑过的维度。 */
export function notRunDimensions(): CombinationDimensions {
  return {
    typecheck: 'not-run',
    runtime: 'not-run',
    interaction: 'not-run',
    visual: 'not-run',
    differences: [],
  };
}

/** 渲染器与主题仅用于报告引用，不参与兼容判定。 */
export type PresentationContext = { renderer: 'canvas' | 'svg'; theme: 'light' | 'dark' };
