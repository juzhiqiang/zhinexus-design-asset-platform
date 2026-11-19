/**
 * T17 矩阵实操顺序（正/负域）与可复现命令。
 *
 * 该文件是运行说明的单一事实来源；未提供环境变量时，全部用例以 blocked 记录、
 * 不计入正向分子/分母，也不产生任何"通过"结论。
 */
import { resolveMatrixEnv } from './env.js';
import { T17_POSITIVE_SCENARIOS, T17_REFUSAL_SCENARIOS } from '../../fixtures/t17-matrix/scenarios.js';
import { MCP_TOOL_NAMES } from './pipeline.js';
import { expectedTools } from './mcp.js';

export type MatrixPlanEntry = {
  caseId: string;
  kind: 'positive' | 'refusal';
  command: string[];
};

export function matrixPlan(): readonly MatrixPlanEntry[] {
  const positive: MatrixPlanEntry[] = T17_POSITIVE_SCENARIOS.map((scenario) => ({
    caseId: scenario.caseId,
    kind: 'positive',
    command: [
      'C01-inspect-integrate',
      'C02-plan-integrate',
      'C03-pnpm-pack-freeze',
      'C04-apply-integrate',
      'C05-install',
      'C06-mcp-serve-driver',
      'C07-verify-integrate',
      'C08-browser-loopback',
      'C09-visual-compare',
    ],
  }));
  const refusal: MatrixPlanEntry[] = T17_REFUSAL_SCENARIOS.map((scenario) => ({
    caseId: scenario.caseId,
    kind: 'refusal',
    command: [
      'R01-inspect-integrate',
      'R02-apply-scenario',
      'R03-verify-or-refuse',
      'R04-evaluate-outcome',
    ],
  }));
  return [...positive, ...refusal];
}

export type MatrixEnvReport = { ready: boolean; missingOrNotes: string[]; positiveCases: number; refusalCases: number; tools: readonly string[] };

export function matrixEnvReport(env: NodeJS.ProcessEnv = process.env): MatrixEnvReport {
  const resolved = resolveMatrixEnv(env);
  return {
    ready: resolved.ok,
    missingOrNotes: resolved.ok ? [] : [...resolved.missing, ...resolved.notes],
    positiveCases: T17_POSITIVE_SCENARIOS.length,
    refusalCases: T17_REFUSAL_SCENARIOS.length,
    tools: [...MCP_TOOL_NAMES],
  };
}

export function matrixTools(): readonly string[] {
  return expectedTools();
}

/** 可复现命令（开发者本机；服务端零执行）。 */
export const REPRODUCE_COMMANDS = [
  '.\\scripts\\pnpm.ps1 exec vitest run --config tests/acceptance/t17-matrix/vitest.config.ts',
  '$env:T17_MATRIX_WORK_ROOT = "C:/t17-work-root"; $env:T17_MATRIX_API_BASE = "http://127.0.0.1:<api-port>"; $env:T17_MATRIX_REGISTRY_BASE = "http://127.0.0.1:<registry-port>"',
  '$env:A10_FROZEN_BUNDLE = "C:/t17/frozen-bundle"; $env:PHASE3_CLI_TARBALL = "C:/t17/component-cli-0.0.15.tgz"',
  '$env:T17_MATRIX_VARIANTS = "tests/acceptance/t17-matrix/config/variants.json"; $env:ZHINEXUS_API_TOKEN = "<api-token>"; $env:ZHINEXUS_REGISTRY_TOKEN = "<registry-token>"',
  '必填项说明见 env.ts；缺失时用例全部以 blocked 收尾，不产生通过结论。',
] as const;