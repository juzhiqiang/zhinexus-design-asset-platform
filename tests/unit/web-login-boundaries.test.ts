import { afterEach, expect, it, vi } from 'vitest';
import { buildServer } from '../../apps/api/dist/app.js';
import { environmentOptions, Platform } from '../../apps/api/dist/platform.js';

afterEach(() => vi.unstubAllEnvs());

it('loads the admin origin from deployment configuration and defaults to local port 5177', () => {
  const local = new Platform({});
  expect(local.adminOrigin).toBe('http://127.0.0.1:5177');
  vi.stubEnv('PLATFORM_ADMIN_ORIGIN', 'https://admin.example.com');
  const configured = new Platform(environmentOptions());
  expect(configured.adminOrigin).toBe('https://admin.example.com');
});

it.each([
  '', 'http://admin.example.com', 'https://admin.example.com/', 'https://admin.example.com/upload',
  'https://admin.example.com?next=gallery', 'https://admin.example.com#admin',
  'https://user:secret@admin.example.com', 'https://admin.example.com:443',
  ' https://admin.example.com', 'https://*.example.com',
])('rejects a non-exact or unsafe admin origin %s', adminOrigin => {
  expect(() => new Platform({ adminOrigin })).toThrow();
});

it('allows only the exact two configured origins for CORS and unsafe Cookie requests', async () => {
  const app = await buildServer({ galleryOrigin: 'https://gallery.example.com', adminOrigin: 'https://admin.example.com' });
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    for (const allowed of ['https://gallery.example.com', 'https://admin.example.com']) {
      const read = await fetch(origin + '/healthz', { headers: { origin: allowed } });
      expect(read.headers.get('access-control-allow-origin')).toBe(allowed);
      const write = await fetch(origin + '/v1/auth/oidc/logout', { method: 'POST', headers: { origin: allowed, cookie: '__Host-platform=' + 'a'.repeat(43) } });
      expect(write.status).toBe(200);
    }
    for (const denied of [undefined, 'null', 'https://admin.example.com.evil.test', 'https://admin.example.com:444', 'https://gallery.example.com/', 'http://admin.example.com', 'https://unknown.example.com']) {
      const headers = { ...(denied ? { origin: denied } : {}), 'x-forwarded-host': 'admin.example.com', 'x-forwarded-proto': 'https' };
      const read = await fetch(origin + '/healthz', { headers });
      expect(read.headers.get('access-control-allow-origin')).toBeNull();
      const write = await fetch(origin + '/v1/auth/oidc/logout', { method: 'POST', headers: { ...headers, cookie: '__Host-platform=' + 'a'.repeat(43) } });
      expect(write.status).toBe(403);
    }
  } finally { await app.close(); }
});

it('rejects arbitrary, duplicated and unexpected login target parameters before contacting OIDC', async () => {
  const app = await buildServer({});
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    for (const query of ['target=other', 'target=', 'target=https://evil.example.com', 'target=//evil.example.com', 'target=gallery&target=admin', 'returnUrl=https://evil.example.com', 'target=admin&redirect_uri=https://evil.example.com', 'target[page]=admin']) {
      const response = await fetch(origin + '/v1/auth/oidc/start?' + query, { redirect: 'manual' });
      expect(response.status, query).toBe(400);
      expect(response.headers.get('location')).toBeNull();
    }
  } finally { await app.close(); }
});
