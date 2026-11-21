import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { afterEach, describe, expect, it } from 'vitest';
import tar from 'tar-stream';
import { McpStdioSession } from './mcp.js';
import type { FrozenCliIdentity } from './executor.js';

const roots: string[] = [];
const sessions: McpStdioSession[] = [];

async function makeCli(source: string): Promise<{ root: string; configPath: string; cli: FrozenCliIdentity; expectedSha256: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 't17-mcp-'));
  roots.push(root);
  const installRoot = path.join(root, 'toolchain', 'cli');
  const packageRoot = path.join(installRoot, 'node_modules', '@company', 'component-cli');
  const projectRoot = path.join(root, 'cases', 'V01');
  const artifactRoot = path.join(root, 'evidence', 'V01');
  const configPath = path.join(root, 'config', 'V01.json');
  await mkdir(path.join(packageRoot, 'dist'), { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  await mkdir(path.dirname(configPath), { recursive: true });
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(configPath, JSON.stringify({ schemaVersion: 1, projectRoot, artifactRoot }), { flag: 'wx' });
  const binPath = path.join(packageRoot, 'dist', 'bin.js');
  const tarballPath = path.join(root, 'component-cli.tgz');
  const manifest = Buffer.from(JSON.stringify({ name: '@company/component-cli', version: '0.0.14', bin: { component: './dist/bin.js' } }));
  const binBytes = Buffer.from(source);
  await writeFile(path.join(packageRoot, 'package.json'), manifest, { flag: 'wx' });
  await writeFile(binPath, binBytes, { flag: 'wx' });
  const archive = tar.pack();
  archive.entry({ name: 'package/package.json', size: manifest.length }, manifest);
  archive.entry({ name: 'package/dist/bin.js', size: binBytes.length }, binBytes);
  archive.finalize();
  await pipeline(archive, createGzip(), createWriteStream(tarballPath, { flags: 'wx' }));
  const tarball = await (await import('node:fs/promises')).readFile(tarballPath);
  const hash = createHash('sha256').update(tarball).digest('hex');
  return {
    root,
    configPath,
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
    '    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { cwd: process.cwd(), args: process.argv.slice(2), sentinel: process.env.T17_MCP_PARENT_SENTINEL ?? null } }) + "\\n");',
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
    configPath: cliSetup.configPath,
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
    const result = response.result as { cwd: string; args: string[]; sentinel: string | null };
    expect(result.cwd).toBe(path.join(setup.root, 'cases', 'V01'));
    expect(result.args).toEqual(['mcp', 'serve', '--config', setup.configPath]);
    expect(result.sentinel).toBeNull();
    await session.close();
    expect(session.hasExited()).toBe(true);
  });

  it('拒绝相对 MCP config 路径且不启动 CLI', async () => {
    const setup = await makeCli(rpcServer());
    const relativeConfig = path.relative(setup.root, setup.configPath);
    expect(path.isAbsolute(relativeConfig)).toBe(false);
    await expect(McpStdioSession.launch({
      cli: setup.cli,
      expectedVersion: '0.0.14',
      expectedTarballSha256: setup.expectedSha256,
      workRoot: setup.root,
      projectRoot: path.join(setup.root, 'cases', 'V01'),
      configPath: relativeConfig,
    })).rejects.toThrow(/absolute|绝对/i);
  });

  it('拒绝把本轮 MCP config 绑定到另一项目根', async () => {
    const setup = await makeCli('process.exit(0);');
    await writeFile(setup.configPath, JSON.stringify({
      schemaVersion: 1,
      projectRoot: path.join(setup.root, 'cases', 'other'),
      artifactRoot: path.join(setup.root, 'evidence', 'V01'),
    }));

    await expect(McpStdioSession.launch({
      cli: setup.cli,
      expectedVersion: '0.0.14',
      expectedTarballSha256: setup.expectedSha256,
      workRoot: setup.root,
      projectRoot: path.join(setup.root, 'cases', 'V01'),
      configPath: setup.configPath,
    })).rejects.toThrow(/bind|绑定/i);
  });

  it('拒绝指向 workRoot 外部的 artifactRoot junction', async () => {
    const setup = await makeCli('process.exit(0);');
    const outside = path.join(path.dirname(setup.root), path.basename(setup.root) + '-outside');
    const linkedArtifactRoot = path.join(setup.root, 'evidence-linked');
    await mkdir(outside);
    roots.push(outside);
    await symlink(outside, linkedArtifactRoot, 'junction');
    await writeFile(setup.configPath, JSON.stringify({
      schemaVersion: 1,
      projectRoot: path.join(setup.root, 'cases', 'V01'),
      artifactRoot: linkedArtifactRoot,
    }));

    const attempt = McpStdioSession.launch({
      cli: setup.cli, expectedVersion: '0.0.14', expectedTarballSha256: setup.expectedSha256,
      workRoot: setup.root, projectRoot: path.join(setup.root, 'cases', 'V01'), configPath: setup.configPath,
    }).then((session) => { sessions.push(session); return session; });
    await expect(attempt).rejects.toThrow(/artifactRoot|artifact root|外置/i);
  });

  it('拒绝冻结安装包之外的任意 binPath', async () => {
    const setup = await makeCli(rpcServer());
    const foreignBin = path.join(setup.root, 'outside.js');
    await writeFile(foreignBin, 'process.exit(0)');
    await expect(McpStdioSession.launch({
      cli: { ...setup.cli, binPath: foreignBin }, expectedVersion: '0.0.14', expectedTarballSha256: setup.expectedSha256,
      workRoot: setup.root, projectRoot: path.join(setup.root, 'cases', 'V01'),
      configPath: setup.configPath,
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
      configPath: setup.configPath,
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
