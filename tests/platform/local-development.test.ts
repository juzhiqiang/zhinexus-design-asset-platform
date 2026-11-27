import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { platformHarness } from './http-support.js';

const credentials = { username: 'admin', password: 'ZhinexusAdmin!2026' };

it('preview activation survives a development restart while configured OIDC still blocks development bootstrap', async () => {
  const h = await platformHarness({ oidc: undefined, keyResolver: undefined, devAdmin: credentials });
  try {
    const preview = randomUUID();
    await h.db.query("INSERT INTO access_revisions(id,section,config) VALUES ($1,'preview','{}')", [preview]);
    await h.db.query("UPDATE access_active SET active_revision_id=$1 WHERE section='preview'", [preview]);
    await h.restart();
    expect((await h.request('/identity/login', credentials)).status).toBe(200);
    const oidc = randomUUID();
    await h.db.query("INSERT INTO access_revisions(id,section,config) VALUES ($1,'oidc','{}')", [oidc]);
    await h.db.query("UPDATE access_active SET active_revision_id=$1 WHERE section='oidc'", [oidc]);
    await expect(h.restart()).rejects.toThrow('UNAUTHENTICATED');
  } finally { await h.close(); }
});

it('local development uses persistent accounts for login, member management and access settings', async () => {
  const h = await platformHarness({ oidc: undefined, keyResolver: undefined, devAdmin: credentials });
  try {
    const login = async (body = credentials) => {
      const response = await h.request('/identity/login', body);
      expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
      return (await response.json()).access_token as string;
    };
    const token = await login();
    const members = await h.request('/v1/managed-accounts?page=1&pageSize=20', undefined, token, 'GET');
    expect(members.status).toBe(200);
    expect((await members.json()).items).toEqual(expect.arrayContaining([expect.objectContaining({ username: 'admin', administrator: true })]));
    expect((await h.request('/v1/access-settings', undefined, token, 'GET')).status).toBe(200);

    await h.request('/identity/password', { username: 'admin', current_password: credentials.password, new_password: 'ChangedAdmin!2026' });
    await h.restart();
    expect((await h.request('/v1/managed-accounts', undefined, token, 'GET')).status).toBe(200);
    expect((await h.request('/identity/login', credentials)).status).toBe(401);
    const current = await login({ username: 'admin', password: 'ChangedAdmin!2026' });
    const created = await h.request('/v1/managed-accounts', { username: 'local.member', displayName: '本地成员', roles: ['reader'] }, current);
    expect(created.status).toBe(201);
    const member = await created.json();
    await h.platform().identityWorker!.tick();
    expect((await h.request(`/v1/managed-accounts/${member.id}/password`, { expectedRevision: '0', password: 'TemporaryMember!2026' }, current)).status).toBe(200);
    const memberLogin = await h.request('/identity/login', { username: 'local.member', password: 'TemporaryMember!2026', new_password: 'ChangedMember!2026' });
    expect(memberLogin.status).toBe(200);
    const memberToken = (await memberLogin.json()).access_token;
    expect((await h.request('/v1/auth/oidc/session', undefined, memberToken, 'GET')).status).toBe(200);
    const detail = await (await h.request(`/v1/managed-accounts/${member.id}`, undefined, current, 'GET')).json();
    expect((await h.request(`/v1/managed-accounts/${member.id}/disable`, { expectedRevision: detail.desiredRevision }, current)).status).toBe(200);
    expect((await h.request('/v1/auth/oidc/session', undefined, memberToken, 'GET')).status).toBe(403);
    await h.restart();
    expect((await h.request('/identity/login', { username: 'local.member', password: 'ChangedMember!2026' })).status).toBe(403);
  } finally { await h.close(); }
});

it.each(['admin', 'gallery'] as const)('local %s OIDC completes PKCE with a real HTTP session and CSRF checks', async target => {
  const h = await platformHarness({ oidc: undefined, keyResolver: undefined, devAdmin: credentials });
  try {
    const start = await fetch(h.origin() + '/v1/auth/oidc/start?target=' + target, { redirect: 'manual' });
    expect(start.status).toBe(303);
    const url = new URL(start.headers.get('location')!);
    expect(url.origin + url.pathname).toBe('http://127.0.0.1:5177/login');
    const cookie = start.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^zhinexus-dev-oidc=/);
    expect(cookie).not.toContain('Secure');
    const rejected = await fetch(h.origin() + '/identity/authorize', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' }, body: new URLSearchParams({ ...Object.fromEntries(url.searchParams), username: 'admin', password: 'wrong-password' }) });
    expect(rejected.status).toBe(303);
    const retry = new URL(rejected.headers.get('location')!);
    expect(retry.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:3000/v1/auth/oidc/callback');
    const authorization = await fetch(h.origin() + '/identity/authorize', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...Object.fromEntries(url.searchParams), ...credentials }) });
    expect(authorization.status).toBe(303);
    const callback = new URL(authorization.headers.get('location')!);
    const response = await fetch(h.origin() + callback.pathname + callback.search, { redirect: 'manual', headers: { cookie: cookie.split(';')[0]! } });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(target === 'admin' ? 'http://127.0.0.1:5177/upload' : 'http://127.0.0.1:5173/library');
    const session = response.headers.get('set-cookie')!;
    expect(session).toMatch(/^zhinexus-dev-platform=/);
    expect(session).toContain('HttpOnly');
    expect(session).toContain('SameSite=Lax');
    expect(Number(/Max-Age=(\d+)/.exec(session)?.[1])).toBeGreaterThan(7100);
    expect(Number(/Max-Age=(\d+)/.exec(session)?.[1])).toBeLessThanOrEqual(7200);
    const headers = { cookie: session.split(';')[0]! };
    expect((await fetch(h.origin() + '/v1/auth/oidc/session', { headers })).status).toBe(200);
    expect((await fetch(h.origin() + '/v1/auth/oidc/renew', { method: 'POST', headers: { ...headers, Origin: 'http://127.0.0.1:5177' } })).status).toBe(401);
    expect((await fetch(h.origin() + '/v1/auth/oidc/logout', { method: 'POST', headers })).status).toBe(403);
    expect((await fetch(h.origin() + '/v1/auth/oidc/logout', { method: 'POST', headers: { ...headers, Origin: 'http://127.0.0.1:5177' } })).status).toBe(200);
    expect((await fetch(h.origin() + '/v1/auth/oidc/session', { headers })).status).toBe(401);
  } finally { await h.close(); }
});
