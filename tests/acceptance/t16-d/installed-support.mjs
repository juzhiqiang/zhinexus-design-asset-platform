// tests/acceptance/t16-d/installed-support.mjs — T16-D 安装态验收支撑：仅依赖 node 内建，供后续 node:test 使用
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function* list(dir, skipRootNodeModules) {
  const rootStat = await lstat(dir);
  if (!rootStat.isDirectory()) throw new Error(`快照目标不是目录: ${dir}`);
  yield { name: '', path: dir, st: rootStat };
  const walk = async function* (current, prefix) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (skipRootNodeModules && prefix === '' && entry.name === 'node_modules') continue;
      const path = join(current, entry.name), name = prefix ? `${prefix}/${entry.name}` : entry.name, st = await lstat(path);
      if (!st.isFile() && !st.isDirectory()) throw new Error(`拒绝符号链接或非常规条目: ${name}`);
      if (st.isFile() && st.nlink > 1) throw new Error(`拒绝硬链接文件: ${name}`);
      yield { name, path, st };
      if (st.isDirectory()) yield* walk(path, name);
    }
  };
  yield* walk(dir, '');
}
export async function snapshot(dir, options = {}) {
  const entries = [];
  for await (const item of list(dir, options.excludeRootNodeModules === true)) {
    if (item.st.isDirectory()) entries.push({ name: item.name, type: 'dir' });
    else { const bytes = await readFile(item.path); entries.push({ name: item.name, type: 'file', size: bytes.length, bytes: bytes.toString('base64'), sha: sha(bytes) }); }
  }
  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
export async function setup() {
  const need = (key) => { const value = process.env[key]; if (typeof value !== 'string' || value.trim() === '') throw new Error(`缺少必需环境变量 ${key}`); return value; };
  const needPath = async (key, kind) => {
    const value = need(key);
    if (!isAbsolute(value)) throw new Error(`${key} 必须是绝对路径`);
    const st = await lstat(value).catch(() => { throw new Error(`${key} 路径不存在: ${value}`); });
    if (kind === 'file' ? !st.isFile() : !st.isDirectory()) throw new Error(`${key} 不是${kind === 'file' ? '常规文件' : '目录'}: ${value}`);
    return value;
  };
  const needUrl = (key) => { let url; try { url = new URL(need(key)); } catch { throw new Error(`${key} 不是合法 URL`); } if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${key} 必须是 http(s) URL`); return url; };
  const entry = await needPath('T16_D_CLI_ENTRY', 'file'), fixedNode = await needPath('T16_D_FIXED_NODE', 'file'), npmCli = await needPath('T16_D_NPM_CLI', 'file');
  const matchFile = await needPath('T16_D_MATCH_FILE', 'file'), cliCwd = await needPath('T16_D_CLI_CWD', 'dir');
  const api = needUrl('T16_D_API_URL'), registry = needUrl('T16_D_REGISTRY_URL');
  const apiToken = need('ZHINEXUS_API_TOKEN'), registryToken = need('ZHINEXUS_REGISTRY_TOKEN'), tokens = [apiToken, registryToken];
  const area = await mkdtemp(join(tmpdir(), 't16-d-')), root = await mkdtemp(join(area, 'project-'));
  const backupRoot = join(area, 'backup'), planFile = join(area, 'plan.json'), evidence = join(area, 'evidence'), poison = join(area, 'poison.txt');
  await mkdir(evidence, { recursive: true });
  const poisonScript = `node -e "const fs=require('fs');fs.writeFileSync(process.argv[1],'poison')" ${JSON.stringify(poison)}`;
  await writeFile(join(root, 'package.json'), `${JSON.stringify({ name: 't16-d-consumer', version: '1.0.0', private: true, packageManager: 'npm@11.20.0', scripts: { preinstall: poisonScript, install: poisonScript, postinstall: poisonScript }, dependencies: { vue: '3.5.45', echarts: '6.1.0' } }, null, 2)}\n`);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'user.txt'), 't16-d-user-source\n');
  const userConfig = join(area, 'npm-user-config'), globalConfig = join(area, 'npm-global-config'), npmCache = join(area, 'npm-cache');
  await writeFile(userConfig, '');
  await writeFile(globalConfig, '');
  const run = (label, cmd, args, options) => new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...options, shell: false, windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`子进程超时(600s): ${label}`)); }, 600000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
  const persist = async (label, result) => {
    const leaked = tokens.some((token) => result.stdout.includes(token) || result.stderr.includes(token));
    const redact = (text) => tokens.reduce((acc, token) => acc.split(token).join('[REDACTED]'), text);
    await writeFile(join(evidence, `${label}.json`), `${JSON.stringify({ code: result.code, stdout: redact(result.stdout), stderr: redact(result.stderr) }, null, 2)}\n`);
    if (leaked) throw new Error(`检测到令牌泄漏，原始输出不展示，已脱敏保存证据: ${label}`);
    return result;
  };
  const absent = async (target, message) => { try { await lstat(target); } catch (error) { if (error.code === 'ENOENT') return; throw error; } throw new Error(message); };
  const baselineEnv = { PATH: dirname(fixedNode) };
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'CI']) if (process.env[key] !== undefined) baselineEnv[key] = process.env[key];
  const baseline = await persist('baseline-install', await run('baseline-install', fixedNode, [npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/', `--userconfig=${userConfig}`, `--globalconfig=${globalConfig}`, `--cache=${npmCache}`], { cwd: root, env: baselineEnv }));
  if (baseline.code !== 0) throw new Error(`基线安装退出码 ${baseline.code}，证据见 ${join(evidence, 'baseline-install.json')}`);
  const installedVersion = async (pkg) => JSON.parse(await readFile(join(root, 'node_modules', pkg, 'package.json'), 'utf8')).version;
  if ((await installedVersion('vue')) !== '3.5.45') throw new Error('vue 实际安装版本不是 3.5.45');
  if ((await installedVersion('echarts')) !== '6.1.0') throw new Error('echarts 实际安装版本不是 6.1.0');
  await absent(poison, '毒物标记存在，说明生命周期脚本被执行');
  await absent(join(root, 'node_modules', '@company', 'charts-vue'), '基线安装后不应存在 @company/charts-vue');
  const original = new Map();
  for await (const item of list(root, true)) if (item.st.isFile()) original.set(item.name, await readFile(item.path));
  const sourceBefore = await snapshot(root, { excludeRootNodeModules: true });
  const match = await readFile(matchFile, 'utf8');
  const cli = async (args, label) => {
    const tag = String(label).replace(/[^a-z0-9-]/gi, '_');
    const env = { ...process.env, ZHINEXUS_API_TOKEN: apiToken, ZHINEXUS_REGISTRY_TOKEN: registryToken };
    const result = await persist(`cli-${tag}`, await run(`cli-${tag}`, fixedNode, [entry, 'integrate', ...args], { cwd: cliCwd, env }));
    let json;
    try { json = JSON.parse(result.stdout.trim()); } catch { throw new Error(`CLI 输出无法解析为单一 JSON 对象，证据见 ${join(evidence, `cli-${tag}.json`)}`); }
    if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new Error(`CLI 输出不是单一 JSON 对象，证据见 ${join(evidence, `cli-${tag}.json`)}`);
    return { code: result.code, json };
  };
  return { area, root, backupRoot, planFile, match, original, sourceBefore, cli, snapshot, sha, evidence, poison, api: api.href, registry: registry.href };
}
