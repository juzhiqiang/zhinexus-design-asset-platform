import { describe, expect, it } from 'vitest';
import type { MatchPlanV1, MatchTarget, ProjectContext } from '@company/contracts';
import {
  evaluateIdMatching,
  IdEvaluationInputError,
  type IdEvalCase,
} from './id-matching.js';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);

const REACT_CONTEXT: ProjectContext = {
  framework: 'react',
  frameworkVersion: '19.3.1',
  echartsVersion: '6.1.0',
  packageManager: 'pnpm',
  requirements: [],
};

const VUE_CONTEXT: ProjectContext = {
  framework: 'vue',
  frameworkVersion: '3.5.45',
  echartsVersion: '6.1.0',
  packageManager: 'pnpm',
  requirements: [],
};

function makeTarget(framework: 'react' | 'vue', variantReleaseId: string): MatchTarget {
  return {
    variantReleaseId,
    variantId: `line-${framework}`,
    componentId: 'line',
    framework,
    packageName: framework === 'react' ? '@company/charts-react' : '@company/charts-vue',
    packageVersion: '0.0.10',
    packageSha256: SHA_B,
    exportName: 'LineChart',
    exportPath: './line',
    evidence: [
      { kind: 'api', path: `api/line-${framework}.json`, sha256: SHA_C },
      { kind: 'docs', path: `docs/line-${framework}.md`, sha256: SHA_D },
    ],
    compatibility: { status: 'verified', recordIds: ['compat-1'] },
    examples: [{ id: `example-line-${framework}-default`, previewEntry: `preview/line-${framework}/index.html` }],
    styleExport: './style.css',
    readyMethod: 'whenRendered',
    notes: [],
  };
}

function makeMappedPlan(framework: 'react' | 'vue', releaseId: string): MatchPlanV1 {
  const context = framework === 'react' ? REACT_CONTEXT : VUE_CONTEXT;
  const packageName = framework === 'react' ? '@company/charts-react' : '@company/charts-vue';
  return {
    schemaVersion: 1,
    source: 'design-id',
    inputDigest: SHA_A,
    ruleSetId: 'rules-1',
    revision: 'rev-1',
    context,
    elements: [
      {
        instanceId: 'inst-1',
        designId: 'opaque-line-id',
        status: 'mapped',
        target: makeTarget(framework, releaseId),
        props: [{ name: 'data', type: 'ChartData', required: true, source: 'sales' }],
        events: [
          {
            name: framework === 'react' ? 'onPointClick' : 'point-click',
            payload: 'ChartEvent',
            handler: 'showDetails',
          },
        ],
        layout: 'grid cell', gaps: [],
      },
    ],
    exactDependencies: [{ name: packageName, version: '0.0.10' }],
    gaps: [],
  };
}

describe('A4 确定性 ID 规则评估器', () => {
  it.each(['target', 'duplicate', 'status', 'gap-code', 'structure'])('拒绝不能形成精确预期的标注：%s', defect => {
    const item: IdEvalCase = { caseId:'invalid', origin:'real', expected:{elements:[{instanceId:'inst-1',designId:'opaque-line-id',expectedStatus:'mapped',expectedVariantReleaseId:'vr-vue-line',requiredGapCodes:[]}]}, plan:makeMappedPlan('vue','vr-vue-line') };
    if(defect==='target') delete item.expected.elements[0]!.expectedVariantReleaseId;
    if(defect==='duplicate') item.expected.elements.push({...item.expected.elements[0]!});
    if(defect==='status') (item.expected.elements[0] as {expectedStatus:string}).expectedStatus='typo';
    if(defect==='gap-code') (item.expected.elements[0]!.requiredGapCodes as string[]).push('WRONG');
    if(defect==='structure') (item as unknown as {expected:unknown}).expected=null;
    expect(()=>evaluateIdMatching([item])).toThrow(IdEvaluationInputError);
  });
  it('设计ID错误不得进入精确匹配分子', () => {
    const report = evaluateIdMatching([{ caseId:'wrong-id',origin:'real', expected:{elements:[{instanceId:'inst-1',designId:'other',expectedStatus:'mapped',expectedVariantReleaseId:'vr-vue-line',requiredGapCodes:[]}]},plan:makeMappedPlan('vue','vr-vue-line') }]);
    expect(report.real.exactMappedInstances).toBe(0); expect(report.real.exactMappingRate.value).toBe(0);
  });
  it('真实样本精确映射 100%、硬违规 0、缺口命中且分离 synthetic 时 passed 为 true', () => {
    const realCase: IdEvalCase = {
      caseId: 'real-1',
      origin: 'real',
      expected: {
        elements: [
          {
            instanceId: 'inst-1',
            designId: 'opaque-line-id',
            expectedStatus: 'mapped',
            expectedVariantReleaseId: 'vr-react-line',
            expectedFramework: 'react',
            requiredGapCodes: [],
          },
        ],
      },
      plan: makeMappedPlan('react', 'vr-react-line'),
    };

    const syntheticFailCase: IdEvalCase = {
      caseId: 'syn-1',
      origin: 'synthetic',
      expected: {
        elements: [
          {
            instanceId: 'inst-1',
            designId: 'opaque-line-id',
            expectedStatus: 'gap',
            requiredGapCodes: ['TARGET_UNAVAILABLE'],
          },
        ],
      },
      plan: makeMappedPlan('vue', 'vr-vue-line'),
    };

    const report = evaluateIdMatching([realCase, syntheticFailCase]);
    expect(report.real.passed).toBe(true);
    expect(report.real.exactMappingRate.value).toBe(1);
    expect(report.real.hardViolationCases).toBe(0);
    expect(report.synthetic.passed).toBe(false);
    expect(report.synthetic.hardViolationCases).toBe(1);
    expect(report.passed).toBe(true);
  });

  it('仅有 synthetic 样本全部通过时，real 仍未通过且整体 passed 为 false', () => {
    const synCase: IdEvalCase = {
      caseId: 'syn-only',
      origin: 'synthetic',
      expected: {
        elements: [
          {
            instanceId: 'inst-1',
            designId: 'opaque-line-id',
            expectedStatus: 'mapped',
            expectedVariantReleaseId: 'vr-vue-line',
            expectedFramework: 'vue',
            requiredGapCodes: [],
          },
        ],
      },
      plan: makeMappedPlan('vue', 'vr-vue-line'),
    };

    const report = evaluateIdMatching([synCase]);
    expect(report.synthetic.passed).toBe(true);
    expect(report.real.totalCases).toBe(0);
    expect(report.real.passed).toBe(false);
    expect(report.passed).toBe(false);
  });

  it('空设计或空输入不得计为匹配成功', () => {
    const emptyPlan: MatchPlanV1 = {
      schemaVersion: 1,
      source: 'design-id',
      inputDigest: SHA_A,
      ruleSetId: 'rules-1',
      revision: 'rev-1',
      context: REACT_CONTEXT,
      elements: [],
      exactDependencies: [],
      gaps: [{ code: 'EMPTY_DESIGN', message: '未提供设计元素' }],
    };
    const emptyCase: IdEvalCase = {
      caseId: 'real-empty',
      origin: 'real',
      expected: {
        elements: [],
        requiredPlanGapCodes: ['EMPTY_DESIGN'],
      },
      plan: emptyPlan,
    };

    const report = evaluateIdMatching([emptyCase]);
    expect(report.real.exactMappingRate.value).toBeNull();
    expect(report.real.passed).toBe(false);
    expect(report.passed).toBe(false);
  });

  it('越权 / 未知 ID 误装配、错框架、跨框架事件混用均判定硬违规并失败', () => {
    // 1. 预期为 gap（例如 TARGET_UNAVAILABLE / UNMAPPED_ID）却被 mapped
    const unauthorizedCase: IdEvalCase = {
      caseId: 'unauth',
      origin: 'real',
      expected: {
        elements: [
          {
            instanceId: 'inst-1',
            designId: 'opaque-line-id',
            expectedStatus: 'gap',
            requiredGapCodes: ['TARGET_UNAVAILABLE'],
          },
        ],
      },
      plan: makeMappedPlan('react', 'vr-react-line'),
    };

    // 2. React 方案误出现 Vue 事件 point-click
    const wrongEventPlan = makeMappedPlan('react', 'vr-react-line');
    wrongEventPlan.elements[0]!.events = [{ name: 'point-click', payload: 'ChartEvent' }];
    const wrongEventCase: IdEvalCase = {
      caseId: 'wrong-event',
      origin: 'real',
      expected: {
        elements: [
          {
            instanceId: 'inst-1',
            designId: 'opaque-line-id',
            expectedStatus: 'mapped',
            expectedVariantReleaseId: 'vr-react-line',
            expectedFramework: 'react',
            requiredGapCodes: [],
          },
        ],
      },
      plan: wrongEventPlan,
    };

    // 3. 目标框架与上下文不匹配（通过绕过或错配产生）
    const wrongFrameworkPlan = makeMappedPlan('react', 'vr-vue-line');
    wrongFrameworkPlan.elements[0]!.target = makeTarget('vue', 'vr-vue-line');
    const wrongFrameworkCase: IdEvalCase = {
      caseId: 'wrong-fw',
      origin: 'real',
      expected: {
        elements: [
          {
            instanceId: 'inst-1',
            designId: 'opaque-line-id',
            expectedStatus: 'mapped',
            expectedVariantReleaseId: 'vr-vue-line',
            expectedFramework: 'react',
            requiredGapCodes: [],
          },
        ],
      },
      plan: wrongFrameworkPlan,
    };

    const report = evaluateIdMatching([unauthorizedCase, wrongEventCase, wrongFrameworkCase]);
    expect(report.real.hardViolationCases).toBe(3);
    expect(report.real.passed).toBe(false);
    expect(report.passed).toBe(false);
  });

  it('多实例复用同一 designId 时须各自独立保留，缺失任一实例即失败', () => {
    const plan = makeMappedPlan('react', 'vr-react-line');
    const missingSecondInstance: IdEvalCase = {
      caseId: 'multi-instance',
      origin: 'real',
      expected: {
        elements: [
          {
            instanceId: 'inst-1',
            designId: 'opaque-line-id',
            expectedStatus: 'mapped',
            expectedVariantReleaseId: 'vr-react-line',
            expectedFramework: 'react',
            requiredGapCodes: [],
          },
          {
            instanceId: 'inst-2',
            designId: 'opaque-line-id',
            expectedStatus: 'mapped',
            expectedVariantReleaseId: 'vr-react-line',
            expectedFramework: 'react',
            requiredGapCodes: [],
          },
        ],
      },
      plan,
    };

    const report = evaluateIdMatching([missingSecondInstance]);
    expect(report.real.hardViolationCases).toBe(1);
    expect(report.real.passed).toBe(false);
  });

  it('拒绝重复 caseId 与非法 origin', () => {
    const valid: IdEvalCase = {
      caseId: 'dup',
      origin: 'real',
      expected: { elements: [] },
      plan: makeMappedPlan('react', 'vr-react-line'),
    };
    expect(() => evaluateIdMatching([valid, { ...valid }])).toThrow(IdEvaluationInputError);
    expect(() =>
      evaluateIdMatching([{ ...valid, origin: 'unknown' as unknown as 'real' }]),
    ).toThrow(IdEvaluationInputError);
  });
});
