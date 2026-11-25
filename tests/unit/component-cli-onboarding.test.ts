import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createServer, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../../packages/component-cli/src/cli.js';
import { companyLogin } from '../../packages/component-cli/src/commands/login.js';
import { resolvePlatformApiUrl, resolvePlatformToken } from '../../packages/component-cli/src/local/credentials.js';

const roots: string[] = [];
const servers: ReturnType<typeof createServer>[] = [];
vi.mock('node:os', async importOriginal => ({ ...await importOriginal<typeof import('node:os')>(), homedir: () => process.env.JUZ_TEST_HOME! }));
beforeEach(async () => {
  vi.stubEnv('JUZ_TEST_HOME', await temporaryRoot());
  for (const key of ['PLATFORM_API_URL', 'ZHINEXUS_API_URL', 'ZHINEXUS_API_TOKEN', 'PLATFORM_TOKEN', 'PLATFORM_API_TOKEN', 'ZHINEXUS_TOKEN']) vi.stubEnv(key, '');
  vi.stubEnv('ZHINEXUS_CREDENTIAL_FILE', path.join(os.tmpdir(), 'juz-no-saved-login-' + crypto.randomUUID()));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map(server => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); }));
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
async function temporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'juz-onboarding-')); roots.push(root); return root;
}
async function origin(handler: (authorization: string | undefined, url: string | undefined, response: ServerResponse) => void) {
  const server = createServer((request, response) => handler(request.headers.authorization, request.url, response));
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + (server.address() as { port: number }).port;
}
async function publishingApi() {
  return origin((_authorization, url, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(url === '/v1/auth/oidc/session'
      ? { authenticated: true, subject: 'publisher', roles: ['publisher'] }
      : { categories: [{ id: 'general', name: '通用', enabled: true, revision: '0' }, { id: 'disabled', name: '停用', enabled: false, revision: '0' }], components: [{ componentId: 'badge', category: 'general' }], packages: ['@fixture/badge'] }));
  });
}
async function existingPackage(root: string, manager?: string) {
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: '@fixture/badge', version: '1.0.0', ...(manager ? { packageManager: manager } : {}), scripts: { build: 'node build.mjs', dev: 'node dev.mjs' } }));
  await fs.writeFile(path.join(root, 'dev.mjs'), "import { writeFileSync } from 'node:fs'; writeFileSync('dev-started', 'yes');\n");
}

describe('simple project CLI onboarding', () => {
  it('initializes an existing npm package through prompts and runs its only development framework without another choice', async () => {
    const root = await temporaryRoot(); await existingPackage(root, 'npm@11.0.0');
    const selected: string[] = []; const prompted: string[] = [];
    const result = await runCli(['init', '--api-url', await publishingApi(), '--token', 'unit-token'], '1.0.0', {
      cwd: root,
      prompt: async (label, fallback) => { prompted.push(label); return label === 'component' ? 'badge' : label === 'export' ? 'Badge' : fallback ?? ''; },
      select: async (label, choices) => { selected.push(label); if (label === 'category') expect(choices.map(choice => choice.value)).toEqual(['general']); return label === 'framework' ? 'react' : 'general'; },
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(prompted).toEqual(['package', 'component', 'export']); expect(selected).toEqual(['framework', 'category']);
    const config = JSON.parse(await fs.readFile(path.join(root, 'component.config.json'), 'utf8'));
    expect(config.packageDir).toBe('.'); expect(config.build.program).toBe('npm'); expect(config.dev.react.program).toBe('npm');
    expect(config.variants[0]).toMatchObject({ componentId: 'badge', exportName: 'Badge', framework: 'react', category: 'general' });
    const dev = await runCli(['dev'], '1.0.0', { cwd: root, select: async () => { throw new Error('Unnecessary selection'); } });
    expect(dev.exitCode, dev.stderr).toBe(0); expect(await fs.readFile(path.join(root, 'dev-started'), 'utf8')).toBe('yes');
  });
  it.each(['pnpm-lock.yaml', 'package-lock.json'])('infers the package manager from %s when the package manifest omits it', async lock => {
    const root = await temporaryRoot(); await existingPackage(root); await fs.writeFile(path.join(root, lock), '{}');
    const result = await runCli(['init', '--component', 'badge', '--export', 'Badge', '--framework', 'react', '--category', 'general'], '1.0.0', { cwd: root });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(await fs.readFile(path.join(root, 'component.config.json'), 'utf8')).build.program).toBe(lock === 'pnpm-lock.yaml' ? 'pnpm' : 'npm');
  });
  it('explains how to log in before selecting a real enabled category', async () => {
    const root = await temporaryRoot(); await existingPackage(root);
    const result = await runCli(['init', '--component', 'badge', '--export', 'Badge', '--framework', 'react'], '1.0.0', { cwd: root, select: async () => { throw new Error('No fabricated categories'); } });
    expect(result.exitCode).toBe(1); expect(result.stderr).toContain('juz login');
    await expect(fs.stat(path.join(root, 'component.config.json'))).rejects.toThrow();
  });
  it('asks which development command to run for a dual-framework configuration', async () => {
    const root = await temporaryRoot(); await existingPackage(root);
    const initialized = await runCli(['init', '--component', 'badge', '--export', 'Badge', '--framework', 'all', '--category', 'general'], '1.0.0', { cwd: root });
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    const dev = await runCli(['dev'], '1.0.0', { cwd: root, select: async (label, choices) => { expect(label).toBe('framework'); expect(choices.map(choice => choice.value)).toEqual(['vue', 'react']); return 'vue'; } });
    expect(dev.exitCode, dev.stderr).toBe(0); expect(JSON.parse(dev.stdout).framework).toBe('vue');
    expect(await fs.readFile(path.join(root, 'dev-started'), 'utf8')).toBe('yes');
  });
  it.each(['package', 'publish'])('%s requires a project configuration in any current directory', async command => {
    const root = await temporaryRoot();
    const result = await runCli([command], '1.0.0', { cwd: root });
    expect(result.exitCode).toBe(1); expect(result.stderr).toContain('component.config.json'); expect(result.stderr).toContain('juz init');
    expect(await fs.readdir(root)).toEqual([]);
  });
  it('keeps normal help focused on the five main commands and exposes legacy diagnostics through --help-all', async () => {
    const help = await runCli(['--help'], '1.0.0');
    for (const command of ['init', 'login', 'dev', 'package', 'publish']) expect(help.stdout).toContain('juz ' + command);
    expect(help.stdout).toContain('--help-all'); expect(help.stdout).not.toContain('echarts verify --bundle');
    expect((await runCli(['--help-all'], '1.0.0')).stdout).toContain('echarts verify --bundle');
  });
});

describe('token login and saved API selection', () => {
  it('validates and saves the chosen API to the credential path from the environment without printing the token', async () => {
    const root = await temporaryRoot(); const credentialFile = path.join(root, 'session.local');
    vi.stubEnv('ZHINEXUS_CREDENTIAL_FILE', credentialFile);
    const apiUrl = await origin((authorization, url, response) => {
      expect(url).toBe('/v1/auth/oidc/session'); expect(authorization).toBe('Bearer current-api-token');
      response.end(JSON.stringify({ authenticated: true }));
    });
    const result = await runCli(['login', '--token', 'current-api-token', '--api-url', apiUrl], '1.0.0');
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(await fs.readFile(credentialFile, 'utf8'))).toEqual({ apiOrigin: apiUrl, accessToken: 'current-api-token' });
    expect(result.stdout + result.stderr).not.toContain('current-api-token');
    expect(await resolvePlatformApiUrl()).toBe(apiUrl); expect(await resolvePlatformToken(apiUrl)).toBe('current-api-token');
  });
  it('reuses the saved API even when the previous JWT expired, and remembers a refreshed login', async () => {
    const root = await temporaryRoot(); const credentialFile = path.join(root, 'session.local');
    const apiUrl = await origin((_authorization, _url, response) => response.end(JSON.stringify({ authenticated: true })));
    const expired = 'header.' + Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url') + '.signature';
    await fs.writeFile(credentialFile, JSON.stringify({ apiOrigin: apiUrl, accessToken: expired }));
    vi.stubEnv('ZHINEXUS_CREDENTIAL_FILE', credentialFile);
    expect(await resolvePlatformToken(apiUrl)).toBeUndefined(); expect(await resolvePlatformApiUrl()).toBe(apiUrl);
    const result = await runCli(['login', '--token', 'refreshed-token', '--credential-file', credentialFile], '1.0.0');
    expect(result.exitCode, result.stderr).toBe(0); expect(await resolvePlatformToken(apiUrl)).toBe('refreshed-token');
  });
  it('uses the API URL environment variable ahead of the remembered address', async () => {
    const root = await temporaryRoot(); const credentialFile = path.join(root, 'session.local');
    await fs.writeFile(credentialFile, JSON.stringify({ apiOrigin: 'https://old.example.com', accessToken: 'old-token' }));
    const apiUrl = await origin((_authorization, _url, response) => response.end(JSON.stringify({ authenticated: true })));
    vi.stubEnv('PLATFORM_API_URL', apiUrl);
    const result = await runCli(['login', '--token', 'environment-api-token', '--credential-file', credentialFile], '1.0.0');
    expect(result.exitCode, result.stderr).toBe(0); expect(JSON.parse(await fs.readFile(credentialFile, 'utf8')).apiOrigin).toBe(apiUrl);
  });
  it.each(['', ' ', 'token with-space', 'token\nnewline'])('rejects malformed token %j before any HTTP request or credential write', async token => {
    const root = await temporaryRoot(); let requested = false;
    const apiUrl = await origin((_authorization, _url, response) => { requested = true; response.end(JSON.stringify({ authenticated: true })); });
    await expect(companyLogin({ apiOrigin: apiUrl, token, credentialFile: path.join(root, 'session.local') })).rejects.toThrow(/token/i);
    expect(requested).toBe(false); expect(await fs.readdir(root)).toEqual([]);
  });
  it('rejects token combined with candidate validation instead of saving a normal login', async () => {
    const root = await temporaryRoot(); const apiUrl = await origin((_authorization, _url, response) => response.end(JSON.stringify({ authenticated: true })));
    await expect(companyLogin({ apiOrigin: apiUrl, token: 'candidate-token', candidate: '123e4567-e89b-42d3-a456-426614174000', administratorToken: 'admin-token', credentialFile: path.join(root, 'session.local') })).rejects.toThrow(/token.*candidate|candidate.*token/i);
    expect(await fs.readdir(root)).toEqual([]);
  });
  it('bounds token-validation HTTP requests when the API never responds', async () => {
    const root = await temporaryRoot(); const apiUrl = await origin(() => {});
    await expect(companyLogin({ apiOrigin: apiUrl, token: 'valid-format', timeoutMs: 50, credentialFile: path.join(root, 'session.local') })).rejects.toThrow();
    expect(await fs.readdir(root)).toEqual([]);
  }, 1500);
});
