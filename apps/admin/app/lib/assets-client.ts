import type { ApiMessages } from '@company/contracts';
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

export function listMyComponents(params: { query?: string; framework?: 'vue' | 'react'; category?: string; page?: number; pageSize?: number } = {}, signal?: AbortSignal) {
  const search = new URLSearchParams();
  if (params.query?.trim()) search.set('query', params.query.trim());
  if (params.framework) search.set('framework', params.framework);
  if (params.category?.trim()) search.set('category', params.category.trim());
  search.set('page', String(params.page ?? 1));
  search.set('pageSize', String(params.pageSize ?? 50));
  return requestJson<ApiMessages['componentsResponse']>(`/v1/me/components?${search.toString()}`, { signal });
}

export function getVariantReleaseDetail(releaseId: string, signal?: AbortSignal) {
  return requestJson<ApiMessages['variantReleaseResponse']>(`/v1/me/variant-releases/${encodeURIComponent(releaseId)}`, { signal });
}

export function getVariantCompatibility(releaseId: string, signal?: AbortSignal) {
  return requestJson<CompatibilityListResponse>(`/v1/me/variant-releases/${encodeURIComponent(releaseId)}/compatibility`, { signal });
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
}) {
  return requestJson<ApiMessages['createBaselineResponse']>('/v1/baselines', {
    method: 'POST',
    body: payload,
  });
}
