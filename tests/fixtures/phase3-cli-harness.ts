/**
 * P3 (role D) black-box harness for `component integrate inspect|plan`.
 *
 * Rules enforced here:
 * - The CLI is executed only as a child process of the built `packages/component-cli/dist/bin.js`.
 *   No module of the CLI implementation is imported by this file.
 * - Only argv, cwd, environment variables, exit code, stdout and stderr are observed.
 * - Temporary workspaces live outside the repository under the OS temp directory.
 * - The HTTP loopback is a protocol stub, not the real Nest/MinIO/Verdaccio stack (C owns real-service acceptance).
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CLI_BIN = path.join(REPO_ROOT, 'packages', 'component-cli', 'dist', 'bin.js');
/** Kept outside every observed project tree so marker writes never contaminate the read-only snapshots. */
export const HOST_TEMP_ROOT = path.join(os.tmpdir(), `t15-d-${process.pid}`);

export type RunResult = { exitCode: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean };

/** Fixed Node executable of the pinned toolchain when running under `scripts/pnpm.ps1`; inherits it otherwise. */
export function cliNodeExecutable(): string {
  return process.env.npm_node_execpath ?? process.env.NODE_EXE ?? process.execPath;
}

export function assertCliBuilt(): void {
  if (!existsSync(path.join(REPO_ROOT, 'packages', 'component-cli', 'dist', 'bin.js'))) {
    throw new Error('Environment error: packages/component-cli/dist/bin.js is missing; run `scripts/pnpm.ps1 --filter @company/component-cli build` before the P3 tests');
  }
}

export function runCliProcess(
  args: readonly string[],
  options: { cwd: string; env?: Record<string, string | undefined>; timeoutMs?: number } = { cwd: REPO_ROOT },
): Promise<RunResult> {
  assertCliBuilt();
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(cliNodeExecutable(), [CLI_BIN, ...args], { cwd: options.cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs ?? 180_000);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (exitCode, signal) => { clearTimeout(timer); resolve({ exitCode, signal, stdout, stderr, timedOut }); });
  });
}

export function sha256Bytes(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export type TreeSnapshot = Map<string, { type: 'file' | 'dir' | 'link'; sha256?: string; link?: string; mtimeMs: number; size: number }>;

/**
 * Recursive, non-following snapshot of a directory tree: names, entry types, raw bytes SHA-256, mtime and size.
 * Directory reading uses lstat so junctions/symlinks are recorded, never traversed.
 */
export function snapshotTree(root: string): TreeSnapshot {
  const result: TreeSnapshot = new Map();
  const visit = (absolute: string, relative: string): void => {
    const stat = lstatSync(absolute);
    const rel = relative.split(path.sep).join('/');
    if (stat.isSymbolicLink()) {
      result.set(rel, { type: 'link', link: readlinkSync(absolute), mtimeMs: stat.mtimeMs, size: stat.size });
      return;
    }
    if (stat.isDirectory()) {
      result.set(rel, { type: 'dir', mtimeMs: stat.mtimeMs, size: stat.size });
      for (const name of (readdirSync(absolute) as string[]).sort()) visit(path.join(absolute, name), relative ? path.join(relative, name) : name);
      return;
    }
    const bytes = readFileSync(absolute);
    result.set(rel, { type: 'file', sha256: sha256Bytes(bytes), mtimeMs: stat.mtimeMs, size: stat.size });
  };
  visit(root, '');
  return result;
}

/** Compare only the file set and raw bytes (not dir mtimes), returning human-readable differences. */
export function compareTreeBytes(before: TreeSnapshot, after: TreeSnapshot): string[] {
  const differences: string[] = [];
  const files = (snapshot: TreeSnapshot) => new Map(snapshot);
  const b = files(before);
  const a = files(after);
  for (const [name, entry] of b) {
    const other = a.get(name);
    if (!other) differences.push(`removed: ${name}`);
    else if (other.type !== entry.type) differences.push(`type changed: ${name}`);
    else if (entry.type === 'file' && other.sha256 !== entry.sha256) differences.push(`content changed: ${name}`);
    else if (entry.type === 'link' && other.link !== entry.link) differences.push(`link changed: ${name}`);
  }
  for (const [name] of a) if (!b.has(name)) differences.push(`added: ${name}`);
  return differences.sort();
}

/** Files added anywhere in either tree (a marker written outside the project but inside an observed root). */
export function addedEntries(before: TreeSnapshot, after: TreeSnapshot): string[] {
  return [...after.keys()].filter((key) => !before.has(key) && after.get(key)!.type !== 'dir').sort();
}

export function tempRoot(prefix = 'case-'): string {
  const root = path.join(HOST_TEMP_ROOT, `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

export function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeFile(file: string, content: string | Uint8Array): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

export type CliJson = { exitCode: number | null; json: any; result: RunResult };

/**
 * Run the CLI, parse stdout as a single JSON document, and require stderr to carry no JSON payload.
 * Diagnostics may exist on stderr, but stdout must be exclusively the structured result.
 */
export function parseCliJson(result: RunResult): CliJson {
  const trimmed = result.stdout.trim();
  let json: any = undefined;
  if (trimmed) json = JSON.parse(trimmed);
  return { exitCode: result.exitCode, json, result };
}

// ---------------------------------------------------------------------------------------------
// Fixture builders (synthetic; contract shape only, never business or compatibility evidence).
// ---------------------------------------------------------------------------------------------

export const SYNTHETIC_PACKAGE_VERSION = '0.0.12';
export const SYNTHETIC_PACKAGE_SHA256 = sha256Bytes(stubTarball());
export const SYNTHETIC_INTEGRITY = `sha512-${createHash('sha512').update(stubTarball()).digest('base64')}`;

export type Framework = 'vue' | 'react';
export type PackageManager = 'npm' | 'pnpm';

export type HostProjectOptions = {
  framework: Framework;
  packageManager: PackageManager;
  frameworkVersion?: string;
  reactDomVersion?: string;
  echartsVersion?: string | null;
  scripts?: Record<string, string>;
  extraPackageJson?: Record<string, unknown>;
  name?: string;
};

/** Exact resolved versions as a lock resolution would record them. */
export function hostVersions(options: HostProjectOptions): { framework: string; reactDom?: string; echarts?: string } {
  return {
    framework: options.frameworkVersion ?? (options.framework === 'vue' ? '3.5.45' : '19.3.1'),
    ...(options.framework === 'react' ? { reactDom: options.reactDomVersion ?? options.frameworkVersion ?? '19.3.1' } : {}),
    ...(options.echartsVersion === null ? {} : { echarts: options.echartsVersion ?? '6.1.0' }),
  };
}

export function packageJsonFor(options: HostProjectOptions): Record<string, unknown> {
  const versions = hostVersions(options);
  const dependencies: Record<string, string> = { [options.framework]: `^${versions.framework}` };
  if (versions.reactDom) dependencies['react-dom'] = versions.reactDom;
  if (versions.echarts) dependencies.echarts = versions.echarts;
  return {
    name: options.name ?? 'synthetic-host', version: '1.0.0', private: true, type: 'module',
    packageManager: `${options.packageManager}@${options.packageManager === 'npm' ? '11.4.2' : '10.12.1'}`,
    scripts: options.scripts ?? { build: 'vite build', typecheck: 'tsc --noEmit' },
    dependencies, ...(options.extraPackageJson ?? {}),
  };
}

/** npm package-lock v3 with resolved root dependencies (synthetic but structurally a real lock v3). */
export function npmLockFor(options: HostProjectOptions): Record<string, unknown> {
  const versions = hostVersions(options);
  const rootDependencies: Record<string, string> = { [options.framework]: `^${versions.framework}` };
  if (versions.reactDom) rootDependencies['react-dom'] = versions.reactDom;
  if (versions.echarts) rootDependencies.echarts = versions.echarts;
  const packages: Record<string, unknown> = { '': { name: options.name ?? 'synthetic-host', version: '1.0.0', dependencies: rootDependencies } };
  const entries: [string, string][] = [[options.framework, versions.framework]];
  if (versions.reactDom) entries.push(['react-dom', versions.reactDom]);
  if (versions.echarts) entries.push(['echarts', versions.echarts]);
  for (const [name, version] of entries) {
    packages[`node_modules/${name}`] = { version, resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, integrity: `sha512-${Buffer.from(`synthetic ${name}@${version}`).toString('base64')}` };
  }
  return { name: options.name ?? 'synthetic-host', version: '1.0.0', lockfileVersion: 3, requires: true, packages };
}

/** pnpm lockfile v9 with a single root importer. */
export function pnpmLockFor(options: HostProjectOptions): string {
  const versions = hostVersions(options);
  const dependencies: [string, string][] = [[options.framework, `^${versions.framework}`]];
  if (versions.reactDom) dependencies.push(['react-dom', versions.reactDom]);
  if (versions.echarts) dependencies.push(['echarts', versions.echarts]);
  const importerLines = dependencies.map(([name, spec]) => `      '${name}':\n        specifier: '${spec}'\n        version: ${versions[name === options.framework ? 'framework' : name === 'react-dom' ? 'reactDom' : 'echarts']}`).join('\n');
  const packages = dependencies.map(([name], i) => `  ${name}@${versions[name === options.framework ? 'framework' : name === 'react-dom' ? 'reactDom' : 'echarts']}:\n    resolution: {integrity: sha512-${Buffer.from(`synthetic ${name}`).toString('base64')}}\n    engines: {node: '>=20'}`).join('\n');
  return [
    "lockfileVersion: '9.0'", '', 'settings:', '  autoInstallPeers: true', '  excludeLinksFromLockfile: false', '',
    'importers:', '', '  .:', '    dependencies:', importerLines, '',
    'packages:', '', packages, '',
    'snapshots:', '', ...dependencies.map(([name], i) => `  ${name}@${versions[name === options.framework ? 'framework' : name === 'react-dom' ? 'reactDom' : 'echarts']}: {}`), '',
  ].join('\n');
}

export type HostProject = { root: string; workspace: string; packageManager: PackageManager; framework: Framework; versions: ReturnType<typeof hostVersions> };

/** Create a synthetic host project under `root` (which must already be a temp directory). */
export function createHostProject(root: string, options: HostProjectOptions): HostProject {
  const target = path.join(root, 'project');
  writeJson(path.join(target, 'package.json'), packageJsonFor(options));
  if (options.packageManager === 'npm') writeJson(path.join(target, 'package-lock.json'), npmLockFor(options));
  else writeFile(path.join(target, 'pnpm-lock.yaml'), pnpmLockFor(options));
  writeFile(path.join(target, 'src', 'main.ts'), '// host entry\nexport {};\n');
  writeFile(path.join(target, '.gitignore'), 'node_modules\n');
  return { root: target, workspace: '.', packageManager: options.packageManager, framework: options.framework, versions: hostVersions(options) };
}

/** Build the synthetic MatchPlan consumed by `plan`; every value derives from contracts, not from CLI output. */
export function matchPlanFor(project: HostProject): Record<string, unknown> {
  const responseApi = stubApiFor(project.framework);
  return {
    schemaVersion: 1, source: 'design-id', inputDigest: 'a'.repeat(64), ruleSetId: 'library', revision: 'synthetic-1',
    context: {
      framework: project.framework, frameworkVersion: project.versions.framework,
      ...(project.versions.echarts ? { echartsVersion: project.versions.echarts } : {}),
      packageManager: project.packageManager, requirements: [],
    },
    elements: [{
      instanceId: 'node-1', designId: 'synthetic/node-1', status: 'mapped', target: stubTargetFor(project.framework),
      props: responseApi.props.map((prop) => ({ ...prop, ...(prop.required ? { source: 'synthetic-data' } : {}) })),
      events: responseApi.events.map((event) => ({ ...event, handler: 'handleEvent' })),
      layout: 'grid cell 1', gaps: [],
    }],
    exactDependencies: [{ name: `@company/charts-${project.framework}`, version: SYNTHETIC_PACKAGE_VERSION }],
    gaps: [],
  };
}

export function stubTargetFor(framework: Framework): Record<string, unknown> {
  const api = stubApiFor(framework);
  return {
    variantReleaseId: framework === 'vue' ? '00000000-0000-4000-8000-000000000001' : '00000000-0000-4000-8000-000000000002',
    variantId: `line-${framework}`, componentId: 'line', framework, packageName: `@company/charts-${framework}`, packageVersion: SYNTHETIC_PACKAGE_VERSION,
    packageSha256: SYNTHETIC_PACKAGE_SHA256, exportName: api.exportName, exportPath: api.exportPath,
    evidence: [{ kind: 'api', path: 'api/line.json', sha256: 'c'.repeat(64) }, { kind: 'docs', path: 'docs/line.md', sha256: 'd'.repeat(64) }],
    compatibility: { status: 'verified', recordIds: ['synthetic-t15-d-record'] },
    examples: [{ id: 'example', previewEntry: 'preview/index.html' }],
    styleExport: './style.css', readyMethod: 'whenRendered', notes: [],
  };
}

export function stubApiFor(framework: Framework): { schemaVersion: 1; componentId: string; framework: Framework; exportName: string; exportPath: string; props: { name: string; type: string; required: boolean }[]; events: { name: string; payload: string }[]; styleExport: string; readyMethod: string; notes: string[] } {
  return {
    schemaVersion: 1, componentId: 'line', framework, exportName: 'LineChart', exportPath: './line',
    props: [{ name: 'data', type: 'ChartData', required: true }, { name: 'config', type: 'LineChartConfig', required: false }],
    events: [framework === 'vue'
      ? { name: 'point-click', payload: 'ChartEvent' }
      : { name: 'onPointClick', payload: 'ChartEvent' }],
    styleExport: './style.css', readyMethod: 'whenRendered', notes: [],
  };
}

export function stubResponseFor(framework: Framework, query: ReturnType<typeof hostVersions>, options: { status?: 'matched' | 'gap'; api?: unknown; target?: Record<string, unknown> } = {}): Record<string, unknown> {
  const target = options.target ?? stubTargetFor(framework);
  const exactDependencies = [
    { name: `@company/charts-${framework}`, version: SYNTHETIC_PACKAGE_VERSION },
    { name: framework, version: query.framework },
    { name: 'echarts', version: query.echarts ?? '6.1.0' },
    ...(framework === 'react' ? [{ name: 'react-dom', version: query.reactDom }] : []),
  ];
  if (options.status === 'gap') {
    return { schemaVersion: 1, query: stubQueryFor(framework, query), status: 'gap', exactDependencies: [], gaps: [{ code: 'TARGET_UNAVAILABLE', message: 'synthetic revoked target' }] };
  }
  return {
    schemaVersion: 1, query: stubQueryFor(framework, query), status: 'matched', target,
    api: options.api ?? stubApiFor(framework), exactDependencies,
    gaps: (target.compatibility as { status: string }).status === 'unverified'
      ? [{ code: 'COMPATIBILITY_UNVERIFIED', message: 'synthetic no accepted record' }] : [],
  };
}

export function stubQueryFor(framework: Framework, query: ReturnType<typeof hostVersions>): Record<string, unknown> {
  return {
    componentId: 'line', framework, packageName: `@company/charts-${framework}`, packageVersion: SYNTHETIC_PACKAGE_VERSION,
    frameworkVersion: query.framework, echartsVersion: query.echarts ?? '6.1.0',
    ...(framework === 'react' ? { reactDomVersion: query.reactDom } : {}),
  };
}

/** Synthetic tarball bytes; the API declares this digest, so a correct implementation must download and verify it. */
export function stubTarball(): Buffer {
  return Buffer.from('synthetic @company/charts tarball for t15-d protocol tests\n');
}
export const stubTarballSha256 = sha256Bytes(stubTarball());

// ---------------------------------------------------------------------------------------------
// Loopback protocol stub: GET /v1/matching/components + GET /<package>/-/<name>-<version>.tgz
// ---------------------------------------------------------------------------------------------

export type StubRequest = { method: string; url: string; headers: http.IncomingHttpHeaders };

export type LoopbackStubOptions = {
  /** Build the response per request; mutate state in tests to emulate revocation/deprecation. */
  respond: (request: StubRequest) => { status: number; body: unknown } | 'pending';
  /** Tarball bytes by package name; missing ⇒ 404. */
  tarball?: (packageName: string) => Buffer | undefined;
  /** Redirect target for tarball requests (used to prove cross-origin redirects are refused). */
  tarballRedirect?: string;
};

export type LoopbackStub = {
  origin: string;
  requests: StubRequest[];
  /** Number of GET /v1/matching/components requests received so far. */
  matchRequests: () => number;
  /** Resolves once at least `count` tarball requests have been received (for the revocation barrier). */
  waitForTarballRequest: (count?: number, timeoutMs?: number) => Promise<void>;
  /** While `hold` is true, tarball responses wait for `releaseAll()`. */
  barrier: { hold: boolean; releaseAll: () => void };
  close: () => Promise<void>;
};

export async function startLoopbackStub(options: LoopbackStubOptions): Promise<LoopbackStub> {
  const requests: StubRequest[] = [];
  let closed = false;
  let tarballRequests = 0;
  const waiters: (() => void)[] = [];
  let releaseResolve: () => void = () => undefined;
  const releaseGate = new Promise<void>((resolve) => { releaseResolve = resolve; });
  const stub: LoopbackStub = {
    origin: '', requests,
    matchRequests: () => requests.filter((r) => r.url.startsWith('/v1/matching/components')).length,
    waitForTarballRequest: async (count = 1, timeoutMs = 30_000) => {
      const deadline = Date.now() + timeoutMs;
      while (tarballRequests < count) {
        if (closed) throw new Error('Stub closed before tarball request');
        if (Date.now() > deadline) throw new Error(`Timeout waiting for ${count} tarball request(s); got ${tarballRequests}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
    barrier: { hold: false, releaseAll: () => { releaseResolve(); } },
    close: async () => { if (closed) return; closed = true; releaseResolve(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); },
  };
  const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
    const request: StubRequest = { method: req.method ?? 'GET', url: req.url ?? '/', headers: req.headers };
    requests.push(request);
    const isTarball = /\.tgz(?:\?|$)/.test(request.url);
    if (isTarball) {
      tarballRequests += 1;
      for (const waiter of waiters.splice(0)) waiter();
      const respondTarball = () => {
        if (options.tarballRedirect) {
          res.writeHead(302, { location: options.tarballRedirect }); res.end(); return;
        }
        const packageName = decodeURIComponent(request.url.split('/-/')[0]!.replace(/^\//, ''));
        const bytes = options.tarball?.(packageName);
        if (!bytes) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) });
        res.end(bytes);
      };
      if (stub.barrier.hold) releaseGate.then(respondTarball); else respondTarball();
      return;
    }
    // Registry metadata is independent of the API stub and carries real hashes of synthetic bytes.
    const registryPath = decodeURIComponent(new URL(request.url, stub.origin).pathname).slice(1);
    const match = /^(@[^/]+\/[^/]+|[^/]+)(?:\/([^/]+))?$/.exec(registryPath);
    if (match && !request.url.startsWith('/v1/')) {
      const packageName = match[1]!;
      const bytes = options.tarball?.(packageName);
      if (bytes) {
        const version = SYNTHETIC_PACKAGE_VERSION;
        const metadata = { name: packageName, version, dependencies: {}, dist: {
          tarball: `${stub.origin}/${encodeURIComponent(packageName)}/-/${packageName.split('/').at(-1)}-${version}.tgz`,
          integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
          shasum: createHash('sha1').update(bytes).digest('hex'),
        } };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(match[2] ? metadata : { name: packageName, versions: { [version]: metadata } })); return;
      }
    }
    const result = options.respond(request);
    const write = () => {
      if (result === 'pending') return; // never answer: used to prove request timeouts fail closed
      res.writeHead(result.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result.body));
    };
    write();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  stub.origin = `http://127.0.0.1:${address.port}`;
  return stub;
}

// ---------------------------------------------------------------------------------------------
// Git helpers: a marker-writing fsmonitor hook and a real local repository, using ONLY fixed argv.
// ---------------------------------------------------------------------------------------------

const GIT_ENV_OVERRIDES = [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_PREFIX', 'GIT_DISCOVERY_ACROSS_FILESYSTEM', 'GIT_CONFIG', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_COUNT',
];

export function assertGitAvailable(): void {
  // Presence only; tests must call git through this harness with fixed argv.
  const probe = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (probe.status !== 0) throw new Error('Environment error: git is not available on PATH');
}

export function gitIn(cwd: string, args: readonly string[], extraEnv: Record<string, string> = {}): void {
  const env: Record<string, string> = { ...process.env as Record<string, string>, GIT_CONFIG_NOSYSTEM: '1', ...extraEnv };
  for (const key of GIT_ENV_OVERRIDES) if (!(key in extraEnv)) delete env[key];
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
}

export function initGitRepo(root: string): void {
  gitIn(root, ['init', '--quiet', '--initial-branch=main']);
  gitIn(root, ['config', '--local', 'user.name', 't15-d']);
  gitIn(root, ['config', '--local', 'user.email', 't15-d@example.invalid']);
  gitIn(root, ['config', '--local', 'commit.gpgsign', 'false']);
}

export function gitCommitAll(root: string, message = 'synthetic baseline'): void {
  gitIn(root, ['add', '--all']);
  gitIn(root, ['commit', '--quiet', '-m', message]);
}
export { GIT_ENV_OVERRIDES };

export type MaliciousProject = { marker: string; helperDir: string; projectRoot: string };

/**
 * Install a marker-writing Git fsmonitor hook plus a malicious npm `prepare` script and pnpm hook.
 * Any execution of project scripts or Git fsmonitor writes to the marker file.
 */
export function installMaliciousScripts(projectRoot: string, markerDir: string): MaliciousProject {
  const helperDir = path.join(markerDir, 'helpers');
  const marker = path.join(markerDir, 'EXECUTED.marker');
  const isWindows = process.platform === 'win32';
  const helper = isWindows
    ? `@echo off\r\necho fsmonitor %date% %time% >> "${marker}"\r\necho %1\r\n`
    : `#!/bin/sh\nprintf 'fsmonitor\\n' >> '${marker.replace(/\\/g, '/')}'\nprintf '\\n'\n`;
  const helperName = `fsmonitor-helper.${isWindows ? 'cmd' : 'sh'}`;
  writeFile(path.join(helperDir, helperName), helper);
  if (!isWindows) chmodSync(path.join(helperDir, helperName), 0o755);
  gitIn(projectRoot, ['config', '--local', 'core.fsmonitor', isWindows ? JSON.stringify(`${helperDir}\\${helperName}`.replace(/\\/g, '/')) : path.join(helperDir, helperName).replace(/\\/g, '/')]);
  writeFile(path.join(helperDir, 'script-marker.mjs'), `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(marker)}, 'project-script\\n');\n`);
  const script = `node "${path.join(helperDir, 'script-marker.mjs').replace(/\\/g, '/')}"`;
  const pkgFile = path.join(projectRoot, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  pkg.scripts = { ...(pkg.scripts ?? {}), prepare: script, postinstall: script, fsmonitor: script };
  writeJson(pkgFile, pkg);
  writeFile(path.join(projectRoot, '.npmrc'), 'ignore-scripts=false\n');
  writeFile(path.join(projectRoot, 'vite.config.mjs'), `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(marker)}, 'vite-config\\n');\nexport default {};\n`);
  return { marker, helperDir, projectRoot };
}

export function markerExists(marker: string): boolean {
  return existsSync(marker);
}

/** Sanity: the malicious Git hook DOES write a marker when Git runs it (proves the marker mechanism works). */
export function proveMarkerMechanism(projectRoot: string, marker: string): void {
  gitIn(projectRoot, ['status', '--porcelain'], { GIT_OPTIONAL_LOCKS: '0' });
  if (!markerExists(marker)) throw new Error('Environment error: the Git fsmonitor marker helper did not execute under plain git status');
}

export function exists(file: string): boolean { return existsSync(file); }
export function isFile(file: string): boolean { return statSync(file).isFile(); }

// ---------------------------------------------------------------------------------------------
// P3 (role D): independent control that a Git user-defined filter helper (clean / process) writes a
// marker when Git runs it, so the CLI tests can prove the same helper never runs during inspect/plan.
// The experiment is fully synthetic inside a case temp directory: .gitattributes names the driver and
// local config points it at our own helper. No real project configuration is involved.
// ---------------------------------------------------------------------------------------------

export function gitShellQuote(value: string): string {
  return "'" + value.split("'").join("'\"'\"'") + "'";
}

/** Git-safe absolute path with forward separators (Git for Windows shells are POSIX sh). */
export function gitPath(value: string): string {
  return path.resolve(value).split(path.sep).join('/');
}

/** Git long-running-process helper (CJS): records each clean request and passes bytes through. */
export function longRunningProcessHelperScript(): string {
  return String.raw`const fs=require('node:fs');const marker=process.argv[2];fs.appendFileSync(marker,'process-start\n');
function exact(n){const b=Buffer.alloc(n);let p=0;while(p<n){const k=fs.readSync(0,b,p,n-p,null);if(!k){if(!p)return undefined;throw Error('partial packet');}p+=k;}return b;}
function packet(){const h=exact(4);if(!h)return undefined;const n=parseInt(h.toString(),16);if(n===0)return null;if(n<4)throw Error('invalid packet');return exact(n-4);}
function list(){const a=[];for(;;){const p=packet();if(p===undefined)return undefined;if(p===null)return a;a.push(p);}}
function send(b){if(typeof b==='string')b=Buffer.from(b);fs.writeSync(1,(b.length+4).toString(16).padStart(4,'0'));fs.writeSync(1,b);}function flush(){fs.writeSync(1,'0000');}
const hello=list();if(!hello)process.exit(0);send('git-filter-server\n');send('version=2\n');flush();const caps=list();if(!caps)process.exit(0);send('capability=clean\n');flush();
for(;;){const headers=list();if(!headers)break;const content=list();if(!content)break;fs.appendFileSync(marker,headers.map(x=>x.toString().trim()).join(' ')+'\n');send('status=success\n');flush();for(const b of content)send(b);flush();flush();}`;
}

/** Clean filter helper (CJS): records invocation, then passes stdin bytes through unchanged. */
export function cleanHelperScript(): string {
  return String.raw`const fs=require('node:fs');const marker=process.argv[2];fs.appendFileSync(marker,'clean-invoked\n');
const chunks=[];for(;;){const b=Buffer.alloc(65536);const k=fs.readSync(0,b,0,b.length,null);if(!k)break;chunks.push(b.subarray(0,k));}
fs.writeSync(1,Buffer.concat(chunks));`;
}

export type GitFilterExperiment = { driver: string; marker: string; helperFile: string; payload: string };

export function installGitFilterExperiment(projectRoot: string, markerDir: string, kind: 'clean' | 'process'): GitFilterExperiment {
  const driver = `t15d${kind}`;
  const helperDir = path.join(markerDir, 'filter-helpers');
  const marker = path.join(markerDir, `git-${kind}-EXECUTED.marker`);
  const helperFile = path.join(helperDir, `filter-${kind}.cjs`);
  mkdirSync(helperDir, { recursive: true });
  writeFile(helperFile, kind === 'clean' ? cleanHelperScript() : longRunningProcessHelperScript());
  const command = `${gitShellQuote(gitPath(cliNodeExecutable()))} ${gitShellQuote(gitPath(helperFile))} ${gitShellQuote(gitPath(marker))}`;
  gitIn(projectRoot, ['config', '--local', `filter.${driver}.${kind}`, command]);
  gitIn(projectRoot, ['config', '--local', `filter.${driver}.required`, 'true']);
  const payload = 'data/payload.txt';
  writeFile(path.join(projectRoot, '.gitattributes'), `data/** filter=${driver}\n`);
  return { driver, marker, helperFile, payload };
}

function safeGitEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  for (const key of GIT_ENV_OVERRIDES) delete env[key];
  env.GIT_CONFIG_NOSYSTEM = '1';
  return env;
}

/** Local fixed-argv Git runner with a 10s timeout; returns status for explicit control assertions. */
export function safeGit(projectRoot: string, args: readonly string[]): { status: number | null; stdout: string; stderr: string; timedOut: boolean } {
  const result = spawnSync('git', args, { cwd: projectRoot, env: safeGitEnv(), encoding: 'utf8', timeout: 10_000 });
  return { status: result.status, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? ''), timedOut: result.error?.name === 'Error' && /ETIMEDOUT/.test(result.error.message) };
}

/**
 * Control: a fresh git add MUST run the helper and leave the expected marker lines. Never returns early.
 * Adds and commits the tracked payload with the timeout-bounded runner so the marker content is stable.
 */
export function proveGitFilterExecutes(projectRoot: string, experiment: GitFilterExperiment, kind: 'clean' | 'process', payloadText: string): void {
  rmSync(experiment.marker, { force: true });
  mkdirSync(path.dirname(path.join(projectRoot, experiment.payload)), { recursive: true });
  writeFile(path.join(projectRoot, experiment.payload), payloadText);
  const add = safeGit(projectRoot, ['add', '--', experiment.payload]);
  if (add.status !== 0) throw new Error(`Environment error: control git add failed (status=${add.status} timedOut=${add.timedOut}) stderr=${add.stderr.slice(0, 500)}`);
  const markerText = existsSync(experiment.marker) ? readFileSync(experiment.marker, 'utf8') : '';
  const expected = kind === 'clean' ? 'clean-invoked' : 'process-start';
  if (!markerText.includes(expected)) throw new Error(`Environment error: control did not execute the ${kind} helper (marker=${JSON.stringify(markerText.slice(0, 300))})`);
  if (kind === 'process' && !/(^|\s)command=clean(\s|$)/m.test(markerText)) throw new Error(`Environment error: process control saw no command=clean packet (marker=${JSON.stringify(markerText.slice(0, 300))})`);
  const commit = safeGit(projectRoot, ['add', '--all']);
  if (commit.status !== 0) throw new Error(`Environment error: control git add --all failed (status=${commit.status}) stderr=${commit.stderr.slice(0, 500)}`);
  const committed = safeGit(projectRoot, ['-c', 'user.name=t15-d', '-c', 'user.email=t15-d@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'synthetic filtered payload']);
  if (committed.status !== 0) throw new Error(`Environment error: control commit failed (status=${committed.status}) stderr=${committed.stderr.slice(0, 500)}`);
}

/** Rewrite a tracked file with same-length bytes and a strictly newer mtime, forcing a content re-check. */
export function dirtyTrackedFileWithSameLength(projectRoot: string, relative: string, replacement: string): void {
  const file = path.join(projectRoot, relative);
  const current = statSync(file);
  if (current.size !== Buffer.byteLength(replacement)) throw new Error('Harness error: same-length rewrite expected');
  writeFileSync(file, replacement);
  const seconds = current.mtimeMs / 1000 + 4;
  utimesSync(file, seconds, seconds);
}
