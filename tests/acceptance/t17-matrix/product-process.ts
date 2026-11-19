import { spawn } from 'node:child_process';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { OwnedRun } from '../t17-host/host.js';
import type { FixedToolchain } from '../t17-host/runtime.js';

export type ProductProcessResult = { exitCode: number; stdout: string; stderr: string; timedOut: boolean; durationMs: number; outputLimited: boolean };
export function sanitizeProductOutput(value: string, secrets: readonly string[] = []): string {
  let safe = value;
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) safe = safe.split(secret).join('[REDACTED]');
  return safe.replace(/(authorization\s*[:=]\s*(?:Bearer\s+)?)[^\s"']+/gi, '$1[REDACTED]').replace(/(_authToken\s*=\s*)[^\s"']+/gi, '$1[REDACTED]');
}
export function productProcessEnvironment(tools: FixedToolchain, temp: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { CI: 'true', TEMP: temp, TMP: temp,
    PATH: [dirname(tools.nodeExecutable), resolve(dirname(tools.nodeExecutable), '../pnpm-native-12.18.0/package'), process.env.SystemRoot ? join(process.env.SystemRoot, 'System32') : undefined].filter(Boolean).join(delimiter),
    PNPM_CONFIG_ENABLE_PRE_POST_SCRIPTS: 'false', PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS: 'false' };
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'ComSpec', 'COMSPEC', 'NUMBER_OF_PROCESSORS', 'PLAYWRIGHT_BROWSERS_PATH']) if (process.env[key]) env[key] = process.env[key];
  return { ...env, ...extra };
}
/** Always resolves only after close; raw output exists in memory only until redaction. */
export async function runProductProcess(input: { run: OwnedRun; executable: string; args: string[]; cwd: string; timeoutMs: number; secrets?: string[]; env?: NodeJS.ProcessEnv; outputLimit?: number }): Promise<ProductProcessResult> {
  if (!isAbsolute(input.executable) || !isAbsolute(input.cwd) || input.timeoutMs < 1) throw new Error('Product process requires explicit absolute paths and a bounded timeout.');
  const started = Date.now(), outputLimit = input.outputLimit ?? 8 * 1024 * 1024;
  return new Promise(resolveResult => {
    let stdout = '', stderr = '', timedOut = false, outputLimited = false, spawnFailed = false, collectedBytes = 0;
    const outDecoder = new StringDecoder('utf8'), errDecoder = new StringDecoder('utf8');
    const child = spawn(resolve(input.executable), input.args, { cwd: input.cwd, env: input.env ?? {}, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = new Promise<void>(done => child.once('close', () => done()));
    let stopping: Promise<void> | undefined;
    const stop = () => stopping ??= (async () => {
      if (child.exitCode === null && process.platform === 'win32' && child.pid) {
        const killer = spawn(join(process.env.SystemRoot ?? 'C:/Windows', 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
        await new Promise<void>(done => { killer.once('close', () => done()); killer.once('error', () => done()); });
      }
      if (child.exitCode === null) child.kill();
      await closed;
    })();
    const collect = (which: 'stdout' | 'stderr', bytes: Uint8Array) => {
      if (collectedBytes + bytes.length > outputLimit) { outputLimited = true; void stop(); return; }
      collectedBytes += bytes.length;
      if (which === 'stdout') stdout += outDecoder.write(Buffer.from(bytes)); else stderr += errDecoder.write(Buffer.from(bytes));
    };
    child.stdout.on('data', bytes => collect('stdout', bytes)); child.stderr.on('data', bytes => collect('stderr', bytes));
    child.once('error', () => { spawnFailed = true; });
    const timer = setTimeout(() => { timedOut = true; void stop(); }, input.timeoutMs);
    const unregister = input.run.trackOwnedProcess(async () => { await stop(); clearTimeout(timer); });
    child.once('close', async code => {
      clearTimeout(timer); unregister();
      if (stopping) await stopping;
      stdout += outDecoder.end(); stderr += errDecoder.end();
      resolveResult({ exitCode: timedOut || outputLimited || spawnFailed ? 1 : code ?? 1,
        stdout: sanitizeProductOutput(stdout, input.secrets), stderr: sanitizeProductOutput(stderr, input.secrets),
        timedOut, durationMs: Date.now() - started, outputLimited });
    });
  });
}
