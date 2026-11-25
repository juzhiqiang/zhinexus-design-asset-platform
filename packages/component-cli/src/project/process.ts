import { spawn } from 'node:child_process';
import { resolvePnpmExecutable } from '../local/pack.js';
import type { LocalCommand } from './config.js';
import { componentEnvironment, operationSignal, bindChild, terminateTree } from './lifecycle.js';

export async function runLocal(command: LocalCommand, cwd: string, log: (message: string) => void = () => {}, timeoutMs = 120_000): Promise<void> {
  const program = command.program === 'pnpm' ? resolvePnpmExecutable(cwd) : command.program;
  operationSignal();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(program, command.args, { cwd, detached: process.platform !== 'win32', shell: process.platform === 'win32' && (program.endsWith('.cmd') || program === 'pnpm' || program === 'npm'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: componentEnvironment() });
    bindChild(child);
    let output = '';
    const timer = timeoutMs ? setTimeout(() => { void terminateTree(child).finally(() => reject(new Error('LOCAL_COMMAND_TIMEOUT: ' + command.program))); }, timeoutMs) : undefined;
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => { const value = String(chunk); output = (output + value).slice(-8192); log(value.trimEnd()); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error('LOCAL_COMMAND_FAILED: ' + command.program + ' (' + code + ')\n' + output)); });
  });
}
