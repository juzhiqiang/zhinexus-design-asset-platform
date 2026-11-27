import { validateApiMessage, type Framework } from '@company/contracts';
import { getStoredSession, loadCompanySession } from './auth';
import {
  ipPreviewMode,
  requestPublicPreviewGrant,
  validateGalleryPreviewGrant,
  type PreviewAccessMode,
  type PreviewGrant,
} from './preview-validation';

export { ipPreviewMode, validateGalleryPreviewGrant, type PreviewAccessMode, type PreviewGrant };

const API_ORIGIN = (process.env.NEXT_PUBLIC_PLATFORM_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

async function previewApi(path: string, input: RequestInit, signal: AbortSignal, anonymous: boolean): Promise<unknown> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...input,
    cache: 'no-store',
    credentials: !anonymous && getStoredSession()?.token === '__session__' ? 'include' : 'omit',
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
  options: { access?: PreviewAccessMode } = {},
): Promise<PreviewGrant | null> {
  const access = options.access ?? 'authenticated';
  if (access === 'authenticated' && !await loadCompanySession()) return null;
  try {
    const query = new URLSearchParams({ framework, query: componentId, pageSize: '100' });
    const catalog = validateApiMessage('componentsResponse', await previewApi(`/v1/components?${query}`, {
      headers: { accept: 'application/json' },
    }, signal, access === 'public'));
    if (!catalog.ok || catalog.value.page !== 1 || catalog.value.total !== catalog.value.items.length) return null;
    const variants = catalog.value.items.filter(item => item.componentId === componentId)
      .flatMap(item => item.variants.filter(variant => variant.framework === framework && variant.variantId === variantId));
    if (variants.length !== 1 || signal.aborted) return null;
    return requestPreviewGrant(variants[0]!.variantReleaseId, signal, { access });
  } catch {
    return null;
  }
}

export async function requestPreviewGrant(
  variantReleaseId: string,
  signal: AbortSignal,
  options: { access?: PreviewAccessMode } = {},
): Promise<PreviewGrant | null> {
  const access = options.access ?? 'authenticated';
  if (access === 'public') {
    return requestPublicPreviewGrant(variantReleaseId, signal, API_ORIGIN);
  }
  const session = getStoredSession() ?? await loadCompanySession();
  if (!session) return null;
  try {
    const raw = await previewApi('/v1/preview-grants', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ variantReleaseId }),
    }, signal, false);
    return validateGalleryPreviewGrant(raw, variantReleaseId, window.location, API_ORIGIN);
  } catch {
    return null;
  }
}
