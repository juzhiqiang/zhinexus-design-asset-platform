import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestPublicPreviewGrant, validateGalleryPreviewGrant } from '../../apps/gallery/app/lib/preview-validation.js';

const releaseId = '12345678-1234-4234-8234-123456789abc';
const token = 'a'.repeat(43);
const future = new Date(Date.now() + 300_000).toISOString();

describe('gallery preview-client public anonymous access & origin validation', () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      globalThis.window = originalWindow;
    }
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('requests a public preview grant without login, cookies, or Authorization header', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    (globalThis as { window?: unknown }).window = {
      location: {
        protocol: 'https:',
        hostname: 'gallery.example.com',
        port: '',
        origin: 'https://gallery.example.com',
      },
    };
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          bootstrapUrl: `https://r-${releaseId}.preview.assets.test/bootstrap?grant=${token}`,
          expiresAt: future,
          mode: 'domain',
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const grant = await requestPublicPreviewGrant(releaseId, new AbortController().signal, 'https://api.example.com');
    expect(grant).toEqual({
      url: `https://r-${releaseId}.preview.assets.test/bootstrap?grant=${token}`,
      variantReleaseId: releaseId,
      isolation: 'domain',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(/\/v1\/preview-grants$/);
    expect(calls[0]!.init?.credentials).toBe('omit');
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.get('authorization')).toBeNull();
  });

  it('accepts local loopback HTTP preview only when gallery runs on local loopback HTTP, and rejects HTTP on HTTPS origins', () => {
    const localGrant = {
      bootstrapUrl: `http://127.0.0.1:3001/bootstrap?grant=${token}`,
      expiresAt: future,
      mode: 'ip-port' as const,
    };

    expect(
      validateGalleryPreviewGrant(
        localGrant,
        releaseId,
        { protocol: 'http:', hostname: '127.0.0.1', port: '5173', origin: 'http://127.0.0.1:5173' },
        'http://127.0.0.1:3000',
      ),
    ).toEqual({
      url: localGrant.bootstrapUrl,
      variantReleaseId: releaseId,
      isolation: 'ip-port',
    });

    expect(
      validateGalleryPreviewGrant(
        localGrant,
        releaseId,
        { protocol: 'http:', hostname: 'localhost', port: '5173', origin: 'http://localhost:5173' },
        'http://127.0.0.1:3000',
      ),
    ).toEqual({
      url: localGrant.bootstrapUrl,
      variantReleaseId: releaseId,
      isolation: 'ip-port',
    });

    // Reject HTTP when gallery is served over HTTPS
    expect(
      validateGalleryPreviewGrant(
        localGrant,
        releaseId,
        { protocol: 'https:', hostname: '127.0.0.1', port: '5173', origin: 'https://127.0.0.1:5173' },
        'https://127.0.0.1:3000',
      ),
    ).toBeNull();

    // Reject non-loopback HTTP IP or same port as gallery/API
    expect(
      validateGalleryPreviewGrant(
        { ...localGrant, bootstrapUrl: `http://127.0.0.2:3001/bootstrap?grant=${token}` },
        releaseId,
        { protocol: 'http:', hostname: '127.0.0.1', port: '5173', origin: 'http://127.0.0.1:5173' },
        'http://127.0.0.1:3000',
      ),
    ).toBeNull();
    expect(
      validateGalleryPreviewGrant(
        { ...localGrant, bootstrapUrl: `http://127.0.0.1:3000/bootstrap?grant=${token}` },
        releaseId,
        { protocol: 'http:', hostname: '127.0.0.1', port: '5173', origin: 'http://127.0.0.1:5173' },
        'http://127.0.0.1:3000',
      ),
    ).toBeNull();
  });
});
