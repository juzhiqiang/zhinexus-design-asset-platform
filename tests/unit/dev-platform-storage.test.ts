import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { ensureLocalArtifactBucket, resolveLocalPlatformStorageEnvironment, resolveLocalRegistryToken } from '../../scripts/dev-storage.js';

const roots: string[] = [];
function localRoot(value: unknown = { minioUser: 'local-test-user', minioPassword: 'local-test-secret', publisherPassword: 'local-publisher-secret' }) {
  const root = mkdtempSync(join(tmpdir(), 'zhinexus-dev-storage-'));
  roots.push(root);
  mkdirSync(join(root, '.tools/g2-local'), { recursive: true });
  writeFileSync(join(root, '.tools/g2-local/credentials.json'), JSON.stringify(value));
  return root;
}
afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('supplies matching local S3 credentials so the API can create upload plans', () => {
  expect(resolveLocalPlatformStorageEnvironment(localRoot(), {})).toEqual({
    PLATFORM_S3_ENDPOINT: 'http://127.0.0.1:19000',
    PLATFORM_S3_BUCKET: 'zhinexus-local-artifacts',
    PLATFORM_S3_REGION: 'us-east-1',
    PLATFORM_S3_ACCESS_KEY: 'local-test-user',
    PLATFORM_S3_SECRET_KEY: 'local-test-secret',
  });
});

it.each([{ PLATFORM_S3_ENDPOINT: 'https://objects.example.com' }, { PLATFORM_S3_SECRET_KEY: 'explicit' }, { NODE_ENV: 'production' }])('never mixes local storage secrets into explicit or production configuration: %o', env => {
  expect(resolveLocalPlatformStorageEnvironment(localRoot(null), env)).toBeUndefined();
});

it('allows code-only development without local storage credentials', () => {
  const root = mkdtempSync(join(tmpdir(), 'zhinexus-no-storage-')); roots.push(root);
  expect(resolveLocalPlatformStorageEnvironment(root, {})).toBeUndefined();
});

it('keeps database-only development available when the local file has no storage identity', () => {
  expect(resolveLocalPlatformStorageEnvironment(localRoot({ postgresPassword: 'db-only' }), {})).toBeUndefined();
});

it('rejects incomplete local credentials without including their contents', () => {
  expect(() => resolveLocalPlatformStorageEnvironment(localRoot({ minioUser: 'sensitive-user' }), {}))
    .toThrow('Local MinIO credentials are incomplete');
});

it('uses the local publisher login only for the fixed local registry', async () => {
  const requests: { url: string; redirect: RequestRedirect | undefined; username: string }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const input = JSON.parse(String(init.body));
    requests.push({ url, redirect: init.redirect, username: input.name });
    return Response.json({ token: 'verified-local-token' });
  });
  expect(await resolveLocalRegistryToken(localRoot(), {})).toBe('verified-local-token');
  expect(requests).toEqual([{ url: 'http://127.0.0.1:14873/-/user/org.couchdb.user:g2publisher', redirect: 'error', username: 'g2publisher' }]);
});

it('does not authenticate with local passwords for remote registries, production or explicit tokens', async () => {
  vi.stubGlobal('fetch', () => { throw new Error('unexpected local credential request'); });
  const root = localRoot(null);
  expect(await resolveLocalRegistryToken(root, { PLATFORM_REGISTRY_ORIGIN: 'https://registry.example.com' })).toBeUndefined();
  expect(await resolveLocalRegistryToken(root, { NODE_ENV: 'production' })).toBeUndefined();
  expect(await resolveLocalRegistryToken(root, { PLATFORM_REGISTRY_TOKEN: 'explicit-token' })).toBe('explicit-token');
});

it.each([Response.json({ error: 'local-publisher-secret' }, { status: 401 }), Response.json({ token: '' }), Response.json({ token: 'invalid token' })])('sanitizes registry authentication failures', async response => {
  vi.stubGlobal('fetch', async () => response);
  await expect(resolveLocalRegistryToken(localRoot(), {})).rejects.toThrow('Local registry authentication failed');
});

it.each([200, 409, 403])('initializes a private bucket, tolerates ownership conflicts and rejects other S3 errors (%i)', async status => {
  const requests: { method: string | undefined; path: string | undefined; acl: string | string[] | undefined }[] = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, path: request.url, acl: request.headers['x-amz-acl'] });
    response.writeHead(status, { 'content-type': 'application/xml' });
    response.end(status === 200 ? '' : '<Error><Code>' + (status === 409 ? 'BucketAlreadyOwnedByYou' : 'AccessDenied') + '</Code></Error>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const operation = ensureLocalArtifactBucket({ ...resolveLocalPlatformStorageEnvironment(localRoot(), {}), PLATFORM_S3_ENDPOINT: 'http://127.0.0.1:' + port });
    if (status === 403) await expect(operation).rejects.toThrow('Local MinIO bucket initialization failed');
    else await expect(operation).resolves.toBeUndefined();
    expect(requests).toEqual([{ method: 'PUT', path: '/zhinexus-local-artifacts/', acl: undefined }]);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

it('refuses to default a production registry origin before spawning the worker', () => {
  const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/dev.ts', 'worker'], {
    cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 15_000, windowsHide: true,
    env: { ...process.env, NODE_ENV: 'production', PLATFORM_DATABASE_URL: 'postgresql://configured',
      PLATFORM_S3_ENDPOINT: 'https://objects.example.com', PLATFORM_REGISTRY_ORIGIN: '',
      PLATFORM_REGISTRY_TOKEN: 'test-production-token', npm_execpath: process.execPath },
  });
  expect(child.status).toBe(1);
  expect(child.stderr).toContain('Worker configuration is incomplete');
});
