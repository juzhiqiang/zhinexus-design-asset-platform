import { describe, expect, it, vi } from 'vitest';
import type { ComponentMatchQueryV1 } from '@company/contracts';
import { validateComponentMatchQuery, validateComponentMatchResponse } from '@company/contracts';
import { componentMatchGapFixture, componentMatchQueryFixture, componentMatchResponseFixture } from '../fixtures/component-match.js';
import {
  COMPONENT_MATCH_PATH, buildComponentMatchQuery, requestComponentMatch, requestComponentMatchWithOutcome,
  type ComponentMatchOutcome,
} from '../../apps/admin/app/lib/component-match-client.js';

/**
 * 二期 P1：组件标识精确查询 HTTP 客户端测试。
 *
 * 公开契约（计划 P1 `Interfaces` 约定，本轮按 C 初审意见对齐）：
 * - `requestComponentMatch(query, { token, signal?, apiUrl? }): Promise<ComponentMatchResponseV1>`
 *   ——直接返回冻结响应类型；失败以抛错结束，由 UI 侧 helper 规整为固定文案；
 * - UI helper `requestComponentMatchWithOutcome` 另命名，返回
 *   `{ ok: true; value } | { ok: false; reason; issues; message }`，只给固定安全文案；
 * - `GET {apiUrl}/v1/matching/components?<query>`，无 body，Bearer read；查询字段只用
 *   `ComponentMatchQueryV1`，经 `URLSearchParams` 单次编码（scoped packageName 同样只编码一次）；
 * - 本地先按 `validateComponentMatchQuery` 校验：非法输入在本地即拒绝，**不发起任何网络请求**，
 *   只呈现安全字段路径（不含用户输入值与服务端内部细节）；
 * - 响应用公开的 `validateComponentMatchResponse` 解析，并核对响应 `query` 与本次请求逐字段一致，
 *   不一致即视为与当前条件不符的旧响应；
 * - 取消语义：fetch 前、await fetch 后、await json 后三处检查，已取消一律 AbortError 上抛；
 * - 不回显服务端原始错误、token 或 schema 原文。
 *
 * TDD 记录：本文件曾按新公开契约重写并处于 RED，宿主确认 RED 后已转 GREEN；
 * 后续修订只涉及断言口径（scoped 响应回显、非 2xx 分类、stale 用自洽响应）与静态导入，
 * 未改动上述任何安全断言。
 */

const API_URL = 'http://127.0.0.1:3000';
const TOKEN = 'phase2-query-token';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type FetchMock = ReturnType<typeof vi.fn> & FetchLike;

function stubFetch(handler: (input: string, init?: RequestInit) => Promise<Response>): FetchMock {
  const mock = vi.fn(handler) as unknown as FetchMock;
  vi.stubGlobal('fetch', mock);
  return mock;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}

/** 延迟到 `release()` 才产出 JSON 的响应：用于取消检查点 3 与迟到响应场景。 */
function deferredResponse(): { response: Promise<Response>; release: (body: unknown, status?: number) => void } {
  let resolve!: (value: Response) => void;
  const response = new Promise<Response>(r => { resolve = r; });
  return { response, release: (body, status = 200) => resolve(jsonResponse(body, status)) };
}

/** 客户端应发出的完整 URL（与 `URLSearchParams` 编码一致）。 */
function expectedUrl(query: ComponentMatchQueryV1): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, value);
  return `${API_URL}${COMPONENT_MATCH_PATH}?${params.toString()}`;
}

type OutcomeOptions = { apiUrl?: string; token: string; query: ComponentMatchQueryV1; signal?: AbortSignal };
/** UI 侧 outcome helper：把失败规整为固定文案结果。 */
async function outcomeHelper(options: OutcomeOptions): Promise<ComponentMatchOutcome> {
  return requestComponentMatchWithOutcome(options.query, {
    apiUrl: options.apiUrl, token: options.token, ...(options.signal ? { signal: options.signal } : {}),
  });
}

/**
 * 断言 outcome 走的是失败分支并收窄类型。
 * `ComponentMatchOutcome` 是可辨识联合，`reason` / `issues` / `message` 只存在于失败分支，
 * 不收窄就直接访问会在联合类型上报错。
 */
async function failedOutcome(options: OutcomeOptions): Promise<Extract<ComponentMatchOutcome, { ok: false }>> {
  const outcome = await outcomeHelper(options);
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error('预期 outcome 为失败分支');
  return outcome;
}

describe('组件精确查询客户端：公开签名 requestComponentMatch → ComponentMatchResponseV1', () => {
  it('合法 Vue 查询直接返回冻结响应类型，URL 用 URLSearchParams 编码且无 body', async () => {
    const query = componentMatchQueryFixture('vue');
    const response = componentMatchResponseFixture('vue');
    const fetchMock = stubFetch(async (input, init) => {
      expect(input).toBe(expectedUrl(query));
      expect(init?.method).toBe('GET');
      expect(init?.body).toBeUndefined();
      expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
      return jsonResponse(response);
    });
    const value = await requestComponentMatch(query, { apiUrl: API_URL, token: TOKEN });
    expect(validateComponentMatchResponse(value).ok).toBe(true);
    expect(value).toEqual(response);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('合法 scoped packageName 经单次 URLSearchParams 编码后发出，且响应 query 完全回显', async () => {
    const query = { ...componentMatchQueryFixture('react'), packageName: '@company/charts-react' };
    // 响应必须与请求逐字段一致（含 packageName），否则客户端会判为 stale
    const response = { ...componentMatchResponseFixture('react'), query };
    expect(validateComponentMatchResponse(response).ok).toBe(true);
    const fetchMock = stubFetch(async (input) => {
      const url = new URL(input);
      expect(url.searchParams.get('packageName')).toBe('@company/charts-react');
      expect(input).toContain('packageName=%40company%2Fcharts-react');
      return jsonResponse(response);
    });
    const value = await requestComponentMatch(query, { apiUrl: API_URL, token: TOKEN });
    expect(validateComponentMatchResponse(value).ok).toBe(true);
    expect(value.query.packageName).toBe('@company/charts-react');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('可选字段缺省时不出现对应查询键', async () => {
    const query = componentMatchQueryFixture('vue');
    const fetchMock = stubFetch(async (input) => {
      const url = new URL(input);
      expect(url.searchParams.has('packageName')).toBe(false);
      expect(url.searchParams.has('reactDomVersion')).toBe(false);
      return jsonResponse(componentMatchResponseFixture('vue'));
    });
    await requestComponentMatch(query, { apiUrl: API_URL, token: TOKEN });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gap 响应同样以 ComponentMatchResponseV1 返回', async () => {
    const query = componentMatchQueryFixture('vue');
    stubFetch(async () => jsonResponse(componentMatchGapFixture('vue')));
    const value = await requestComponentMatch(query, { apiUrl: API_URL, token: TOKEN });
    expect(value.status).toBe('gap');
    expect(value.target).toBeUndefined();
    expect(value.exactDependencies).toEqual([]);
  });

  it('signal 与 apiUrl 均可省略', async () => {
    const query = componentMatchQueryFixture('vue');
    stubFetch(async () => jsonResponse(componentMatchResponseFixture('vue')));
    await expect(requestComponentMatch(query, { token: TOKEN })).resolves.toMatchObject({ status: 'matched' });
  });
});

describe('组件精确查询客户端：失败以抛错结束并带上固定安全文案', () => {
  it('本地输入校验失败即抛错，且不发起任何网络请求', async () => {
    const fetchMock = stubFetch(async () => { throw new Error('不应发起网络请求'); });
    for (const query of [
      { ...componentMatchQueryFixture('vue'), componentId: undefined },
      { ...componentMatchQueryFixture('vue'), packageVersion: '^0.0.12' },
      { ...componentMatchQueryFixture('react'), reactDomVersion: undefined },
      { ...componentMatchQueryFixture('vue'), reactDomVersion: '19.3.1' },
    ] as ComponentMatchQueryV1[]) {
      await expect(requestComponentMatch(query, { apiUrl: API_URL, token: TOKEN })).rejects.toMatchObject({
        reason: 'invalid-input',
        message: '组件查询条件不完整或格式不正确，请检查后重试',
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [409, 'conflict', '同一查询条件匹配多个可读发布，请补充 packageName 后重试'],
    // 非 2xx（除 401/403/409）一律归为 unavailable：不回显服务端原文，也不把服务端拒绝
    // 解读成「响应格式错误」
    [400, 'unavailable', '组件查询服务暂时不可用，请稍后重试'],
    [500, 'unavailable', '组件查询服务暂时不可用，请稍后重试'],
    [401, 'unauthorized', '登录状态已失效，请重新登录后重试'],
    [403, 'unauthorized', '登录状态已失效，请重新登录后重试'],
  ])('HTTP %i → reason=%s，文案固定且不回显服务端原文', async (status, reason, message) => {
    const serverText = '内部细节：另一个发布 id=00000000-0000-4000-8000-0000000000ff 也命中';
    stubFetch(async () => textResponse(serverText, status));
    await expect(requestComponentMatch(componentMatchQueryFixture('vue'), { apiUrl: API_URL, token: TOKEN })).rejects.toMatchObject({ reason, message });
    try {
      await requestComponentMatch(componentMatchQueryFixture('vue'), { apiUrl: API_URL, token: TOKEN });
    } catch (error) {
      expect((error as Error).message).not.toContain(serverText);
      expect((error as Error).message).not.toContain('00000000-0000-4000-8000-0000000000ff');
    }
  });

  it('网络失败与非 JSON 响应都归为不可用，不回显原文', async () => {
    stubFetch(async () => { throw new Error('ECONNREFUSED 127.0.0.1:3000'); });
    await expect(requestComponentMatch(componentMatchQueryFixture('vue'), { apiUrl: API_URL, token: TOKEN })).rejects.toMatchObject({
      reason: 'unavailable', message: '组件查询服务暂时不可用，请稍后重试',
    });
    stubFetch(async () => textResponse('<html>gateway</html>', 502));
    await expect(requestComponentMatch(componentMatchQueryFixture('vue'), { apiUrl: API_URL, token: TOKEN })).rejects.toMatchObject({ reason: 'unavailable' });
  });
});

describe('组件精确查询客户端：响应校验与对齐', () => {
  it.each([
    ['schema 非法', { schemaVersion: 2, query: componentMatchQueryFixture('vue'), status: 'matched' }],
    ['gap 带 target', { ...componentMatchGapFixture('vue'), target: componentMatchResponseFixture('vue').target }],
    ['matched 缺 api', (() => { const r = componentMatchResponseFixture('vue'); delete (r as { api?: unknown }).api; return r; })()],
    ['target 身份与 query 不一致', { ...componentMatchResponseFixture('vue'), target: { ...componentMatchResponseFixture('vue').target!, componentId: 'other' } }],
    ['缺 echarts 精确依赖', { ...componentMatchResponseFixture('vue'), exactDependencies: [{ name: '@company/charts-vue', version: '0.0.12' }] }],
    ['matched 带非兼容缺口', { ...componentMatchResponseFixture('vue'), gaps: [{ code: 'TARGET_UNAVAILABLE', message: 'x' }] }],
  ])('响应未通过公开校验即抛错，不返回半成品：%s', async (_label, body) => {
    stubFetch(async () => jsonResponse(body));
    await expect(requestComponentMatch(componentMatchQueryFixture('vue'), { apiUrl: API_URL, token: TOKEN })).rejects.toMatchObject({
      reason: 'invalid-response', message: '组件查询结果格式不正确，请稍后重试',
    });
  });

  /**
   * stale 必须用**结构自洽**的响应来断言：如果只把 `query` 改掉而 target / api /
   * exactDependencies 还是旧请求的身份，公开运行时校验会先以 invalid-response 拒绝，
   * 根本走不到 stale 分支。这里用一份能通过 `validateComponentMatchResponse` 的
   * 合法 gap 响应，只让它的 `query` 与本次请求不同——**不调整安全校验的顺序**。
   */
  it('响应 query 与本次请求不一致时视为旧响应', async () => {
    const request = componentMatchQueryFixture('vue');
    const staleGap = {
      schemaVersion: 1 as const,
      query: { ...request, packageVersion: '0.0.9' },
      status: 'gap' as const,
      exactDependencies: [],
      gaps: [{ code: 'TARGET_UNAVAILABLE', message: 'Target unavailable' }],
    };
    expect(validateComponentMatchResponse(staleGap).ok).toBe(true);
    stubFetch(async () => jsonResponse(staleGap));
    await expect(requestComponentMatch(request, { apiUrl: API_URL, token: TOKEN })).rejects.toMatchObject({
      reason: 'stale', message: '查询结果与当前条件不一致，已忽略该响应',
    });
  });

  it('React 查询只接受带精确 reactDomVersion 的对齐响应', async () => {
    const request = componentMatchQueryFixture('react');
    // 同样是一份自洽的合法 gap 响应，只有 reactDomVersion 与请求不同
    const staleGap = {
      schemaVersion: 1 as const,
      query: { ...request, reactDomVersion: '19.3.0' },
      status: 'gap' as const,
      exactDependencies: [],
      gaps: [{ code: 'TARGET_UNAVAILABLE', message: 'Target unavailable' }],
    };
    expect(validateComponentMatchResponse(staleGap).ok).toBe(true);
    stubFetch(async () => jsonResponse(staleGap));
    await expect(requestComponentMatch(request, { apiUrl: API_URL, token: TOKEN })).rejects.toMatchObject({ reason: 'stale' });
  });
});

describe('组件精确查询客户端：取消与迟到响应', () => {
  it('已取消的信号在 fetch 前即抛 AbortError，不发请求', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(componentMatchResponseFixture('vue')));
    const controller = new AbortController();
    controller.abort();
    await expect(requestComponentMatch(componentMatchQueryFixture('vue'), {
      apiUrl: API_URL, token: TOKEN, signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetch 后取消：await fetch 之后检查点抛 AbortError，旧响应不外泄', async () => {
    const controller = new AbortController();
    stubFetch(async () => {
      controller.abort();
      return jsonResponse(componentMatchResponseFixture('vue'));
    });
    await expect(requestComponentMatch(componentMatchQueryFixture('vue'), {
      apiUrl: API_URL, token: TOKEN, signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('json 之后取消：迟到响应不得作为本次结果返回', async () => {
    const controller = new AbortController();
    let enterJson!: () => void;
    let releaseJson!: (value: unknown) => void;
    const entered = new Promise<void>(resolve => { enterJson = resolve; });
    const parsed = new Promise<unknown>(resolve => { releaseJson = resolve; });
    const response = jsonResponse(componentMatchResponseFixture('vue'));
    const json = vi.spyOn(response, 'json').mockImplementation(() => {
      enterJson();
      return parsed;
    });
    stubFetch(async () => response);
    const pending = requestComponentMatch(componentMatchQueryFixture('vue'), {
      apiUrl: API_URL, token: TOKEN, signal: controller.signal,
    });
    await entered;
    expect(json).toHaveBeenCalledOnce();
    controller.abort();
    releaseJson(componentMatchResponseFixture('vue'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('signal 透传给 fetch，便于调用方中止在途请求', async () => {
    let seen: AbortSignal | undefined;
    stubFetch(async (_input, init) => {
      seen = (init as { signal?: AbortSignal } | undefined)?.signal;
      return jsonResponse(componentMatchResponseFixture('vue'));
    });
    const controller = new AbortController();
    await requestComponentMatch(componentMatchQueryFixture('vue'), { apiUrl: API_URL, token: TOKEN, signal: controller.signal });
    expect(seen).toBe(controller.signal);
  });
});

describe('组件精确查询客户端：UI outcome helper 与查询构造', () => {
  it('outcome helper 把失败规整为固定文案，成功时原样带回响应', async () => {
    const query = componentMatchQueryFixture('vue');
    stubFetch(async () => jsonResponse(componentMatchResponseFixture('vue')));
    const ok = await outcomeHelper({ apiUrl: API_URL, token: TOKEN, query });
    expect(ok.ok).toBe(true);
    if (!ok.ok) throw new Error('预期 outcome 为成功分支');
    expect(ok.value).toEqual(componentMatchResponseFixture('vue'));

    stubFetch(async () => textResponse('内部细节', 500));
    const failed = await failedOutcome({ apiUrl: API_URL, token: TOKEN, query });
    expect(failed.reason).toBe('unavailable');
    expect(failed.message).toBe('组件查询服务暂时不可用，请稍后重试');
    expect(failed.message).not.toContain('内部细节');
  });

  it('outcome helper 对本地输入校验失败带回安全字段路径，不回显用户输入值', async () => {
    const fetchMock = stubFetch(async () => { throw new Error('不应发起网络请求'); });
    const failed = await failedOutcome({
      apiUrl: API_URL, token: TOKEN,
      query: { ...componentMatchQueryFixture('vue'), packageVersion: '^0.0.12' },
    });
    expect(failed.reason).toBe('invalid-input');
    expect(Array.isArray(failed.issues)).toBe(true);
    expect(failed.issues.every(issue => issue.path.startsWith('/'))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('查询构造不得 trim：空白必须原样交给校验，不能被静默去掉', () => {
    const built = buildComponentMatchQuery({
      componentId: 'line', framework: 'vue', packageVersion: '0.0.12',
      packageName: ' @company/charts-vue ', frameworkVersion: '3.5.45', echartsVersion: '6.1.0',
    });
    // 原值保留：由 validateComponentMatchQuery 拒绝，而不是先 trim 成合法值发出去
    expect(built.packageName).toBe(' @company/charts-vue ');
    expect(validateComponentMatchQuery(built).ok).toBe(false);
  });

  it('查询构造对 reactDomVersion 同样不 trim', () => {
    const built = buildComponentMatchQuery({
      componentId: 'line', framework: 'react', packageVersion: '0.0.12',
      frameworkVersion: '19.3.1', echartsVersion: '6.1.0', reactDomVersion: ' 19.3.1 ',
    });
    expect(built.reactDomVersion).toBe(' 19.3.1 ');
    expect(validateComponentMatchQuery(built).ok).toBe(false);
  });
});
