/**
 * T17 矩阵 spec / report / evidence 编排壳。
 *
 * 该模块只组装“要传递什么给产品边界”，不实现产品本身（产品由 A/实际 Antigravity 交付）：
 * - 指定 CLI / MCP 调用顺序与参数；
 * - 用 @company/contracts 校验 verify/repair/apply 结构，逐字段核对证据摘要；
 * - 用 run-seal 封存独立收集的证据，把评分器与真实执行解耦。
 *
 * 真实执行需要 C 提供冻结包与合成工程环境；未提供时记录为 blocked，不产生通过结论。
 */
import type {
  ComponentApiV1,
  IntegrationApplyResultV1,
  IntegrationPlanV1,
  MatchPlanV1,
  PackageRef,
  ReleaseManifestV1,
} from '@company/contracts';
import {
  validateIntegrationApplyResult,
  validateIntegrationPlan,
  validateIntegrationRepairResult,
  validateIntegrationVerificationReport,
  validateIntegrationVerificationSpec,
  validateComponentApi,
  validateMatchPlan,
} from '@company/contracts';
import { createHash } from 'node:crypto';
import type { MatrixEnv } from './env.js';
import { canonicalJson } from './support.js';
import type { MatrixVariant } from './platform.js';

/**
 * C 冻结契约（packages/contracts/src/integration-*.ts）。
 * 本矩阵只做结构校验与摘要核对；真实执行仍由产品边界完成。
 */
type IntegrationIdentityV1 = { schemaVersion: 1; projectRoot: string; planDigest: string; applyResultDigest: string };
type IntegrationCommandV1 = { kind: 'type' | 'build'; script: string; manifestPath: string; manifestSha256: string; timeoutMs: number; outputDirectories: string[] };
type IntegrationSpecV1 = IntegrationIdentityV1 & { commands: IntegrationCommandV1[]; browser?: Record<string, unknown>; businessGaps: string[] };
type IntegrationReportV1 = IntegrationIdentityV1 & { operation: string; status: string; checks: { id: string; category: string; status: string; issues: unknown[]; evidence: unknown[] }[]; changedFiles: string[]; installedVersions: { name: string; version: string; manifestSha256: string }[]; visualResult: string; environment?: Record<string, unknown>; artifacts: unknown[]; pendingItems: unknown[] };
type IntegrationRepairResultV1 = IntegrationIdentityV1 & { operation: string; status: string; attempts: unknown[]; stopReason: string; finalReport: IntegrationReportV1; changedFiles: string[]; pendingItems: unknown[] };

export type FrozenPackages = { core: PackageRef; framework: PackageRef; cli: PackageRef };

export const FROZEN_TSCONFIG = {
  vue: { typescript: '6.0.3', vueTsc: '3.3.14' },
  react: { typescript: '7.0.2' },
} as const;

export function digestOf(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export type CheckedBundle = { manifest: ReleaseManifestV1; packages: PackageRef[]; apis: Map<string, ComponentApiV1>; manifestSha256: string };

export function checkedFrozenBundle(manifest: ReleaseManifestV1, apis: Map<string, ComponentApiV1>, manifestSha256: string): CheckedBundle {
  if (manifest.schemaVersion !== 1) throw new Error('bundle.schemaVersion');
  for (const api of apis.values()) {
    const checked = validateComponentApi(api);
    if (!checked.ok) throw new Error('component-api');
  }
  return { manifest, packages: manifest.packages, apis, manifestSha256 };
}

export type SpecDraft = {
  browser?: Record<string, unknown>;
  businessGaps: readonly string[];
  commands: IntegrationCommandV1[];
};

/** 由矩阵预声明构造验证 spec；identity 由 CLI 在可信边界重新派生。 */
export function buildSpec(input: {
  projectRoot: string; planDigest: string; applyResultDigest: string;
  commands: IntegrationCommandV1[];
  browser?: Record<string, unknown>;
  businessGaps: readonly string[];
}): IntegrationSpecV1 {
  const spec: IntegrationSpecV1 = {
    schemaVersion: 1,
    projectRoot: input.projectRoot,
    planDigest: input.planDigest,
    applyResultDigest: input.applyResultDigest,
    commands: input.commands,
    businessGaps: [...input.businessGaps],
    ...(input.browser ? { browser: input.browser } : {}),
  };
  return spec;
}

export type StructuralResults = {
  plan?: IntegrationPlanV1 | null;
  applyResult?: IntegrationApplyResultV1 | null;
  spec?: IntegrationSpecV1 | null;
  report?: IntegrationReportV1 | null;
  repair?: IntegrationRepairResultV1 | null;
  matchPlan?: MatchPlanV1 | null;
};

/** 对 CLI/MCP 产物逐个做结构字段校验；缺字段或类型非法直接抛错（不跳过、不静默）。 */
export function checkStructural(result: {
  plan?: unknown; applyResult?: unknown; spec?: unknown; report?: unknown; repair?: unknown; matchPlan?: unknown;
}): StructuralResults {
  const output: StructuralResults = {};
  const requireIdentity = (value: Record<string, unknown>, label: string): IntegrationIdentityV1 => {
    if (value.schemaVersion !== 1) throw new Error(label + ': schemaVersion 必须为 1');
    if (typeof value.projectRoot !== 'string' || !value.projectRoot) throw new Error(label + ': projectRoot 缺失');
    if (typeof value.planDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.planDigest)) throw new Error(label + ': planDigest 非法');
    if (typeof value.applyResultDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.applyResultDigest)) throw new Error(label + ': applyResultDigest 非法');
    return { schemaVersion: 1, projectRoot: value.projectRoot, planDigest: value.planDigest, applyResultDigest: value.applyResultDigest };
  };
  const requireDigests = (value: Record<string, unknown>, label: string): string[] => {
    if (!Array.isArray(value.changedFiles)) throw new Error(label + ': changedFiles 缺失');
    return value.changedFiles as string[];
  };
  const requireInstalled = (value: Record<string, unknown>, label: string): { name: string; version: string; manifestSha256: string }[] => {
    const installed = value.installedVersions;
    if (!Array.isArray(installed)) throw new Error(label + ': installedVersions 缺失');
    return installed as { name: string; version: string; manifestSha256: string }[];
  };
  if (result.plan !== undefined && result.plan !== null) {
    const checked = validateIntegrationPlan(result.plan);
    if (!checked.ok) throw new Error('plan: 契约校验失败');
    output.plan = checked.value;
  }
  if (result.applyResult !== undefined && result.applyResult !== null) {
    const checked = validateIntegrationApplyResult(result.applyResult);
    if (!checked.ok) throw new Error('apply-result: 契约校验失败');
    output.applyResult = checked.value;
  }
  if (result.spec !== undefined && result.spec !== null) {
    const checked = validateIntegrationVerificationSpec(result.spec);
    if (!checked.ok) throw new Error('spec: 契约校验失败');
    const spec = checked.value as unknown as Record<string, unknown>;
    requireIdentity(spec, 'spec');
    if (!Array.isArray(spec.commands)) throw new Error('spec: commands 缺失');
    if (!Array.isArray(spec.businessGaps)) throw new Error('spec: businessGaps 缺失');
    output.spec = spec as unknown as IntegrationSpecV1;
  }
  if (result.report !== undefined && result.report !== null) {
    const checked = validateIntegrationVerificationReport(result.report);
    if (!checked.ok) throw new Error('report: 契约校验失败');
    const report = checked.value as unknown as Record<string, unknown>;
    requireIdentity(report, 'report');
    requireDigests(report, 'report');
    requireInstalled(report, 'report');
    if (!Array.isArray(report.checks)) throw new Error('report: checks 缺失');
    if (typeof report.visualResult !== 'string') throw new Error('report: visualResult 缺失');
    if (typeof report.status !== 'string') throw new Error('report: status 缺失');
    if (!Array.isArray(report.pendingItems)) throw new Error('report: pendingItems 缺失');
    if (!Array.isArray(report.artifacts)) throw new Error('report: artifacts 缺失');
    if (report.snapshots === undefined) throw new Error('report: snapshots 缺失');
    if (report.operation !== 'verify') throw new Error('report: operation 必须是 verify');
    output.report = report as unknown as IntegrationReportV1;
  }
  if (result.repair !== undefined && result.repair !== null) {
    const checked = validateIntegrationRepairResult(result.repair);
    if (!checked.ok) throw new Error('repair: 契约校验失败');
    const repair = checked.value as unknown as Record<string, unknown>;
    requireIdentity(repair, 'repair');
    requireDigests(repair, 'repair');
    if (!Array.isArray(repair.attempts)) throw new Error('repair: attempts 缺失');
    if (typeof repair.stopReason !== 'string') throw new Error('repair: stopReason 缺失');
    if (repair.finalReport === undefined) throw new Error('repair: finalReport 缺失');
    if (repair.operation !== 'repair') throw new Error('repair: operation 必须是 repair');
    const final = repair.finalReport as Record<string, unknown>;
    requireIdentity(final, 'repair/finalReport');
    output.repair = repair as unknown as IntegrationRepairResultV1;
  }
  if (result.matchPlan !== undefined && result.matchPlan !== null) {
    const checked = validateMatchPlan(result.matchPlan);
    if (!checked.ok) throw new Error('match-plan: 契约校验失败');
    const match = checked.value as unknown as Record<string, unknown>;
    if (match.schemaVersion !== 1) throw new Error('match-plan: schemaVersion 必须为 1');
    if (!Array.isArray(match.elements)) throw new Error('match-plan: elements 缺失');
    if (!Array.isArray(match.exactDependencies)) throw new Error('match-plan: exactDependencies 缺失');
    if (match.context === undefined) throw new Error('match-plan: context 缺失');
    output.matchPlan = match as unknown as MatchPlanV1;
  }
  return output;
}

export type EvidenceLedgerEntry = {
  caseId: string;
  kind: 'positive' | 'refusal';
  command: string;
  exitCode: number;
  byteDigests: { label: string; sha256: string; bytes: number }[];
};

export class EvidenceLedger {
  private readonly entries: EvidenceLedgerEntry[] = [];

  add(entry: EvidenceLedgerEntry): void {
    for (const digest of entry.byteDigests) {
      if (!/^[a-f0-9]{64}$/.test(digest.sha256)) throw new Error('ledger digest: ' + digest.label);
    }
    this.entries.push(entry);
  }

  list(): readonly EvidenceLedgerEntry[] {
    return this.entries;
  }

  digest(): string {
    return createHash('sha256').update(canonicalJson(this.entries)).digest('hex');
  }
}

export function variantIdOf(env: MatrixEnv, variants: readonly MatrixVariant[], componentId: string, framework: 'vue' | 'react'): string {
  void env;
  const match = variants.find((variant) => variant.componentId === componentId && variant.framework === framework);
  if (!match) throw new Error('missing-variant: ' + componentId + '/' + framework);
  return match.variantReleaseId;
}

/** MCP 工具名矩阵（C 冻结的四工具）。 */
export const MCP_TOOL_NAMES = ['inspect_project', 'plan_integration', 'apply_integration', 'verify_integration'] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export type McpToolCall = {
  tool: McpToolName;
  /** JSON-RPC 2.0 arguments；产品边界会重新派生所有身份/授权字段。 */
  arguments: Record<string, unknown>;
};

/** requests/list 的预期结果：恰好四个既定工具、无第五个 repair 工具。 */
export function expectedMcpToolNames(): readonly string[] {
  return MCP_TOOL_NAMES;
}

export function isApprovedMcpTool(name: string): name is McpToolName {
  return (MCP_TOOL_NAMES as readonly string[]).includes(name);
}

export const MATRIX_APPROVED_SCRIPTS = ['typecheck', 'build'] as const;

export function approvedScriptName(name: string): string {
  if (!(MATRIX_APPROVED_SCRIPTS as readonly string[]).includes(name)) throw new Error('script-out-of-scope');
  return name;
}

export function frozenToolchainFor(framework: 'vue' | 'react'): string {
  return framework === 'vue' ? FROZEN_TSCONFIG.vue.typescript : FROZEN_TSCONFIG.react.typescript;
}
