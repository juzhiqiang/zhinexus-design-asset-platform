/**
 * T17 MCP stdio 驱动器。
 *
 * 只能启动已经复核身份的冻结 component-cli；cwd 必须是本轮 workRoot 内的普通项目目录。
 * stdio 按 JSON-RPC 行协议解析并有明确字节上限，关闭流程等到 ChildProcess 的 close 事件。
 */
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { FrozenCliIdentity } from './executor.js';
import { assertFrozenCliEntry } from './executor.js';
import type { McpToolCall, McpToolName } from './pipeline.js';
import { expectedMcpToolNames } from './pipeline.js';
import { sha256Bytes } from './support.js';

export type JsonRpcRequest = { jsonrpc: '2.0'; id: number; method: string; params?: Record<string, unknown> };
export type JsonRpcResponse = { jsonrpc: '2.0'; id: number; result?: unknown; error?: { code: number; message: string } };

export type McpCallRecord = { tool: McpToolName; requestDigest: string; responseDigest: string; bytes: number };
export type McpStdioLaunchInput = {
  cli: FrozenCliIdentity;
  expectedVersion: string;
  expectedTarballSha256: string;
  workRoot: string;
  projectRoot: string;
  configPath: string;
  protocolVersion?: string;
  apiToken?: string;
  registryToken?: string;
};

const MAX_STDOUT_BYTES = 1024 * 1024;
const MAX_STDERR_BYTES = 1024 * 1024;
const RESPONSE_TIMEOUT_MS = 120_000;
const CLOSE_TIMEOUT_MS = 20_000;
const FORCE_CLOSE_TIMEOUT_MS = 10_000;
const ALLOWED_ENVIRONMENT = new Set([
  'appdata', 'comspec', 'homedrive', 'homepath', 'home', 'lang', 'lc_all', 'localappdata', 'path', 'pathext',
  'playwright_browsers_path', 'systemroot', 'temp', 'tmp', 'userprofile', 'windir',
]);

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function requireRealDirectory(target: string, label: string): Promise<string> {
  const resolved = path.resolve(target);
  const stat = await lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(await realpath(resolved), resolved)) {
    throw new Error(label + ' 必须是无链接的普通目录');
  }
  return resolved;
}

async function requireOwnedArtifactRoot(workRoot: string, target: string): Promise<void> {
  if (!isWithin(workRoot, target)) throw new Error('MCP artifactRoot 必须位于本轮 workRoot 内');
  const stat = await lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(await realpath(target), target)) {
    throw new Error('MCP artifactRoot 必须是 workRoot 内无链接的普通目录');
  }
  const realWorkRoot = await realpath(workRoot);
  const realArtifactRoot = await realpath(target);
  if (!isWithin(realWorkRoot, realArtifactRoot)) throw new Error('MCP artifactRoot 真实路径必须位于本轮 workRoot 内');
}

function minimalEnvironment(tokens: Pick<McpStdioLaunchInput, 'apiToken' | 'registryToken'>): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && ALLOWED_ENVIRONMENT.has(key.toLowerCase())) output[key] = value;
  }
  output.CI = 'true';
  output.NO_COLOR = '1';
  if (tokens.apiToken) output.ZHINEXUS_API_TOKEN = tokens.apiToken;
  if (tokens.registryToken) output.ZHINEXUS_REGISTRY_TOKEN = tokens.registryToken;
  return output;
}

export class McpStdioSession {
  private readonly child: ChildProcess;
  private readonly stdoutChunks: Buffer[] = [];
  private readonly stderrChunks: Buffer[] = [];
  private readonly protocolVersions: string;
  private readonly secrets: string[];
  private readonly responses: JsonRpcResponse[] = [];
  private readonly exitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  private readonly maxOutputBytes: number;
  private stdoutPending = Buffer.alloc(0);
  private stdoutSize = 0;
  private stderrSize = 0;
  private nextId = 1;
  private closed = false;
  private closing: Promise<void> | null = null;
  private failure: Error | null = null;
  private exitResult: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  private sensitiveOutput = false;

  readonly records: McpCallRecord[] = [];

  private constructor(input: McpStdioLaunchInput, maxOutputBytes = MAX_STDOUT_BYTES) {
    this.protocolVersions = input.protocolVersion ?? '2025-06-18';
    this.secrets = [input.apiToken, input.registryToken].filter((value): value is string => Boolean(value));
    this.maxOutputBytes = maxOutputBytes;
    this.child = spawn(process.execPath, [path.resolve(input.cli.binPath), 'mcp', 'serve', '--config', path.resolve(input.configPath)], {
      cwd: path.resolve(input.projectRoot),
      env: minimalEnvironment(input),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.exitPromise = new Promise((resolve) => {
      this.child.once('close', (code, signal) => {
        if (this.stdoutPending.length > 0 && !this.failure) this.fail('mcp stdout 协议行缺少结束换行符');
        this.exitResult = { code, signal };
        resolve(this.exitResult);
      });
    });
    this.child.once('error', () => this.fail('mcp 子进程启动或运行失败'));
    this.child.stdout?.on('data', (chunk: Buffer) => this.acceptStdout(Buffer.from(chunk)));
    this.child.stderr?.on('data', (chunk: Buffer) => this.acceptStderr(Buffer.from(chunk)));
  }

  static async launch(input: McpStdioLaunchInput): Promise<McpStdioSession> {
    await assertFrozenCliEntry(input.cli, input.expectedVersion, input.expectedTarballSha256);
    const workRoot = await requireRealDirectory(input.workRoot, 'workRoot');
    const projectRoot = await requireRealDirectory(input.projectRoot, 'projectRoot');
    const installRoot = await requireRealDirectory(input.cli.installRoot, '冻结 CLI installRoot');
    if (!path.isAbsolute(input.configPath)) throw new Error('MCP config 路径必须是绝对路径');
    const configPath = path.resolve(input.configPath);
    if (!isWithin(workRoot, projectRoot)) throw new Error('MCP cwd 必须是本轮 workRoot 内的项目');
    if (!isWithin(workRoot, installRoot)) throw new Error('冻结 CLI installRoot 必须位于本轮 workRoot 内');
    if (!isWithin(workRoot, configPath)) throw new Error('MCP config 必须位于本轮 workRoot 内');
    const configStat = await lstat(configPath);
    if (!configStat.isFile() || configStat.isSymbolicLink() || configStat.nlink > 1 || !samePath(await realpath(configPath), configPath)) {
      throw new Error('MCP config 必须是本轮 workRoot 内未链接的普通文件');
    }
    let config: unknown;
    try { config = JSON.parse(await readFile(configPath, 'utf8')); } catch { throw new Error('MCP config 必须是有效 JSON'); }
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('MCP config 必须是 JSON 对象');
    const configRecord = config as Record<string, unknown>;
    if (configRecord.schemaVersion !== 1 || typeof configRecord.projectRoot !== 'string' || !path.isAbsolute(configRecord.projectRoot)
      || typeof configRecord.artifactRoot !== 'string' || !path.isAbsolute(configRecord.artifactRoot)
      || !samePath(configRecord.projectRoot, projectRoot) || !isWithin(workRoot, path.resolve(configRecord.artifactRoot))
      || samePath(configRecord.artifactRoot, projectRoot)) {
      throw new Error('MCP config 必须绑定本轮项目根和工作区内的外置 artifactRoot');
    }
    await requireOwnedArtifactRoot(workRoot, path.resolve(configRecord.artifactRoot));
    return new McpStdioSession(input);
  }

  private fail(message: string): void {
    if (this.failure) return;
    this.failure = new Error(message);
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
  }

  private containsSecret(bytes: Buffer): boolean {
    const text = bytes.toString('utf8');
    return this.secrets.some((secret) => secret.length > 0 && text.includes(secret));
  }

  private acceptStdout(chunk: Buffer): void {
    if (this.failure) return;
    if (this.stdoutSize + chunk.byteLength > this.maxOutputBytes) {
      this.fail('mcp stdout 超过字节上限');
      return;
    }
    this.stdoutSize += chunk.byteLength;
    this.stdoutChunks.push(chunk);
    const full = Buffer.concat(this.stdoutChunks, this.stdoutSize);
    if (this.containsSecret(full)) {
      this.sensitiveOutput = true;
      this.stdoutChunks.length = 0;
      this.stdoutSize = 0;
      this.stdoutPending = Buffer.alloc(0);
      this.responses.length = 0;
      this.fail('mcp stdout 包含敏感凭证');
      return;
    }
    let pending = Buffer.concat([this.stdoutPending, chunk]);
    for (;;) {
      const newline = pending.indexOf(10);
      if (newline < 0) break;
      const line = pending.subarray(0, newline).toString('utf8').replace(/\r$/, '');
      pending = pending.subarray(newline + 1);
      if (!line.trim()) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(line); } catch { this.fail('mcp stdout 含非 JSON 协议行'); return; }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed as Record<string, unknown>).jsonrpc !== '2.0') {
        this.fail('mcp stdout 含无效 JSON-RPC 消息');
        return;
      }
      const message = parsed as Record<string, unknown>;
      if (message.id !== undefined) {
        if ((typeof message.id !== 'number' && typeof message.id !== 'string') ||
            (message.result === undefined && message.error === undefined)) {
          this.fail('mcp stdout 含无效 JSON-RPC 响应');
          return;
        }
        this.responses.push(message as unknown as JsonRpcResponse);
      }
    }
    this.stdoutPending = pending;
  }

  private acceptStderr(chunk: Buffer): void {
    if (this.failure) return;
    if (this.stderrSize + chunk.byteLength > MAX_STDERR_BYTES) {
      this.stderrChunks.length = 0;
      this.stderrSize = 0;
      this.fail('mcp stderr 超过字节上限');
      return;
    }
    this.stderrSize += chunk.byteLength;
    this.stderrChunks.push(chunk);
    if (this.containsSecret(Buffer.concat(this.stderrChunks, this.stderrSize))) {
      this.sensitiveOutput = true;
      this.stderrChunks.length = 0;
      this.stderrSize = 0;
      this.fail('mcp stderr 包含敏感凭证');
    }
  }

  private async send(request: Omit<JsonRpcRequest, 'jsonrpc'>): Promise<JsonRpcResponse> {
    if (this.closed) throw new Error('mcp-session-closed');
    if (this.failure) throw this.failure;
    const payload: JsonRpcRequest = { jsonrpc: '2.0', ...request };
    const bytes = Buffer.from(JSON.stringify(payload) + '\n', 'utf8');
    if (!this.child.stdin || !this.child.stdin.write(bytes)) {
      if (!this.child.stdin || this.child.stdin.destroyed) throw new Error('mcp stdin closed');
    }
    return await this.waitForResponse(payload.id);
  }

  private async waitForResponse(id: number): Promise<JsonRpcResponse> {
    const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.failure) throw this.failure;
      const index = this.responses.findIndex((response) => response.id === id);
      if (index >= 0) return this.responses.splice(index, 1)[0]!;
      if (this.exitResult) throw new Error('mcp 子进程在响应前退出');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('mcp-response-timeout');
  }

  async initialize(): Promise<JsonRpcResponse> {
    return await this.send({
      id: this.nextId++, method: 'initialize',
      params: { protocolVersion: this.protocolVersions, capabilities: {}, clientInfo: { name: 't17-matrix', version: '1.0.0' } },
    });
  }

  async listTools(): Promise<{ names: string[]; response: JsonRpcResponse }> {
    const response = await this.send({ id: this.nextId++, method: 'tools/list', params: {} });
    const result = response.result as { tools?: { name: string }[] } | undefined;
    const names = (result?.tools ?? []).map((tool) => tool.name).sort();
    return { names, response };
  }

  async callTool(call: McpToolCall): Promise<{ response: JsonRpcResponse; record: McpCallRecord }> {
    const request = { id: this.nextId++, method: 'tools/call', params: { name: call.tool, arguments: call.arguments } };
    const requestBytes = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...request }) + '\n', 'utf8');
    const response = await this.send(request);
    const responseBytes = Buffer.from(JSON.stringify(response) + '\n', 'utf8');
    const record: McpCallRecord = {
      tool: call.tool,
      requestDigest: createHash('sha256').update(requestBytes).digest('hex'),
      responseDigest: createHash('sha256').update(responseBytes).digest('hex'),
      bytes: requestBytes.length + responseBytes.length,
    };
    this.records.push(record);
    return { response, record };
  }

  stderrText(): string {
    if (this.sensitiveOutput) return '[REDACTED]';
    return Buffer.concat(this.stderrChunks, this.stderrSize).toString('utf8')
      .replace(/\b(?:api[-_]?token|registry[-_]?token|authorization|password|secret)(?:\s*[=:]\s*|\s+)[^\s,;]+/gi, '[REDACTED]')
      .replace(/(?:https?|wss?):\/\/[^\s"']+/gi, '[URL_REDACTED]')
      .slice(0, 4096);
  }

  stdoutBytes(): Buffer {
    if (this.sensitiveOutput) return Buffer.alloc(0);
    return Buffer.concat(this.stdoutChunks, this.stdoutSize);
  }

  async toolAnnotations(): Promise<Record<string, unknown>> {
    const response = await this.send({ id: this.nextId++, method: 'tools/list', params: {} });
    const result = response.result as { tools?: { name: string; annotations?: Record<string, unknown> }[] } | undefined;
    const output: Record<string, unknown> = {};
    for (const tool of result?.tools ?? []) output[tool.name] = tool.annotations ?? null;
    return output;
  }

  notify(method: string, params?: Record<string, unknown>): void {
    if (this.closed || this.failure) throw this.failure ?? new Error('mcp-session-closed');
    const payload: Record<string, unknown> = { jsonrpc: '2.0', method };
    if (params !== undefined) payload.params = params;
    this.child.stdin?.write(Buffer.from(JSON.stringify(payload) + '\n', 'utf8'));
  }

  private async waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.exitResult) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
    const exited = this.exitPromise.then(() => true as const);
    const result = await Promise.race([exited, timeout]);
    if (timer) clearTimeout(timer);
    return result;
  }

  private async closeInternal(): Promise<void> {
    this.closed = true;
    this.child.stdin?.end();
    if (!await this.waitForExit(CLOSE_TIMEOUT_MS)) {
      this.child.kill('SIGKILL');
      if (!await this.waitForExit(FORCE_CLOSE_TIMEOUT_MS)) throw new Error('mcp 子进程被终止后未确认退出');
    }
    if (this.failure) throw this.failure;
  }

  async close(): Promise<void> {
    if (!this.closing) this.closing = this.closeInternal();
    await this.closing;
  }

  exitCode(): number | null {
    return this.exitResult?.code ?? null;
  }

  hasExited(): boolean {
    return this.exitResult !== null;
  }
}

export function expectedTools(): readonly string[] {
  return expectedMcpToolNames();
}

export { sha256Bytes };
