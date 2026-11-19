/**
 * T17 A1/A2 产品 RED 辅助：CLI 根出口命名空间查找与 optional 调用。
 *
 * 仅在 GREEN 阶段才从 CLI 根出口导出 `verifyIntegration` / `repairIntegration`，
 * RED 阶段缺导出时返回 undefined，由用例对状态、摘要、文件与进程边界的实质断言失败。
 */
import type { IntegrationPlanV1 } from '../../../packages/component-cli/src/contracts/integration-plan.js';
import type { IntegrationApplyResultV1 } from '../../../packages/component-cli/src/contracts/integration-apply.js';
import type {
  IntegrationExecutionAuthorizationV1,
  IntegrationVerificationReportV1,
  IntegrationVerificationSpecV1,
} from '../../../packages/component-cli/src/contracts/integration-verification.js';
import type { IntegrationRepairResultV1 } from '../../../packages/component-cli/src/contracts/integration-repair.js';

export type VerifyIntegrationOptions = {
  applyResult: IntegrationApplyResultV1;
  spec: IntegrationVerificationSpecV1;
  authorization: IntegrationExecutionAuthorizationV1;
  artifactRoot: string;
  signal?: AbortSignal;
};

export type RepairIntegrationOptions = {
  applyResult: IntegrationApplyResultV1;
  spec: IntegrationVerificationSpecV1;
  authorization: IntegrationExecutionAuthorizationV1;
  artifactRoot: string;
  maxAttempts?: 0 | 1 | 2;
  signal?: AbortSignal;
};

export type VerifyIntegrationFn = (
  root: string,
  plan: IntegrationPlanV1,
  options: VerifyIntegrationOptions,
) => Promise<IntegrationVerificationReportV1>;

export type RepairIntegrationFn = (
  root: string,
  plan: IntegrationPlanV1,
  report: IntegrationVerificationReportV1,
  options: RepairIntegrationOptions,
) => Promise<IntegrationRepairResultV1>;

export type T17CliExports = {
  verifyIntegration?: VerifyIntegrationFn;
  repairIntegration?: RepairIntegrationFn;
  loadError?: string;
};

async function importRootExport(): Promise<unknown> {
  const originalArgv1: string = process.argv[1] ?? '';
  process.argv[1] = 't17-red-namespace-probe';
  try {
    return await import('../../../packages/component-cli/src/index.js');
  } finally {
    process.argv[1] = originalArgv1;
  }
}

export async function loadT17CliExports(): Promise<T17CliExports> {
  try {
    return (await importRootExport()) as unknown as T17CliExports;
  } catch (error) {
    return { loadError: error instanceof Error ? error.message : String(error) };
  }
}

export async function callVerify(
  exports: T17CliExports,
  root: string,
  plan: IntegrationPlanV1,
  options: VerifyIntegrationOptions,
): Promise<IntegrationVerificationReportV1 | undefined> {
  if (typeof exports.verifyIntegration !== 'function') return undefined;
  return exports.verifyIntegration(root, plan, options);
}

export async function callRepair(
  exports: T17CliExports,
  root: string,
  plan: IntegrationPlanV1,
  report: IntegrationVerificationReportV1,
  options: RepairIntegrationOptions,
): Promise<IntegrationRepairResultV1 | undefined> {
  if (typeof exports.repairIntegration !== 'function') return undefined;
  return exports.repairIntegration(root, plan, report, options);
}
