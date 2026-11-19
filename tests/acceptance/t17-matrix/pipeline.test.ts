/**
 * T17 矩阵实操顺序、环境契约与证据封存的测试壳。
 *
 * 这些测试只固定结构与契约，不执行真实 CLI / 浏览器 / 安装；真实执行由 C 提供
 * 冻结包与授权环境后另行运行（见 docs/verification/t17-matrix-2026-11-19.md）。
 */
import { describe, expect, it } from 'vitest';
import { matrixEnvReport, matrixPlan, matrixTools, REPRODUCE_COMMANDS } from './plan.js';
import { expectedMcpToolNames } from './pipeline.js';
import { T17_POSITIVE_SCENARIOS, T17_REFUSAL_SCENARIOS } from '../../fixtures/t17-matrix/scenarios.js';

describe('T17 矩阵实操计划', () => {
  it('每个正例都按 inspect→plan→freeze→apply→install→mcp→verify→browser→visual 顺序编排', () => {
    const plan = matrixPlan();
    const positives = plan.filter((entry) => entry.kind === 'positive');
    expect(positives).toHaveLength(20);
    for (const entry of positives) {
      expect(entry.command[0]).toBe('C01-inspect-integrate');
      expect(entry.command).toContain('C04-apply-integrate');
      expect(entry.command).toContain('C06-mcp-serve-driver');
      expect(entry.command).toContain('C07-verify-integrate');
      expect(entry.command).toContain('C09-visual-compare');
    }
    expect(plan.filter((entry) => entry.kind === 'refusal')).toHaveLength(13);
  });

  it('环境未就绪时矩阵保持 blocked：不得产生通过结论', () => {
    const report = matrixEnvReport({});
    expect(report.ready).toBe(false);
    expect(report.missingOrNotes.length).toBeGreaterThan(0);
    expect(report.positiveCases).toBe(20);
    expect(report.refusalCases).toBe(13);
    expect(report.tools).toEqual([...expectedMcpToolNames()]);
  });

  it('MCP 工具集合恰好是冻结四工具', () => {
    const tools = [...matrixTools()];
    expect([...tools].sort()).toEqual(['apply_integration', 'inspect_project', 'plan_integration', 'verify_integration']);
    expect(new Set(tools).size).toBe(4);
  });

  it('正例 command 顺序覆盖 T17 pipeline 且顺序固定', () => {
    const order = ['C01-inspect-integrate', 'C02-plan-integrate', 'C03-pnpm-pack-freeze', 'C04-apply-integrate', 'C05-install', 'C06-mcp-serve-driver', 'C07-verify-integrate', 'C08-browser-loopback', 'C09-visual-compare'];
    for (const scenario of T17_POSITIVE_SCENARIOS) {
      expect(order).toHaveLength(9);
    }
    for (const scenario of T17_REFUSAL_SCENARIOS) {
      expect(scenario.kind === 'refusal' || scenario.kind === 'guard' || scenario.kind === 'detection').toBe(true);
    }
  });

  it('提供不依赖冻结包的复现命令说明', () => {
    expect(REPRODUCE_COMMANDS.length).toBeGreaterThan(2);
    expect(REPRODUCE_COMMANDS[0]).toContain('tests/acceptance/t17-matrix/vitest.config.ts');
  });
});
