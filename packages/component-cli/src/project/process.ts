import { spawn } from 'node:child_process';
import { resolvePnpmExecutable } from '../local/pack.js';
import type { LocalCommand } from './config.js';

export async function runLocal(command: LocalCommand, cwd: string, log: (message: string) => void = () => {}, timeoutMs = 120_000): Promise<void> {
  const program = command.program === 'pnpm' ? resolvePnpmExecutable(cwd) : command.program;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(program, command.args, { cwd, shell: process.platform === 'win32' && (program.endsWith('.cmd') || program === 'pnpm' || program === 'npm'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } });
    let output = '';
    const timer = timeoutMs ? setTimeout(() => { child.kill(); reject(new Error('LOCAL_COMMAND_TIMEOUT: ' + command.program)); }, timeoutMs) : undefined;
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => { const value = String(chunk); output = (output + value).slice(-8192); log(value.trimEnd()); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error('LOCAL_COMMAND_FAILED: ' + command.program + ' (' + code + ')\n' + output)); });
  });
}
