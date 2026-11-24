import {
  validateSearchCandidatesRequest,
  validateSearchCandidatesResponse,
  type SearchCandidatesResponse,
  type ValidationResult,
} from '@company/contracts';

/**
 * 二期 B3：文本检索客户端。
 *
 * 边界（与 `2026-11-15-phase2-text-search.md` B3 一致）：
 * - `POST {apiUrl}/v1/search/candidates`，Bearer 取当前 session；请求体与响应均复用
 *   `@company/contracts` 校验器，不自定义公共 DTO、不重写校验规则；
 * - 只有调用方显式发起才请求（本模块不自动轮询、不重试）；
 * - 传入 `signal` 时遵循取消语义：已取消的调用以 `AbortError` 拒绝，绝不再解析或返回旧响应；
 * - 不持久化查询、上下文或响应；不回显服务端原始错误或 token——错误信息只使用固定文案。
 */

const DEFAULT_API_ORIGIN = process.env.NEXT_PUBLIC_PLATFORM_API_URL || 'http://127.0.0.1:3000';

/** 面向用户的固定错误文案：绝不包含服务端原文、token 或内部细节。 */
const ERROR_MESSAGES = {
  INVALID_INPUT: '检索输入不完整或格式不正确，请检查后重试',
  UNAUTHORIZED: '登录状态已失效，请重新登录后重试',
  NETWORK: '检索服务暂时不可用，请稍后重试',
  INVALID_RESPONSE: '检索结果格式不正确，请稍后重试',
} as const;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type SearchCandidatesOptions = {
  apiUrl?: string;
  token: string;
  query: string;
  context: unknown;
  reactDomVersion?: string;
  signal?: AbortSignal;
  /** 可注入 fetch（测试用）；缺省使用全局 fetch。 */
  fetch?: FetchLike;
};

function resolveFetch(options: SearchCandidatesOptions): FetchLike {
  if (options.fetch) return options.fetch;
  if (typeof fetch !== 'undefined') return (input, init) => fetch(input, init);
  throw new Error(ERROR_MESSAGES.NETWORK);
}

/** 把任意失败规整为不回显原始内容的固定文案 issues。 */
function fail(message: string): ValidationResult<SearchCandidatesResponse> {
  return { ok: false, issues: [{ code: 'INVALID_SCHEMA', path: '', message }] };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * 取消检查点：不依赖 fetch 实现是否配合 signal。
 * 在发起请求前、await fetch 之后、await json 之后统一检查；已取消一律以 AbortError 抛出，
 * 让调用方据此忽略旧响应，绝不把旧数据当成本次结果返回。
 */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    throw error;
  }
}

export async function searchCandidates(
  options: SearchCandidatesOptions,
): Promise<ValidationResult<SearchCandidatesResponse>> {
  const { token, query, context, reactDomVersion, signal } = options;
  const apiUrl = options.apiUrl ?? DEFAULT_API_ORIGIN;

  // 本地先校验请求：非法输入在本地即被拒绝，不发起任何网络请求
  const candidate: Record<string, unknown> = {
    query: query.trim(),
    context,
  };
  if (reactDomVersion !== undefined && reactDomVersion.trim() !== '') {
    candidate.reactDomVersion = reactDomVersion.trim();
  }

  const requestCheck = validateSearchCandidatesRequest(candidate);
  if (!requestCheck.ok) return fail(ERROR_MESSAGES.INVALID_INPUT);

  const doFetch = resolveFetch(options);
  let response: Response;
  try {
    throwIfAborted(signal); // 检查点 1：发起请求前
    response = await doFetch(`${apiUrl}/v1/search/candidates`, {
      ...(token==='__session__' ? {credentials:'include' as const} : {}),
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(requestCheck.value),
      ...(signal ? { signal } : {}),
    });
    throwIfAborted(signal); // 检查点 2：await fetch 之后
  } catch (error) {
    // 取消必须原样上抛：调用方据此忽略旧响应，绝不降级为业务结果
    if (isAbortError(error)) throw error;
    return fail(ERROR_MESSAGES.NETWORK);
  }

  if (!response.ok) {
    return fail(response.status === 401 || response.status === 403 ? ERROR_MESSAGES.UNAUTHORIZED : ERROR_MESSAGES.NETWORK);
  }

  let payload: unknown;
  try {
    payload = await response.json();
    throwIfAborted(signal); // 检查点 3：await json 之后
  } catch (error) {
    if (isAbortError(error)) throw error;
    return fail(ERROR_MESSAGES.INVALID_RESPONSE);
  }

  // 响应经契约解析：形状校验不证明证据真实性，也不证明兼容性。
  // 解析失败一律使用固定文案，不回显含输入键的 schema 原文。
  const parsed = validateSearchCandidatesResponse(payload);
  if (!parsed.ok) return fail(ERROR_MESSAGES.INVALID_RESPONSE);
  return parsed;
}
