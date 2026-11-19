import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { OwnedRun } from './host.js';

export type FixedToolchain = { nodeExecutable: string; npmCliPath: string; pnpmWrapper: string; repositoryRoot: string };
export type NativeResult = { executable: string; args: string[]; cwd: string; exitCode: number | null; timedOut: boolean; stdoutBytes: number; stderrBytes: number; stdoutSha256: string; stderrSha256: string; stdoutEvidence: string; stderrEvidence: string };
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const systemKeys = ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS'];

export function fixedScriptInvocation(root: string, manager: 'npm' | 'pnpm', script: 'typecheck' | 'build', tools: FixedToolchain) {
  if (manager === 'npm') return { executable: resolve(tools.nodeExecutable), args: [resolve(tools.npmCliPath), '--ignore-scripts', 'run', script], cwd: resolve(root), extraEnv: {} as Record<string, string> };
  const shell = join(process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  return { executable: shell, args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', resolve(tools.pnpmWrapper), '-PnpmArgs', '--dir', resolve(root), 'run', script], cwd: resolve(tools.repositoryRoot), extraEnv: { PNPM_CONFIG_ENABLE_PRE_POST_SCRIPTS: 'false' } };
}
function tail(chunks: Buffer[], cap: number) { const all = Buffer.concat(chunks); return all.length > cap ? all.subarray(all.length - cap) : all; }
async function stopProcess(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
    await new Promise<void>(done => { killer.once('close', () => done()); killer.once('error', () => done()); });
  } else { child.kill('SIGTERM'); await new Promise<void>(done => { if (child.exitCode !== null || child.signalCode !== null) done(); else child.once('close', () => done()); }); }
}
export async function runNativeScript(run: OwnedRun, options: { projectRoot: string; manager: 'npm' | 'pnpm'; script: 'typecheck' | 'build'; toolchain: FixedToolchain; extraEnv?: Record<string, string>; timeoutMs?: number; outputLimit?: number }): Promise<NativeResult> {
  const invocation = fixedScriptInvocation(options.projectRoot, options.manager, options.script, options.toolchain), limit = options.outputLimit ?? 1024 * 1024;
  const env: NodeJS.ProcessEnv = { PATH: [dirname(resolve(options.toolchain.nodeExecutable)), dirname(resolve(options.toolchain.pnpmWrapper)), process.env.SystemRoot ? join(process.env.SystemRoot, 'System32') : undefined].filter(Boolean).join(';'), TEMP: join(run.evidenceRoot, 'files'), TMP: join(run.evidenceRoot, 'files'), CI: 'true', ...invocation.extraEnv, ...options.extraEnv };
  for (const key of systemKeys) if (process.env[key]) env[key] = process.env[key];
  const stdout: Buffer[] = [], stderr: Buffer[] = []; let stdoutBytes = 0, stderrBytes = 0, timedOut = false;
  const child = spawn(invocation.executable, invocation.args, { cwd: invocation.cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { const b = Buffer.from(chunk); stdoutBytes += b.length; stdout.push(b); });
  child.stderr.on('data', chunk => { const b = Buffer.from(chunk); stderrBytes += b.length; stderr.push(b); });
  const close = () => stopProcess(child), unregister = run.trackOwnedProcess(close);
  let code: number | null;
  try { code = await new Promise<number | null>((ok, fail) => { const timer = setTimeout(() => { timedOut = true; void close().finally(() => ok(child.exitCode)); }, options.timeoutMs ?? 600000); child.once('error', error => { clearTimeout(timer); fail(error); }); child.once('close', value => { clearTimeout(timer); ok(value); }); }); }
  finally { unregister(); }
  const out = tail(stdout, limit), err = tail(stderr, limit), key = options.manager + '-' + options.script + '-' + Date.now();
  const outRef = await run.writeEvidence(key + '.stdout', out), errRef = await run.writeEvidence(key + '.stderr', err);
  return { executable: invocation.executable, args: invocation.args, cwd: invocation.cwd, exitCode: code, timedOut, stdoutBytes, stderrBytes, stdoutSha256: sha(out), stderrSha256: sha(err), stdoutEvidence: outRef.path, stderrEvidence: errRef.path };
}
export async function assertLifecycleHooksSuppressed(projectRoot: string) {
  for (const hook of ['preinstall', 'postinstall', 'pretypecheck', 'posttypecheck', 'prebuild', 'postbuild']) {
    try { await readFile(join(projectRoot, '.t17-hooks', hook)); throw Error('Unexpected lifecycle script ran: ' + hook); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
export async function installDependencies(run: OwnedRun, options: { projectRoot: string; manager: 'npm' | 'pnpm'; toolchain: FixedToolchain; registry?: string }) {
  const root = resolve(options.projectRoot), config = join(root, '.t17-install'); await mkdir(config, { recursive: true });
  const userconfig = join(config, 'userconfig'), globalconfig = join(config, 'globalconfig'), cache = join(config, 'cache');
  await writeFile(userconfig, '').catch(() => undefined); await writeFile(globalconfig, '').catch(() => undefined); await mkdir(cache, { recursive: true });
  const env: NodeJS.ProcessEnv = { PATH: [dirname(resolve(options.toolchain.nodeExecutable)), dirname(resolve(options.toolchain.pnpmWrapper))].join(';'), TEMP: config, TMP: config, CI: 'true', npm_config_userconfig: userconfig, npm_config_globalconfig: globalconfig, npm_config_cache: cache, PNPM_CONFIG_ENABLE_PRE_POST_SCRIPTS: 'false', PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS: 'false' };
  for (const key of systemKeys) if (process.env[key]) env[key] = process.env[key];
  const npm = options.manager === 'npm', executable = npm ? resolve(options.toolchain.nodeExecutable) : join(process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const args = npm ? [resolve(options.toolchain.npmCliPath), 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry', options.registry ?? 'https://registry.npmjs.org/', '--userconfig', userconfig, '--globalconfig', globalconfig, '--cache', cache] : ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', resolve(options.toolchain.pnpmWrapper), '-PnpmArgs', '--dir', root, 'install', '--ignore-scripts', '--ignore-pnpmfile', '--registry', options.registry ?? 'https://registry.npmjs.org/'];
  const cwd = npm ? root : resolve(options.toolchain.repositoryRoot), stdout: Buffer[] = [], stderr: Buffer[] = [];
  const child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', b => stdout.push(Buffer.from(b))); child.stderr.on('data', b => stderr.push(Buffer.from(b)));
  const unregister = run.trackOwnedProcess(() => stopProcess(child)); let code: number | null;
  try { code = await new Promise<number | null>((ok, fail) => { const timer = setTimeout(() => { void stopProcess(child).finally(() => fail(Error('Dependency install timed out.'))); }, 600000); child.once('error', error => { clearTimeout(timer); fail(Error('Dependency install could not start (' + error.name + ').')); }); child.once('close', value => { clearTimeout(timer); ok(value); }); }); }
  finally { unregister(); }
  const out = Buffer.concat(stdout), err = Buffer.concat(stderr), key = 'install-' + options.manager + '-' + Date.now(), outRef = await run.writeEvidence(key + '.stdout', out), errRef = await run.writeEvidence(key + '.stderr', err);
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
