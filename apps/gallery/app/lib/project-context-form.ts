import {
  validateProjectContext,
  type ProjectContext,
  type ValidationResult,
} from '@company/contracts';

/**
 * 二期 B1：项目上下文本地表单的纯转换。
 *
 * 只做「白名单构造 + 空白可选 ECharts 省略」，其余一律交由 `@company/contracts` 的
 * `validateProjectContext` 校验；不自定义公共校验规则、不虚构兼容状态、不调用任何检索/匹配端点。
 */

/** 表单原始输入：字段均为字符串，requirements 为字符串数组；缺字段以「省略该键」表示。 */
export type ProjectContextFields = {
  framework?: string;
  frameworkVersion?: string;
  echartsVersion?: string;
  packageManager?: string;
  requirements?: string[];
};

/**
 * 将表单原始字段规整为 `ProjectContext` 并校验，返回契约 `ValidationResult<ProjectContext>`。
 *
 * - 白名单构造：仅纳入已提供（非 `undefined`）的字段；缺必填字段时不塞 `undefined`，
 *   避免 `assertJson` 以根路径报错，从而让 `validateProjectContext` 返回对应字段路径的「必填缺失」。
 * - `echartsVersion` 可选：`trim` 后为空则省略，非空才纳入。
 * - `requirements` 原样纳入（含空白单项），由契约 `text` 规则拒绝空白项、允许空数组。
 */
export function buildProjectContext(fields: ProjectContextFields): ValidationResult<ProjectContext> {
  const candidate: Record<string, unknown> = {};

  if (fields.framework !== undefined) candidate.framework = fields.framework;
  if (fields.frameworkVersion !== undefined) candidate.frameworkVersion = fields.frameworkVersion;
  if (fields.packageManager !== undefined) candidate.packageManager = fields.packageManager;
  if (fields.requirements !== undefined) candidate.requirements = fields.requirements;

  const echartsVersion = typeof fields.echartsVersion === 'string' ? fields.echartsVersion.trim() : '';
  if (echartsVersion) candidate.echartsVersion = echartsVersion;

  return validateProjectContext(candidate);
}
