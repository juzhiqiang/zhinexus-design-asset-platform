import type {
  DesignElementV1,
  DesignIdInputV1,
  DesignIdMappingV1,
  ElementBindings,
  ValidationIssue,
  ValidationResult,
} from '@company/contracts';
import { validateDesignIdInput, validateDesignIdMapping } from '@company/contracts';

/**
 * 二期 ID 规则匹配：设计 ID 配置/元素清单/可选绑定的纯本地输入构造。
 *
 * 边界（与 `2026-11-15-phase2-match-plan-http.md` B 范围一致）：
 * - 只做「JSON 解析 + 白名单组装」，校验一律交给冻结契约 `validateDesignIdMapping` /
 *   `validateDesignIdInput`；不自定义公共 DTO、不重写校验规则、不发起任何网络请求；
 * - ID 为不透明字符串：不切分、不 trim、不转大小写、不解释为正则/路径/脚本；
 * - 未知字段与重复映射/实例在本地拒绝；未知 designId **不是**格式错误，交服务端报缺口；
 * - 空配置/空元素合法，但不得被称为匹配成功；
 * - 诊断只输出安全字段路径与固定文案，不回显服务端原文或 token。
 */

/** 规则 JSON 语法失败的固定文案（不含解析器原文）。 */
export const MAPPING_JSON_SYNTAX_ERROR = '规则 JSON 不是合法的 JSON 文本，请检查格式';

/** 绑定 JSON 语法失败的固定文案（不含解析器原文）。 */
export const BINDINGS_JSON_SYNTAX_ERROR = '绑定 JSON 不是合法的 JSON 文本，请检查格式';

/** 绑定不是数组时的固定文案。 */
export const BINDINGS_NOT_ARRAY_ERROR = '绑定必须是 JSON 数组，可留空';

type ParsedJson = { ok: true; value: unknown } | { ok: false; issue: ValidationIssue };

/** 解析用户粘贴的 JSON 文本；语法失败只返回固定文案，绝不带上解析器原文。 */
function parseJsonText(raw: string, message: string): ParsedJson {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, issue: { code: 'INVALID_SCHEMA', path: '', message } };
  }
}

/**
 * 解析显式规则 JSON 为 `DesignIdMappingV1`。
 *
 * - 语法失败：单条固定文案 issue（路径为空，由界面渲染为根路径）；
 * - 结构/跨字段失败：原样返回契约 issues（含 `/entries/{i}/...` 字段路径）。
 */
export function parseMappingJson(raw: string): ValidationResult<DesignIdMappingV1> {
  const parsed = parseJsonText(raw, MAPPING_JSON_SYNTAX_ERROR);
  if (!parsed.ok) return { ok: false, issues: [parsed.issue] };
  return validateDesignIdMapping(parsed.value);
}

/**
 * 用已解析的映射与元素清单组装完整输入并校验。
 *
 * 复用 `validateDesignIdInput`：重复映射/实例、未知字段、空白或超长 ID 都以
 * `/mapping/...`、`/elements/...` 前缀路径返回，便于界面锚定到具体输入。
 */
export function buildDesignIdInput(fields: {
  mapping: DesignIdMappingV1;
  elements: DesignElementV1[];
}): ValidationResult<DesignIdInputV1> {
  return validateDesignIdInput({ schemaVersion: 1, mapping: fields.mapping, elements: fields.elements });
}

/**
 * 按 designId 分组元素，供「同一 designId 多实例复用」的界面分组展示。
 *
 * 必须使用 `Map`：designId 是不透明字符串，可能是 `__proto__` / `constructor` 等
 * 原型键形状，用普通对象累加会污染原型或触发原型链遍历。
 */
export function groupElementsByDesignId(design: DesignIdInputV1): Map<string, DesignElementV1[]> {
  const groups = new Map<string, DesignElementV1[]>();
  for (const element of design.elements) {
    const bucket = groups.get(element.designId);
    if (bucket) bucket.push(element);
    else groups.set(element.designId, [element]);
  }
  return groups;
}

/** 界面原始输入：规则 JSON 文本、逐行元素、可选绑定 JSON 文本。 */
export type DesignFormFields = {
  mappingText: string;
  elements: DesignElementV1[];
  bindingsText: string;
};

export type DesignFormResult =
  | { ok: true; design: DesignIdInputV1; bindings?: ElementBindings[] }
  | { ok: false; issues: ValidationIssue[] };

/**
 * 界面提交入口：一次产出可直接交给 `requestMatchPlan` 的设计输入与可选绑定。
 *
 * 顺序：规则 JSON 语法 → 完整输入结构/跨字段校验（给 `/mapping` 前缀路径）→
 * 绑定 JSON 语法。空绑定（空文本或空数组）按省略处理，不发多余键。
 */
export function buildDesignForm(fields: DesignFormFields): DesignFormResult {
  const mapping = parseJsonText(fields.mappingText, MAPPING_JSON_SYNTAX_ERROR);
  if (!mapping.ok) return { ok: false, issues: [mapping.issue] };

  const design = validateDesignIdInput({ schemaVersion: 1, mapping: mapping.value, elements: fields.elements });
  if (!design.ok) return { ok: false, issues: design.issues };

  if (fields.bindingsText.trim() === '') return { ok: true, design: design.value };

  const parsedBindings = parseJsonText(fields.bindingsText, BINDINGS_JSON_SYNTAX_ERROR);
  if (!parsedBindings.ok) return { ok: false, issues: [parsedBindings.issue] };
  if (!Array.isArray(parsedBindings.value)) {
    return { ok: false, issues: [{ code: 'INVALID_SCHEMA', path: '/bindings', message: BINDINGS_NOT_ARRAY_ERROR }] };
  }
  if (parsedBindings.value.length === 0) return { ok: true, design: design.value };

  return { ok: true, design: design.value, bindings: parsedBindings.value as ElementBindings[] };
}
