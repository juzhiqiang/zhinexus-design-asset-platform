import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../apps/api/dist/app.js';

describe('local dev administrator runtime', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('rejects developer authentication in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(buildServer({ databaseUrl: 'postgresql://unreachable.invalid/local', devAdmin: { username: 'admin', password: 'ZhinexusAdmin!2026' } })).rejects.toThrow();
  });
  it('requires a database instead of issuing an unusable stateless login', async () => {
    await expect(buildServer({ devAdmin: { username: 'admin', password: 'ZhinexusAdmin!2026' } })).rejects.toThrow();
  });
  it('rejects non-loopback development binding', async () => {
    vi.stubEnv('PLATFORM_BIND_HOST', '0.0.0.0');
    await expect(buildServer({ databaseUrl: 'postgresql://unreachable.invalid/local', devAdmin: { username: 'admin', password: 'ZhinexusAdmin!2026' } })).rejects.toThrow();
  });
  it('stays fail-closed when devAdmin is not explicitly configured', async () => {
    const app = await buildServer({});
    await app.listen(0, '127.0.0.1');
    try {
      const base = await app.getUrl();
      expect((await fetch(base + '/identity/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'ZhinexusAdmin!2026' }) })).status).toBe(503);
      expect((await fetch(base + '/v1/auth/oidc/session')).status).toBe(401);
    } finally { await app.close(); }
  });
});
