import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

type RpcReply = {
  jsonrpc: string;
  id: number;
  result?: { isError?: boolean; content?: { type: string; text?: string }[]; tools?: { name: string; inputSchema: { additionalProperties?: boolean } }[] };
  error?: { code: number; message: string };
};

// Keep host credentials out of the test child: only these synthetic values are
// sent to the product, and failing assertions report booleans rather than wire data.
function syntheticEnvironment(apiToken: string, registryToken: string): Record<string, string> {
  const env: Record<string, string> = { ZHINEXUS_API_TOKEN: apiToken, ZHINEXUS_REGISTRY_TOKEN: registryToken };
  for (const key of ['PATH', 'SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function startStdio(configPath: string, apiToken: string, registryToken: string) {
  const child = spawn(process.execPath, [path.resolve('packages/component-cli/dist/bin.js'), 'mcp', 'serve', '--config', configPath], {
    env: syntheticEnvironment(apiToken, registryToken),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  let pending = '';
  let invalidFrames = 0;
  let nextId = 1;
  const frames: RpcReply[] = [];
  const waiters = new Map<number, { resolve: (reply: RpcReply) => void; reject: (error: Error) => void }>();
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
    pending += chunk;
    while (pending.includes('\n')) {
      const lineEnd = pending.indexOf('\n');
      const line = pending.slice(0, lineEnd);
      pending = pending.slice(lineEnd + 1);
      try {
        const frame = JSON.parse(line) as RpcReply;
        frames.push(frame);
        waiters.get(frame.id)?.resolve(frame);
        waiters.delete(frame.id);
      } catch { invalidFrames += 1; }
    }
  });
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });
  const closed = new Promise<number | null>(resolve => child.once('close', resolve));
  child.once('error', () => {
    for (const waiter of waiters.values()) waiter.reject(new Error('MCP child failed to start'));
  });
  function notify(method: string, params?: Record<string, unknown>) {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }) + '\n');
  }
  async function request(method: string, params?: Record<string, unknown>): Promise<RpcReply> {
    const id = nextId++;
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await new Promise<RpcReply>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('MCP reply timed out')), 10_000);
        waiters.set(id, { resolve, reject });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) + '\n');
      });
    } finally { clearTimeout(timer!); waiters.delete(id); }
  }
  return {
    request, notify,
    output: () => ({ stdout, stderr, pending, invalidFrames, frames }),
    close: async () => {
      child.stdin.end();
      const timeout = setTimeout(() => child.kill(), 10_000);
      try { return await closed; } finally { clearTimeout(timeout); }
    },
  };
}

describe('MCP SDK response redaction at the real stdio boundary', () => {
  it.each([
    ['plain', 'T17_SYNTHETIC_MCP_API_SECRET_394751', 'T17_SYNTHETIC_MCP_REGISTRY_SECRET_394751'],
    ['JSON escaped', 'T17_SYNTHETIC_API_"\\\t\n_SECRET', 'T17_SYNTHETIC_REGISTRY_"\\\t\n_SECRET'],
  ])('strict SDK errors redact %s credentials before stdout', async (_label, apiToken, registryToken) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhinexus-t17-mcp-redaction-project-'));
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zhinexus-t17-mcp-redaction-artifacts-'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'synthetic-redaction-project', version: '1.0.0', private: true }));
    const configPath = path.join(artifactRoot, 'host.json');
    fs.writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, projectRoot: root, artifactRoot }));
    const session = startStdio(configPath, apiToken, registryToken);
    try {
      const initialized = await session.request('initialize', {
        protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'synthetic-redaction-client', version: '1.0.0' },
      });
      expect(initialized.error === undefined).toBe(true);
      session.notify('notifications/initialized');
      const listed = await session.request('tools/list');
      expect(listed.result?.tools?.map(tool => tool.name).sort()).toEqual([
        'apply_integration', 'inspect_project', 'plan_integration', 'verify_integration',
      ]);
      expect(listed.result?.tools?.every(tool => tool.inputSchema.additionalProperties === false)).toBe(true);

      // The SDK rejects unknown keys before our registered tool handler runs.
      const inputError = await session.request('tools/call', {
        name: 'inspect_project', arguments: { [apiToken]: true, [registryToken]: true },
      });
      expect(inputError.result?.isError).toBe(true);

      // Unknown tools are protocol errors rather than CallToolResult errors.
      const protocolError = await session.request('tools/call', { name: apiToken, arguments: {} });
      expect(protocolError.error?.code).toBe(-32602);
      session.notify('notifications/cancelled', { requestId: 987654, reason: registryToken });
      const inspected = await session.request('tools/call', { name: 'inspect_project', arguments: {} });
      expect(inspected.result?.isError === true).toBe(false);
      const afterErrors = await session.request('tools/list');
      expect(afterErrors.result?.tools?.length).toBe(4);
    } finally { expect(await session.close()).toBe(0); }

    const output = session.output();
    expect(output.invalidFrames).toBe(0);
    expect(output.pending).toBe('');
    expect(output.frames.every(frame => frame.jsonrpc === '2.0')).toBe(true);
    const diagnosticTexts = output.frames.flatMap(frame => [
      frame.error?.message ?? '',
      ...(frame.result?.content?.map(content => content.text ?? '') ?? []),
    ]);
    const leaked = [apiToken, registryToken].some(token => {
      const escaped = JSON.stringify(token).slice(1, -1);
      return [output.stdout, output.stderr, ...diagnosticTexts]
        .some(text => text.includes(token) || text.includes(escaped));
    });
    expect(leaked).toBe(false);
  }, 30_000);
});
