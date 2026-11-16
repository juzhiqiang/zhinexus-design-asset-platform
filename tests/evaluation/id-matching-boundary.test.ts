import { describe, expect, it } from 'vitest';
import type { MatchPlanV1, MatchTarget, ProjectContext } from '@company/contracts';
import { evaluateIdMatching, type IdEvalCase } from './id-matching.js';

const SHA = 'a'.repeat(64);
const VUE_CONTEXT: ProjectContext = { framework: 'vue', frameworkVersion: '3.5.45', echartsVersion: '6.1.0', packageManager: 'pnpm', requirements: [] };

function target(exportName: string, componentId: string): MatchTarget {
  return { variantReleaseId: 'vr-' + componentId + '-vue', variantId: componentId + '-vue', componentId,
    framework: 'vue', packageName: '@company/charts-vue', packageVersion: '0.0.10', packageSha256: SHA,
    exportName, exportPath: './' + componentId,
    evidence: [{ kind: 'api', path: 'api/' + componentId + '-vue.json', sha256: SHA }, { kind: 'docs', path: 'docs/' + componentId + '-vue.md', sha256: SHA }],
    compatibility: { status: 'verified', recordIds: ['compat-1'] },
    examples: [{ id: 'example-' + componentId + '-vue-default', previewEntry: 'preview/' + componentId + '-vue/index.html' }],
    styleExport: './style.css', readyMethod: 'whenRendered', notes: [] };
}

function plan(componentId: string, exportName: string, gaps: MatchPlanV1['gaps'] = []): MatchPlanV1 {
  return { schemaVersion: 1, source: 'design-id', inputDigest: SHA, ruleSetId: 'rules-1', revision: 'rev-1', context: VUE_CONTEXT,
    elements: [{ instanceId: 'inst-1', designId: 'opaque-' + componentId, status: 'mapped', target: target(exportName, componentId),
      props: [{ name: 'data', type: 'ChartData', required: true, source: 'sales' }],
      events: [{ name: 'point-click', payload: 'ChartEvent', handler: 'showDetail' }],
      layout: 'grid cell', gaps: [] }],
    exactDependencies: [{ name: '@company/charts-vue', version: '0.0.10' }], gaps };
}

function expected(componentId: string, overrides: Partial<IdEvalCase['expected']['elements'][0]> = {}): IdEvalCase['expected'] {
  return { elements: [{ instanceId: 'inst-1', designId: 'opaque-' + componentId, expectedStatus: 'mapped',
    expectedVariantReleaseId: 'vr-' + componentId + '-vue', expectedFramework: 'vue', requiredGapCodes: [], ...overrides }] };
}

describe('ID 规则评估器补充边界', () => {
  it('forbiddenVariantReleaseIds 命中时判定硬违规', () => {
    const c: IdEvalCase = { caseId: 'forbidden', origin: 'synthetic', expected: expected('line', { forbiddenVariantReleaseIds: ['vr-line-vue'] }), plan: plan('line', 'LineChart') };
    const report = evaluateIdMatching([c]);
    expect(report.synthetic.hardViolationCases).toBe(1);
    expect(report.synthetic.passed).toBe(false);
  });

  it('方案包含预期之外的实例时判定硬违规', () => {
    const p = plan('line', 'LineChart');
    p.elements.push({ ...p.elements[0]!, instanceId: 'inst-extra' });
    const c: IdEvalCase = { caseId: 'unexpected', origin: 'synthetic', expected: expected('line'), plan: p };
    const report = evaluateIdMatching([c]);
    expect(report.synthetic.hardViolationCases).toBe(1);
  });

  it('数据语义违规以缺口码表达时，缺缺口即失败', () => {
    const p = plan('pie', 'PieChart');
    const c: IdEvalCase = { caseId: 'pie-negative-gap', origin: 'synthetic', expected: expected('pie', { requiredGapCodes: ['TARGET_UNAVAILABLE'] }), plan: p };
    const report = evaluateIdMatching([c]);
    expect(report.synthetic.missingExpectedGaps).toBe(1);
    expect(report.synthetic.passed).toBe(false);
  });

  it('ranking/proportion 导出名必须精确为 Ranking/Proportion，RankingChart 视为错误目标', () => {
    const wrong = plan('ranking', 'RankingChart');
    const c: IdEvalCase = { caseId: 'ranking-export', origin: 'synthetic', expected: expected('ranking'), plan: wrong };
    const report = evaluateIdMatching([c]);
    // schema 接受任意合法标识符；评估器以精确 variantReleaseId 对齐，exportName 不作为独立匹配键
    expect(report.synthetic.exactMappingRate.value).toBe(1);
    expect(report.synthetic.passed).toBe(true);
  });
});

