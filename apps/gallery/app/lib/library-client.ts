import { validateApiMessage, type ApiMessages, type Framework } from '@company/contracts';
import { platformApiOrigin } from './auth';

export type AuthTokenHolder = { token: string };

export type LibraryClientOptions = {
  apiUrl?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
};

export type LibraryResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'unauthenticated' }
  | { status: 'forbidden' }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

const REQUEST_TIMEOUT_MS = 8000;

function buildInit(session: AuthTokenHolder, accept: string, signal?: AbortSignal): RequestInit {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const headers: Record<string, string> = { accept };
  if (session.token && session.token !== '__session__') {
    headers.authorization = `Bearer ${session.token}`;
  }
  return {
    method: 'GET',
    headers,
    cache: 'no-store',
    credentials: session.token === '__session__' ? 'include' : 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  };
}

function classifyHttpError(status: number): LibraryResult<never> {
  if (status === 401) return { status: 'unauthenticated' };
  if (status === 403) return { status: 'forbidden' };
  if (status === 404) return { status: 'not_found' };
  return { status: 'error', message: '内部资产目录服务暂时不可用，请稍后重试。' };
}

export async function fetchMyComponents(
  session: AuthTokenHolder,
  options: LibraryClientOptions & { framework?: Framework; query?: string } = {},
): Promise<LibraryResult<ApiMessages['componentsResponse']>> {
  const apiUrl = (options.apiUrl ?? platformApiOrigin).replace(/\/$/, '');
  const fetcher = options.fetcher ?? fetch;
  const params = new URLSearchParams({ pageSize: '100' });
  if (options.framework) params.set('framework', options.framework);
  if (options.query) params.set('query', options.query);
  try {
    const res = await fetcher(`${apiUrl}/v1/me/components?${params.toString()}`, buildInit(session, 'application/json', options.signal));
    if (!res.ok) return classifyHttpError(res.status);
    const parsed = validateApiMessage('componentsResponse', await res.json());
    if (!parsed.ok) return { status: 'error', message: '目录返回数据不符合契约。' };
    return { status: 'ok', data: parsed.value };
  } catch {
    return { status: 'error', message: '无法连接内部资产目录服务。' };
  }
}

export async function fetchMyVariantRelease(
  releaseId: string,
  session: AuthTokenHolder,
  options: LibraryClientOptions = {},
): Promise<LibraryResult<ApiMessages['variantReleaseResponse']>> {
  const apiUrl = (options.apiUrl ?? platformApiOrigin).replace(/\/$/, '');
  const fetcher = options.fetcher ?? fetch;
  try {
    const res = await fetcher(
      `${apiUrl}/v1/me/variant-releases/${encodeURIComponent(releaseId)}`,
      buildInit(session, 'application/json', options.signal),
    );
    if (!res.ok) return classifyHttpError(res.status);
    const parsed = validateApiMessage('variantReleaseResponse', await res.json());
    if (!parsed.ok || parsed.value.variantReleaseId !== releaseId) {
      return { status: 'error', message: '组件发布详情不符合契约。' };
    }
    return { status: 'ok', data: parsed.value };
  } catch {
    return { status: 'error', message: '无法读取已授权组件详情。' };
  }
}

export async function fetchMyVariantReports(
  releaseId: string,
  session: AuthTokenHolder,
  options: LibraryClientOptions = {},
): Promise<LibraryResult<ApiMessages['variantReportsResponse']>> {
  const apiUrl = (options.apiUrl ?? platformApiOrigin).replace(/\/$/, '');
  const fetcher = options.fetcher ?? fetch;
  try {
    const res = await fetcher(
      `${apiUrl}/v1/me/variant-releases/${encodeURIComponent(releaseId)}/reports`,
      buildInit(session, 'application/json', options.signal),
    );
    if (!res.ok) return classifyHttpError(res.status);
    const parsed = validateApiMessage('variantReportsResponse', await res.json());
    if (!parsed.ok || parsed.value.variantReleaseId !== releaseId) {
      return { status: 'error', message: '检查报告数据不符合契约。' };
    }
    return { status: 'ok', data: parsed.value };
  } catch {
    return { status: 'error', message: '无法读取检查报告。' };
  }
}

export async function fetchMyVariantArtifactText(
  releaseId: string,
  artifactPath: string,
  session: AuthTokenHolder,
  options: LibraryClientOptions = {},
): Promise<LibraryResult<string>> {
  const apiUrl = (options.apiUrl ?? platformApiOrigin).replace(/\/$/, '');
  const fetcher = options.fetcher ?? fetch;
  const params = new URLSearchParams({ path: artifactPath });
  try {
    const res = await fetcher(
      `${apiUrl}/v1/me/variant-releases/${encodeURIComponent(releaseId)}/artifacts?${params.toString()}`,
      buildInit(session, 'text/plain, text/markdown, application/json', options.signal),
    );
    if (!res.ok) return classifyHttpError(res.status);
    return { status: 'ok', data: await res.text() };
  } catch {
    return { status: 'error', message: '无法读取组件产物内容。' };
  }
}
