import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { OwnedRun } from './host.js';

export type FixedToolchain = { nodeExecutable: string; npmCliPath: string; pnpmWrapper: string; repositoryRoot: string };
export type NativeResult = { executable: string; args: string[]; cwd: string; exitCode: number | null; timedOut: boolean; stdoutBytes: number; stderrBytes: number; stdoutSha256: string; stderrSha256: string; stdoutEvidence: string; stderrEvidence: string };
export type FrozenCliInstallation = { root: string; entry: string; version: string; entrySha256: string };
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const systemKeys = ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS'];
const MAX_NATIVE_OUTPUT_BYTES = 16 * 1024 * 1024;
function outputCap(value?: number) {
  const cap = value ?? 1024 * 1024;
  if (!Number.isSafeInteger(cap) || cap < 0 || cap > MAX_NATIVE_OUTPUT_BYTES) throw new RangeError('Native process output limit is outside the supported bound.');
  return cap;
}
function captureOutput(limit: number, onLimit: () => void) {
  const chunks: Buffer[] = []; let bytes = 0, capturedBytes = 0, exceeded = false;
  return {
    append(chunk: Uint8Array) {
      const buffer = Buffer.from(chunk); bytes += buffer.length;
      if (buffer.length >= limit && limit > 0) { chunks.splice(0, chunks.length, buffer.subarray(buffer.length - limit)); capturedBytes = limit; }
      else if (buffer.length > 0 && limit > 0) {
        chunks.push(buffer); capturedBytes += buffer.length;
        let excess = capturedBytes - limit;
        while (excess > 0 && chunks.length) {
          const first = chunks[0]!;
          if (first.length <= excess) { chunks.shift(); excess -= first.length; capturedBytes -= first.length; }
          else { chunks[0] = first.subarray(excess); capturedBytes -= excess; excess = 0; }
        }
        if (chunks.length > 64) { chunks.splice(0, chunks.length, Buffer.concat(chunks)); }
      }
      if (!exceeded && bytes > limit) { exceeded = true; onLimit(); }
    },
    bytes: () => bytes,
    exceeded: () => exceeded,
    value: () => Buffer.concat(chunks),
  };
}

export function fixedScriptInvocation(root: string, manager: 'npm' | 'pnpm', script: 'typecheck' | 'build', tools: FixedToolchain) {
  if (manager === 'npm') return { executable: resolve(tools.nodeExecutable), args: [resolve(tools.npmCliPath), '--ignore-scripts', 'run', script], cwd: resolve(root), extraEnv: {} as Record<string, string> };
  const shell = join(process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  return { executable: shell, args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', resolve(tools.pnpmWrapper), '-PnpmArgs', '--dir', resolve(root), 'run', script], cwd: resolve(tools.repositoryRoot), extraEnv: { PNPM_CONFIG_ENABLE_PRE_POST_SCRIPTS: 'false' } };
}

function assertInside(root: string, path: string, name: string) {
  const rel = relative(root, path);
  if (rel === '..' || rel.startsWith('..' + sep) || rel === '' || /^[A-Za-z]:/.test(rel)) throw new Error(name + ' must stay inside its owned root.');
}

export async function runFrozenCli(run: OwnedRun, options: { installation: FrozenCliInstallation; projectRoot: string; args?: string[]; extraEnv?: Record<string, string>; toolchain: FixedToolchain; timeoutMs?: number; outputLimit?: number }): Promise<NativeResult> {
  await run.assertOwnedProject(resolve(options.projectRoot));
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(options.installation.version)) throw new Error('Frozen CLI installation version is invalid.');
  const installRoot = await realpath(resolve(options.installation.root));
  await run.assertOwnedProject(installRoot);
  const packageRoot = join(installRoot, 'node_modules', '@company', 'component-cli');
  const packageManifestPath = join(packageRoot, 'package.json');
  const packageStat = await lstat(packageManifestPath);
  if (!packageStat.isFile() || packageStat.isSymbolicLink() || packageStat.nlink > 1) throw new Error('Installed CLI package manifest is not an ordinary file.');
  const installed = JSON.parse(await readFile(packageManifestPath, 'utf8')) as { name?: unknown; version?: unknown; bin?: unknown };
  const bin = typeof installed.bin === 'string' ? installed.bin : typeof installed.bin === 'object' && installed.bin !== null && !Array.isArray(installed.bin) ? (installed.bin as Record<string, unknown>).component : undefined;
  if (installed.name !== '@company/component-cli' || installed.version !== options.installation.version || typeof bin !== 'string' || !bin || bin.includes('\\')) throw new Error('Installed CLI package identity or bin declaration changed.');
  const declaredEntry = resolve(packageRoot, bin);
  const entry = resolve(installRoot, options.installation.entry);
  assertInside(installRoot, entry, 'Frozen CLI entry');
  if ((process.platform === 'win32' ? declaredEntry.toLowerCase() : declaredEntry) !== (process.platform === 'win32' ? entry.toLowerCase() : entry)) throw new Error('Frozen CLI entry differs from the installed package bin declaration.');
  const entryStat = await lstat(entry), entryReal = await realpath(entry);
  if (!entryStat.isFile() || entryStat.isSymbolicLink() || entryStat.nlink > 1 || entryReal !== entry) throw new Error('Frozen CLI entry must be an ordinary file inside its install root.');
  if (!/^[0-9a-f]{64}$/.test(options.installation.entrySha256) || sha(await readFile(entry)) !== options.installation.entrySha256) throw new Error('Frozen CLI entry digest changed after installation.');
  const args = [entry, ...(options.args ?? [])], limit = outputCap(options.outputLimit);
  const env: NodeJS.ProcessEnv = { PATH: [dirname(resolve(options.toolchain.nodeExecutable)), process.env.SystemRoot ? join(process.env.SystemRoot, 'System32') : undefined].filter(Boolean).join(';'), TEMP: join(run.evidenceRoot, 'files'), TMP: join(run.evidenceRoot, 'files'), CI: 'true', ...options.extraEnv };
  for (const key of systemKeys) if (process.env[key]) env[key] = process.env[key];
  let timedOut = false;
  const child = spawn(resolve(options.toolchain.nodeExecutable), args, { cwd: resolve(options.projectRoot), env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const childClosed = observeClose(child);
  const close = () => stopProcess(child, childClosed), unregister = run.trackOwnedProcess(close);
  const stdout = captureOutput(limit, () => { void close().catch(() => undefined); });
  const stderr = captureOutput(limit, () => { void close().catch(() => undefined); });
  child.stdout.on('data', chunk => stdout.append(chunk));
  child.stderr.on('data', chunk => stderr.append(chunk));
  let code: number | null;
  try {
    code = await new Promise<number | null>((ok, fail) => {
      let startError: Error | undefined;
      const timer = setTimeout(() => { timedOut = true; void close().catch(fail); }, options.timeoutMs ?? 600000);
      child.once('error', error => { startError = error; clearTimeout(timer); });
      child.once('close', value => { clearTimeout(timer); startError ? fail(startError) : ok(value); });
    });
  } finally { unregister(); }
  const out = stdout.value(), err = stderr.value(), key = 'cli-' + randomBytes(12).toString('hex');
  const outRef = await run.writeEvidence(key + '.stdout', out), errRef = await run.writeEvidence(key + '.stderr', err);
  const outputLimitExceeded = stdout.exceeded() || stderr.exceeded();
  return { executable: resolve(options.toolchain.nodeExecutable), args, cwd: resolve(options.projectRoot), exitCode: outputLimitExceeded ? null : code, timedOut, stdoutBytes: stdout.bytes(), stderrBytes: stderr.bytes(), stdoutSha256: sha(out), stderrSha256: sha(err), stdoutEvidence: outRef.path, stderrEvidence: errRef.path };
}
function observeClose(child: ReturnType<typeof spawn>) {
  let closed = false;
  const promise = new Promise<void>(resolve => child.once('close', () => { closed = true; resolve(); }));
  return { promise, hasClosed: () => closed };
}
async function stopProcess(child: ReturnType<typeof spawn>, childClosed: ReturnType<typeof observeClose>) {
  if (!childClosed.hasClosed()) {
    if (process.platform === 'win32' && child.pid) {
      try {
        const killer = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
        const code = await new Promise<number | null>(resolve => { killer.once('close', resolve); killer.once('error', () => resolve(null)); });
        if (code !== 0 && !childClosed.hasClosed()) child.kill();
      } catch {
        if (!childClosed.hasClosed()) child.kill();
      }
    } else child.kill('SIGTERM');
  }
  await childClosed.promise;
}
export async function runNativeScript(run: OwnedRun, options: { projectRoot: string; manager: 'npm' | 'pnpm'; script: 'typecheck' | 'build'; toolchain: FixedToolchain; extraEnv?: Record<string, string>; timeoutMs?: number; outputLimit?: number }): Promise<NativeResult> {
  await run.assertOwnedProject(resolve(options.projectRoot));
  const invocation = fixedScriptInvocation(options.projectRoot, options.manager, options.script, options.toolchain), limit = outputCap(options.outputLimit);
  const env: NodeJS.ProcessEnv = { PATH: [dirname(resolve(options.toolchain.nodeExecutable)), dirname(resolve(options.toolchain.pnpmWrapper)), process.env.SystemRoot ? join(process.env.SystemRoot, 'System32') : undefined].filter(Boolean).join(';'), TEMP: join(run.evidenceRoot, 'files'), TMP: join(run.evidenceRoot, 'files'), CI: 'true', ...invocation.extraEnv, ...options.extraEnv };
  for (const key of systemKeys) if (process.env[key]) env[key] = process.env[key];
  let timedOut = false;
  const child = spawn(invocation.executable, invocation.args, { cwd: invocation.cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const childClosed = observeClose(child);
  const close = () => stopProcess(child, childClosed), unregister = run.trackOwnedProcess(close);
  const stdout = captureOutput(limit, () => { void close().catch(() => undefined); });
  const stderr = captureOutput(limit, () => { void close().catch(() => undefined); });
  child.stdout.on('data', chunk => stdout.append(chunk));
  child.stderr.on('data', chunk => stderr.append(chunk));
  let code: number | null;
  try { code = await new Promise<number | null>((ok, fail) => { let startError: Error | undefined; const timer = setTimeout(() => { timedOut = true; void close().catch(fail); }, options.timeoutMs ?? 600000); child.once('error', error => { startError = error; clearTimeout(timer); }); child.once('close', value => { clearTimeout(timer); startError ? fail(startError) : ok(value); }); }); }
  finally { unregister(); }
  const out = stdout.value(), err = stderr.value(), key = options.manager + '-' + options.script + '-' + randomBytes(12).toString('hex');
  const outRef = await run.writeEvidence(key + '.stdout', out), errRef = await run.writeEvidence(key + '.stderr', err);
  const outputLimitExceeded = stdout.exceeded() || stderr.exceeded();
  return { executable: invocation.executable, args: invocation.args, cwd: invocation.cwd, exitCode: outputLimitExceeded ? null : code, timedOut, stdoutBytes: stdout.bytes(), stderrBytes: stderr.bytes(), stdoutSha256: sha(out), stderrSha256: sha(err), stdoutEvidence: outRef.path, stderrEvidence: errRef.path };
}
export async function assertLifecycleHooksSuppressed(projectRoot: string) {
  for (const hook of ['preinstall', 'postinstall', 'pretypecheck', 'posttypecheck', 'prebuild', 'postbuild']) {
    try { await readFile(join(projectRoot, '.t17-hooks', hook)); throw Error('Unexpected lifecycle script ran: ' + hook); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
export async function installDependencies(run: OwnedRun, options: { projectRoot: string; manager: 'npm' | 'pnpm'; toolchain: FixedToolchain; registry?: string; outputLimit?: number }) {
  const limit = outputCap(options.outputLimit);
  const root = resolve(options.projectRoot);
  await run.assertOwnedProject(root);
  const config = join(root, '.t17-install'); await mkdir(config, { recursive: true });
  const userconfig = join(config, 'userconfig'), globalconfig = join(config, 'globalconfig'), cache = join(config, 'cache');
  await writeFile(userconfig, '').catch(() => undefined); await writeFile(globalconfig, '').catch(() => undefined); await mkdir(cache, { recursive: true });
  const env: NodeJS.ProcessEnv = { PATH: [dirname(resolve(options.toolchain.nodeExecutable)), dirname(resolve(options.toolchain.pnpmWrapper))].join(';'), TEMP: config, TMP: config, CI: 'true', npm_config_userconfig: userconfig, npm_config_globalconfig: globalconfig, npm_config_cache: cache, PNPM_CONFIG_ENABLE_PRE_POST_SCRIPTS: 'false', PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS: 'false' };
  for (const key of systemKeys) if (process.env[key]) env[key] = process.env[key];
  const npm = options.manager === 'npm', executable = npm ? resolve(options.toolchain.nodeExecutable) : join(process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const args = npm ? [resolve(options.toolchain.npmCliPath), 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry', options.registry ?? 'https://registry.npmjs.org/', '--userconfig', userconfig, '--globalconfig', globalconfig, '--cache', cache] : ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', resolve(options.toolchain.pnpmWrapper), '-PnpmArgs', '--dir', root, 'install', '--ignore-scripts', '--ignore-pnpmfile', '--registry', options.registry ?? 'https://registry.npmjs.org/'];
  const cwd = npm ? root : resolve(options.toolchain.repositoryRoot);
  const child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const childClosed = observeClose(child);
  let stopPromise: Promise<void> | undefined;
  const close = () => stopPromise ??= stopProcess(child, childClosed);
  const stdout = captureOutput(limit, () => { void close().catch(() => undefined); });
  const stderr = captureOutput(limit, () => { void close().catch(() => undefined); });
  child.stdout.on('data', chunk => stdout.append(chunk)); child.stderr.on('data', chunk => stderr.append(chunk));
  const unregister = run.trackOwnedProcess(close); let code: number | null;
  let timedOut = false;
  try { code = await new Promise<number | null>((ok, fail) => { let startError: Error | undefined; const timer = setTimeout(() => { timedOut = true; void close().catch(fail); }, 600000); child.once('error', error => { startError = error; clearTimeout(timer); }); child.once('close', value => { clearTimeout(timer); startError ? fail(Error('Dependency install could not start (' + startError.name + ').')) : ok(value); }); }); }
  finally { unregister(); }
  const out = stdout.value(), err = stderr.value(), key = 'install-' + options.manager + '-' + randomBytes(12).toString('hex'), outRef = await run.writeEvidence(key + '.stdout', out), errRef = await run.writeEvidence(key + '.stderr', err);
  if (stdout.exceeded() || stderr.exceeded()) throw Error('Dependency install exceeded the configured output limit; bounded output evidence retained at ' + outRef.path + ' and ' + errRef.path);
  if (timedOut) throw Error('Dependency install timed out; output evidence retained at ' + outRef.path + ' and ' + errRef.path);
  if (code !== 0) throw Error('Dependency install failed with exit ' + code + '; see external evidence ' + outRef.path + ' and ' + errRef.path);
  await assertLifecycleHooksSuppressed(root);
  return { manager: options.manager, executable, args, cwd, exitCode: code, stdoutSha256: outRef.sha256, stderrSha256: errRef.sha256, stdoutBytes: out.length, stderrBytes: err.length };
}
export type BrowserAsset = { url: string; path: string; sha256: string; bytes: number; status: number };
export function createBrowserAssetRecorder(origin: string) {
  const base = new URL(origin), assets = new Map<string, BrowserAsset>();
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port) throw Error('Browser asset recorder requires an explicit loopback HTTP origin.');
  return { async record(response: { url(): string; status(): number; request(): { method(): string }; body(): Promise<Buffer> }) { const url = new URL(response.url()); if (url.origin !== base.origin || response.request().method() !== 'GET') return; const bytes = await response.body(); assets.set(url.href, { url: url.href, path: url.pathname, sha256: sha(bytes), bytes: bytes.length, status: response.status() }); }, snapshot() { return [...assets.values()].sort((a, b) => a.url.localeCompare(b.url)); } };
}
