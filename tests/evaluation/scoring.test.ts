import { describe, expect, it } from 'vitest';
import {
  EvaluationInputError,
  scoreEvaluation,
  type EvaluationCase,
  type EvaluationObservation,
} from './scoring.js';

/**
 * 二期 A2 离线评分器单元测试。
 *
 * 声明：以下全部测试用例（包括为验证 `real` 组 30 样本 / 10 陷阱统计逻辑而构造的
 * `origin: 'real'` 模拟输入）均为人工构造的 **synthetic 测试模拟数据**，
 * 不代表仓库已具备 30 个真实业务标注样本。
 */

function makeCase(overrides: Partial<EvaluationCase> = {}): EvaluationCase {
  return {
    caseId: 'SYNTH-CASE-1',
    origin: 'synthetic',
    category: 'matchable',
    acceptableVariantIds: ['line-react'],
    requiredGapFields: [],
    ...overrides,
  };
}

function makeObs(overrides: Partial<EvaluationObservation> = {}): EvaluationObservation {
  return {
    caseId: 'SYNTH-CASE-1',
    top5VariantIds: ['line-react'],
    gapFields: [],
    hardViolations: [],
    ...overrides,
  };
}

function buildSimulatedRealBatch(
  count: number,
  trapCount: number,
  options?: { missTop5?: number; missGap?: boolean; hardViolationIndex?: number },
): { cases: EvaluationCase[]; observations: EvaluationObservation[] } {
  const cases: EvaluationCase[] = [];
  const observations: EvaluationObservation[] = [];
  const trapCategories: EvaluationCase['category'][] = [
    'no-match',
    'missing-constraint',
    'cross-framework-trap',
    'api-trap',
    'data-semantic-trap',
  ];

  for (let i = 0; i < count; i += 1) {
    const isTrap = i < trapCount;
    const category: EvaluationCase['category'] = isTrap
      ? trapCategories[i % trapCategories.length]!
      : 'matchable';
    const isNoMatch = category === 'no-match' || category === 'cross-framework-trap';
    const caseId = `SIM-REAL-${i + 1}`;
    const acceptableVariantIds = isNoMatch ? [] : ['line-react'];
    const requiredGapFields = isTrap ? ['config.unit'] : [];

    cases.push({
      caseId,
      origin: 'real',
      category,
      acceptableVariantIds,
      requiredGapFields,
    });

    const missThisTop5 = options?.missTop5 !== undefined && i >= count - options.missTop5;
    const hardViolations =
      options?.hardViolationIndex === i ? ['cross-framework-recommendation'] : [];
    const gapFields =
      options?.missGap && i === 0 ? [] : requiredGapFields;

    observations.push({
      caseId,
      top5VariantIds: isNoMatch ? [] : missThisTop5 ? ['bar-react'] : ['line-react'],
      gapFields,
      hardViolations,
    });
  }
  return { cases, observations };
}

describe('scoreEvaluation（二期离线评分器）', () => {
  it('按 real 与 synthetic 严格隔离统计，synthetic 不影响 real 结论', () => {
    const simReal = buildSimulatedRealBatch(30, 10);
    const synthBadCase = makeCase({
      caseId: 'SYNTH-BAD-1',
      origin: 'synthetic',
      category: 'matchable',
      acceptableVariantIds: ['pie-vue'],
      requiredGapFields: ['config.unit'],
    });
    const synthBadObs = makeObs({
      caseId: 'SYNTH-BAD-1',
      top5VariantIds: ['bar-vue'],
      gapFields: [],
      hardViolations: ['fabricated-export'],
    });

    const report = scoreEvaluation(
      [...simReal.cases, synthBadCase],
      [...simReal.observations, synthBadObs],
    );

    expect(report.real.totalCases).toBe(30);
    expect(report.real.trapCases).toBe(10);
    expect(report.real.hardViolationCases).toBe(0);
    expect(report.real.top5.value).toBe(1);
    expect(report.real.gapRecall.value).toBe(1);
    expect(report.real.passed).toBe(true);
    expect(report.passed).toBe(true);

    expect(report.synthetic.totalCases).toBe(1);
    expect(report.synthetic.hardViolationCases).toBe(1);
    expect(report.synthetic.top5.value).toBe(0);
    expect(report.synthetic.gapRecall.value).toBe(0);
    expect(report.synthetic.passed).toBe(false);
  });

  it('空分母返回 null 与 N/A，且 passed 必须为 false', () => {
    const onlySynthetic = makeCase({ caseId: 'SYNTH-ONLY', origin: 'synthetic' });
    const report = scoreEvaluation([onlySynthetic], [makeObs({ caseId: 'SYNTH-ONLY' })]);

    expect(report.real.totalCases).toBe(0);
    expect(report.real.top5.value).toBeNull();
    expect(report.real.top5.display).toBe('N/A');
    expect(report.real.gapRecall.value).toBeNull();
    expect(report.real.gapRecall.display).toBe('N/A');
    expect(report.real.passed).toBe(false);
    expect(report.passed).toBe(false);
  });

  it('Top5 仅取前 5 个候选且分母覆盖所有 acceptableVariantIds 非空案例（含 missing-constraint）', () => {
    const c1 = makeCase({
      caseId: 'R-1',
      origin: 'real',
      category: 'missing-constraint',
      acceptableVariantIds: ['trend-card-react'],
      requiredGapFields: ['config.previousValue'],
    });
    const c2 = makeCase({
      caseId: 'R-2',
      origin: 'real',
      category: 'matchable',
      acceptableVariantIds: ['line-react'],
    });
    const o1 = makeObs({
      caseId: 'R-1',
      // 第 6 位才出现可接受候选，不能计入 Top-5 命中
      top5VariantIds: ['a', 'b', 'c', 'd', 'e', 'trend-card-react'],
      gapFields: ['config.previousValue'],
    });
    const o2 = makeObs({
      caseId: 'R-2',
      top5VariantIds: ['bar-react', 'line-react'],
    });

    const report = scoreEvaluation([c1, c2], [o1, o2]);

    expect(report.real.top5.denominator).toBe(2);
    expect(report.real.top5.numerator).toBe(1);
    expect(report.real.top5.value).toBe(0.5);
    expect(report.failures.some((f) => f.caseId === 'R-1' && f.reasons.includes('top5-miss'))).toBe(
      true,
    );
  });

  it('gap 召回按所需字段去重计算，观测重复字段不重复加分', () => {
    const c1 = makeCase({
      caseId: 'G-1',
      origin: 'real',
      category: 'missing-constraint',
      acceptableVariantIds: ['trend-card-react'],
      requiredGapFields: ['config.previousValue', 'config.unit'],
    });
    const o1 = makeObs({
      caseId: 'G-1',
      top5VariantIds: ['trend-card-react'],
      // 重复报告同一字段不能算 2 分
      gapFields: ['config.previousValue', 'config.previousValue'],
    });

    const report = scoreEvaluation([c1], [o1]);
    expect(report.real.gapRecall.denominator).toBe(2);
    expect(report.real.gapRecall.numerator).toBe(1);
    expect(report.real.gapRecall.value).toBe(0.5);
    expect(
      report.failures.some(
        (f) => f.caseId === 'G-1' && f.reasons.some((r) => r.includes('config.unit')),
      ),
    ).toBe(true);
  });

  it('硬违规按案例计数，且同案例即使前 5 命中也不计入有效 Top5 命中', () => {
    const sim = buildSimulatedRealBatch(30, 10, { hardViolationIndex: 25 });
    // 即使同一案例有两条违规，也按 1 个案例计
    sim.observations[25] = {
      ...sim.observations[25]!,
      hardViolations: ['cross-framework', 'fabricated-prop'],
    };

    const report = scoreEvaluation(sim.cases, sim.observations);
    expect(report.real.hardViolationCases).toBe(1);
    expect(report.real.passed).toBe(false);
    expect(
      report.failures.some(
        (f) => f.caseId === 'SIM-REAL-26' && f.reasons.some((r) => r.startsWith('hard-violation:')),
      ),
    ).toBe(true);
  });

  it('缺少 observation 计入失败与缺观测计数，不静默忽略', () => {
    const c1 = makeCase({ caseId: 'M-1', origin: 'real', requiredGapFields: ['config.unit'] });
    const report = scoreEvaluation([c1], []);

    expect(report.real.missingObservations).toBe(1);
    expect(report.real.top5.denominator).toBe(1);
    expect(report.real.top5.numerator).toBe(0);
    expect(report.real.gapRecall.denominator).toBe(1);
    expect(report.real.gapRecall.numerator).toBe(0);
    expect(report.real.passed).toBe(false);
    expect(
      report.failures.some((f) => f.caseId === 'M-1' && f.reasons.includes('missing-observation')),
    ).toBe(true);
  });

  it('不足 30 real 或不足 10 陷阱时，即使指标全 100% 也不得 passed', () => {
    const simSmall = buildSimulatedRealBatch(29, 10);
    expect(scoreEvaluation(simSmall.cases, simSmall.observations).passed).toBe(false);

    const simFewTraps = buildSimulatedRealBatch(30, 9);
    expect(scoreEvaluation(simFewTraps.cases, simFewTraps.observations).passed).toBe(false);
  });

  it('拒绝重复 caseId、未知 observation、重复 observation 与非法输入', () => {
    const c1 = makeCase({ caseId: 'DUP-1' });
    expect(() => scoreEvaluation([c1, c1], [])).toThrow(EvaluationInputError);

    expect(() =>
      scoreEvaluation([c1], [makeObs({ caseId: 'UNKNOWN-1' })]),
    ).toThrow(EvaluationInputError);

    expect(() =>
      scoreEvaluation([c1], [makeObs({ caseId: 'DUP-1' }), makeObs({ caseId: 'DUP-1' })]),
    ).toThrow(EvaluationInputError);

    expect(() =>
      scoreEvaluation([makeCase({ caseId: '   ' })], []),
    ).toThrow(EvaluationInputError);
  });

  it('noMatchRejection 零分母（全为可匹配样本）时不得 passed', () => {
    const cases: EvaluationCase[] = [];
    const observations: EvaluationObservation[] = [];
    for (let i = 0; i < 30; i += 1) {
      const isTrap = i < 10;
      const caseId = `SIM-NM-ZERO-${i + 1}`;
      cases.push({
        caseId,
        origin: 'real',
        category: isTrap ? 'missing-constraint' : 'matchable',
        acceptableVariantIds: ['line-react'],
        requiredGapFields: isTrap ? ['config.unit'] : [],
      });
      observations.push({
        caseId,
        top5VariantIds: ['line-react'],
        gapFields: isTrap ? ['config.unit'] : [],
        hardViolations: [],
      });
    }
    const report = scoreEvaluation(cases, observations);
    expect(report.real.noMatchRejection.denominator).toBe(0);
    expect(report.real.noMatchRejection.value).toBeNull();
    expect(report.real.noMatchRejection.display).toBe('N/A');
    expect(report.real.passed).toBe(false);
    expect(report.passed).toBe(false);
  });

  it('noMatchRejection 低于 90% 时不得 passed，达到 90% 时可通过', () => {
    // 构造 30 个模拟真实案例：其中 10 个为 no-match（acceptableVariantIds=[]），20 个为 matchable
    const buildBatch = (falsePositives: number) => {
      const cases: EvaluationCase[] = [];
      const observations: EvaluationObservation[] = [];
      for (let i = 0; i < 30; i += 1) {
        const isNoMatch = i < 10;
        const caseId = `SIM-NM-${i + 1}`;
        cases.push({
          caseId,
          origin: 'real',
          category: isNoMatch ? 'no-match' : 'matchable',
          acceptableVariantIds: isNoMatch ? [] : ['line-react'],
          requiredGapFields: isNoMatch ? ['chart.type'] : [],
        });
        observations.push({
          caseId,
          top5VariantIds: isNoMatch ? (i < falsePositives ? ['pie-react'] : []) : ['line-react'],
          gapFields: isNoMatch ? ['chart.type'] : [],
          hardViolations: [],
        });
      }
      return scoreEvaluation(cases, observations);
    };

    const failReport = buildBatch(2); // 8/10 = 80% < 90%
    expect(failReport.real.noMatchRejection.value).toBe(0.8);
    expect(failReport.real.passed).toBe(false);

    const passReport = buildBatch(1); // 9/10 = 90%
    expect(passReport.real.noMatchRejection.value).toBe(0.9);
    expect(passReport.real.passed).toBe(true);
  });

  it('Top5 80% 与 gapRecall 90% 阈值边界精确生效', () => {
    // 30 案例：10 个 no-match（100% 拒绝，各 1 个 requiredGapField 共 10 个），20 个 matchable
    const buildThresholdBatch = (top5Misses: number, missedGaps: number) => {
      const cases: EvaluationCase[] = [];
      const observations: EvaluationObservation[] = [];
      for (let i = 0; i < 30; i += 1) {
        const isNoMatch = i < 10;
        const caseId = `SIM-TH-${i + 1}`;
        cases.push({
          caseId,
          origin: 'real',
          category: isNoMatch ? 'no-match' : 'matchable',
          acceptableVariantIds: isNoMatch ? [] : ['line-react'],
          requiredGapFields: isNoMatch ? ['chart.type'] : [],
        });
        const matchIdx = i - 10;
        observations.push({
          caseId,
          top5VariantIds: isNoMatch ? [] : matchIdx < top5Misses ? ['bar-react'] : ['line-react'],
          gapFields: isNoMatch ? (i < missedGaps ? [] : ['chart.type']) : [],
          hardViolations: [],
        });
      }
      return scoreEvaluation(cases, observations);
    };

    // Top5 = 16/20 = 0.80, gap = 9/10 = 0.90 -> passed
    const exactPass = buildThresholdBatch(4, 1);
    expect(exactPass.real.top5.value).toBe(0.8);
    expect(exactPass.real.gapRecall.value).toBe(0.9);
    expect(exactPass.real.passed).toBe(true);

    // Top5 = 15/20 = 0.75 < 0.80 -> failed
    const failTop5 = buildThresholdBatch(5, 1);
    expect(failTop5.real.top5.value).toBe(0.75);
    expect(failTop5.real.passed).toBe(false);

    // gap = 8/10 = 0.80 < 0.90 -> failed
    const failGap = buildThresholdBatch(4, 2);
    expect(failGap.real.gapRecall.value).toBe(0.8);
    expect(failGap.real.passed).toBe(false);
  });

  it('拒绝稀疏数组空洞（如 new Array(1)），防止 undefined 伪命中', () => {
    const sparseCase = makeCase({
      caseId: 'SPARSE-1',
      requiredGapFields: new Array<string>(1),
    });
    const sparseObs = makeObs({
      caseId: 'SPARSE-1',
      gapFields: new Array<string>(1),
    });

    expect(() => scoreEvaluation([sparseCase], [makeObs({ caseId: 'SPARSE-1' })])).toThrow(
      EvaluationInputError,
    );
    expect(() =>
      scoreEvaluation([makeCase({ caseId: 'SPARSE-1', requiredGapFields: ['config.unit'] })], [sparseObs]),
    ).toThrow(EvaluationInputError);
  });
});
