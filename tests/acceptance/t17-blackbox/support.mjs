// tests/acceptance/t17-blackbox/support.mjs — T17-D 独立黑盒支撑设施（仅 Node 内建，不导入产品源码）。
// 职责：校验调用方给出的冻结 CLI tarball 身份，在仓外以真实 npm 安装该 tarball，
// 启动真实本地静态宿主与 MCP stdio 客户端，以子进程方式驱动实际 `node <installed>/dist/bin.js`。
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readlink, readdir, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const canonicalJson = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
};
export const digestOf = (value) => sha256(Buffer.from(canonicalJson(value), 'utf8'));

/** 必需环境变量：缺失即失败关闭，不做任何默认值或跳过。 */
export function required(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`缺少必需环境变量 ${name}（不伪造成功，见 README）`);
  return value;
}
export async function requiredFile(name) {
  const value = required(name);
  if (!isAbsolute(value)) throw new Error(`${name} 必须是绝对路径`);
  const stat = await lstat(value).catch(() => { throw new Error(`${name} 路径不存在: ${value}`); });
  if (!stat.isFile()) throw new Error(`${name} 不是常规文件: ${value}`);
  return await realpath(value);
}
export async function requiredDirectory(name) {
  const value = required(name);
  if (!isAbsolute(value)) throw new Error(`${name} 必须是绝对路径`);
  const stat = await lstat(value).catch(() => { throw new Error(`${name} 路径不存在: ${value}`); });
  if (!stat.isDirectory()) throw new Error(`${name} 不是目录: ${value}`);
  return await realpath(value);
}

/** 子进程：shell:false、有界超时、stdout/stderr 全量收集；始终返回退出码与原文（脱敏在持久化层完成）。 */
export function run(command, args, { cwd, env, timeoutMs = 600_000, signal } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false, exit = null;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve({ code: -1, stdout, stderr: `${stderr}\nspawn error: ${error.message}`, timedOut }); });
    child.on('close', (code, exitSignal) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort); exit = exitSignal;
      resolve({ code: typeof code === 'number' ? code : -1, signal: exit, stdout, stderr, timedOut });
    });
  });
}

/** 单一 JSON 对象 stdout 解析：多余文本、空输出、数组都视为协议污染。 */
export function singleJson(result) {
  const text = result.stdout.trim();
  if (text === '') throw new Error('stdout 为空，期望单一 JSON 对象');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error(`stdout 不是可解析的单一 JSON（前 200 字符）: ${text.slice(0, 200)}`); }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('stdout 不是单一 JSON 对象');
  return value;
}

/** 源快照：排除已核验的 node_modules 与调用方显式列出的输出目录；链接以目标记录而非跟随。 */
export async function snapshotTree(root, excluded = []) {
  const skip = new Set(['node_modules', ...excluded.map((p) => p.replaceAll('\\', '/'))]);
  const files = {};
  async function visit(directory, prefix) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (skip.has(rel)) continue;
      const absolute = join(directory, entry.name);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) files[rel] = `link:${(await readlink(absolute).catch(() => '?'))}`;
      else if (stat.isDirectory()) await visit(absolute, rel);
      else files[rel] = sha256(await readFile(absolute));
    }
  }
  await visit(root, '');
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
export const treeDiff = (before, after) => ({
  added: Object.keys(after).filter((p) => !(p in before)),
  removed: Object.keys(before).filter((p) => !(p in after)),
  modified: Object.keys(after).filter((p) => p in before && before[p] !== after[p]),
});

/** 仓外环境根：所有安装、工程、artifact 均位于目标工程之外。 */
export async function evidenceArea(prefix = 't17-d-blackbox-') {
  const area = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  console.log(JSON.stringify({ event: 'T17_D_EVIDENCE_DIRECTORY', artifactDirectory: area, productionAcceptance: false }));
  return area;
}

export function within(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.startsWith(`..${sep}`));
}

/** 干净包管理器环境：不继承用户 npmrc/cache/凭据（空 userconfig/globalconfig 先写入再返回）。 */
export async function cleanEnvironment(area, label, { dirs }) {
  const config = join(area, `${label}-config`);
  await mkdir(config, { recursive: true });
  const userconfig = join(config, 'userconfig'), globalconfig = join(config, 'globalconfig');
  await writeFile(userconfig, ''); await writeFile(globalconfig, '');
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return { ...env, PATH: dirs.join(';'), TEMP: config, TMP: config, CI: 'true', npm_config_userconfig: userconfig,
    npm_config_globalconfig: globalconfig, npm_config_cache: join(config, 'cache'),
    PNPM_CONFIG_ENABLE_PRE_POST_SCRIPTS: 'false', PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS: 'false' };
}

/**
 * 安装冻结 CLI tarball 到仓外隔离目录，并全程锁定其字节身份。
 * 返回 { root, bin, version, tarball, sha256, assertUnchanged }。
 */
export async function installFrozenCli({ area, tarball, node, npmCli, expectedVersion }) {
  const bytes = await readFile(tarball);
  const digest = sha256(bytes);
  if (process.env.T17_D_CLI_SHA256 && process.env.T17_D_CLI_SHA256.toLowerCase() !== digest) {
    throw new Error(`冻结包 SHA-256 与调用方给出的 T17_D_CLI_SHA256 不一致（实际 ${digest}）`);
  }
  const root = join(area, 'cli'); await mkdir(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, dependencies: { '@company/component-cli': `file:${tarball.replaceAll('\\', '/')}` } }, null, 2));
  const env = await cleanEnvironment(area, 'frozen-cli', { dirs: [dirname(node)] });
  const installed = await run(node, [npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/'], { cwd: root, env, timeoutMs: 300_000 });
  await writeFile(join(area, 'frozen-cli-install.json'), JSON.stringify({ code: installed.code, stdout: installed.stdout, stderr: installed.stderr }, null, 2));
  if (installed.code !== 0) throw new Error(`冻结 CLI 安装失败（证据 frozen-cli-install.json），退出码 ${installed.code}`);
  const packageRoot = join(root, 'node_modules', '@company', 'component-cli');
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  if (manifest.name !== '@company/component-cli') throw new Error('冻结 CLI 安装包身份错误：package name 不匹配');
  if (expectedVersion !== undefined && manifest.version !== expectedVersion) throw new Error('冻结 CLI 安装包身份错误：package version 不匹配');
  if (manifest.dependencies?.['@company/contracts'] !== undefined) throw new Error('冻结 CLI 声明了私有包 @company/contracts 运行时依赖');
  const bin = join(packageRoot, 'dist', 'bin.js');
  if (!(await lstat(bin).catch(() => null))?.isFile()) throw new Error('冻结 CLI 缺少 dist/bin.js');
  const assertUnchanged = async () => {
    const current = sha256(await readFile(tarball));
    if (current !== digest) throw new Error(`冻结包字节在验收期间发生变化：${digest} -> ${current}`);
  };
  return { root, bin, version: manifest.version, tarball, sha256: digest, assertUnchanged };
}

/** Write one host-consumable receipt only after canonicalizing and checking evidence for supplied secrets. */
export async function recordCaseEvidence({ area, caseId, kind, value, secrets = [] }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(caseId)) throw new Error('Unsafe case id for evidence receipt.');
  if (kind !== 'positive' && kind !== 'refusal') throw new Error('Unsupported evidence receipt kind.');
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Case evidence must be a JSON object.');
  const serialized = canonicalJson(value) + '\n';
  if (secrets.some(secret => typeof secret === 'string' && secret.length > 0 && serialized.includes(secret))) {
    throw new Error('Sensitive secret found in case evidence; refusing to persist it.');
  }
  const directory = await realpath(area);
  const evidenceDirectory = join(directory, 'files');
  await mkdir(evidenceDirectory, { recursive: true });
  const evidencePath = join(evidenceDirectory, caseId + '.json');
  const bytes = Buffer.from(serialized, 'utf8');
  await writeFile(evidencePath, bytes, { flag: 'wx' });
  return { caseId, kind, evidencePath, sha256: sha256(bytes), bytes: bytes.length };
}

/** 启动真实静态宿主：只提供已构建的 dist，任何路径穿越或缺失回落到 index.html 之前的 404。 */
export async function serveStatic(root, files = {}) {
  const extras = new Map(Object.entries(files).map(([path, content]) => [`/${path}`, content]));
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    const requested = pathname === '/' ? '/index.html' : pathname;
    if (extras.has(requested)) { response.writeHead(200, { 'content-type': requested.endsWith('.js') ? 'text/javascript' : 'text/html' }); response.end(extras.get(requested)); return; }
    const target = join(root, requested);
    if (!within(root, target)) { response.writeHead(403); response.end(); return; }
    try {
      const bytes = await readFile(target);
      const type = requested.endsWith('.js') ? 'text/javascript' : requested.endsWith('.css') ? 'text/css' : requested.endsWith('.html') ? 'text/html' : 'application/octet-stream';
      response.writeHead(200, { 'content-type': type }); response.end(bytes);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { origin: `http://127.0.0.1:${address.port}`, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

/**
 * 最小 MCP JSON-RPC stdio 客户端（newline-delimited 帧）。
 * 同时记录每一条 stdout 帧是否可解析为 JSON-RPC 2.0 消息，用于协议污染检测。
 */
export function mcpClient({ command, args, cwd, env, timeoutMs = 60_000 }) {
  const child = spawn(command, args, { cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', stderr = '', nextId = 1, exited = false, exitInfo = null;
  const pending = new Map();
  const frames = [];
  const protocolViolations = [];
  let stderrBytes = 0;
  const failAll = (error) => { for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(error); } pending.clear(); };
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { protocolViolations.push({ kind: 'non-json', preview: line.slice(0, 120) }); continue; }
      if (message?.jsonrpc !== '2.0') { protocolViolations.push({ kind: 'non-jsonrpc', preview: line.slice(0, 120) }); continue; }
      frames.push(message);
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve, timer } = pending.get(message.id); pending.delete(message.id); clearTimeout(timer); resolve(message);
      } else if (message.id === undefined && message.method === undefined) protocolViolations.push({ kind: 'non-jsonrpc', preview: line.slice(0, 120) });
    }
  });
  child.stderr.on('data', (chunk) => { stderrBytes += chunk.length; if (stderr.length < 64 * 1024) stderr += chunk; });
  child.on('error', (error) => { exited = true; failAll(error); });
  child.on('close', (code, signal) => { exited = true; exitInfo = { code, signal }; failAll(new Error(`MCP 进程已退出 code=${code} signal=${signal}`)); });
  const request = (method, params) => new Promise((resolve, reject) => {
    if (exited) { reject(new Error('MCP 进程已退出')); return; }
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP 请求超时: ${method}`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`);
  });
  const notify = (method, params) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })}\n`);
  const close = async () => {
    if (!exited) { child.stdin.end(); }
    await new Promise((resolve) => {
      if (exited) return resolve();
      const timer = setTimeout(() => { if (!exited) child.kill(); resolve(); }, 10_000);
      child.once('close', () => { clearTimeout(timer); resolve(); });
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    return { exited, exitInfo, stderr, stderrBytes, frames: frames.length, protocolViolations, trailing: buffer.trim().slice(0, 200) };
  };
  const kill = () => { if (!exited) child.kill(); };
  return { request, notify, close, kill, state: () => ({ exited, exitInfo, frames: frames.length, protocolViolations: [...protocolViolations], stderr, stderrBytes }) };
}
