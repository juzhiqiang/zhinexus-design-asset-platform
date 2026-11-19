import { spawn } from 'node:child_process';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Client, type CallToolResult } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { singleJson } from './support.mjs';

export function processAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; } }
/** Read-only diagnostics from this run's owned install roots; never reads npmrc or credentials. */
export function observeLiveInstallLogs(parent: string, sensitiveValues: readonly string[]) {
  const logs = new Map<string, string>(); let stopped = false;
  const redact = (value: string) => sensitiveValues.reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), value);
  const watching = (async () => {
    do {
      try {
        for (const entry of await readdir(parent, { withFileTypes: true })) {
          if (!entry.isDirectory() || entry.isSymbolicLink() || !entry.name.startsWith('.t16-env-')) continue;
          const root = join(parent, entry.name), marker = JSON.parse(await readFile(join(root, '.t16-owner.json'), 'utf8')) as Record<string, unknown>;
          if (marker.kind !== 't16-external-root' || marker.role !== 'env' || typeof marker.operationId !== 'string' || !marker.operationId.startsWith('apply-')) continue;
          const directory = join(root, 'cache', '_logs');
          for (const log of await readdir(directory, { withFileTypes: true })) {
            if (!log.isFile() || log.isSymbolicLink() || !log.name.endsWith('-debug-0.log')) continue;
            const file = join(directory, log.name), info = await lstat(file);
            if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) continue;
            logs.set(marker.operationId + '/' + log.name, redact(await readFile(file, 'utf8')));
          }
        }
      } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
      if (!stopped) await new Promise(done => setTimeout(done, 50));
    } while (!stopped);
  })();
  return async () => { stopped = true; await watching; return { kind: 'independent-owned-install-log-observation', credentialsRead: false, logs: [...logs].map(([path, text]) => ({ path, text })) }; };
}
export async function until(test: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!await test()) { if (Date.now() >= deadline) throw new Error('Independent process/browser observation timed out.'); await new Promise(done => setTimeout(done, 50)); }
}
export async function terminateOwnedTree(pid: number) {
  if (!processAlive(pid)) return;
  if (process.platform === 'win32') await new Promise<void>((resolve, reject) => {
    const killer = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
    killer.once('error', reject); killer.once('close', () => resolve());
  }); else { try { process.kill(-pid, 'SIGKILL'); } catch { process.kill(pid, 'SIGKILL'); } }
  await until(() => !processAlive(pid));
}
/** The runner owns the spawned PID; timeout cleanup awaits its entire tree. */
export async function runLive(command: string, args: string[], options: { cwd: string; env: Record<string, string>; timeoutMs?: number }) {
  const child = spawn(command, args, { cwd: options.cwd, env: options.env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', timedOut = false, termination: Promise<void> | undefined;
  child.stdout.on('data', value => { stdout += String(value); }); child.stderr.on('data', value => { stderr += String(value); });
  const timer = setTimeout(() => { timedOut = true; if (child.pid) termination = terminateOwnedTree(child.pid); }, options.timeoutMs ?? 600_000);
  try {
    const code = await new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code ?? -1)); });
    await termination;
    return { code, stdout, stderr, timedOut };
  } finally { clearTimeout(timer); if (child.pid && processAlive(child.pid)) await terminateOwnedTree(child.pid); }
}

export async function openLiveMcp(input: { node: string; bin: string; config: string; cwd: string; env: Record<string, string>; sensitiveValues?: string[] }) {
  const transport = new StdioClientTransport({ command: input.node, args: [input.bin, 'mcp', 'serve', '--config', input.config], cwd: input.cwd, env: input.env, stderr: 'pipe' });
  const client = new Client({ name: 'independent-t17-d-live', version: '1.0.0' });
  let stderr = '';
  transport.stderr?.on('data', chunk => { stderr += String(chunk); });
  try { await client.connect(transport); } catch (error) { await transport.close(); throw error; }
  const pid = transport.pid;
  if (!pid) throw new Error('Real MCP SDK transport did not expose its owned child PID.');
  const protocolErrors: string[] = [], frames: Array<{ jsonrpc?: string; method?: string; id?: string | number }> = [], sentMethods: string[] = [];
  const onmessage = transport.onmessage, onerror = transport.onerror, send = transport.send.bind(transport);
  transport.onmessage = message => { frames.push({ jsonrpc: message.jsonrpc, ...('method' in message ? { method: message.method } : {}), ...('id' in message ? { id: message.id } : {}) }); onmessage?.(message); };
  transport.onerror = error => { protocolErrors.push(error.message); onerror?.(error); };
  transport.send = async message => { if ('method' in message) sentMethods.push(message.method); return send(message); };
  let closed = false;
  return { client, pid, frames, protocolErrors, sentMethods,
    async tool(name: string, args: Record<string, unknown>, options?: { signal?: AbortSignal; timeout?: number }): Promise<Record<string, unknown>> {
      const result = await client.callTool({ name, arguments: args }, { timeout: 600_000, ...options });
      if (input.sensitiveValues?.some(secret => JSON.stringify(result).includes(secret))) throw new Error('Real MCP tool output exposed a sensitive value.');
      return parseLiveTool(result);
    },
    async close() {
      if (!closed) { closed = true; await client.close(); await until(() => !processAlive(pid)); }
      if (protocolErrors.length || frames.some(frame => frame.jsonrpc !== '2.0')) throw new Error('MCP stdout/transport protocol was polluted: ' + protocolErrors.join('; '));
      return { pid, exited: !processAlive(pid), frames: frames.length, protocolErrors, sentMethods, stderrSha256: (await import('./support.mjs')).sha256(stderr), stderrBytes: Buffer.byteLength(stderr) };
    },
  };
}
export function parseLiveTool(result: CallToolResult): Record<string, unknown> {
  const content = result.content;
  if (!Array.isArray(content) || content.length !== 1 || content[0]?.type !== 'text' || result.isError) throw new Error('Real MCP tool returned an error or non-single-JSON content: ' + JSON.stringify(content));
  return singleJson({ stdout: content[0].text });
}
