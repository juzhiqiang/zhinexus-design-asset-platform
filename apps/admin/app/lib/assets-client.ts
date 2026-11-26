import {
  validateApiMessage,
  validateComponentApi,
  type ApiMessages,
  type CheckReportV1,
  type ComponentApiV1,
} from '@company/contracts';
import { getAuthCredentials, getAuthHeaders, getStoredSession, notifySessionExpired, platformApiOrigin } from './auth';

export class AssetApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type CompatibilityItem = {
  compatibilityId: string;
  variantReleaseId: string;
  packageName: string;
  packageVersion: string;
  framework: 'vue' | 'react';
  frameworkVersion: string;
  echartsVersion: string;
  status: string;
  createdAt: string;
  reason?: string;
  subject?: string;
};

export type CompatibilityListResponse = {
  variantReleaseId: string;
  items: CompatibilityItem[];
};

type GlobalWithOrigin = typeof globalThis & {
  Origin?: {
    from(value: unknown): { opaque: boolean; isSameOrigin(other: unknown): boolean };
  };
};

function isSameOriginTuple(candidateHref: string, trustedOriginOrUrl: string): boolean {
  try {
    const g = globalThis as GlobalWithOrigin;
    if (g.Origin && typeof g.Origin.from === 'function') {
      const cand = g.Origin.from(candidateHref);
      const trusted = g.Origin.from(trustedOriginOrUrl);
      if (cand.opaque || trusted.opaque) return false;
      return cand.isSameOrigin(trusted);
    }
    const candidateUrl = new URL(candidateHref);
    const trustedUrl = new URL(trustedOriginOrUrl);
    return candidateUrl.origin !== 'null' && candidateUrl.origin === trustedUrl.origin;
  } catch {
    return false;
  }
}

/**
 * 严格核验管理端收到的短期预览 bootstrapUrl：
 * - 必须通过契约校验且未过期
 * - 必须为无用户名密码、无 hash 的 HTTPS `/bootstrap?grant=<43位令牌>`
 * - 严禁与管理端自身或平台管理 API 同源
 */
export function validateAdminPreviewBootstrapUrl(
  raw: unknown,
  adminLocation: { origin: string; hostname: string; port: string },
  apiOrigin: string = platformApiOrigin,
): { url: string; isolation: 'domain' | 'ip-port' } | null {
  const checked = validateApiMessage('previewGrantResponse', raw);
  if (!checked.ok || Date.parse(checked.value.expiresAt) <= Date.now()) return null;
  let url: URL;
  try {
    url = new URL(checked.value.bootstrapUrl);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== '/bootstrap' ||
    !/^\?grant=[A-Za-z0-9_-]{43}$/.test(url.search)
  ) {
    return null;
  }
  if (isSameOriginTuple(url.href, adminLocation.origin) || isSameOriginTuple(url.href, apiOrigin)) {
    return null;
  }
  const numericHost = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname) || url.hostname.startsWith('[');
  if ((checked.value.mode === 'domain' && numericHost) || (checked.value.mode === 'ip-port' && !numericHost)) {
    return null;
  }
  if (numericHost) {
    if (!url.port || url.port === adminLocation.port) return null;
    return { url: url.href, isolation: 'ip-port' };
  }
  if (url.hostname === adminLocation.hostname || !/^r-[0-9a-f-]{36}\./i.test(url.hostname)) {
    return null;
  }
  return { url: url.href, isolation: 'domain' };
}

export function parseProbeEvidenceInput(
  jsonText: string,
): { ok: true; candidate: { version: string; integrity: string; source: string }; evidence: Record<string, unknown> } | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, message: '证据内容不是有效的 JSON 格式。' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, message: '证据内容必须为 JSON 对象。' };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.schemaVersion !== 1 || obj.kind !== 'a-t10-sdk-probe') {
    return { ok: false, message: '仅接受 schemaVersion=1 且 kind="a-t10-sdk-probe" 的本地实测探测证据。' };
  }
  const cand = obj.candidate;
  if (
    !cand ||
    typeof cand !== 'object' ||
    Array.isArray(cand) ||
    typeof (cand as { version?: unknown }).version !== 'string' ||
    typeof (cand as { integrity?: unknown }).integrity !== 'string' ||
    typeof (cand as { source?: unknown }).source !== 'string'
  ) {
    return { ok: false, message: '证据缺少有效的 candidate（version / integrity / source）字段。' };
  }
  const candidate = {
    version: (cand as { version: string }).version.trim(),
    integrity: (cand as { integrity: string }).integrity.trim(),
    source: (cand as { source: string }).source.trim(),
  };
  const checkReq = validateApiMessage('createCompatibilityRequest', {
    packageSha256: 'a'.repeat(64),
    reason: 'check',
    candidate,
    evidence: obj,
  });
  if (!checkReq.ok) {
    return { ok: false, message: checkReq.issues[0]?.message || '候选 ECharts 注册表地址或版本格式不合法。' };
  }
  return { ok: true, candidate, evidence: obj };
}

async function requestJson<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const session = getStoredSession();
  const response = await fetch(`${platformApiOrigin}${path}`, {
    method: init.method ?? 'GET',
    credentials: getAuthCredentials(session),
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    headers: {
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...getAuthHeaders(session),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!response.ok) {
    if (response.status === 401) notifySessionExpired();
    const message = response.status === 401
      ? '登录已失效，请重新登录。'
      : response.status === 403
        ? '当前账号没有执行该操作的权限。'
        : response.status === 404
          ? '未找到对应的资产或版本记录。'
          : response.status === 409
            ? '版本状态或基线修订已发生变化，请刷新后重试。'
            : response.status === 503
              ? '资产目录服务未连接到数据库，暂时不可用。'
              : `请求失败（HTTP ${response.status}）。`;
    throw new AssetApiError(message, response.status);
  }
  return (await response.json()) as T;
}

async function requestBytes(path: string, signal?: AbortSignal): Promise<{ bytes: Uint8Array; mime: string }> {
  const session = getStoredSession();
  const response = await fetch(`${platformApiOrigin}${path}`, {
    method: 'GET',
    credentials: getAuthCredentials(session),
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    headers: getAuthHeaders(session),
  });
  if (!response.ok) {
    if (response.status === 401) notifySessionExpired();
    throw new AssetApiError(`读取产物材料失败（HTTP ${response.status}）。`, response.status);
  }
  const buf = await response.arrayBuffer();
  return {
    bytes: new Uint8Array(buf),
    mime: response.headers.get('content-type') || 'application/octet-stream',
  };
}

export function listMyComponents(params: { query?: string; framework?: 'vue' | 'react'; category?: string; page?: number; pageSize?: number } = {}, signal?: AbortSignal) {
  const search = new URLSearchParams();
  if (params.query?.trim()) search.set('query', params.query.trim());
  if (params.framework) search.set('framework', params.framework);
  if (params.category?.trim()) search.set('category', params.category.trim());
  search.set('page', String(params.page ?? 1));
  search.set('pageSize', String(params.pageSize ?? 20));
  return requestJson<ApiMessages['componentsResponse']>(`/v1/me/components?${search.toString()}`, { signal });
}

export function getVariantReleaseDetail(releaseId: string, signal?: AbortSignal) {
  return requestJson<ApiMessages['variantReleaseResponse']>(`/v1/me/variant-releases/${encodeURIComponent(releaseId)}`, { signal });
}

export function getVariantCompatibility(releaseId: string, signal?: AbortSignal) {
  return requestJson<CompatibilityListResponse>(`/v1/me/variant-releases/${encodeURIComponent(releaseId)}/compatibility`, { signal });
}

export async function getVariantReports(releaseId: string, signal?: AbortSignal): Promise<CheckReportV1[]> {
  const raw = await requestJson<unknown>(`/v1/me/variant-releases/${encodeURIComponent(releaseId)}/reports`, { signal });
  const checked = validateApiMessage('variantReportsResponse', raw);
  if (!checked.ok) throw new Error('服务返回了无效的检查报告结构。');
  return checked.value.reports;
}

export async function getVariantDocsText(releaseId: string, docsPath: string, signal?: AbortSignal): Promise<string> {
  const { bytes } = await requestBytes(`/v1/me/variant-releases/${encodeURIComponent(releaseId)}/artifacts?path=${encodeURIComponent(docsPath)}`, signal);
  return new TextDecoder().decode(bytes);
}

export async function getVariantComponentApi(releaseId: string, apiPath: string, signal?: AbortSignal): Promise<ComponentApiV1> {
  const { bytes } = await requestBytes(`/v1/me/variant-releases/${encodeURIComponent(releaseId)}/artifacts?path=${encodeURIComponent(apiPath)}`, signal);
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  const checked = validateComponentApi(parsed);
  if (!checked.ok) throw new Error('组件 API 描述文件未通过契约校验。');
  return checked.value;
}

export async function getVariantScreenshotBlobUrl(releaseId: string, imagePath: string, signal?: AbortSignal): Promise<string> {
  const { bytes, mime } = await requestBytes(`/v1/me/variant-releases/${encodeURIComponent(releaseId)}/artifacts?path=${encodeURIComponent(imagePath)}`, signal);
  const safeMime = mime.startsWith('image/png') ? 'image/png' : 'image/jpeg';
  return URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: safeMime }));
}

export async function requestAdminPreviewGrant(
  variantReleaseId: string,
  signal?: AbortSignal,
): Promise<{ url: string; isolation: 'domain' | 'ip-port' }> {
  const raw = await requestJson<unknown>('/v1/preview-grants', {
    method: 'POST',
    body: { variantReleaseId },
    signal,
  });
  const validated = validateAdminPreviewBootstrapUrl(raw, window.location, platformApiOrigin);
  if (!validated) {
    throw new Error('预览网关地址未通过独立源或 HTTPS 安全隔离核验，已阻断内嵌加载。');
  }
  return validated;
}

export function submitVariantCompatibility(
  releaseId: string,
  payload: ApiMessages['createCompatibilityRequest'],
) {
  return requestJson<ApiMessages['createCompatibilityResponse']>(
    `/v1/variant-releases/${encodeURIComponent(releaseId)}/compatibility`,
    {
      method: 'POST',
      body: payload,
    },
  );
}

export function deprecateVariantRelease(releaseId: string, reason: string) {
  return requestJson<ApiMessages['deprecateResponse']>(`/v1/variant-releases/${encodeURIComponent(releaseId)}/deprecate`, {
    method: 'POST',
    body: { reason: reason.trim() },
  });
}

export function acceptVisualBaseline(payload: {
  variantId: string;
  exampleId: string;
  environmentKey: string;
  screenshotId: string;
  reason: string;
  expectedRevision?: string;
}) {
  return requestJson<ApiMessages['createBaselineResponse']>('/v1/baselines', {
    method: 'POST',
    body: payload,
  });
}
