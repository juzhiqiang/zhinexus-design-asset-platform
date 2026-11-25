import { describe, expect, it } from 'vitest';
import { buildServer } from '../../apps/api/dist/app.js';

describe('local dev default administrator password login', () => {
  it('stays fail-closed when devAdmin is not explicitly configured', async () => {
    const app = await buildServer({});
    await app.listen(0, '127.0.0.1');
    try {
      const base = (await app.getUrl()).replace(/\/$/, '');
      const login = await fetch(`${base}/identity/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'ZhinexusAdmin!2026' }),
      });
      expect(login.status).toBe(503);
      const session = await fetch(`${base}/v1/auth/oidc/session`);
      expect(session.status).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('authenticates the default admin credentials and verifies the issued Bearer token as administrator', async () => {
    const app = await buildServer({ devAdmin: { username: 'admin', password: 'ZhinexusAdmin!2026' } });
    await app.listen(0, '127.0.0.1');
    try {
      const base = (await app.getUrl()).replace(/\/$/, '');
      const bad = await fetch(`${base}/identity/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'wrong-password' }),
      });
      expect(bad.status).toBe(401);

      const ok = await fetch(`${base}/identity/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'ZhinexusAdmin!2026' }),
      });
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as { access_token: string; token_type: string };
      expect(body.token_type).toBe('Bearer');
      expect(body.access_token.split('.')).toHaveLength(3);

      const session = await fetch(`${base}/v1/auth/oidc/session`, {
        headers: { Authorization: `Bearer ${body.access_token}` },
      });
      expect(session.status).toBe(200);
      expect(await session.json()).toEqual({
        authenticated: true,
        administrator: true,
        subject: 'admin',
        roles: ['reader', 'publisher', 'maintainer'],
      });
    } finally {
      await app.close();
    }
  });
});
