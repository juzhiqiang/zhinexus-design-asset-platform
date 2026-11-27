import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { companyLogin } from '../../packages/component-cli/src/commands/login.js';
import { runCli } from '../../packages/component-cli/src/cli.js';
import { resolvePlatformApiUrl, resolvePlatformToken } from '../../packages/component-cli/src/local/credentials.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'juz-login-methods-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const credentialFile = join(root, 'session.local');
  const requests: { path: string; body: Record<string, string>; authorization?: string }[] = [];
  let rejectPassword = false, requireNewPassword = false;
  let metadataOverrides: Record<string, unknown> = {};
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? request.headers['content-type']?.includes('application/x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw) as Record<string, string> : {};
    requests.push({ path: request.url!, body, authorization: request.headers.authorization });
    response.setHeader('content-type', 'application/json');
    if (request.url === '/v1/auth/oidc/cli') return response.end(JSON.stringify({ issuer: origin + '/identity', audience: 'platform', clientId: 'cli', redirectUri: 'http://127.0.0.1:54321/callback', authorizationEndpoint: origin + '/identity/authorize', tokenEndpoint: origin + '/identity/token', passwordLoginEndpoint: origin + '/identity/login', browserAuthorizationEndpoint: origin + '/login', scopes: [], generation: '0', ...metadataOverrides }));
    if (request.url === '/identity/token') return response.end(JSON.stringify({ access_token: 'cli-token', token_type: 'Bearer' }));
    if (request.url === '/identity/login') {
      if (rejectPassword || (requireNewPassword && !body.new_password)) {
        response.statusCode = 401;
        return response.end(JSON.stringify({ code: 'UNAUTHENTICATED', details: requireNewPassword ? [{ path: 'newPassword', message: 'password replacement required' }] : [] }));
      }
      return response.end(JSON.stringify({ access_token: 'cli-token', token_type: 'Bearer' }));
    }
    if (request.url === '/v1/auth/oidc/session') return response.end(JSON.stringify({ authenticated: true }));
    response.statusCode = 404; response.end('{}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  return { origin, credentialFile, requests, overrideMetadata: (value: Record<string, unknown>) => { metadataOverrides = value; }, rejectPassword: () => { rejectPassword = true; }, requireNewPassword: () => { requireNewPassword = true; } };
}

it('logs in with a password over HTTP and saves only the verified token and origin', async () => {
  const f = await fixture(); const warnings: string[] = [];
  expect(await companyLogin({ apiOrigin: f.origin, method: 'password', username: 'alice', password: 'secret-password-123', credentialFile: f.credentialFile, onWarning: message => warnings.push(message) })).toMatchObject({ authenticated: true });
  expect(f.requests.find(r => r.path === '/identity/login')?.body).toEqual({ username: 'alice', password: 'secret-password-123', client_id: 'cli' });
  expect(JSON.parse(await readFile(f.credentialFile, 'utf8'))).toEqual({ apiOrigin: f.origin, accessToken: 'cli-token' });
  expect(warnings.join(' ')).toContain('HTTPS');
});

it('lets the user select account/password and uses a separate hidden password prompt', async () => {
  const f = await fixture(); const labels: string[] = [];
  const result = await runCli(['login', '--api-url', f.origin, '--credential-file', f.credentialFile], 'test', {
    select: async (_label, choices) => { expect(choices.map(c => c.value)).toEqual(['password', 'browser', 'token']); return 'password'; },
    prompt: async label => { labels.push(label); return 'alice'; },
    promptSecret: async label => { labels.push(label); return 'secret-password-123'; },
  });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(labels).toEqual(['username', 'password']);
  expect(result.stdout + result.stderr).not.toContain('secret-password-123');
});

it('accepts explicit password mode and requests first-login password replacement without echoing secrets', async () => {
  const f = await fixture(); f.requireNewPassword(); const labels: string[] = [];
  const result = await runCli(['login', '--method', 'password', '--username', 'alice', '--api-url', f.origin, '--credential-file', f.credentialFile], 'test', {
    promptSecret: async label => { labels.push(label); return label === 'password' ? 'temporary-pass-123' : 'replacement-pass-456'; },
  });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(labels).toEqual(['password', 'newPassword', 'confirmPassword']);
  expect(f.requests.filter(r => r.path === '/identity/login').at(-1)?.body.new_password).toBe('replacement-pass-456');
  expect(result.stdout + result.stderr).not.toMatch(/temporary-pass-123|replacement-pass-456/);
});

it('does not overwrite a saved login when a password is rejected', async () => {
  const f = await fixture(); f.rejectPassword(); const previous = JSON.stringify({ apiOrigin: f.origin, accessToken: 'previous-token' });
  await writeFile(f.credentialFile, previous);
  const result = await runCli(['login', '--method', 'password', '--username', 'alice', '--api-url', f.origin, '--credential-file', f.credentialFile], 'test', { promptSecret: async () => 'incorrect-pass-123' });
  expect(result.exitCode).toBe(1);
  expect(await readFile(f.credentialFile, 'utf8')).toBe(previous);
  expect(result.stderr).not.toContain('incorrect-pass-123');
});

it('lets the user select Token without fetching browser or password metadata', async () => {
  const f = await fixture();
  const result = await runCli(['login', '--api-url', f.origin, '--credential-file', f.credentialFile], 'test', { select: async () => 'token', promptSecret: async () => 'user-token' });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(f.requests.map(r => r.path)).toEqual(['/v1/auth/oidc/session']);
  expect(f.requests[0]?.authorization).toBe('Bearer user-token');
});

it('rejects conflicting modes before making requests', async () => {
  const f = await fixture();
  const result = await runCli(['login', '--method', 'browser', '--token', 'user-token', '--api-url', f.origin], 'test');
  expect(result.exitCode).toBe(1); expect(f.requests).toEqual([]);
});

it('retains and reuses HTTP credentials for a non-loopback platform origin', async () => {
  const f = await fixture(); const apiOrigin = 'http://platform.company.test:3000';
  await writeFile(f.credentialFile, JSON.stringify({ apiOrigin, accessToken: 'saved-token' }));
  vi.stubEnv('ZHINEXUS_CREDENTIAL_FILE', f.credentialFile);
  for (const key of ['PLATFORM_API_URL', 'ZHINEXUS_API_URL', 'ZHINEXUS_API_TOKEN', 'PLATFORM_TOKEN', 'PLATFORM_API_TOKEN', 'ZHINEXUS_TOKEN']) vi.stubEnv(key, '');
  expect(await resolvePlatformApiUrl()).toBe(apiOrigin);
  expect(await resolvePlatformToken(apiOrigin)).toBe('saved-token');
});

it('opens the advertised HTTP browser form and completes the original PKCE exchange', async () => {
  const f = await fixture(); let challenge = '';
  const reservation = createServer(); await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const redirectUri = 'http://127.0.0.1:' + (reservation.address() as { port: number }).port + '/callback';
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  f.overrideMetadata({ redirectUri });
  const result = await companyLogin({ apiOrigin: f.origin, method: 'browser', credentialFile: f.credentialFile, openBrowser: async address => {
    const url = new URL(address); expect(url.origin + url.pathname).toBe(f.origin + '/login');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256'); challenge = url.searchParams.get('code_challenge')!;
    const callback = new URL(redirectUri); callback.search = new URLSearchParams({ code: randomBytes(16).toString('hex'), state: url.searchParams.get('state')! }).toString();
    expect((await fetch(callback)).status).toBe(200);
  } });
  expect(result.authenticated).toBe(true);
  const exchange = f.requests.find(r => r.path === '/identity/token')!.body;
  expect(createHash('sha256').update(exchange.code_verifier!).digest('base64url')).toBe(challenge);
  expect(exchange.redirect_uri).toBe(redirectUri);
  expect(JSON.parse(await readFile(f.credentialFile, 'utf8')).accessToken).toBe('cli-token');
});

it('never sends a password to an advertised endpoint on a different origin', async () => {
  const f = await fixture(); f.overrideMetadata({ passwordLoginEndpoint: 'http://untrusted.example.test/identity/login' });
  await expect(companyLogin({ apiOrigin: f.origin, method: 'password', username: 'alice', password: 'secret-pass-123', credentialFile: f.credentialFile })).rejects.toThrow('PASSWORD_ENDPOINT_INVALID');
  expect(f.requests.map(r => r.path)).toEqual(['/v1/auth/oidc/cli']);
});

it('keeps explicit Token login non-interactive and does not print it', async () => {
  const f = await fixture();
  const result = await runCli(['login', '--token', 'private-user-token', '--api-url', f.origin, '--credential-file', f.credentialFile], 'test', { select: async () => { throw new Error('must not prompt'); } });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout + result.stderr).not.toContain('private-user-token');
});
