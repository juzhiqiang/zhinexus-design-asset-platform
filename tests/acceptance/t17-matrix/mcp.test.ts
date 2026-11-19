import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { McpStdioSession } from './mcp.js';
import type { FrozenCliIdentity } from './executor.js';

const roots: string[] = [];
const sessions: McpStdioSession[] = [];

async function makeCli(source: string): Promise<{ root: string; cli: FrozenCliIdentity; expectedSha256: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 't17-mcp-'));
  roots.push(root);
  const installRoot = path.join(root, 'toolchain', 'cli');
  const packageRoot = path.join(installRoot, 'node_modules', '@company', 'component-cli');
  const projectRoot = path.join(root, 'cases', 'V01');
  await mkdir(path.join(packageRoot, 'dist'), { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  const binPath = path.join(packageRoot, 'dist', 'bin.js');
  const tarballPath = path.join(root, 'component-cli.tgz');
  const tarball = Buffer.from('frozen cli tarball fixture');
  await writeFile(tarballPath, tarball, { flag: 'wx' });
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@company/component-cli', version: '0.0.14', bin: { component: './dist/bin.js' } }));
  await writeFile(binPath, source, { flag: 'wx' });
  const hash = createHash('sha256').update(tarball).digest('hex');
  return {
    root,
    cli: { version: '0.0.14', tarballSha256: hash, tarballPath, installRoot, packageRoot, binPath },
    expectedSha256: hash,
  };
}

function rpcServer(prefix = ''): string {
  return prefix + [
    'let buffer = "";',
    'process.stdin.setEncoding("utf8");',
    'process.stdin.on("data", chunk => {',
    '  buffer += chunk;',
    '  for (;;) {',
    '    const index = buffer.indexOf("\\n");',
    '    if (index < 0) break;',
    '    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);',
    '    const request = JSON.parse(line);',
    '    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { cwd: process.cwd(), sentinel: process.env.T17_MCP_PARENT_SENTINEL ?? null } }) + "\\n");',
    '  }',
    '});',
  ].join('\n');
}

async function launch(cliSetup: Awaited<ReturnType<typeof makeCli>>): Promise<McpStdioSession> {
  const session = await McpStdioSession.launch({
    cli: cliSetup.cli,
    expectedVersion: '0.0.14',
    expectedTarballSha256: cliSetup.expectedSha256,
    workRoot: cliSetup.root,
    projectRoot: path.join(cliSetup.root, 'cases', 'V01'),
  });
  sessions.push(session);
  return session;
}

afterEach(async () => {
  delete process.env.T17_MCP_PARENT_SENTINEL;
  for (const session of sessions.splice(0)) await session.close().catch(() => undefined);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('T17 MCP stdio 进程边界', () => {
  it('只在冻结 CLI 身份与本次 workRoot 项目通过校验后启动，并使用最小环境', async () => {
    process.env.T17_MCP_PARENT_SENTINEL = 'must-not-inherit';
    const setup = await makeCli(rpcServer());
    const session = await launch(setup);
    const response = await session.initialize();
    const result = response.result as { cwd: string; sentinel: string | null };
    expect(result.cwd).toBe(path.join(setup.root, 'cases', 'V01'));
    expect(result.sentinel).toBeNull();
    await session.close();
    expect(session.hasExited()).toBe(true);
  });

  it('拒绝冻结安装包之外的任意 binPath', async () => {
    const setup = await makeCli(rpcServer());
    const foreignBin = path.join(setup.root, 'outside.js');
    await writeFile(foreignBin, 'process.exit(0)');
    await expect(McpStdioSession.launch({
      cli: { ...setup.cli, binPath: foreignBin }, expectedVersion: '0.0.14', expectedTarballSha256: setup.expectedSha256,
      workRoot: setup.root, projectRoot: path.join(setup.root, 'cases', 'V01'),
    })).rejects.toThrow(/入口路径|bin|安装入口/i);
  });

  it('拒绝 workRoot 之外的 MCP cwd', async () => {
    const setup = await makeCli(rpcServer());
    const outside = path.join(path.dirname(setup.root), 'outside-project');
    await mkdir(outside);
    roots.push(outside);
    await expect(McpStdioSession.launch({
      cli: setup.cli, expectedVersion: '0.0.14', expectedTarballSha256: setup.expectedSha256,
      workRoot: setup.root, projectRoot: outside,
    })).rejects.toThrow(/workRoot|项目/);
  });

  it('stdout 非 JSON 协议行立即失败并关闭子进程', async () => {
    const setup = await makeCli(rpcServer('process.stdout.write("startup log\\n");\n'));
    const session = await launch(setup);
    await expect(session.initialize()).rejects.toThrow(/stdout|JSON|协议/);
    await expect(session.close()).rejects.toThrow(/stdout|JSON|协议/);
    expect(session.hasExited()).toBe(true);
  });

  it('stdout 超过上限时失败且 close 等待实际退出事件', async () => {
    const setup = await makeCli(rpcServer('process.stdout.write("x".repeat(1024 * 1024 + 32) + "\\n");\n'));
    const session = await launch(setup);
    await expect(session.initialize()).rejects.toThrow(/上限|limit|stdout/i);
    await expect(session.close()).rejects.toThrow(/上限|limit|stdout/i);
    expect(session.hasExited()).toBe(true);
  });

  it('stderr 超过上限时失败关闭且不回显过量诊断', async () => {
    const setup = await makeCli(rpcServer('process.stderr.write("x".repeat(1024 * 1024 + 32));\n'));
    const session = await launch(setup);
    await expect(session.initialize()).rejects.toThrow(/上限|limit|stderr/i);
    await expect(session.close()).rejects.toThrow(/上限|limit|stderr/i);
    expect(session.hasExited()).toBe(true);
    expect(session.stderrText().length).toBeLessThan(64);
  });

  it('验证响应后的 stdout 污染会在关闭握手时被拒绝', async () => {
    const setup = await makeCli(rpcServer('setTimeout(() => process.stdout.write("trailing log"), 10);\n'));
    const session = await launch(setup);
    await expect(session.initialize()).resolves.toMatchObject({ jsonrpc: '2.0' });
    await expect(session.close()).rejects.toThrow(/stdout|JSON|协议/);
    expect(session.hasExited()).toBe(true);
  });
});
