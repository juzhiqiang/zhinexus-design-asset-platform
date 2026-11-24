import { describe, expect, it, vi } from 'vitest';
import type { SearchCandidatesRequest, SearchCandidatesResponse } from '@company/contracts';
import { validateSearchCandidatesRequest, validateSearchCandidatesResponse } from '@company/contracts';
import { candidateFixture } from '../fixtures/search.js';
import { searchCandidates } from '../../apps/admin/app/lib/search-client.js';

/**
 * 二期 B3：文本检索客户端的 RED 基线测试（`search-client.ts` 尚未创建）。
 *
 * 约定（与 `2026-11-15-phase2-text-search.md` B3 一致）：
 * - `searchCandidates` 位于 `apps/gallery/app/lib/search-client.ts`；
 * - `POST {apiUrl}/v1/search/candidates`，Bearer 取当前 session；请求体经契约
 *   `validateSearchCandidatesRequest` 校验（复用，不自定义公共 DTO）；
 * - 响应经 `validateSearchCandidatesResponse` 解析，返回既有 `ValidationResult<SearchCandidatesResponse>`；
 * - 只有用户明确点击搜索才 POST；取消（AbortController）后旧响应必须被忽略；
 * - 不持久化查询、上下文或响应；不回显服务端原始错误或 token。
 *
 * TDD 记录：实现文件缺失时本文件因无法解析导入而失败（RED）；由 C 在宿主确认 RED 后再实现转 GREEN。
 */

const API_URL = 'http://127.0.0.1:3000';
const TOKEN = 'phase2-search-token';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type FetchMock = ReturnType<typeof vi.fn> & FetchLike;

/** 注入可控 fetch：同时作为全局 fetch 与可注入的 `fetch` 依赖（同一实例，便于断言）。 */
function stubFetch(handler: (input: string, init?: RequestInit) => Promise<Response>): FetchMock {
  const mock = vi.fn(handler) as unknown as FetchMock;
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** 便捷构造 JSON / 文本响应。 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}

const context = {
  framework: 'react' as const,
  frameworkVersion: '19.3.1',
  packageManager: 'pnpm' as const,
  requirements: ['销售数据看板'],
};

function okResponse(): SearchCandidatesResponse {
  return { candidates: [candidateFixture()], gaps: [] };
}

describe('searchCandidates（二期文本检索客户端）', () => {
  it('显式调用才 POST 到 /v1/search/candidates，Bearer 取当前 session', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(okResponse()));

    await searchCandidates({
      apiUrl: API_URL,
      token: TOKEN,
      query: '折线图',
      context,
      fetch: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${API_URL}/v1/search/candidates`);
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers['content-type']).toBe('application/json');
    const body = JSON.parse(String(init?.body)) as SearchCandidatesRequest;
    expect(body.query).toBe('折线图');
    expect(body.context).toEqual(context);
    expect(Object.prototype.hasOwnProperty.call(body, 'reactDomVersion')).toBe(false);

    vi.unstubAllGlobals();
  });

  it('reactDomVersion 仅在提供时发送，且为精确版本', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(okResponse()));

    await searchCandidates({
      apiUrl: API_URL,
      token: TOKEN,
      query: '柱状图',
      context,
      reactDomVersion: '19.3.1',
      fetch: fetchMock,
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as SearchCandidatesRequest;
    expect(body.reactDomVersion).toBe('19.3.1');
    expect(validateSearchCandidatesRequest(body).ok).toBe(true);

    vi.unstubAllGlobals();
  });

  it('空白 query 在本地即被拒绝，不发起请求', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(okResponse()));

    const result = await searchCandidates({
      apiUrl: API_URL,
      token: TOKEN,
      query: '   ',
      context,
      fetch: fetchMock,
    });

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('非法上下文在本地即被拒绝，不发起请求', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(okResponse()));

    const result = await searchCandidates({
      apiUrl: API_URL,
      token: TOKEN,
      query: '折线图',
      context: { ...context, frameworkVersion: '^19.0.0' } as unknown as typeof context,
      fetch: fetchMock,
    });

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('成功响应经契约解析后保留真实字段', async () => {
    const result = await searchCandidates({
      apiUrl: API_URL,
      token: TOKEN,
      query: '折线图',
      context,
      fetch: stubFetch(async () => jsonResponse(okResponse())),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.candidates).toHaveLength(1);
      expect(result.value.candidates[0]).toEqual(candidateFixture());
    }

    vi.unstubAllGlobals();
  });

  it('空 candidates 通过校验并原样返回（诚实空态）', async () => {
    const empty = { candidates: [], gaps: ['仅搜索发布元数据，未提供用途/视觉评分'] };

    const result = await searchCandidates({
      apiUrl: API_URL,
      token: TOKEN,
      query: '不存在的组件',
      context,
      fetch: stubFetch(async () => jsonResponse(empty)),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.candidates).toEqual([]);
      expect(result.value.gaps).toContain('仅搜索发布元数据，未提供用途/视觉评分');
    }

    vi.unstubAllGlobals();
  });

  it('契约拒绝的响应（如重复 variantReleaseId）返回 ok:false', async () => {
    const dup = { candidates: [candidateFixture(), candidateFixture()], gaps: [] };

    const result = await searchCandidates({
      apiUrl: API_URL,
      token: TOKEN,
      query: '折线图',
      context,
      fetch: stubFetch(async () => jsonResponse(dup)),
    });

    expect(result.ok).toBe(false);
    expect(validateSearchCandidatesResponse(dup).ok).toBe(false);

    vi.unstubAllGlobals();
  });

  it('非 JSON 响应返回 ok:false 且不回显服务端原始内容或 token', async () => {
    const raw = 'upstream boom: secret-token-leak';

    const result = await searchCandidates({
      apiUrl: API_URL,
      token: TOKEN,
      query: '折线图',
      context,
      fetch: stubFetch(async () => textResponse(raw, 500)),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const serialized = JSON.stringify(result.issues);
      expect(serialized).not.toContain(raw);
      expect(serialized).not.toContain(TOKEN);
      expect(serialized).not.toContain('secret-token-leak');
    }

    vi.unstubAllGlobals();
  });

  it('HTTP 401 返回 ok:false 且不泄露 token', async () => {
    const result = await searchCandidates({
      apiUrl: API_URL,
      token: TOKEN,
      query: '折线图',
      context,
      fetch: stubFetch(async () => jsonResponse({ message: 'unauthorized' }, 401)),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(JSON.stringify(result.issues)).not.toContain(TOKEN);
    }

    vi.unstubAllGlobals();
  });

  it('取消后旧响应被忽略：已取消的调用不返回结果', async () => {
    const fetchMock = vi.fn((_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    })) as unknown as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    const pending = searchCandidates({
      apiUrl: API_URL,
      token: TOKEN,
      query: '折线图',
      context,
      signal: controller.signal,
      fetch: fetchMock,
    });

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    vi.unstubAllGlobals();
  });

  it('卸载/换身份后旧响应被忽略：取消信号触发后不再返回旧数据', async () => {
    const fetchMock = vi.fn((_input: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
      resolve(jsonResponse(okResponse()));
    })) as unknown as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    const settled = searchCandidates({
      apiUrl: API_URL,
      token: TOKEN,
      query: '折线图',
      context,
      signal: controller.signal,
      fetch: fetchMock,
    }).then(
      (value) => ({ aborted: false, value }),
      (error: unknown) => ({ aborted: (error as Error)?.name === 'AbortError', value: null }),
    );

    controller.abort();

    const outcome = await settled;
    expect(outcome.aborted).toBe(true);
    expect(outcome.value).toBeNull();

    vi.unstubAllGlobals();
  });

  it('signal 在调用前已取消：不发请求，直接以 AbortError 拒绝', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(okResponse()));
    const controller = new AbortController();
    controller.abort();

    await expect(searchCandidates({
      apiUrl: API_URL,
      token: TOKEN,
      query: '折线图',
      context,
      signal: controller.signal,
      fetch: fetchMock,
    })).rejects.toMatchObject({ name: 'AbortError' });

    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('fetch 已返回但取消发生在解析前：仍以 AbortError 拒绝，不返回旧数据', async () => {
    let releaseJson: () => void = () => {};
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: () => new Promise<unknown>((resolve) => { releaseJson = () => resolve(okResponse()); }),
    }) as unknown as (input: string, init?: RequestInit) => Promise<Response>) as unknown as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    const settled = searchCandidates({
      apiUrl: API_URL,
      token: TOKEN,
      query: '折线图',
      context,
      signal: controller.signal,
      fetch: fetchMock,
    }).then(
      (value) => ({ aborted: false, value }),
      (error: unknown) => ({ aborted: (error as Error)?.name === 'AbortError', value: null }),
    );

    // 等 fetch resolve，但 json 仍挂起
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    releaseJson();

    const outcome = await settled;
    expect(outcome.aborted).toBe(true);
    expect(outcome.value).toBeNull();

    vi.unstubAllGlobals();
  });

  it('响应 schema 错误使用固定文案，不展示含输入键的 schema 原文', async () => {
    const bad = { candidates: [{ ...candidateFixture(), packageVersion: '^1.0.0' }], gaps: [] };

    const result = await searchCandidates({
      apiUrl: API_URL,
      token: TOKEN,
      query: '折线图',
      context,
      fetch: stubFetch(async () => jsonResponse(bad)),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const serialized = JSON.stringify(result.issues);
      expect(serialized).not.toContain('packageVersion');
      expect(serialized).not.toContain('variantReleaseId');
      expect(serialized).not.toContain('/candidates/');
      expect(result.issues[0]?.message).toBe('检索结果格式不正确，请稍后重试');
    }

    vi.unstubAllGlobals();
  });

  it('不持久化查询、上下文或响应（无 localStorage / sessionStorage 写入）', async () => {
    const writes: string[] = [];
    const setItem = (key: string) => { writes.push(key); };
    vi.stubGlobal('localStorage', { getItem: () => null, setItem, removeItem: () => {} });
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem, removeItem: () => {} });

    await searchCandidates({
      apiUrl: API_URL,
      token: TOKEN,
      query: '折线图',
      context,
      fetch: stubFetch(async () => jsonResponse(okResponse())),
    });

    expect(writes).toEqual([]);

    vi.unstubAllGlobals();
  });
});
