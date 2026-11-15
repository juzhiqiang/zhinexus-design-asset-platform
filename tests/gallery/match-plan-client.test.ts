import { describe, expect, it, vi } from 'vitest';
import type { ElementBindings, MatchPlanRequest, MatchPlanV1 } from '@company/contracts';
import { manifestDigest } from '@company/contracts';
import { matchPlanFixture, matchRequestFixture } from '../fixtures/match-plan.js';
import { requestMatchPlan } from '../../apps/gallery/app/lib/match-plan-client.js';

/**
 * 二期 ID 规则匹配：装配方案 HTTP 客户端的 RED 基线测试
 * （`match-plan-client.ts` 尚未创建）。
 *
 * 约定（与 `2026-11-15-phase2-match-plan-http.md` 冻结接口一致）：
 * - `POST {apiUrl}/v1/matching/plans`，Bearer read；请求体为 `MatchPlanRequest`
 *   （design / context / 可选 reactDomVersion / 可选 bindings），只用冻结 contracts 导出；
 * - 本地先按 `validateMatchPlanRequest` 校验：非法输入在本地即拒绝，**不发起任何网络请求**，
 *   且只呈现安全字段路径（契约 message 不含用户输入值与服务端内部细节）；
 * - 响应用 `validateMatchPlan` 解析；`inputDigest` 必须等于本地对**完整请求**计算的
 *   `manifestDigest`，否则视为与当前输入不一致的旧响应并忽略；
 * - 取消语义：fetch 前、await fetch 后、await json 后三处检查，已取消统一 AbortError 上抛；
 * - 不回显服务端原始错误、token 或 schema 原文；401/403 一律提示重新登录。
 *
 * TDD 记录：实现文件缺失时本文件因无法解析导入而失败（RED）；由 C 在宿主确认 RED 后再实现转 GREEN。
 */

const API_URL = 'http://127.0.0.1:3000';
const TOKEN = 'phase2-design-token';
const PLAN_PATH = '/v1/matching/plans';

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
function deferredJsonResponse(payload: unknown): { response: Response; release: () => void } {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const response = {
    ok: true,
    status: 200,
    json: async () => {
      await pending;
      return payload;
    },
  } as unknown as Response;
  return { response, release };
}

const request = matchRequestFixture();

/** 用真实 manifestDigest 签发的合法响应体。 */
async function signedPlan(overrides: Partial<MatchPlanV1> = {}): Promise<MatchPlanV1> {
  const plan:MatchPlanV1=matchPlanFixture();delete plan.elements[0]!.props[0]!.source;delete plan.elements[0]!.events[0]!.handler;delete plan.elements[0]!.layout;
  plan.elements[0]!.gaps.push({code:'MISSING_PROP',message:'缺数据'},{code:'MISSING_EVENT',message:'缺事件'},{code:'LAYOUT_UNKNOWN',message:'缺布局'});
  return { ...plan, inputDigest: await manifestDigest(request), ...overrides };
}

const baseOptions = {
  apiUrl: API_URL,
  token: TOKEN,
  design: request.design,
  context: request.context,
};

describe('requestMatchPlan（二期装配方案客户端）', () => {
  it.each(['target','instance','design','revision','context','binding'])('拒绝回显正确摘要却改变请求语义的响应：%s', async change=>{
    const plan=await signedPlan();
    if(change==='target')plan.elements[0]!.target!.variantReleaseId='other';
    if(change==='instance')plan.elements[0]!.instanceId='other';
    if(change==='design')plan.elements[0]!.designId='other';
    if(change==='revision')plan.revision='other';
    if(change==='context')plan.context.frameworkVersion='3.5.44';
    if(change==='binding')plan.elements[0]!.props[0]!.source='invented';
    const result=await requestMatchPlan({...baseOptions,fetch:async()=>jsonResponse(plan)});
    expect(result.ok).toBe(false);
  });
  it('请求发出后调用者修改对象，不得更换已发送请求的摘要身份', async () => {
    const original = matchRequestFixture(); const originalDigest = await manifestDigest(original);
    const result = await requestMatchPlan({ ...baseOptions, design:original.design, context:original.context, fetch:async()=>{
      original.design.mapping.revision='mutated';
      return jsonResponse({...await signedPlan(),inputDigest:originalDigest});
    }});
    expect(result.ok).toBe(true); if(result.ok)expect(result.request.design.mapping.revision).toBe('draft-1');
  });
  it('显式调用才 POST 到 /v1/matching/plans，Bearer 取当前 session', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(await signedPlan()));

    const result = await requestMatchPlan({ ...baseOptions, fetch: fetchMock });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${API_URL}${PLAN_PATH}`);
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers['content-type']).toBe('application/json');
    expect(headers.accept).toBe('application/json');

    vi.unstubAllGlobals();
  });

  it('请求体只包含冻结契约字段，不夹带模型/OCR/截图之类未定义键', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(await signedPlan()));

    await requestMatchPlan({ ...baseOptions, fetch: fetchMock });

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['context', 'design']);
    expect(body.design).toEqual(request.design);
    expect(body.context).toEqual(request.context);
    for (const forbidden of ['model', 'ocr', 'ocrText', 'screenshot', 'prompt', 'image', 'query']) {
      expect(Object.prototype.hasOwnProperty.call(body, forbidden)).toBe(false);
    }

    vi.unstubAllGlobals();
  });

  it('空白 reactDomVersion 省略，提供时才发送；bindings 仅在提供时发送', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(await signedPlan()));

    await requestMatchPlan({ ...baseOptions, reactDomVersion: '   ', fetch: fetchMock });
    let body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(body, 'reactDomVersion')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body, 'bindings')).toBe(false);

    const bindings: ElementBindings[] = [
      { instanceId: 'node-1', props: [{ name: 'data', source: 'sales' }], events: [{ name: 'point-click', handler: 'showDetail' }], layout: 'grid cell 1' },
    ];
    await requestMatchPlan({ ...baseOptions, reactDomVersion: '19.3.1', bindings, fetch: fetchMock });
    body = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body)) as Record<string, unknown>;
    expect(body.reactDomVersion).toBe('19.3.1');
    expect(body.bindings).toEqual(bindings);

    vi.unstubAllGlobals();
  });

  it('本地校验失败（重复映射）时不发请求，并给出安全字段路径', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(await signedPlan()));
    const design = structuredClone(request.design);
    design.mapping.entries.push({ ...design.mapping.entries[0]! });

    const result = await requestMatchPlan({ ...baseOptions, design, fetch: fetchMock });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-input');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATE_ID', path: '/design/mapping/entries/1/designId' }),
    );
    // 本地诊断只呈现安全字段路径，不带用户输入值与服务端细节
    expect(result.message).not.toContain('设计/Line');

    vi.unstubAllGlobals();
  });

  it('本地校验失败（重复 instanceId）时不发请求', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(await signedPlan()));
    const design = structuredClone(request.design);
    design.elements.push({ instanceId: 'node-1', designId: 'other' });

    const result = await requestMatchPlan({ ...baseOptions, design, fetch: fetchMock });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-input');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATE_ID', path: '/design/elements/1/instanceId' }),
    );

    vi.unstubAllGlobals();
  });

  it('本地校验失败（绑定引用不存在实例）时不发请求', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(await signedPlan()));

    const result = await requestMatchPlan({
      ...baseOptions,
      bindings: [{ instanceId: 'ghost', props: [], events: [] }],
      fetch: fetchMock,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-input');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'REFERENCE_NOT_FOUND', path: '/bindings/0/instanceId' }),
    );

    vi.unstubAllGlobals();
  });

  it('本地校验失败（绑定内重复字段名）时不发请求', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(await signedPlan()));

    const result = await requestMatchPlan({
      ...baseOptions,
      bindings: [{ instanceId: 'node-1', props: [{ name: 'data', source: 'a' }, { name: 'data', source: 'b' }], events: [] }],
      fetch: fetchMock,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-input');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATE_ID', path: '/bindings/0/props/1/name' }),
    );

    vi.unstubAllGlobals();
  });

  it('本地校验失败（上下文非精确版本）时不发请求', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(await signedPlan()));

    const result = await requestMatchPlan({
      ...baseOptions,
      context: { ...request.context, frameworkVersion: '^19.0.0' },
      fetch: fetchMock,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-input');
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('inputDigest 等于本地对完整请求计算的 manifestDigest 时才接受方案', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(await signedPlan()));

    const result = await requestMatchPlan({ ...baseOptions, fetch: fetchMock });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inputDigest).toBe(await manifestDigest(request));
    expect(result.value.source).toBe('design-id');
    expect(result.value.elements).toHaveLength(1);
    expect(result.request.design).toEqual(request.design);

    vi.unstubAllGlobals();
  });

  it('inputDigest 与当前请求不一致时忽略响应（旧响应不得当作本次结果）', async () => {
    const stale = { ...matchPlanFixture(), inputDigest: 'a'.repeat(64) };
    const fetchMock = stubFetch(async () => jsonResponse(stale));

    const result = await requestMatchPlan({ ...baseOptions, fetch: fetchMock });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('stale');
    expect(result.issues).toEqual([]);
    expect(result.message).toBeTruthy();
    expect(result.message).not.toContain('设计/Line');

    vi.unstubAllGlobals();
  });

  it('401/403 一律提示重新登录，且不回显 token 或服务端原文', async () => {
    for (const status of [401, 403]) {
      const fetchMock = stubFetch(async () =>
        jsonResponse({ code: 'FORBIDDEN', message: `denied for ${TOKEN}`, details: [], requestId: 'req-1' }, status),
      );

      const result = await requestMatchPlan({ ...baseOptions, fetch: fetchMock });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('unauthorized');
      expect(result.message).not.toContain(TOKEN);
      expect(result.message).not.toContain('denied');
      expect(result.message).not.toContain('FORBIDDEN');

      vi.unstubAllGlobals();
    }
  });

  it('服务端 5xx/网络失败使用固定文案，不回显原始内容', async () => {
    const fetchMock = stubFetch(async () => textResponse('upstream boom: secret', 500));

    const result = await requestMatchPlan({ ...baseOptions, fetch: fetchMock });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unavailable');
    expect(result.message).not.toContain('upstream boom');
    expect(result.message).not.toContain('secret');

    vi.unstubAllGlobals();
  });

  it('fetch 抛出（断网）时按不可用处理', async () => {
    const fetchMock = stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    const result = await requestMatchPlan({ ...baseOptions, fetch: fetchMock });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unavailable');

    vi.unstubAllGlobals();
  });

  it('响应不符合契约时使用固定文案，不回显含输入键的 schema 原文', async () => {
    const broken: Record<string, unknown> = { ...matchPlanFixture(), inputDigest: await manifestDigest(request) };
    delete broken.exactDependencies;
    const fetchMock = stubFetch(async () => jsonResponse(broken));

    const result = await requestMatchPlan({ ...baseOptions, fetch: fetchMock });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-response');
    expect(result.message).not.toContain('exactDependencies');
    expect(result.message).not.toContain('Required field is missing');

    vi.unstubAllGlobals();
  });

  it('空设计响应缺少 EMPTY_DESIGN 缺口时按非法响应拒绝', async () => {
    const emptyDesign = structuredClone(request);
    emptyDesign.design.elements = [];
    const plan = {
      schemaVersion: 1 as const,
      source: 'design-id' as const,
      inputDigest: await manifestDigest(emptyDesign),
      ruleSetId: 'library',
      revision: 'draft-1',
      context: emptyDesign.context,
      elements: [],
      exactDependencies: [],
      gaps: [],
    };
    const fetchMock = stubFetch(async () => jsonResponse(plan));

    const result = await requestMatchPlan({
      apiUrl: API_URL,
      token: TOKEN,
      design: emptyDesign.design,
      context: emptyDesign.context,
      fetch: fetchMock,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-response');

    vi.unstubAllGlobals();
  });

  it('非 JSON 响应体按非法响应处理', async () => {
    const fetchMock = stubFetch(async () => textResponse('<html>gateway</html>', 200));

    const result = await requestMatchPlan({ ...baseOptions, fetch: fetchMock });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-response');
    expect(result.message).not.toContain('gateway');

    vi.unstubAllGlobals();
  });

  it('已取消的调用在 fetch 之前即抛 AbortError，且不发起请求', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(await signedPlan()));
    const controller = new AbortController();
    controller.abort();

    await expect(requestMatchPlan({ ...baseOptions, fetch: fetchMock, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('fetch 解析前被取消：await fetch 之后统一抛 AbortError', async () => {
    let release: () => void = () => {};
    const fetchMock = stubFetch(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return jsonResponse(await signedPlan());
    });
    const controller = new AbortController();

    const pending = requestMatchPlan({ ...baseOptions, fetch: fetchMock, signal: controller.signal });
    controller.abort();
    release();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    vi.unstubAllGlobals();
  });

  it('JSON 解析完成后被取消：仍抛 AbortError，不把旧响应当成本次结果', async () => {
    const { response, release } = deferredJsonResponse(matchPlanFixture());
    const fetchMock = stubFetch(async () => response);
    const controller = new AbortController();

    const pending = requestMatchPlan({ ...baseOptions, fetch: fetchMock, signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    release();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    vi.unstubAllGlobals();
  });

  it('未取消时正常返回，AbortError 不会被吞成业务结果', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(await signedPlan()));
    const controller = new AbortController();

    const result = await requestMatchPlan({ ...baseOptions, fetch: fetchMock, signal: controller.signal });

    expect(result.ok).toBe(true);
    expect(controller.signal.aborted).toBe(false);

    vi.unstubAllGlobals();
  });
});
