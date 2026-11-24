import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../packages/component-cli/src/cli.js';

const roots: string[] = [];
const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
async function project() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-cli-unit-')); roots.push(root);
  await fs.mkdir(path.join(root, 'component'));
  await fs.writeFile(path.join(root, 'component/package.json'), JSON.stringify({ name: '@fixture/badge', version: '0.1.0', private: false, type: 'module', exports: './index.js', scripts: { build: 'node build.mjs', dev: 'node dev.mjs' } }));
  return root;
}
const initArgs = (root: string) => ['init', '--project', root, '--package', 'component', '--component', 'badge', '--export', 'Badge', '--framework', 'react', '--category', 'general'];
async function config(root: string) {
  for (const dir of ['consumer', 'api', 'docs']) await fs.mkdir(path.join(root, dir));
  await fs.writeFile(path.join(root, 'api/badge-react.json'), JSON.stringify({ schemaVersion: 1, componentId: 'badge', framework: 'react', exportName: 'Badge', exportPath: '.', props: [], events: [], notes: [] }));
  await fs.writeFile(path.join(root, 'docs/badge-react.md'), '# Badge');
  await fs.writeFile(path.join(root, 'consumer/package.json'), JSON.stringify({ name: 'badge-consumer', private: true, type: 'module', dependencies: { react: '19.3.1', 'react-dom': '19.3.1' } }));
  const value = { schemaVersion: 1, packageDir: 'component', build: { program: process.execPath, args: ['-e', "require('fs').writeFileSync('built','yes')"] }, dev: { react: { program: process.execPath, args: ['-e', "require('fs').writeFileSync('dev-started','yes')"] } }, variants: [{ componentId: 'badge', framework: 'react', category: 'general', exportName: 'Badge', exportPath: '.', api: 'api/badge-react.json', docs: 'docs/badge-react.md', consumer: { templateDir: 'consumer', adapter: 'vite', previewDir: 'dist', previewEntry: 'index.html' }, readiness: { selector: '#app', states: ['default'], width: 800, height: 400, renderer: 'canvas', theme: 'light' } }] };
  await fs.writeFile(path.join(root, 'component.config.json'), JSON.stringify(value));
  return value;
}
async function api(overrides: { status?: number; roles?: string[]; categories?: unknown[]; components?: unknown[]; packages?: string[] } = {}) {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (overrides.status) { res.writeHead(overrides.status).end('{}'); return; }
    if (req.url === '/v1/auth/oidc/session') res.end(JSON.stringify({ authenticated: true, subject: 'publisher', administrator: false, roles: overrides.roles ?? ['publisher'] }));
    else res.end(JSON.stringify({ categories: overrides.categories ?? [{ id: 'general', name: '通用', enabled: true, revision: '0' }], components: overrides.components ?? [{ componentId: 'badge', category: 'general' }], packages: overrides.packages ?? ['@fixture/badge'] }));
  });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

describe('real project CLI configuration', () => {
  it('rejects legacy arbitrary consumer build commands with an explicit Vite adapter migration error before building', async () => {
    const root = await project(); const value = await config(root);
    const legacy = JSON.parse(JSON.stringify(value));
    legacy.variants[0].consumer.build = { program: process.execPath, args: ['-e', "require('fs').writeFileSync('consumer-built','yes')"] };
    delete legacy.variants[0].consumer.adapter;
    await fs.writeFile(path.join(root, 'component.config.json'), JSON.stringify(legacy));
    const result = await runCli(['prepare-release', '--project', root, '--framework', 'react', '--api-url', await api(), '--token', 'test-token'], '0.0.27');
    expect(result.exitCode).toBe(1); expect(result.stderr).toContain('CONSUMER_ADAPTER_REQUIRED');
    await expect(fs.stat(path.join(root, 'component/built'))).rejects.toThrow();
  });
  it('initializes only a configuration for an explicitly selected existing package, without overwriting files', async () => {
    const root = await project();
    const before = await fs.readFile(path.join(root, 'component/package.json'), 'utf8');
    const result = await runCli(initArgs(root), '0.0.27');
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(await fs.readFile(path.join(root, 'component.config.json'), 'utf8')).packageDir).toBe('component');
    const original = await fs.readFile(path.join(root, 'component.config.json'), 'utf8');
    const repeated = await runCli(initArgs(root), '0.0.27');
    expect(repeated.exitCode).toBe(1); expect(repeated.stderr).toContain('CONFIG_EXISTS');
    expect(await fs.readFile(path.join(root, 'component.config.json'), 'utf8')).toBe(original);
    expect(await fs.readFile(path.join(root, 'component/package.json'), 'utf8')).toBe(before);
    expect((await fs.readdir(root)).sort()).toEqual(['component', 'component.config.json']);
  });
  it('rejects a private application and missing noninteractive framework before creating configuration', async () => {
    const root = await project();
    const missing = await runCli(initArgs(root).filter((_, index) => index !== 9 && index !== 10), '0.0.27');
    expect(missing.exitCode).toBe(1); expect(missing.stderr).toContain('--framework');
    const missingCategory = await runCli(initArgs(root).slice(0, 11), '0.0.27');
    expect(missingCategory.exitCode).toBe(1); expect(missingCategory.stderr).toContain('--category');
    await fs.writeFile(path.join(root, 'component/package.json'), JSON.stringify({ name: '@fixture/app', version: '0.1.0', private: true }));
    const result = await runCli(initArgs(root), '0.0.27');
    expect(result.exitCode).toBe(1); expect(result.stderr).toContain('PACKAGE_PRIVATE');
    expect(await fs.readdir(root)).toEqual(['component']);
  });
  it.each([{ status: 401 }, { roles: ['viewer'] }, { categories: [] }, { components: [] }, { packages: [] }])('blocks identity, role, category and ACL failures before building: %j', async override => {
    const root = await project(); await config(root); const origin = await api(override);
    const result = await runCli(['prepare-release', '--project', root, '--framework', 'react', '--api-url', origin, '--token', 'unit-token'], '0.0.27');
    expect(result.exitCode).toBe(1); expect(result.stderr).toMatch(/UNAUTHENTICATED|FORBIDDEN|CATEGORY_DISABLED/);
    await expect(fs.stat(path.join(root, 'component/built'))).rejects.toThrow();
  });
  it('runs configured development commands locally and validates API identity in doctor', async () => {
    const root = await project(); const value = await config(root);
    const dev = await runCli(['dev', '--project', root, '--framework', 'react'], '0.0.27');
    expect(dev.exitCode, dev.stderr).toBe(0); expect(await fs.readFile(path.join(root, 'component/dev-started'), 'utf8')).toBe('yes');
    const origin = await api();
    const doctor = await runCli(['doctor', '--project', root, '--framework', 'react', '--api-url', origin, '--token', 'unit-token'], '0.0.27');
    expect(doctor.exitCode, doctor.stderr).toBe(0);
    await fs.writeFile(path.join(root, value.variants[0]!.api), JSON.stringify({ schemaVersion: 1, componentId: 'badge', framework: 'vue', exportName: 'Badge', exportPath: '.', props: [], events: [], notes: [] }));
    const wrong = await runCli(['doctor', '--project', root, '--framework', 'react', '--api-url', origin, '--token', 'unit-token'], '0.0.27');
    expect(wrong.exitCode).toBe(1); expect(wrong.stderr).toContain('API_IDENTITY_MISMATCH');
  });
  it('rejects project paths that escape the real root', async () => {
    const root = await project(); const value = await config(root); value.packageDir = '../outside';
    await fs.writeFile(path.join(root, 'component.config.json'), JSON.stringify(value));
    const result = await runCli(['dev', '--project', root, '--framework', 'react'], '0.0.27');
    expect(result.exitCode).toBe(1); expect(result.stderr).toContain('PATH_OUTSIDE_PROJECT');
  });
  it('preserves SDK command help and version behavior', async () => {
    expect((await runCli(['--version'], '0.0.27')).stdout).toBe('0.0.27\n');
    expect((await runCli(['--help'], '0.0.27')).stdout).toContain('echarts verify --bundle');
  });
  it('selects framework and enabled category interactively when explicit init arguments are absent', async () => {
    const root = await project(); const origin = await api(); const selections: string[] = [];
    const result = await runCli(['init', '--project', root, '--package', 'component', '--component', 'badge', '--export', 'Badge', '--api-url', origin, '--token', 'unit-token'], '0.0.27', { select: async (name, choices) => { selections.push(name); return name === 'framework' ? 'react' : choices[0]!.value; } });
    expect(result.exitCode, result.stderr).toBe(0); expect(selections).toEqual(['framework', 'category']);
    expect(JSON.parse(await fs.readFile(path.join(root, 'component.config.json'), 'utf8')).variants[0].category).toBe('general');
  });
  it('rejects invalid init identity before writing and gives missing selection hints for configured noninteractive commands', async () => {
    const root = await project();
    const args = initArgs(root); args[6] = '../../invalid';
    const invalid = await runCli(args, '0.0.27'); expect(invalid.exitCode).toBe(1); expect(invalid.stderr).toContain('CONFIG_INVALID');
    await config(root);
    const result = await runCli(['dev'], '0.0.27', { cwd: root });
    expect(result.exitCode).toBe(1); expect(result.stderr).toContain('--framework');
    await expect(fs.stat(path.join(root, 'component/dev-started'))).rejects.toThrow();
  });
  it('rejects a symlinked package that escapes the project root', async () => {
    const root = await project(); await config(root); const outside = await project();
    await fs.rm(path.join(root, 'component'), { recursive: true });
    await fs.symlink(path.join(outside, 'component'), path.join(root, 'component'), 'junction');
    const result = await runCli(['dev', '--project', root, '--framework', 'react'], '0.0.27');
    expect(result.exitCode).toBe(1); expect(result.stderr).toContain('PATH_OUTSIDE_PROJECT');
  });
});
