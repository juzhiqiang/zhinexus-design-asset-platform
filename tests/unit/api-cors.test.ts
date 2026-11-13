import { afterEach, expect, it } from 'vitest';
import { buildServer } from '../../apps/api/dist/app.js';
import { environmentOptions, Platform } from '../../apps/api/dist/platform.js';

let app: Awaited<ReturnType<typeof buildServer>> | undefined;
afterEach(async () => { await app?.close(); app = undefined; });
const galleryOrigin = 'https://gallery.platform.test';
const preview = { platformOrigin: galleryOrigin, apiOrigin: 'https://api.platform.test', previewOrigin: 'https://preview.assets.test' };
async function start(options: Parameters<typeof buildServer>[0] = {}) {
  app = await buildServer(options);
  await app.listen(0, '127.0.0.1');
  return app.getUrl();
}
const preflight = (origin: string, api: string, headers = 'authorization,content-type,idempotency-key') => fetch(`${api}/v1/releases`, {
  method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': headers },
});

it('allows the configured gallery preflight and exposes request IDs without bypassing authentication', async () => {
  const api = await start({ preview });
  const response = await preflight(galleryOrigin, api);
  expect(response.status).toBe(204);
  expect(response.headers.get('access-control-allow-origin')).toBe(galleryOrigin);
  expect(response.headers.get('vary')).toContain('Origin');
  expect(response.headers.get('access-control-allow-methods')?.split(',').sort()).toEqual(['GET', 'OPTIONS', 'POST']);
  expect(response.headers.get('access-control-allow-headers')?.toLowerCase().split(',').sort())
    .toEqual(['authorization', 'content-type', 'idempotency-key']);
  expect(response.headers.get('access-control-allow-credentials')).toBeNull();
  const post = await fetch(`${api}/v1/releases`, { method: 'POST', headers: { origin: galleryOrigin, 'content-type': 'application/json' }, body: '{}' });
  expect(post.status).toBe(401);
  expect(post.headers.get('access-control-allow-origin')).toBe(galleryOrigin);
  expect(post.headers.get('access-control-expose-headers')?.toLowerCase()).toBe('x-request-id');
  expect(post.headers.get('x-request-id')).toBeTruthy();
});

it('does not permit preview, lookalike, different port or null origins, or arbitrary request headers', async () => {
  const api = await start({ preview });
  for (const origin of [preview.previewOrigin, 'https://gallery.platform.test.evil.test', 'https://gallery.platform.test:444', 'null']) {
    expect((await preflight(origin, api)).headers.get('access-control-allow-origin')).toBeNull();
  }
  const extra = await preflight(galleryOrigin, api, 'x-untrusted');
  expect(extra.headers.get('access-control-allow-headers')?.toLowerCase() ?? '').not.toContain('x-untrusted');
});

it('keeps cross-origin access disabled when gallery configuration is absent', async () => {
  const api = await start();
  expect((await preflight(galleryOrigin, api)).headers.get('access-control-allow-origin')).toBeNull();
});

it('accepts an explicit loopback HTTP gallery for local browser integration', async () => {
  const local = 'http://127.0.0.1:5173';
  const api = await start({ galleryOrigin: local });
  expect((await preflight(local, api)).headers.get('access-control-allow-origin')).toBe(local);
});

it('fails closed on invalid gallery origins and disagreement with preview deployment configuration', () => {
  for (const origin of ['*', 'null', 'http://gallery.platform.test', `${galleryOrigin}/`, `${galleryOrigin}/path`, `${galleryOrigin}?a=1`,
    `${galleryOrigin}#fragment`, 'https://user:secret@gallery.platform.test']) {
    expect(() => new Platform({ galleryOrigin: origin })).toThrow();
  }
  expect(() => new Platform({ galleryOrigin: 'https://other.platform.test', preview })).toThrow();
});

it('reads gallery configuration independently of preview configuration', () => {
  const previous = process.env.PLATFORM_GALLERY_ORIGIN;
  process.env.PLATFORM_GALLERY_ORIGIN = galleryOrigin;
  try { expect(environmentOptions().galleryOrigin).toBe(galleryOrigin); }
  finally { if (previous === undefined) delete process.env.PLATFORM_GALLERY_ORIGIN; else process.env.PLATFORM_GALLERY_ORIGIN = previous; }
});
