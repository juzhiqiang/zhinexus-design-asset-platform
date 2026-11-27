import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { companyLogin } from '../../packages/component-cli/dist/commands/login.js';
import { platformHarness } from './http-support.js';

it('issues real CLI password credentials, verifies the signed identity and saves it with Token login', async () => {
  const credentials = { username: 'admin', password: 'CliLoginAdmin!2026' };
  const h = await platformHarness({ oidc: undefined, keyResolver: undefined, devAdmin: credentials });
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
