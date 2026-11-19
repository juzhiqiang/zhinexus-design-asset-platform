import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mcpClient, snapshotTree } from './support.mjs';

const temporaryDirectories: string[] = [];
async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 't17-blackbox-support-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('T17 black-box support', () => {
  it('snapshots a directory link without traversing its target', async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await mkdir(join(outside, 'private'));
    await writeFile(join(outside, 'private', 'secret.txt'), 'outside');
    await symlink(outside, join(root, 'linked'), 'junction');

    const snapshot = await snapshotTree(root);

    expect(snapshot.linked).toMatch(/^link:/);
    expect(Object.keys(snapshot)).not.toContain('linked/private/secret.txt');
  });

  it('closes a real stdio child after a JSON-RPC response', async () => {
    const childProgram = [
      "let input = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', chunk => { input += chunk; let newline; while ((newline = input.indexOf('\\n')) >= 0) { const line = input.slice(0, newline); input = input.slice(newline + 1); const request = JSON.parse(line); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { method: request.method } }) + '\\n'); } });",
    ].join('');
    const client = mcpClient({ command: process.execPath, args: ['-e', childProgram], cwd: process.cwd() });
    let closed: Awaited<ReturnType<typeof client.close>> | undefined;
    try {
      const response = await client.request('ping');
      expect(response.result).toEqual({ method: 'ping' });
    } finally {
      closed = await client.close();
    }

    expect(closed?.exited).toBe(true);
    expect(closed?.exitInfo?.code).toBe(0);
    expect(closed?.protocolViolations).toEqual([]);
    expect(closed?.trailing).toBe('');
  });
});
