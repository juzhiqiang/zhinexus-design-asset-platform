import { validateApiMessage } from '@company/contracts';

const DEFAULT_API_ORIGIN = (process.env.NEXT_PUBLIC_PLATFORM_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
export const ipPreviewMode = process.env.NEXT_PUBLIC_PLATFORM_PREVIEW_MODE === 'ip-port';

export type PreviewAccessMode = 'public' | 'authenticated';
export type PreviewGrant = { url: string; variantReleaseId: string; isolation: 'ip-port' | 'domain' };

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

export function validateGalleryPreviewGrant(
  raw: unknown,
  variantReleaseId: string,
  galleryLocation: { protocol: string; hostname: string; port: string; origin: string },
  apiOrigin: string = DEFAULT_API_ORIGIN,
): PreviewGrant | null {
  const grant = validateApiMessage('previewGrantResponse', raw);
  if (!grant.ok || Date.parse(grant.value.expiresAt) <= Date.now()) return null;
  let url: URL;
  try {
    url = new URL(grant.value.bootstrapUrl);
  } catch {
    return null;
  }
  const localLoopbackHttp =
    galleryLocation.protocol === 'http:'
    && (galleryLocation.hostname === '127.0.0.1' || galleryLocation.hostname === 'localhost')
    && url.protocol === 'http:'
    && url.hostname === '127.0.0.1'
    && Boolean(url.port)
    && url.port !== galleryLocation.port;

  if (
    (url.protocol !== 'https:' && !localLoopbackHttp)
    || url.username
    || url.password
    || url.hash
    || url.pathname !== '/bootstrap'
    || !/^\?grant=[A-Za-z0-9_-]{43}$/.test(url.search)
    || isSameOriginTuple(url.href, galleryLocation.origin)
    || isSameOriginTuple(url.href, apiOrigin)
  ) {
    return null;
  }

  const numericHost = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname) || url.hostname.startsWith('[');
  if ((grant.value.mode === 'domain' && numericHost) || (grant.value.mode === 'ip-port' && !numericHost)) return null;
  if (numericHost) {
    if (!localLoopbackHttp && (url.hostname !== galleryLocation.hostname || !url.port || url.port === galleryLocation.port)) return null;
    return { url: url.href, variantReleaseId, isolation: 'ip-port' };
  }
  if (
    url.protocol !== 'https:'
    || (!grant.value.mode && ipPreviewMode)
    || url.hostname === galleryLocation.hostname
    || !url.hostname.startsWith(`r-${variantReleaseId}.`)
  ) {
    return null;
  }
  return { url: url.href, variantReleaseId, isolation: 'domain' };
}

export async function requestPublicPreviewGrant(
  variantReleaseId: string,
  signal: AbortSignal,
  apiOrigin: string = DEFAULT_API_ORIGIN,
): Promise<PreviewGrant | null> {
  try {
    const response = await fetch(`${apiOrigin.replace(/\/$/, '')}/v1/preview-grants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variantReleaseId }),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]),
    });
    if (!response.ok) return null;
    return validateGalleryPreviewGrant(await response.json(), variantReleaseId, window.location, apiOrigin);
  } catch {
    return null;
  }
}
