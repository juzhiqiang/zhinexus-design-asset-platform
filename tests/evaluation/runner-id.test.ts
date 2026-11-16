import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { MatchPlanV1, MatchTarget, ProjectContext } from '@company/contracts';
import { runIdEvaluation } from './runner-id.js';

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
          { name: framework === 'react' ? 'onPointClick' : 'point-click', payload: 'ChartEvent', handler: 'showDetails' },
        ],
        layout: 'grid cell',
        gaps: [],
      },
    ],
    exactDependencies: [{ name: packageName, version: '0.0.10' }],
    gaps: [],
  };
}

type CaseAnnotation = {
  caseId: string;
  origin: 'real' | 'synthetic';
  expected: {
    elements: {
      instanceId: string;
      designId: string;
      expectedStatus: 'mapped' | 'gap';
      expectedVariantReleaseId?: string;
      expectedFramework?: 'vue' | 'react';
      requiredGapCodes: string[];
    }[];
    requiredPlanGapCodes?: string[];
  };
};

type Observation = { caseId: string; plan: unknown };

// 仅用于验证 real 分组算法的人工单测数据，不是真实业务评估集或验收证据。
const REAL_MAPPED: CaseAnnotation = {
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
};

const SYN_GAP: CaseAnnotation = {
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
};

const META = { mappingVersion: 'mapping-v1', runnerVersion: 'runner-1.0.0' };

function run(cases: unknown, observations: unknown, metadata = META) {
  return runIdEvaluation(JSON.stringify(cases), JSON.stringify(observations), metadata);
}

const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

describe('T13 ID 评估入口 runIdEvaluation', () => {
  it('cases 只存 expected，observations 按 caseId 提供 plan，产出与评估器一致的报告', () => {
    const cases = [REAL_MAPPED, SYN_GAP];
    const observations: Observation[] = [
      { caseId: 'real-1', plan: makeMappedPlan('react', 'vr-react-line') },
      { caseId: 'syn-1', plan: makeMappedPlan('vue', 'vr-vue-line') },
    ];
    const casesJson = JSON.stringify(cases);
    const observationsJson = JSON.stringify(observations);
    const report = runIdEvaluation(casesJson, observationsJson, META);

    expect(report.real.passed).toBe(true);
    expect(report.real.totalCases).toBe(1);
    expect(report.real.exactMappingRate.value).toBe(1);
    expect(report.real.hardViolationCases).toBe(0);
    expect(report.synthetic.hardViolationCases).toBe(1);
    expect(report.synthetic.passed).toBe(false);
    expect(report.passed).toBe(true);
    expect(report.failures.map((f) => f.caseId)).toEqual(['syn-1']);

    expect(report.metadata.mappingVersion).toBe('mapping-v1');
    expect(report.metadata.runnerVersion).toBe('runner-1.0.0');
    expect(report.inputSha256).toBe(sha(casesJson));
    expect(report.observationSha256).toBe(sha(observationsJson));
    expect(report.productionAcceptance).toBe(false);
  });

  it('仅 synthetic 通过时 real 空集仍失败，整体 passed 为 false 且报告说明 synthetic 非生产验收', () => {
    const cases = [{ ...REAL_MAPPED, origin: 'synthetic' }];
    const observations: Observation[] = [{ caseId: 'real-1', plan: makeMappedPlan('react', 'vr-react-line') }];
    const report = run(cases, observations);
    expect(report.synthetic.exactMappedInstances).toBe(1);
    expect(report.synthetic.passed).toBe(true);
    expect(report.real.totalCases).toBe(0);
    expect(report.real.passed).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.productionAcceptance).toBe(false);
  });

  it('空 cases 或空 observations 不可通过', () => {
    const empty = run([], []);
    expect(empty.passed).toBe(false);
    expect(empty.real.passed).toBe(false);
    expect(empty.synthetic.passed).toBe(false);

    expect(() => run([REAL_MAPPED], [])).toThrow();
    expect(() => run([], [{ caseId: 'real-1', plan: makeMappedPlan('react', 'vr-react-line') }])).toThrow();
  });

  it('错误计划不得进入分子：框架/目标不符时失败并保留具体原因', () => {
    const observations: Observation[] = [{ caseId: 'real-1', plan: makeMappedPlan('vue', 'vr-vue-line') }];
    const report = run([REAL_MAPPED], observations);
    expect(report.real.exactMappedInstances).toBe(0);
    expect(report.real.hardViolationCases).toBe(1);
    const reasons = report.failures.find((f) => f.caseId === 'real-1')!.reasons;
    expect(reasons).toContain('wrong-target-release:inst-1');
    expect(report.passed).toBe(false);
  });

  it('非法 JSON、非数组、缺失 metadata 抛输入错误', () => {
    expect(() => runIdEvaluation('{', '[]', META)).toThrow();
    expect(() => runIdEvaluation('{}', '[]', META)).toThrow();
    expect(() => runIdEvaluation('[]', '{}', META)).toThrow();
    expect(() =>
      runIdEvaluation('[]', '[]', { mappingVersion: '', runnerVersion: 'runner-1' }),
    ).toThrow();
  });

  it('敏感非法输入只给出定位信息，不在错误中回显原值', () => {
    const secret = `secret-${'x'.repeat(20)}`;
    const badObservation = [{ caseId: secret, plan: { secret } }];
    let message = '';
    try {
      run([{ ...REAL_MAPPED, caseId: secret }, { ...REAL_MAPPED, caseId: secret }], []);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toContain(secret);
    expect(message.length).toBeGreaterThan(0);

    let second = '';
    try {
      run([REAL_MAPPED], badObservation);
    } catch (err) {
      second = (err as Error).message;
    }
    expect(second).not.toContain(secret);
    expect(second.length).toBeGreaterThan(0);
  });

  it.each(['case-extra', 'expected-extra', 'element-extra', 'embedded-plan', 'observation-extra', 'duplicate-case', 'duplicate-observation', 'unknown-case'])('严格拒绝污染输入：%s', defect => {
    const cases = JSON.parse(JSON.stringify([REAL_MAPPED]));
    const observations = [{ caseId: 'real-1', plan: makeMappedPlan('react', 'vr-react-line') }] as Record<string, unknown>[];
    if (defect === 'case-extra') cases[0].extra = true;
    if (defect === 'expected-extra') cases[0].expected.extra = true;
    if (defect === 'element-extra') cases[0].expected.elements[0].extra = true;
    if (defect === 'embedded-plan') cases[0].plan = observations[0]!.plan;
    if (defect === 'observation-extra') observations[0]!.expected = cases[0].expected;
    if (defect === 'duplicate-case') cases.push(cases[0]);
    if (defect === 'duplicate-observation') observations.push(observations[0]!);
    if (defect === 'unknown-case') observations[0]!.caseId = 'unannotated';
    expect(() => run(cases, observations)).toThrow();
  });

  it('非法MatchPlan作为硬违规计分，缺映射目标的标注拒绝', () => {
    const report = run([REAL_MAPPED], [{ caseId: 'real-1', plan: {} }]);
    expect(report.real.hardViolationCases).toBe(1);
    expect(report.failures[0]!.reasons).toContain('invalid-match-plan-schema');
    const cases = JSON.parse(JSON.stringify([REAL_MAPPED]));
    delete cases[0].expected.elements[0].expectedVariantReleaseId;
    expect(() => run(cases, [{ caseId: 'real-1', plan: makeMappedPlan('react', 'vr-react-line') }])).toThrow();
  });

  it('SHA256追踪原始字节，空映射分母显示N/A', () => {
    const report = runIdEvaluation('[ ]', '[]', META);
    expect(report.inputSha256).toBe(sha('[ ]'));
    expect(report.inputSha256).not.toBe(report.observationSha256);
    expect(report.real.exactMappingRate.value).toBeNull();
    expect(report.real.exactMappingRate.display).toBe('N/A');
  });
});
