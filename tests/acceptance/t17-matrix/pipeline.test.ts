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
import { checkStructural } from './pipeline.js';
import { validIntegrationPlanFixture } from '../../fixtures/integration-plan.js';
import { applyResultFixture } from '../../fixtures/integration-apply.js';

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

  it('实际矩阵计划逐场景包含完整且固定顺序的正例与拒绝阶段', () => {
    const expectedPositiveOrder = [
      'C01-inspect-integrate',
      'C02-plan-integrate',
      'C03-pnpm-pack-freeze',
      'C04-apply-integrate',
      'C05-install',
      'C06-mcp-serve-driver',
      'C07-verify-integrate',
      'C08-browser-loopback',
      'C09-visual-compare',
    ];
    const expectedRefusalOrder = [
      'R01-inspect-integrate',
      'R02-apply-scenario',
      'R03-verify-or-refuse',
      'R04-evaluate-outcome',
    ];
    const plan = matrixPlan();
    const positives = plan.filter((entry) => entry.kind === 'positive');
    const refusals = plan.filter((entry) => entry.kind === 'refusal');

    expect(positives).toHaveLength(20);
    expect(refusals).toHaveLength(13);
    expect(new Set(positives.map((entry) => entry.caseId)).size).toBe(20);
    expect(new Set(refusals.map((entry) => entry.caseId)).size).toBe(13);
    expect(positives).toEqual(T17_POSITIVE_SCENARIOS.map((scenario) => ({
      caseId: scenario.caseId,
      kind: 'positive',
      command: expectedPositiveOrder,
    })));
    expect(refusals).toEqual(T17_REFUSAL_SCENARIOS.map((scenario) => ({
      caseId: scenario.caseId,
      kind: 'refusal',
      command: expectedRefusalOrder,
    })));
  });

  it('提供不依赖冻结包的复现命令说明', () => {
    expect(REPRODUCE_COMMANDS.length).toBeGreaterThan(2);
    expect(REPRODUCE_COMMANDS[0]).toContain('tests/acceptance/t17-matrix/vitest.config.ts');
  });

  it('拒绝只有数组占位而缺少 MatchPlan 契约字段的响应', () => {
    expect(() => checkStructural({
      matchPlan: { schemaVersion: 1, elements: [], exactDependencies: [], context: {} },
    })).toThrow(/match-plan|MatchPlan|context|source|digest/i);
  });

  it('接受仅包含计划阶段字段的真实 IntegrationPlan 契约产物', () => {
    const result = checkStructural({ plan: validIntegrationPlanFixture() });

    expect(result.plan?.status).toBe('planned');
    expect(result.plan?.localProject.framework).toBe('vue');
    expect(result.plan?.baseFileHashes).toContainEqual({
      path: 'src/components/zhinexus/component-0001.vue', exists: false,
    });
  });

  it('接受没有验证报告 applyResultDigest 字段的真实 apply 契约产物', () => {
    const result = checkStructural({ applyResult: applyResultFixture() });

    expect(result.applyResult?.status).toBe('applied');
    expect(result.applyResult?.installState).toBe('succeeded');
    expect(result.applyResult?.changedFiles).toContain('src/components/zhinexus/component-0001.vue');
  });

  it('继续拒绝缺少已允许路径快照的计划产物', () => {
    const plan = validIntegrationPlanFixture();
    plan.baseFileHashes.pop();

    expect(() => checkStructural({ plan })).toThrow(/plan: 契约校验失败/);
  });

  it('继续拒绝缺少写入后快照的 apply 产物', () => {
    const applyResult = applyResultFixture();
    applyResult.afterHashes.pop();

    expect(() => checkStructural({ applyResult })).toThrow(/apply-result: 契约校验失败/);
  });

  it('拒绝只通过顶层数组检查但嵌套 evidence 项畸形的验证报告', () => {
    expect(() => checkStructural({
      report: {
        schemaVersion: 1, operation: 'verify', projectRoot: 'C:/tmp/project', planDigest: 'a'.repeat(64),
        applyResultDigest: 'b'.repeat(64), specDigest: 'c'.repeat(64), id: 'report-1', toolVersion: '0.0.14',
        verifiedAt: '2026-11-19T00:00:00.000Z', status: 'passed', checks: [{ id: 'type', category: 'type', status: 'passed', issues: [null], evidence: [] }],
        changedFiles: [], snapshots: { before: [], after: [] }, installedVersions: [], visualResult: 'PASS',
        environment: { os: 'Windows', arch: 'x64', browserVersion: 'test', browserRevision: 'test', fontDigest: 'd'.repeat(64),
          locale: 'zh-CN', timezone: 'Asia/Shanghai', deviceScaleFactor: 1, renderer: 'canvas', width: 640, height: 360,
          theme: 'light', frameworkVersion: '19.3.1', echartsVersion: '6.1.0' },
        artifacts: [], pendingItems: [],
      },
    })).toThrow(/report|契约/);
  });
});
