import type {
  ComponentMatchQueryV1,
  ComponentMatchResponseV1,
  ValidationIssue,
} from '@company/contracts';
import { canonicalJson, validateComponentMatchQuery, validateComponentMatchResponse } from '@company/contracts';

/**
 * 二期 P1：组件标识精确查询 HTTP 客户端（`GET /v1/matching/components`）。
 *
 * 公开契约（与计划 P1 `Interfaces` 约定一致）：
 * - `requestComponentMatch(query, { token, signal?, apiUrl? }): Promise<ComponentMatchResponseV1>`
 *   ——**直接返回冻结响应类型**；失败以抛错结束（`ComponentMatchRequestError` 带 `reason` /
 *   安全字段 `issues` / 固定文案 `message`）；
 * - `requestComponentMatchWithOutcome(query, options)` 是 UI 侧 helper：把失败规整成
 *   `{ ok: false; reason; issues; message }`，只给固定安全文案，便于表单直接渲染；
 * - `buildComponentMatchQuery(fields)` 是纯函数：**不 trim**，空白原样交给校验，
 *   由 `validateComponentMatchQuery` 拒绝，而不是先 trim 成合法值发出去。
 *
 * 其它边界（与 `docs/specs/2026-11-16-phase2-query-completion-design.md` 一致）：
 * - `GET`，**无 body**，Bearer read；查询字段经 `URLSearchParams` 单次编码
 *   （scoped packageName 同样只编码一次），不另定义 HTTP 形状；
 * - 本地先按 `validateComponentMatchQuery` 校验：非法输入在本地即拒绝，**不发起任何网络请求**，
 *   只呈现安全字段路径（不含用户输入值与服务端内部细节）；
 * - 响应用公开的 `validateComponentMatchResponse` 解析，并核对响应 `query` 与本次请求逐字段一致，
 *   不一致即视为与当前条件不符的旧响应；
 * - 取消语义：fetch 前、await fetch 后、await json 后三处检查，已取消一律 AbortError 上抛，
 *   不依赖 fetch 实现是否配合 signal；
 * - 不持久化任何查询或响应；不回显服务端原始错误、token 或 schema 原文。
 */

const DEFAULT_API_ORIGIN = process.env.NEXT_PUBLIC_PLATFORM_API_URL || 'http://127.0.0.1:3000';

/** 冻结端点路径。 */
export const COMPONENT_MATCH_PATH = '/v1/matching/components';

/** 面向用户的固定失败文案：绝不含服务端原文、token 或内部细节。 */
const ERROR_MESSAGES = {
  'invalid-input': '组件查询条件不完整或格式不正确，请检查后重试',
  unauthorized: '登录状态已失效，请重新登录后重试',
  unavailable: '组件查询服务暂时不可用，请稍后重试',
  conflict: '同一查询条件匹配多个可读发布，请补充 packageName 后重试',
  'invalid-response': '组件查询结果格式不正确，请稍后重试',
  stale: '查询结果与当前条件不一致，已忽略该响应',
} as const;

export type ComponentMatchFailureReason = keyof typeof ERROR_MESSAGES;

/** 失败分类：界面据此决定「渲染字段路径」还是「渲染固定文案」。 */
export class ComponentMatchRequestError extends Error {
  constructor(readonly reason: ComponentMatchFailureReason, readonly issues: ValidationIssue[], message: string) {
    super(message);
    this.name = 'ComponentMatchRequestError';
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ComponentMatchOptions = {
  apiUrl?: string;
  token: string;
  signal?: AbortSignal;
  /** 可注入 fetch（测试用）；缺省使用全局 fetch。 */
  fetch?: FetchLike;
};

export type ComponentMatchOutcome =
  | { ok: true; value: ComponentMatchResponseV1 }
  | { ok: false; reason: ComponentMatchFailureReason; issues: ValidationIssue[]; message: string };

/** 表单字段 → 查询对象。**不 trim**：空白必须原样交给校验，不能被静默去掉。 */
export function buildComponentMatchQuery(fields: {
  componentId: string;
  framework: string;
  packageVersion: string;
  packageName?: string;
  frameworkVersion: string;
  echartsVersion: string;
  reactDomVersion?: string;
}): ComponentMatchQueryV1 {
  const query: ComponentMatchQueryV1 = {
    componentId: fields.componentId,
    framework: fields.framework as ComponentMatchQueryV1['framework'],
    packageVersion: fields.packageVersion,
    frameworkVersion: fields.frameworkVersion,
    echartsVersion: fields.echartsVersion,
  };
  // 只有「键存在」才写入：空串与空白都算提供了值，由校验拒绝，不在这里替用户决定
  if (fields.packageName !== undefined) query.packageName = fields.packageName;
  if (fields.reactDomVersion !== undefined) query.reactDomVersion = fields.reactDomVersion;
  return query;
}

/** 用 `URLSearchParams` 构造查询串：可选字段缺省时不出现对应键。 */
export function componentMatchSearchParams(query: ComponentMatchQueryV1): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, value);
  return params;
}

function resolveFetch(options: ComponentMatchOptions): FetchLike {
  if (options.fetch) return options.fetch;
  if (typeof fetch !== 'undefined') return (input, init) => fetch(input, init);
  throw new Error(ERROR_MESSAGES.unavailable);
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

type CoreResult =
  | { ok: true; value: ComponentMatchResponseV1 }
  | { ok: false; reason: ComponentMatchFailureReason; issues: ValidationIssue[] };

async function run(query: ComponentMatchQueryV1, options: ComponentMatchOptions): Promise<CoreResult> {
  const { token, signal } = options;
  const apiUrl = options.apiUrl ?? DEFAULT_API_ORIGIN;

  // 本地先校验请求：非法输入在本地即被拒绝，不发起任何网络请求
  const queryCheck = validateComponentMatchQuery(query);
  if (!queryCheck.ok) return { ok: false, reason: 'invalid-input', issues: queryCheck.issues };
  const fixed = structuredClone(queryCheck.value);

  const doFetch = resolveFetch(options);
  let response: Response;
  try {
    throwIfAborted(signal); // 检查点 1：发起请求前
    response = await doFetch(`${apiUrl}${COMPONENT_MATCH_PATH}?${componentMatchSearchParams(fixed).toString()}`, {
      ...(token==='__session__' ? {credentials:'include' as const} : {}),
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      ...(signal ? { signal } : {}),
    });
    throwIfAborted(signal); // 检查点 2：await fetch 之后
  } catch (error) {
    // 取消必须原样上抛：调用方据此忽略旧响应，绝不降级为业务结果
    if (isAbortError(error)) throw error;
    return { ok: false, reason: 'unavailable', issues: [] };
  }

  if (response.status === 409) return { ok: false, reason: 'conflict', issues: [] };
  if (!response.ok) {
    const unauthorized = response.status === 401 || response.status === 403;
    return { ok: false, reason: unauthorized ? 'unauthorized' : 'unavailable', issues: [] };
  }

  let payload: unknown;
  try {
    payload = await response.json();
    throwIfAborted(signal); // 检查点 3：await json 之后
  } catch (error) {
    if (isAbortError(error)) throw error;
    return { ok: false, reason: 'invalid-response', issues: [] };
  }
  throwIfAborted(signal);

  const responseCheck = validateComponentMatchResponse(payload);
  if (!responseCheck.ok) return { ok: false, reason: 'invalid-response', issues: [] };
  // 响应必须对应当前查询条件：逐字段比对 query，不一致即视为旧响应
  if (canonicalJson(responseCheck.value.query) !== canonicalJson(fixed)) {
    return { ok: false, reason: 'stale', issues: [] };
  }
  return { ok: true, value: responseCheck.value };
}

/** 计划约定的公开签名：成功返回响应，失败抛 `ComponentMatchRequestError`。 */
export async function requestComponentMatch(query: ComponentMatchQueryV1, options: ComponentMatchOptions): Promise<ComponentMatchResponseV1> {
  const result = await run(query, options);
  if (result.ok) return result.value;
  throw new ComponentMatchRequestError(result.reason, result.issues, ERROR_MESSAGES[result.reason]);
}

/** UI 侧 helper：把失败规整为固定文案结果，取消仍原样上抛。 */
export async function requestComponentMatchWithOutcome(query: ComponentMatchQueryV1, options: ComponentMatchOptions): Promise<ComponentMatchOutcome> {
  try {
    return { ok: true, value: await requestComponentMatch(query, options) };
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (error instanceof ComponentMatchRequestError) {
      return { ok: false, reason: error.reason, issues: error.issues, message: error.message };
    }
    return { ok: false, reason: 'unavailable', issues: [], message: ERROR_MESSAGES.unavailable };
  }
}
