import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { decodeJwt } from 'jose';
import { companyLogin } from '../../packages/component-cli/dist/commands/login.js';
import { platformHarness } from './http-support.js';

it('issues real CLI password credentials, verifies the signed identity and saves it with Token login', async () => {
  const credentials = { username: 'admin', password: 'CliLoginAdmin!2026' };
  const h = await platformHarness({ oidc: undefined, keyResolver: undefined, devAdmin: { username: credentials.username, password: credentials.password } });
  const root = await mkdtemp(join(tmpdir(), 'cli-real-login-'));
  try {
    const metadata = await (await h.request('/v1/auth/oidc/cli', undefined, undefined, 'GET')).json();
    expect(metadata.passwordLoginEndpoint).toBe('http://127.0.0.1:3000/identity/login');
    expect(metadata.browserAuthorizationEndpoint).toBe('http://127.0.0.1:5177/login');
    expect((await h.request('/identity/login', { ...credentials, client_id: 'unregistered-client' })).status).toBe(400);
    expect((await h.request('/identity/login', { ...credentials, password: 'incorrect', client_id: metadata.clientId })).status).toBe(401);
    const response = await h.request('/identity/login', { ...credentials, client_id: metadata.clientId });
    expect(response.status).toBe(200);
    const token = (await response.json()).access_token;
    const identity = await h.platform().authenticate('Bearer ' + token);
    expect(identity.channel).toBe('cli');
    expect(identity.clientId).toBe('zhinexus-cli');
    expect(identity.roles).toContain('publisher');
    const web = await h.request('/identity/login', credentials);
    expect((await h.platform().authenticate('Bearer ' + (await web.json()).access_token)).channel).toBe('web');
    const credentialFile = join(root, 'session.local');
    await expect(companyLogin({ apiOrigin: h.origin(), token, credentialFile })).resolves.toMatchObject({ authenticated: true });
    const saved = JSON.parse(await readFile(credentialFile, 'utf8'));
    expect(saved).toEqual({ apiOrigin: h.origin(), accessToken: token });
    expect((await h.request('/v1/auth/oidc/session', undefined, saved.accessToken, 'GET')).status).toBe(200);
  } finally { await h.close(); await rm(root, { recursive: true, force: true }); }
});

it('renews real signed local tokens and keeps revocation and account-version checks effective', async () => {
  const credentials = { username: 'admin', password: 'CliRenewAdmin!2026', client_id: 'zhinexus-cli' };
  const h = await platformHarness({ oidc: undefined, keyResolver: undefined, devAdmin: credentials });
  try {
    const login = await h.request('/identity/login', credentials);
    expect(login.status).toBe(200);
    const issued = await login.json();
    expect(issued.expires_in).toBe(7200);
    const original = decodeJwt(issued.access_token);
    expect(original.exp! - original.iat!).toBe(7200);
    expect((await h.request('/v1/auth/oidc/renew', {})).status).toBe(401);
    expect((await h.request('/v1/auth/oidc/renew', {}, undefined, 'POST', { authorization: 'Session ' + 'a'.repeat(43) })).status).toBe(401);
    const renewed = await h.request('/v1/auth/oidc/renew', {}, issued.access_token);
    expect(renewed.status).toBe(200);
    expect(renewed.headers.get('cache-control')).toBe('no-store');
    const result = await renewed.json();
    const next = decodeJwt(result.accessToken);
    expect(next).toMatchObject({ sub: original.sub, azp: original.azp, auth_time: original.auth_time, platform_account_version: original.platform_account_version });
    expect(next.exp! - next.iat!).toBe(7200);
    expect(next.jti).not.toBe(original.jti);
    expect((await h.request('/v1/auth/oidc/session', undefined, result.accessToken, 'GET')).status).toBe(200);
    const identity = await h.platform().authenticate('Bearer ' + issued.access_token);
    const audit = await h.db.query("SELECT data FROM audit_events WHERE subject=$1 AND event='ACCESS_TOKEN_RENEWED'", [identity.subject]);
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows)).not.toContain(result.accessToken);
    await h.db.query('UPDATE managed_accounts SET auth_time_floor=$2 WHERE platform_subject=$1', [identity.subject, original.auth_time]);
    expect((await h.request('/v1/auth/oidc/renew', {}, result.accessToken)).status).toBe(401);
    await h.db.query('UPDATE managed_accounts SET auth_time_floor=0,version=version+1 WHERE platform_subject=$1', [identity.subject]);
    expect((await h.request('/v1/auth/oidc/renew', {}, issued.access_token)).status).toBe(401);
    await h.db.query('UPDATE managed_accounts SET enabled=false WHERE platform_subject=$1', [identity.subject]);
    expect((await h.request('/v1/auth/oidc/renew', {}, issued.access_token)).status).toBe(403);
  } finally { await h.close(); }
});

it('does not re-sign an external company issuer token as a local token', async () => {
  const h = await platformHarness();
  try {
    const token = await h.token('external-user', ['publisher'], 'cli');
    expect((await h.request('/v1/auth/oidc/renew', {}, token)).status).toBe(404);
  } finally { await h.close(); }
});
