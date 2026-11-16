import { createHash } from 'node:crypto';
import type { IdEvalCase, IdEvaluationReport } from './id-matching.js';
import { evaluateIdMatching, IdEvaluationInputError } from './id-matching.js';

/** 运行器元数据；由调用方提供，用于报告可追溯性。 */
export type IdEvaluationMetadata = {
  mappingVersion: string;
  runnerVersion: string;
};

/** T13 ID 评估入口的完整报告：在评估器报告上追加字节级摘要与生产验收声明。 */
export type IdEvaluationRunReport = IdEvaluationReport & {
  metadata: IdEvaluationMetadata;
  inputSha256: string;
  observationSha256: string;
  productionAcceptance: false;
};

const CASE_FIELDS = new Set(['caseId', 'origin', 'expected']);
const EXPECTED_FIELDS = new Set(['elements', 'requiredPlanGapCodes']);
const ELEMENT_FIELDS = new Set([
  'instanceId',
  'designId',
  'expectedStatus',
  'expectedVariantReleaseId',
  'expectedFramework',
  'requiredGapCodes',
  'forbiddenVariantReleaseIds',
]);
const OBSERVATION_FIELDS = new Set(['caseId', 'plan']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** 原始文本的 SHA-256（按 UTF-8 原始字节，不重新序列化）。 */
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 拒绝未知字段；错误信息只包含定位路径，绝不回显字段值。 */
function rejectUnknownFields(record: Record<string, unknown>, allowed: Set<string>, path: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new IdEvaluationInputError(`${path} 存在未知字段`);
    }
  }
}

/** 解析 JSON 文本为数组；解析失败只报告位置，不回显输入内容。 */
function parseArray(raw: string, label: string): unknown[] {
  if (typeof raw !== 'string') {
    throw new IdEvaluationInputError(`${label} 必须为 JSON 字符串`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new IdEvaluationInputError(`${label} 不是合法 JSON`);
  }
  if (!Array.isArray(parsed)) {
    throw new IdEvaluationInputError(`${label} 必须为 JSON 数组`);
  }
  return parsed;
}

/** 校验 cases 结构（严格字段白名单），返回按脚本侧评估器所需形状的副本。 */
function validateCasesJson(items: unknown[]): IdEvalCase[] {
  const seen = new Set<string>();
  const cases: IdEvalCase[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!isRecord(item)) {
      throw new IdEvaluationInputError(`cases[${i}] 必须为对象`);
    }
    rejectUnknownFields(item, CASE_FIELDS, `cases[${i}]`);
    if (!isRecord(item.expected)) {
      throw new IdEvaluationInputError(`cases[${i}].expected 必须为对象`);
    }
    rejectUnknownFields(item.expected, EXPECTED_FIELDS, `cases[${i}].expected`);
    if (!Array.isArray(item.expected.elements)) {
      throw new IdEvaluationInputError(`cases[${i}].expected.elements 必须为数组`);
    }
    for (let j = 0; j < item.expected.elements.length; j += 1) {
      const el = item.expected.elements[j];
      if (!isRecord(el)) {
        throw new IdEvaluationInputError(`cases[${i}].expected.elements[${j}] 必须为对象`);
      }
      rejectUnknownFields(el, ELEMENT_FIELDS, `cases[${i}].expected.elements[${j}]`);
    }
    if (typeof item.caseId === 'string') {
      if (seen.has(item.caseId)) {
        throw new IdEvaluationInputError(`cases[${i}] 存在重复 caseId`);
      }
      seen.add(item.caseId);
    }
    // 完整标注交由评估器验证；此处仅剥离 plan，确保 cases 中不含观测。
    cases.push({
      caseId: item.caseId as string,
      origin: item.origin as IdEvalCase['origin'],
      expected: item.expected as IdEvalCase['expected'],
      plan: undefined,
    });
  }
  return cases;
}

/** 校验 observations 结构（严格字段白名单），要求与 cases 一一对应。 */
function mapObservations(items: unknown[], caseIds: Set<string>): Map<string, unknown> {
  const plans = new Map<string, unknown>();
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!isRecord(item)) {
      throw new IdEvaluationInputError(`observations[${i}] 必须为对象`);
    }
    rejectUnknownFields(item, OBSERVATION_FIELDS, `observations[${i}]`);
    if (typeof item.caseId !== 'string' || item.caseId.trim().length === 0) {
      throw new IdEvaluationInputError(`observations[${i}].caseId 必须为非空字符串`);
    }
    if (!('plan' in item)) {
      throw new IdEvaluationInputError(`observations[${i}] 缺少 plan`);
    }
    if (plans.has(item.caseId)) {
      throw new IdEvaluationInputError(`observations[${i}] 存在重复 caseId`);
    }
    if (!caseIds.has(item.caseId)) {
      throw new IdEvaluationInputError(`observations[${i}] 对应未知 case`);
    }
    plans.set(item.caseId, item.plan);
  }
  return plans;
}

function validateMetadata(metadata: unknown): IdEvaluationMetadata {
  if (!isRecord(metadata)) {
    throw new IdEvaluationInputError('metadata 必须为对象');
  }
  rejectUnknownFields(metadata, new Set(['mappingVersion', 'runnerVersion']), 'metadata');
  const { mappingVersion, runnerVersion } = metadata;
  if (typeof mappingVersion !== 'string' || mappingVersion.trim().length === 0) {
    throw new IdEvaluationInputError('metadata.mappingVersion 必须为非空字符串');
  }
  if (typeof runnerVersion !== 'string' || runnerVersion.trim().length === 0) {
    throw new IdEvaluationInputError('metadata.runnerVersion 必须为非空字符串');
  }
  return { mappingVersion, runnerVersion };
}

/**
 * T13 ID 评估入口：读取 cases 与 observations 的原始 JSON 文本，
 * 按 caseId 合并后复用 evaluateIdMatching 评分，并在报告上追加摘要与验收声明。
 * real 与 synthetic 的评分保持独立，passed 沿用评估器的 real.passed；
 * 离线评分不等同生产验收，故 productionAcceptance 恒为 false。
 */
export function runIdEvaluation(
  casesJson: string,
  observationsJson: string,
  metadata: unknown,
): IdEvaluationRunReport {
  const meta = validateMetadata(metadata);
  const caseItems = parseArray(casesJson, 'cases');
  const observationItems = parseArray(observationsJson, 'observations');
  const inputSha256 = sha256(casesJson);
  const observationSha256 = sha256(observationsJson);

  const cases = validateCasesJson(caseItems);
  if (cases.length === 0 && observationItems.length > 0) {
    throw new IdEvaluationInputError('cases 为空但存在 observations');
  }
  const caseIds = new Set(cases.map((c) => c.caseId));
  const plans = mapObservations(observationItems, caseIds);
  for (let i = 0; i < cases.length; i += 1) {
    if (!plans.has(cases[i]!.caseId)) {
      throw new IdEvaluationInputError(`cases[${i}] 缺少对应 observation`);
    }
  }

  const merged = cases.map((c) => ({ ...c, plan: plans.get(c.caseId) }));
  const report = evaluateIdMatching(merged);

  return {
    ...report,
    metadata: meta,
    inputSha256,
    observationSha256,
    productionAcceptance: false,
  };
}
