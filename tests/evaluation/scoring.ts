/**
 * 二期 A2 离线评分器（仅测试工具内部类型，非 `@company/contracts` 公共 DTO）。
 *
 * 边界说明：
 * - 处理显式人工标注与观测结果，不调用外部模型、不声称自动检测语义硬违规；
 * - 严格隔离 `real` 与 `synthetic` 样本；
 * - 任一指标分母为 0 时返回 `value: null` 与 `display: 'N/A'`，且 `passed: false`；
 * - `real` 组需同时满足 `totalCases >= 30`、`trapCases >= 10`、`missingObservations === 0`、
 *   `hardViolationCases === 0`、`top5 >= 0.8`、`gapRecall >= 0.9` 才可 `passed: true`。
 */

export type EvalOrigin = 'real' | 'synthetic';

export type EvalCategory =
  | 'matchable'
  | 'no-match'
  | 'missing-constraint'
  | 'cross-framework-trap'
  | 'api-trap'
  | 'data-semantic-trap';

export type EvaluationCase = {
  caseId: string;
  origin: EvalOrigin;
  category: EvalCategory;
  acceptableVariantIds: string[];
  requiredGapFields: string[];
};

export type EvaluationObservation = {
  caseId: string;
  top5VariantIds: string[];
  gapFields: string[];
  hardViolations: string[];
};

export type MetricSummary = {
  numerator: number;
  denominator: number;
  value: number | null;
  display: string;
};

export type GroupScore = {
  origin: EvalOrigin;
  totalCases: number;
  trapCases: number;
  missingObservations: number;
  hardViolationCases: number;
  top5: MetricSummary;
  gapRecall: MetricSummary;
  noMatchRejection: MetricSummary;
  passed: boolean;
};

export type CaseFailure = {
  caseId: string;
  origin: EvalOrigin;
  category: EvalCategory;
  reasons: string[];
};

export type EvaluationScoreReport = {
  real: GroupScore;
  synthetic: GroupScore;
  passed: boolean;
  failures: CaseFailure[];
};

export class EvaluationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvaluationInputError';
  }
}

const VALID_ORIGINS = new Set<EvalOrigin>(['real', 'synthetic']);
const VALID_CATEGORIES = new Set<EvalCategory>([
  'matchable',
  'no-match',
  'missing-constraint',
  'cross-framework-trap',
  'api-trap',
  'data-semantic-trap',
]);
const TRAP_CATEGORIES = new Set<EvalCategory>([
  'no-match',
  'missing-constraint',
  'cross-framework-trap',
  'api-trap',
  'data-semantic-trap',
]);

const MIN_REAL_CASES = 30;
const MIN_TRAP_CASES = 10;
const MIN_TOP5_RECALL = 0.8;
const MIN_GAP_RECALL = 0.9;
const TOP_K = 5;

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new EvaluationInputError(`${label} 必须为非空字符串`);
  }
  return value;
}

function assertStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new EvaluationInputError(`${label} 必须为数组`);
  }
  return value.map((item, idx) => assertNonEmptyString(item, `${label}[${idx}]`));
}

function validateCases(cases: EvaluationCase[]): Map<string, EvaluationCase> {
  if (!Array.isArray(cases)) {
    throw new EvaluationInputError('cases 必须为数组');
  }
  const caseMap = new Map<string, EvaluationCase>();
  for (let i = 0; i < cases.length; i += 1) {
    const item = cases[i];
    if (!item || typeof item !== 'object') {
      throw new EvaluationInputError(`cases[${i}] 必须为对象`);
    }
    const caseId = assertNonEmptyString(item.caseId, `cases[${i}].caseId`);
    if (caseMap.has(caseId)) {
      throw new EvaluationInputError(`重复的 caseId: ${caseId}`);
    }
    if (!VALID_ORIGINS.has(item.origin)) {
      throw new EvaluationInputError(`cases[${i}].origin 非法: ${String(item.origin)}`);
    }
    if (!VALID_CATEGORIES.has(item.category)) {
      throw new EvaluationInputError(`cases[${i}].category 非法: ${String(item.category)}`);
    }
    const acceptableVariantIds = assertStringArray(
      item.acceptableVariantIds,
      `cases[${i}].acceptableVariantIds`,
    );
    const requiredGapFields = assertStringArray(
      item.requiredGapFields,
      `cases[${i}].requiredGapFields`,
    );
    caseMap.set(caseId, {
      caseId,
      origin: item.origin,
      category: item.category,
      acceptableVariantIds,
      requiredGapFields,
    });
  }
  return caseMap;
}

function validateObservations(
  observations: EvaluationObservation[],
  caseMap: Map<string, EvaluationCase>,
): Map<string, EvaluationObservation> {
  if (!Array.isArray(observations)) {
    throw new EvaluationInputError('observations 必须为数组');
  }
  const obsMap = new Map<string, EvaluationObservation>();
  for (let i = 0; i < observations.length; i += 1) {
    const item = observations[i];
    if (!item || typeof item !== 'object') {
      throw new EvaluationInputError(`observations[${i}] 必须为对象`);
    }
    const caseId = assertNonEmptyString(item.caseId, `observations[${i}].caseId`);
    if (!caseMap.has(caseId)) {
      throw new EvaluationInputError(`未知的 observation caseId: ${caseId}`);
    }
    if (obsMap.has(caseId)) {
      throw new EvaluationInputError(`重复的 observation caseId: ${caseId}`);
    }
    obsMap.set(caseId, {
      caseId,
      top5VariantIds: assertStringArray(item.top5VariantIds, `observations[${i}].top5VariantIds`),
      gapFields: assertStringArray(item.gapFields, `observations[${i}].gapFields`),
      hardViolations: assertStringArray(item.hardViolations, `observations[${i}].hardViolations`),
    });
  }
  return obsMap;
}

function buildMetric(numerator: number, denominator: number): MetricSummary {
  if (denominator === 0) {
    return { numerator: 0, denominator: 0, value: null, display: 'N/A' };
  }
  const value = numerator / denominator;
  return {
    numerator,
    denominator,
    value,
    display: `${(value * 100).toFixed(1)}%`,
  };
}

function scoreGroup(
  origin: EvalOrigin,
  groupCases: EvaluationCase[],
  obsMap: Map<string, EvaluationObservation>,
  failures: CaseFailure[],
): GroupScore {
  let trapCases = 0;
  let missingObservations = 0;
  let hardViolationCases = 0;
  let top5Hits = 0;
  let top5Total = 0;
  let gapHits = 0;
  let gapTotal = 0;
  let noMatchHits = 0;
  let noMatchTotal = 0;

  for (const evalCase of groupCases) {
    if (TRAP_CATEGORIES.has(evalCase.category)) {
      trapCases += 1;
    }

    const requiredGaps = new Set(evalCase.requiredGapFields);
    gapTotal += requiredGaps.size;

    const isMatchable = evalCase.acceptableVariantIds.length > 0;
    if (isMatchable) {
      top5Total += 1;
    } else {
      noMatchTotal += 1;
    }

    const obs = obsMap.get(evalCase.caseId);
    if (!obs) {
      missingObservations += 1;
      failures.push({
        caseId: evalCase.caseId,
        origin,
        category: evalCase.category,
        reasons: ['missing-observation'],
      });
      continue;
    }

    const caseReasons: string[] = [];
    const hasHardViolation = obs.hardViolations.length > 0;
    if (hasHardViolation) {
      hardViolationCases += 1;
      for (const violation of obs.hardViolations) {
        caseReasons.push(`hard-violation: ${violation}`);
      }
    }

    // 仅取前 5 个候选；且硬违规案例不得计入有效命中
    const top5 = obs.top5VariantIds.slice(0, TOP_K);
    if (isMatchable) {
      const acceptable = new Set(evalCase.acceptableVariantIds);
      const matched = top5.some((variantId) => acceptable.has(variantId));
      if (matched && !hasHardViolation) {
        top5Hits += 1;
      } else if (!matched) {
        caseReasons.push('top5-miss');
      }
    } else {
      const rejectedCleanly = top5.length === 0 && !hasHardViolation;
      if (rejectedCleanly) {
        noMatchHits += 1;
      } else if (top5.length > 0) {
        caseReasons.push('no-match-false-positive');
      }
    }

    // 所需 gap 字段按集合去重计分，观测重复上报不重复加分
    if (requiredGaps.size > 0) {
      const observedGaps = new Set(obs.gapFields);
      const missingGaps: string[] = [];
      for (const field of requiredGaps) {
        if (observedGaps.has(field)) {
          gapHits += 1;
        } else {
          missingGaps.push(field);
        }
      }
      if (missingGaps.length > 0) {
        caseReasons.push(`missing-required-gaps: ${missingGaps.join(', ')}`);
      }
    }

    if (caseReasons.length > 0) {
      failures.push({
        caseId: evalCase.caseId,
        origin,
        category: evalCase.category,
        reasons: caseReasons,
      });
    }
  }

  const top5 = buildMetric(top5Hits, top5Total);
  const gapRecall = buildMetric(gapHits, gapTotal);
  const noMatchRejection = buildMetric(noMatchHits, noMatchTotal);

  const passed =
    origin === 'real' &&
    groupCases.length >= MIN_REAL_CASES &&
    trapCases >= MIN_TRAP_CASES &&
    missingObservations === 0 &&
    hardViolationCases === 0 &&
    top5.value !== null &&
    top5.value >= MIN_TOP5_RECALL &&
    gapRecall.value !== null &&
    gapRecall.value >= MIN_GAP_RECALL;

  return {
    origin,
    totalCases: groupCases.length,
    trapCases,
    missingObservations,
    hardViolationCases,
    top5,
    gapRecall,
    noMatchRejection,
    passed,
  };
}

/** 对人工标注案例与观测结果执行离线评估，严格分离 real 与 synthetic。 */
export function scoreEvaluation(
  cases: EvaluationCase[],
  observations: EvaluationObservation[],
): EvaluationScoreReport {
  const caseMap = validateCases(cases);
  const obsMap = validateObservations(observations, caseMap);

  const realCases: EvaluationCase[] = [];
  const syntheticCases: EvaluationCase[] = [];
  for (const evalCase of caseMap.values()) {
    if (evalCase.origin === 'real') {
      realCases.push(evalCase);
    } else {
      syntheticCases.push(evalCase);
    }
  }

  const failures: CaseFailure[] = [];
  const real = scoreGroup('real', realCases, obsMap, failures);
  const synthetic = scoreGroup('synthetic', syntheticCases, obsMap, failures);

  return {
    real,
    synthetic,
    passed: real.passed,
    failures,
  };
}
