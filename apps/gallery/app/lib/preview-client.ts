import { validateApiMessage, type Framework } from '@company/contracts';
import { getStoredSession } from './auth';

const API_ORIGIN = (process.env.NEXT_PUBLIC_PLATFORM_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
export const ipPreviewMode = process.env.NEXT_PUBLIC_PLATFORM_PREVIEW_MODE === 'ip-port';

export type PreviewGrant = { url: string; variantReleaseId: string; isolation: 'ip-port' | 'domain' };

async function previewApi(path: string, input: RequestInit, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...input,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]),
  });
  return response.ok ? response.json() : null;
}

/** The catalog returns the current Ready release for each published implementation. */
export async function requestComponentPreview(
  componentId: string,
  variantId: string,
  framework: Framework,
  signal: AbortSignal,
): Promise<PreviewGrant | null> {
  if (!getStoredSession()) return null;
  try {
    const query = new URLSearchParams({ framework, query: componentId, pageSize: '100' });
    const catalog = validateApiMessage('componentsResponse', await previewApi(`/v1/components?${query}`, {
      headers: { accept: 'application/json' },
    }, signal));
    if (!catalog.ok || catalog.value.page !== 1 || catalog.value.total !== catalog.value.items.length) return null;
    const variants = catalog.value.items.filter(item => item.componentId === componentId)
      .flatMap(item => item.variants.filter(variant => variant.framework === framework && variant.variantId === variantId));
    if (variants.length !== 1 || signal.aborted) return null;
    return requestPreviewGrant(variants[0]!.variantReleaseId, signal);
  } catch {
    return null;
  }
}

export async function requestPreviewGrant(variantReleaseId: string, signal: AbortSignal): Promise<PreviewGrant | null> {
  const session = getStoredSession();
  if (!session) return null;
  try {
    const grant = validateApiMessage('previewGrantResponse', await previewApi('/v1/preview-grants', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ variantReleaseId }),
    }, signal));
    if (!grant.ok || Date.parse(grant.value.expiresAt) <= Date.now()) return null;
    const url = new URL(grant.value.bootstrapUrl);
    const gallery = window.location;
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.pathname !== '/bootstrap' ||
      !/^\?grant=[A-Za-z0-9_-]{43}$/.test(url.search) || url.origin === gallery.origin) return null;

    const numericHost = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname) || url.hostname.startsWith('[');
    if (numericHost) {
      if (url.hostname !== gallery.hostname || !url.port || url.port === gallery.port || url.origin === new URL(API_ORIGIN).origin) return null;
      return { url: url.href, variantReleaseId, isolation: 'ip-port' };
    }
    if (ipPreviewMode || url.hostname === gallery.hostname || !url.hostname.startsWith(`r-${variantReleaseId}.`)) return null;
    return { url: url.href, variantReleaseId, isolation: 'domain' };
  } catch {
    return null;
  }
}
