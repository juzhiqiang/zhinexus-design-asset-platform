import { afterEach, describe, expect, it, vi } from 'vitest';
import * as galleryAuth from '../../apps/gallery/app/lib/auth.js';
import * as adminAuth from '../../apps/admin/app/lib/auth.js';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => { store.delete(key); },
    setItem: (key: string, value: string) => { store.set(key, value); },
  };
}

describe('independent gallery and admin auth helpers', () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
    if (originalLocalStorage === undefined) {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    } else {
      (globalThis as { localStorage?: unknown }).localStorage = originalLocalStorage;
    }
    vi.restoreAllMocks();
  });

  it('binds gallery login URL to ?target=gallery', () => {
    const parsed = new URL(galleryAuth.companyLoginUrl);
    expect(parsed.pathname).toBe('/v1/auth/oidc/start');
    expect(parsed.searchParams.get('target')).toBe('gallery');
  });

  it('binds admin login URL to ?target=admin', () => {
    const parsed = new URL(adminAuth.companyLoginUrl);
    expect(parsed.pathname).toBe('/v1/auth/oidc/start');
    expect(parsed.searchParams.get('target')).toBe('admin');
  });

  for (const [label, auth] of [['gallery', galleryAuth], ['admin', adminAuth]] as const) {
    it(`${label}: late loadCompanySession 200 after clearSession must not restore alice`, async () => {
      const storage = createMemoryStorage();
      (globalThis as { window?: unknown }).window = {};
      (globalThis as { localStorage?: unknown }).localStorage = storage;

      let resolveSession!: (res: Response) => void;
      const sessionPending = new Promise<Response>((resolve) => { resolveSession = resolve; });
      let resolveLogout!: (res: Response) => void;
      const logoutPending = new Promise<Response>((resolve) => { resolveLogout = resolve; });

      globalThis.fetch = vi.fn((input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith('/v1/auth/oidc/session')) return sessionPending;
        if (url.endsWith('/v1/auth/oidc/logout')) return logoutPending;
        return Promise.resolve(new Response('{}', { status: 404 }));
      }) as typeof fetch;

      // 1. Start loadCompanySession (in-flight)
      const firstLoad = auth.loadCompanySession();

      // 2. User logs out while session check is still in-flight
      auth.clearSession();

      // 3. While logout is STILL in-flight, a focus event calls loadCompanySession()
      const focusLoad = auth.loadCompanySession();
      expect(await focusLoad).toBeNull();
      expect(auth.getStoredSession()).toBeNull();

      // 4. Stale 200 arrives for firstLoad -> must NOT write alice back
      resolveSession(new Response(JSON.stringify({
        authenticated: true,
        administrator: false,
        subject: 'alice',
        roles: ['reader'],
      }), { status: 200, headers: { 'content-type': 'application/json' } }));

      expect(await firstLoad).toBeNull();
      expect(auth.getStoredSession()).toBeNull();

      // Clean up pending logout
      resolveLogout(new Response(JSON.stringify({ authenticated: false }), { status: 200 }));
      await Promise.resolve();
    });
  }
});
