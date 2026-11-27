import { createServer } from 'node:http';
import * as fs from 'node:fs/promises';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { platformAuthorization, resolvePlatformToken, savePlatformCredential } from '../../packages/component-cli/src/local/credentials.js';
import { publishingAccess } from '../../packages/component-cli/src/project/doctor.js';

vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>() }));

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const jwt = (expires: number) => 'header.' + Buffer.from(JSON.stringify({ exp: expires })).toString('base64url') + '.signature';
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'juz-renew-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'session.local');
  for (const name of ['ZHINEXUS_API_TOKEN', 'PLATFORM_TOKEN', 'PLATFORM_API_TOKEN', 'ZHINEXUS_TOKEN']) vi.stubEnv(name, '');
  vi.stubEnv('ZHINEXUS_CREDENTIAL_FILE', file);
  let now = Math.floor(Date.now() / 1000) * 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const old = jwt(now / 1000 + 120);
  const renewed = jwt(now / 1000 + 7200);
  let status = 200, body: unknown = { accessToken: renewed, expiresIn: 7200 };
  let handler: ((path: string) => { body: unknown }) | undefined;
  const requests: { path: string; method: string; authorization?: string; body: string }[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({ path: request.url!, method: request.method!, authorization: request.headers.authorization, body: Buffer.concat(chunks).toString() });
    response.statusCode = status;
    response.setHeader('content-type', 'application/json');
    if (status === 302) response.setHeader('location', '/credential-leak');
    response.end(JSON.stringify(handler ? handler(request.url!).body : body));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const apiOrigin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const saved = { apiOrigin, accessToken: old };
  await writeFile(file, JSON.stringify(saved));
  return { file, apiOrigin, old, renewed, saved, requests, advance: (ms: number) => { now += ms; },
    respond: (code: number, value?: unknown) => { status = code; body = value ?? {}; },
    handle: (callback: NonNullable<typeof handler>) => { handler = callback; } };
}

it('renews an active saved JWT before expiry and atomically saves only its token and origin', async () => {
  const f = await fixture();
  expect(await resolvePlatformToken(f.apiOrigin)).toBe(f.renewed);
  expect(JSON.parse(await readFile(f.file, 'utf8'))).toEqual({ apiOrigin: f.apiOrigin, accessToken: f.renewed });
  expect(f.requests).toEqual([{ path: '/v1/auth/oidc/renew', method: 'POST', authorization: 'Bearer ' + f.old, body: '{}' }]);
  expect(await resolvePlatformToken(f.apiOrigin)).toBe(f.renewed);
  expect(f.requests).toHaveLength(1);
});

it('coalesces concurrent renewal requests for the same saved credential', async () => {
  const f = await fixture();
  expect(await Promise.all([resolvePlatformToken(f.apiOrigin), resolvePlatformToken(f.apiOrigin), resolvePlatformToken(f.apiOrigin)])).toEqual([f.renewed, f.renewed, f.renewed]);
  expect(f.requests).toHaveLength(1);
});

it.each([
  ['same-origin', 'renewal-first'], ['other-origin', 'renewal-first'],
  ['same-origin', 'login-first'], ['other-origin', 'login-first'],
])('preserves a concurrent new login while saving (%s, %s)', async (origin, order) => {
  const f = await fixture();
  const actualRename = fs.rename, actualOpen = fs.open;
  const reachedRename = signal(), resumeRename = signal(), contended = signal();
  let paused = false;
  vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
    if (String(target) === f.file && !paused) {
      paused = true; reachedRename.resolve(); await resumeRename.promise;
    }
    return actualRename(source, target);
  });
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    try { return await actualOpen(...args); }
    catch (error) {
      if (args[1] === 'wx' && (error as NodeJS.ErrnoException).code === 'EEXIST') contended.resolve();
      throw error;
    }
  });
  const nextLogin = { apiOrigin: origin === 'same-origin' ? f.apiOrigin : 'https://other.example.com', accessToken: 'new-login' };
  const login = () => savePlatformCredential(nextLogin.apiOrigin, nextLogin.accessToken, f.file);
  const renewal = () => resolvePlatformToken(f.apiOrigin, f.old);
  const first = order === 'renewal-first' ? renewal() : login();
  await reachedRename.promise;
  const second = order === 'renewal-first' ? login() : renewal();
  try { await Promise.race([second, contended.promise]); }
  finally { resumeRename.resolve(); }
  const results = await Promise.all([first, second]);
  expect(results[order === 'renewal-first' ? 0 : 1]).toBe(f.renewed);
  expect(JSON.parse(await readFile(f.file, 'utf8'))).toEqual(nextLogin);
});

it('passes the token renewed during publishing preflight into the later release', async () => {
  const f = await fixture();
  const initial = jwt(Date.now() / 1000 + 310);
  f.handle(path => {
    if (path === '/v1/auth/oidc/session') {
      f.advance(20_000);
      return { body: { authenticated: true, subject: 'publisher', roles: ['publisher'] } };
    }
    if (path === '/v1/publishing/options') return { body: { categories: [], components: [], packages: [] } };
    return { body: { accessToken: f.renewed, expiresIn: 7200 } };
  });
  const access = await publishingAccess(f.apiOrigin, initial);
  expect(f.requests.find(request => request.path === '/v1/publishing/options')?.authorization).toBe('Bearer ' + f.renewed);
  f.advance(300_000);
  expect(await resolvePlatformToken(access.apiUrl, access.token)).toBe(f.renewed);
});

it('releases its own credential lock after a failed atomic save', async () => {
  const f = await fixture();
  vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk failure'));
  await expect(savePlatformCredential(f.apiOrigin, 'new-login')).rejects.toThrow('disk failure');
  expect(JSON.parse(await readFile(f.file, 'utf8'))).toEqual(f.saved);
  await expect(readFile(f.file + '.lock')).rejects.toMatchObject({ code: 'ENOENT' });
  await savePlatformCredential(f.apiOrigin, 'new-login');
  expect(JSON.parse(await readFile(f.file, 'utf8')).accessToken).toBe('new-login');
});

it('fails closed after bounded waiting without deleting an unowned credential lock', async () => {
  const f = await fixture(), lock = f.file + '.lock';
  await writeFile(lock, 'another-cli-operation');
  await expect(savePlatformCredential(f.apiOrigin, 'new-login')).rejects.toThrow('CREDENTIAL_BUSY:');
  expect(await readFile(lock, 'utf8')).toBe('another-cli-operation');
  expect(JSON.parse(await readFile(f.file, 'utf8'))).toEqual(f.saved);
}, 10_000);

it('checks again during a long command and then reuses the renewed explicit token', async () => {
  const f = await fixture();
  const token = jwt(Date.now() / 1000 + 600);
  const authorization = platformAuthorization(f.apiOrigin, token);
  expect(await authorization()).toBe('Bearer ' + token);
  expect(f.requests).toHaveLength(0);
  f.advance(310_000);
  expect(await authorization()).toBe('Bearer ' + f.renewed);
  expect(await authorization()).toBe('Bearer ' + f.renewed);
  expect(f.requests).toHaveLength(1);
  expect(JSON.parse(await readFile(f.file, 'utf8'))).toEqual(f.saved);
});

it('renews an environment token without persisting it over a different saved login', async () => {
  const f = await fixture();
  await writeFile(f.file, JSON.stringify({ apiOrigin: f.apiOrigin, accessToken: 'different-login' }));
  vi.stubEnv('PLATFORM_TOKEN', f.old);
  expect(await resolvePlatformToken(f.apiOrigin)).toBe(f.renewed);
  expect(JSON.parse(await readFile(f.file, 'utf8')).accessToken).toBe('different-login');
});

it('does not send a saved credential to another origin or renew an expired JWT', async () => {
  const f = await fixture();
  expect(await resolvePlatformToken('https://other.example.com')).toBeUndefined();
  f.advance(121_000);
  expect(await resolvePlatformToken(f.apiOrigin)).toBeUndefined();
  expect(f.requests).toHaveLength(0);
  expect(JSON.parse(await readFile(f.file, 'utf8'))).toEqual(f.saved);
});

it('uses a still-valid token when the connected server does not support local renewal', async () => {
  const f = await fixture(); f.respond(404);
  expect(await resolvePlatformToken(f.apiOrigin)).toBe(f.old);
  expect(JSON.parse(await readFile(f.file, 'utf8'))).toEqual(f.saved);
});

it.each([401, 403, 500, 302])('does not overwrite saved credentials or follow redirects when renewal returns %s', async status => {
  const f = await fixture(); f.respond(status);
  await expect(resolvePlatformToken(f.apiOrigin)).rejects.toThrow(/RENEW|UNAUTHENTICATED|FORBIDDEN/);
  expect(JSON.parse(await readFile(f.file, 'utf8'))).toEqual(f.saved);
  expect(f.requests).toHaveLength(1);
});

it.each([{ accessToken: 'not-a-jwt', expiresIn: 7200 }, { accessToken: jwt(1), expiresIn: 7200 }, { accessToken: 'token', expiresIn: -1 }])('rejects unusable renewal responses without replacing credentials', async body => {
  const f = await fixture(); f.respond(200, body);
  await expect(resolvePlatformToken(f.apiOrigin)).rejects.toThrow(/RENEW/);
  expect(JSON.parse(await readFile(f.file, 'utf8'))).toEqual(f.saved);
});
