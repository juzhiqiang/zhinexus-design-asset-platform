import type {
  DesignIdInputV1,
  ElementBindings,
  MatchPlanRequest,
  MatchPlanV1,
  ProjectContext,
  ValidationIssue,
} from '@company/contracts';
import { canonicalJson, manifestDigest, validateMatchPlan, validateMatchPlanRequest } from '@company/contracts';

/**
 * 二期 ID 规则匹配：装配方案 HTTP 客户端。
 *
 * 边界（与 `2026-11-15-phase2-match-plan-http.md` 冻结接口一致）：
 * - `POST {apiUrl}/v1/matching/plans`，Bearer read；请求体为冻结的 `MatchPlanRequest`
 *   （design / context / 可选 reactDomVersion / 可选 bindings），只用 contracts 导出，
 *   不另定义 HTTP 形状；
 * - 本地先按 `validateMatchPlanRequest` 校验：非法输入在本地即拒绝，**不发起任何网络请求**；
 * - 响应用 `validateMatchPlan` 解析，并核对 `inputDigest` 必须等于本地对**完整请求**计算的
 *   `manifestDigest`：不一致即视为与当前输入不符的旧响应，直接忽略；
 * - 取消语义：fetch 前、await fetch 后、await json 后三处检查，已取消一律 AbortError 上抛，
 *   不依赖 fetch 实现是否配合 signal；
 * - 不持久化任何输入或响应；不回显服务端原始错误、token 或 schema 原文——失败只给固定文案，
 *   仅本地输入校验失败才附带契约 issues（安全字段路径，不含用户输入值）。
 */

const DEFAULT_API_ORIGIN = process.env.NEXT_PUBLIC_PLATFORM_API_URL || 'http://127.0.0.1:3000';

/** 冻结端点路径。 */
export const MATCH_PLAN_PATH = '/v1/matching/plans';

/** 面向用户的固定失败文案：绝不含服务端原文、token 或内部细节。 */
const ERROR_MESSAGES = {
  INVALID_INPUT: '设计配置或项目上下文的输入不完整或格式不正确，请检查后重试',
  UNAUTHORIZED: '登录状态已失效，请重新登录后重试',
  UNAVAILABLE: '装配方案服务暂时不可用，请稍后重试',
  INVALID_RESPONSE: '装配方案结果格式不正确，请稍后重试',
  STALE: '装配结果与当前输入不一致，已忽略该响应',
} as const;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type MatchPlanOptions = {
  apiUrl?: string;
  token: string;
  design: DesignIdInputV1;
  context: ProjectContext;
  reactDomVersion?: string;
  bindings?: ElementBindings[];
  signal?: AbortSignal;
  /** 可注入 fetch（测试用）；缺省使用全局 fetch。 */
  fetch?: FetchLike;
};

/** 失败分类：界面据此决定「渲染字段路径」还是「渲染固定文案」。 */
export type MatchPlanFailureReason =
  | 'invalid-input'
  | 'unauthorized'
  | 'unavailable'
  | 'invalid-response'
  | 'stale';

export type MatchPlanOutcome =
  | { ok: true; value: MatchPlanV1; request: MatchPlanRequest; inputDigest: string }
  | { ok: false; reason: MatchPlanFailureReason; issues: ValidationIssue[]; message: string };

function resolveFetch(options: MatchPlanOptions): FetchLike {
  if (options.fetch) return options.fetch;
  if (typeof fetch !== 'undefined') return (input, init) => fetch(input, init);
  throw new Error(ERROR_MESSAGES.UNAVAILABLE);
}

/** 把任意失败规整为不回显原始内容的固定文案结果。 */
function fail(reason: MatchPlanFailureReason, message: string): MatchPlanOutcome {
  return { ok: false, reason, issues: [], message };
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

/**
 * 白名单构造请求体：只有非空可选项才出现对应键。
 * 这一点同时决定 `inputDigest`——多一个空键就会让摘要对不上。
 */
function buildRequestBody(options: MatchPlanOptions): Record<string, unknown> {
  const candidate: Record<string, unknown> = { design: options.design, context: options.context };
  const reactDomVersion = typeof options.reactDomVersion === 'string' ? options.reactDomVersion.trim() : '';
  if (reactDomVersion) candidate.reactDomVersion = reactDomVersion;
  const bindings = options.bindings ?? [];
  if (bindings.length > 0) candidate.bindings = bindings;
  return candidate;
}

export async function requestMatchPlan(options: MatchPlanOptions): Promise<MatchPlanOutcome> {
  const { token, signal } = options;
  const apiUrl = options.apiUrl ?? DEFAULT_API_ORIGIN;

  // 本地先校验请求：非法输入在本地即被拒绝，不发起任何网络请求
  const requestCheck = validateMatchPlanRequest(buildRequestBody(options));
  if (!requestCheck.ok) {
    return { ok: false, reason: 'invalid-input', issues: requestCheck.issues, message: ERROR_MESSAGES.INVALID_INPUT };
  }
  const request = structuredClone(requestCheck.value);

  const doFetch = resolveFetch(options);
  let response: Response;
  try {
    throwIfAborted(signal); // 检查点 1：发起请求前
    response = await doFetch(`${apiUrl}${MATCH_PLAN_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    });
    throwIfAborted(signal); // 检查点 2：await fetch 之后
  } catch (error) {
    // 取消必须原样上抛：调用方据此忽略旧响应，绝不降级为业务结果
    if (isAbortError(error)) throw error;
    return fail('unavailable', ERROR_MESSAGES.UNAVAILABLE);
  }

  if (!response.ok) {
    const unauthorized = response.status === 401 || response.status === 403;
    return fail(unauthorized ? 'unauthorized' : 'unavailable', unauthorized ? ERROR_MESSAGES.UNAUTHORIZED : ERROR_MESSAGES.UNAVAILABLE);
  }

  let payload: unknown;
  try {
    payload = await response.json();
    throwIfAborted(signal); // 检查点 3：await json 之后
  } catch (error) {
    if (isAbortError(error)) throw error;
    return fail('invalid-response', ERROR_MESSAGES.INVALID_RESPONSE);
  }

  // 先核对输入摘要：响应必须对应当前完整请求，否则视为旧响应直接忽略（先于 schema 判断，
  // 避免把不符输入的响应当成本次结果）
  let expectedDigest: string;
  try {
    expectedDigest = await manifestDigest(request);
  } catch {
    return fail('invalid-response', ERROR_MESSAGES.INVALID_RESPONSE);
  }
  throwIfAborted(signal);
  const receivedDigest = payload !== null && typeof payload === 'object'
    ? (payload as { inputDigest?: unknown }).inputDigest
    : undefined;
  if (receivedDigest !== expectedDigest) {
    return fail('stale', ERROR_MESSAGES.STALE);
  }

  const planCheck = validateMatchPlan(payload);
  if (!planCheck.ok) {
    return fail('invalid-response', ERROR_MESSAGES.INVALID_RESPONSE);
  }
  const plan=planCheck.value;
  if(plan.ruleSetId!==request.design.mapping.ruleSetId || plan.revision!==request.design.mapping.revision ||
    canonicalJson(plan.context)!==canonicalJson(request.context) || plan.elements.length!==request.design.elements.length) return fail('invalid-response',ERROR_MESSAGES.INVALID_RESPONSE);
  const expectedElements=new Map(request.design.elements.map(e=>[e.instanceId,e]));
  for(const element of plan.elements){
    const expected=expectedElements.get(element.instanceId);
    if(!expected||expected.designId!==element.designId)return fail('invalid-response',ERROR_MESSAGES.INVALID_RESPONSE);
    if(element.status==='mapped'){
      const target=request.design.mapping.entries.find(e=>e.designId===element.designId&&e.framework===request.context.framework);
      const binding=request.bindings?.find(b=>b.instanceId===element.instanceId);
      if(!target||target.variantReleaseId!==element.target!.variantReleaseId||element.layout!==binding?.layout||
        element.props.some(p=>p.source!==binding?.props.find(b=>b.name===p.name)?.source)||
        element.events.some(e=>e.handler!==binding?.events.find(b=>b.name===e.name)?.handler))return fail('invalid-response',ERROR_MESSAGES.INVALID_RESPONSE);
    }
  }

  return { ok: true, value: planCheck.value, request, inputDigest: expectedDigest };
}
