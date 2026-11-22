/**
 * T16 B / P1 产品 RED 辅助：CLI 根出口的命名空间查找与 optional 调用。
 *
 * 依据 docs/plans/2026-11-18-t16-b-install-isolation-brief.md：
 * - `applyIntegration` / `rollbackIntegration` 在 GREEN 阶段才从 CLI 根出口导出；
 * - RED 阶段**不得**对尚不存在的模块做静态 import（那会变成 collect/typecheck 错误，
 *   而不是行为断言失败），因此这里只按命名空间可选查找，缺函数时返回 undefined，
 *   由各用例对“实质结果”（状态、字节、摘要、进程边界）的断言失败；
 * - 不向公开 options 注入任何 runner；故障只由测试私有 mock 或受控文件条件注入。
 *
 * 本文件不是 Vitest 用例（不匹配 `*.test.ts`），仅被三份产品测试共用。
 */
import type {
  IntegrationApplyAuthorizationV1,
  IntegrationApplyResultV1,
  IntegrationRollbackResultV1,
} from '../../../packages/component-cli/src/contracts/integration-apply.js';
import type { IntegrationPlanV1 } from '../../../packages/component-cli/src/contracts/integration-plan.js';

/** 与 brief 冻结的固定接口一致；authorization 只能来自本次显式 apply 的调用边界。 */
export type IntegrationApplyOptions = {
  authorization?: IntegrationApplyAuthorizationV1;
  apiUrl: string;
  registryUrl: string;
  apiToken?: string;
  registryToken?: string;
  backupRoot: string;
  workspace?: string;
  outputDir?: string;
  requestTimeoutMs?: number;
};

export type IntegrationRollbackOptions = { backupRoot: string };

export type IntegrationBackupRef = { id: string; sha256: string };

export type ApplyIntegration = (
  root: string,
  plan: IntegrationPlanV1,
  options: IntegrationApplyOptions,
) => Promise<IntegrationApplyResultV1>;

export type RollbackIntegration = (
  root: string,
  backupRef: IntegrationBackupRef,
  options: IntegrationRollbackOptions,
) => Promise<IntegrationRollbackResultV1>;

export type CliExports = {
  applyIntegration?: ApplyIntegration;
  rollbackIntegration?: RollbackIntegration;
  /** 根出口加载失败原因（仅诊断用）；正常情况下为 undefined。 */
  loadError?: string;
};

async function importRootExport(): Promise<unknown> {
  const originalArgv1: string = process.argv[1] ?? '';
  // 根出口在“被当作 CLI 直接运行”时会执行 runCli 并改写 process.exitCode；
  // 这里只按命名空间查找导出，必须避免误判为直接运行。
  process.argv[1] = 't16-red-namespace-probe';
  try {
    return await import('../../../packages/component-cli/src/index.js');
  } finally {
    process.argv[1] = originalArgv1;
  }
}

export async function loadCliExports(): Promise<CliExports> {
  try {
    return (await importRootExport()) as unknown as CliExports;
  } catch (error) {
    return { loadError: error instanceof Error ? error.message : String(error) };
  }
}

/** optional 调用：缺导出时返回 undefined（由用例的实质断言失败），不抛“不是一个函数”。 */
export async function callApply(
  exports: CliExports,
  root: string,
  plan: IntegrationPlanV1,
  options: IntegrationApplyOptions,
): Promise<IntegrationApplyResultV1 | undefined> {
  if (typeof exports.applyIntegration !== 'function') return undefined;
  return await exports.applyIntegration(root, plan, options);
}

export async function callRollback(
  exports: CliExports,
  root: string,
  backupRef: IntegrationBackupRef,
  options: IntegrationRollbackOptions,
): Promise<IntegrationRollbackResultV1 | undefined> {
  if (typeof exports.rollbackIntegration !== 'function') return undefined;
  return await exports.rollbackIntegration(root, backupRef, options);
}

/** RED 诊断：把缺能力原因写进失败消息，方便宿主区分“未实现”与“实现不符预期”。 */
export function capabilityNote(exports: CliExports, name: 'applyIntegration' | 'rollbackIntegration'): string {
  if (typeof exports[name] === 'function') return `${name} 已导出`;
  return exports.loadError !== undefined
    ? `CLI 根出口加载失败：${exports.loadError}`
    : `CLI 根出口尚未导出 ${name}（P1 产品能力缺失）`;
}
