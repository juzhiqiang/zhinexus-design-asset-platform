import {
  validateSearchCandidatesResponse,
  type SearchCandidatesResponse,
  type ValidationResult,
} from '@company/contracts';

/**
 * 二期 B2：候选响应解析。
 *
 * 直接复用 `@company/contracts` 的 `validateSearchCandidatesResponse`，不自定义公共响应结构、
 * 不重写校验规则。契约校验器已将非 JSON / 非法输入规整为 `{ ok: false, issues }`，
 * 因此本函数对外承诺「不抛原始异常」，只返回既有 `ValidationResult<SearchCandidatesResponse>`。
 *
 * 形状校验不证明证据真实性，也不证明兼容性；是否 `verified` 以契约为准。
 */
export function parseCandidateResults(input: unknown): ValidationResult<SearchCandidatesResponse> {
  return validateSearchCandidatesResponse(input);
}
