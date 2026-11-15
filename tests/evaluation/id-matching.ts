import { MATCH_GAP_CODES, validateMatchPlan, type MatchGap, type MatchPlanV1 } from '@company/contracts';

export type IdEvalOrigin = 'real' | 'synthetic';

export type IdExpectedElement = {
  instanceId: string;
  designId: string;
  expectedStatus: 'mapped' | 'gap';
  expectedVariantReleaseId?: string;
  expectedFramework?: 'vue' | 'react';
  requiredGapCodes: MatchGap['code'][];
  forbiddenVariantReleaseIds?: string[];
};

export type IdEvalCase = {
  caseId: string;
  origin: IdEvalOrigin;
  expected: {
    elements: IdExpectedElement[];
    requiredPlanGapCodes?: MatchGap['code'][];
  };
  plan: unknown;
};

export type IdMetricSummary = {
  numerator: number;
  denominator: number;
  value: number | null;
  display: string;
};

export type IdGroupScore = {
  origin: IdEvalOrigin;
  totalCases: number;
  mappedExpectedInstances: number;
  exactMappedInstances: number;
  exactMappingRate: IdMetricSummary;
  hardViolationCases: number;
  missingExpectedGaps: number;
  passed: boolean;
};

export type IdCaseFailure = {
  caseId: string;
  origin: IdEvalOrigin;
  reasons: string[];
};

export type IdEvaluationReport = {
  real: IdGroupScore;
  synthetic: IdGroupScore;
  passed: boolean;
  failures: IdCaseFailure[];
};

export class IdEvaluationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdEvaluationInputError';
  }
}

const VALID_ORIGINS = new Set<IdEvalOrigin>(['real', 'synthetic']);

function buildRate(numerator: number, denominator: number): IdMetricSummary {
  if (denominator === 0) {
    return { numerator: 0, denominator: 0, value: null, display: 'N/A' };
  }
  const value = numerator / denominator;
  return { numerator, denominator, value, display: `${(value * 100).toFixed(1)}%` };
}

function validateCases(cases: unknown): Map<IdEvalOrigin, IdEvalCase[]> {
  if (!Array.isArray(cases)) {
    throw new IdEvaluationInputError('cases 必须为数组');
  }
  const seenIds = new Set<string>();
  const grouped = new Map<IdEvalOrigin, IdEvalCase[]>([
    ['real', []],
    ['synthetic', []],
  ]);

  for (let i = 0; i < cases.length; i += 1) {
    const item = cases[i];
    if (!item || typeof item !== 'object') {
      throw new IdEvaluationInputError(`cases[${i}] 必须为对象`);
    }
    if (typeof item.caseId !== 'string' || item.caseId.trim().length === 0) {
      throw new IdEvaluationInputError(`cases[${i}].caseId 必须为非空字符串`);
    }
    if (seenIds.has(item.caseId)) {
      throw new IdEvaluationInputError(`重复的 caseId: ${item.caseId}`);
    }
    seenIds.add(item.caseId);

    if (!VALID_ORIGINS.has(item.origin)) {
      throw new IdEvaluationInputError(`cases[${i}].origin 非法`);
    }
    const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
    const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && /\S/.test(v);
    const codes = (v: unknown) => Array.isArray(v) && v.every(c => typeof c === 'string' && (MATCH_GAP_CODES as readonly string[]).includes(c));
    if (!record(item.expected) || !Array.isArray(item.expected.elements) ||
      (item.expected.requiredPlanGapCodes !== undefined && !codes(item.expected.requiredPlanGapCodes))) throw new IdEvaluationInputError('无效的 expected 标注');
    const instances = new Set<string>();
    for (const el of item.expected.elements) {
      if (!record(el) || !text(el.instanceId) || !text(el.designId) || !['mapped', 'gap'].includes(String(el.expectedStatus)) ||
        !codes(el.requiredGapCodes) || (el.expectedStatus === 'mapped' && !text(el.expectedVariantReleaseId)) ||
        (el.expectedVariantReleaseId !== undefined && !text(el.expectedVariantReleaseId)) ||
        (el.expectedFramework !== undefined && !['vue', 'react'].includes(String(el.expectedFramework))) ||
        (el.forbiddenVariantReleaseIds !== undefined && (!Array.isArray(el.forbiddenVariantReleaseIds) || !el.forbiddenVariantReleaseIds.every(text)))) throw new IdEvaluationInputError('无效的实例精确目标标注');
      if (instances.has(el.instanceId)) throw new IdEvaluationInputError('重复的预期实例');
      instances.add(el.instanceId);
    }
    grouped.get(item.origin)!.push(item as IdEvalCase);
  }
  return grouped;
}

function evaluateSingleCase(
  evalCase: IdEvalCase,
  failures: IdCaseFailure[],
): {
  mappedExpected: number;
  exactMapped: number;
  hardViolation: boolean;
  missingGaps: number;
} {
  const reasons: string[] = [];
  let hardViolation = false;
  let missingGaps = 0;
  let mappedExpected = 0;
  let exactMapped = 0;

  for (const el of evalCase.expected.elements) {
    if (el.expectedStatus === 'mapped') mappedExpected += 1;
  }

  const checked = validateMatchPlan(evalCase.plan);
  if (!checked.ok) {
    hardViolation = true;
    reasons.push('invalid-match-plan-schema');
    failures.push({ caseId: evalCase.caseId, origin: evalCase.origin, reasons });
    return { mappedExpected, exactMapped, hardViolation, missingGaps };
  }

  const plan: MatchPlanV1 = checked.value;
  const planElements = new Map(plan.elements.map((el) => [el.instanceId, el]));
  const expectedIds = new Set(evalCase.expected.elements.map((el) => el.instanceId));

  for (const actual of plan.elements) {
    if (!expectedIds.has(actual.instanceId)) {
      hardViolation = true;
      reasons.push(`unexpected-instance:${actual.instanceId}`);
    }
  }

  const actualPlanGapCodes = new Set(plan.gaps.map((g) => g.code));
  for (const code of evalCase.expected.requiredPlanGapCodes ?? []) {
    if (!actualPlanGapCodes.has(code)) {
      missingGaps += 1;
      reasons.push(`missing-plan-gap:${code}`);
    }
  }

  for (const exp of evalCase.expected.elements) {
    const actual = planElements.get(exp.instanceId);
    if (!actual) {
      hardViolation = true;
      reasons.push(`missing-instance:${exp.instanceId}`);
      continue;
    }

    if (actual.designId !== exp.designId) {
      hardViolation = true;
      reasons.push(`design-id-mismatch:${exp.instanceId}`);
    }

    if (exp.expectedStatus === 'gap') {
      if (actual.status === 'mapped') {
        hardViolation = true;
        reasons.push(`unauthorized-or-unmapped-assembly:${exp.instanceId}`);
      }
    } else {
      if (actual.status !== 'mapped' || !actual.target) {
        reasons.push(`expected-mapped-missed:${exp.instanceId}`);
      } else {
        const expectedFw = exp.expectedFramework ?? plan.context.framework;
        let elementValid = actual.designId === exp.designId;

        if (actual.target.framework !== expectedFw || actual.target.framework !== plan.context.framework) {
          hardViolation = true;
          elementValid = false;
          reasons.push(`wrong-framework:${exp.instanceId}`);
        }

        if (
          exp.expectedVariantReleaseId !== undefined &&
          actual.target.variantReleaseId !== exp.expectedVariantReleaseId
        ) {
          hardViolation = true;
          elementValid = false;
          reasons.push(`wrong-target-release:${exp.instanceId}`);
        }

        if (exp.forbiddenVariantReleaseIds?.includes(actual.target.variantReleaseId)) {
          hardViolation = true;
          elementValid = false;
          reasons.push(`forbidden-target-release:${exp.instanceId}`);
        }

        const eventNames = new Set(actual.events.map((e) => e.name));
        if (actual.target.framework === 'react' && eventNames.has('point-click')) {
          hardViolation = true;
          elementValid = false;
          reasons.push(`cross-framework-event-on-react:${exp.instanceId}`);
        }
        if (actual.target.framework === 'vue' && eventNames.has('onPointClick')) {
          hardViolation = true;
          elementValid = false;
          reasons.push(`cross-framework-event-on-vue:${exp.instanceId}`);
        }

        if (elementValid) {
          exactMapped += 1;
        }
      }
    }

    const actualElementGapCodes = new Set(actual.gaps.map((g) => g.code));
    for (const code of exp.requiredGapCodes) {
      if (!actualElementGapCodes.has(code)) {
        missingGaps += 1;
        reasons.push(`missing-element-gap:${exp.instanceId}:${code}`);
      }
    }
  }

  if (reasons.length > 0) {
    failures.push({ caseId: evalCase.caseId, origin: evalCase.origin, reasons });
  }

  return { mappedExpected, exactMapped, hardViolation, missingGaps };
}

function scoreGroup(
  origin: IdEvalOrigin,
  groupCases: IdEvalCase[],
  failures: IdCaseFailure[],
): IdGroupScore {
  let mappedExpectedInstances = 0;
  let exactMappedInstances = 0;
  let hardViolationCases = 0;
  let missingExpectedGaps = 0;

  for (const evalCase of groupCases) {
    const res = evaluateSingleCase(evalCase, failures);
    mappedExpectedInstances += res.mappedExpected;
    exactMappedInstances += res.exactMapped;
    if (res.hardViolation) hardViolationCases += 1;
    missingExpectedGaps += res.missingGaps;
  }

  const exactMappingRate = buildRate(exactMappedInstances, mappedExpectedInstances);
  // 空集（无有效可映射实例）或存在任何硬违规/遗漏缺口时不得通过
  const passed =
    groupCases.length > 0 &&
    mappedExpectedInstances > 0 &&
    hardViolationCases === 0 &&
    missingExpectedGaps === 0 &&
    exactMappingRate.value === 1;

  return {
    origin,
    totalCases: groupCases.length,
    mappedExpectedInstances,
    exactMappedInstances,
    exactMappingRate,
    hardViolationCases,
    missingExpectedGaps,
    passed,
  };
}

/** 评估确定性 ID 规则装配方案：严格分离 real 与 synthetic，空集与硬违规均失败关闭。 */
export function evaluateIdMatching(cases: unknown): IdEvaluationReport {
  const grouped = validateCases(cases);
  const failures: IdCaseFailure[] = [];

  const real = scoreGroup('real', grouped.get('real')!, failures);
  const synthetic = scoreGroup('synthetic', grouped.get('synthetic')!, failures);

  return {
    real,
    synthetic,
    passed: real.passed,
    failures,
  };
}
