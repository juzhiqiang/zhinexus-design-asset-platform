import { getAuthCredentials, getAuthHeaders, getStoredSession, platformApiOrigin } from './auth';

export class JobsApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type ReleaseJobSummary = {
  jobId: string;
  channel: string;
  subject: string;
  state: 'PENDING' | 'RUNNING' | 'RETRY_WAIT' | 'READY' | 'REJECTED' | 'CONFLICT';
  stage: string;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  packages: Array<{ name: string; version: string }>;
  variantCount: number;
  lastError?: { code: string; message?: string };
};

export async function listReleaseJobs(params: { state?: string; limit?: number } = {}, signal?: AbortSignal): Promise<ReleaseJobSummary[]> {
  const session = getStoredSession();
  const search = new URLSearchParams();
  if (params.state && params.state !== 'ALL') search.set('state', params.state);
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  const response = await fetch(`${platformApiOrigin}/v1/releases${qs ? `?${qs}` : ''}`, {
    method: 'GET',
    credentials: getAuthCredentials(session),
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    headers: getAuthHeaders(session),
  });
  if (!response.ok) {
    const message = response.status === 401
      ? '登录已失效，请重新登录。'
      : response.status === 403
        ? '当前账号没有查看发布作业的权限。'
        : response.status === 503
          ? '发布作业服务未连接到数据库，暂时不可用。'
          : `读取发布作业失败（HTTP ${response.status}）。`;
    throw new JobsApiError(message, response.status);
  }
  const data = (await response.json()) as { items?: ReleaseJobSummary[] };
  return Array.isArray(data.items) ? data.items : [];
}

export async function retryReleaseJob(jobId: string): Promise<{ jobId: string; state: string }> {
  const session = getStoredSession();
  const response = await fetch(`${platformApiOrigin}/v1/releases/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST',
    credentials: getAuthCredentials(session),
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    headers: getAuthHeaders(session),
  });
  if (!response.ok) {
    const message = response.status === 409
      ? '当前作业不处于可重试状态（或租约尚未过期）。'
      : response.status === 403
        ? '当前账号没有重试该发布作业的权限。'
        : `重试作业失败（HTTP ${response.status}）。`;
    throw new JobsApiError(message, response.status);
  }
  return (await response.json()) as { jobId: string; state: string };
}
