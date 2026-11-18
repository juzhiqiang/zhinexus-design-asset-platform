import assert from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('integrate apply 缺少 --plan 必须以 INVALID_ARGUMENTS 失败且零写入零回显', () => {
  const entry = process.env.T16_D_CLI_ENTRY;
  assert.ok(typeof entry === 'string' && entry.length > 0 && fs.existsSync(entry), '环境变量 T16_D_CLI_ENTRY 必须指向真实 CLI 入口');
  const apiToken = 'synthetic-api-token-t16d-4f2b9c';
  const registryToken = 'synthetic-registry-token-t16d-7d3e1a';
  const redact = (text) => String(text).split(apiToken).join('<redacted>').split(registryToken).join('<redacted>');
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 't16-d-cli-required-'));
  const projectDir = path.join(evidenceDir, 'project');
  const backupRoot = path.join(evidenceDir, 'backup-root');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(backupRoot, { recursive: true });
  const markerArg = path.join(evidenceDir, 'marker-ran').split(path.sep).join('/');
  const malicious = (phase) => `node -e "require('fs').writeFileSync('${markerArg}','${phase}')"`;
  const pkgPath = path.join(projectDir, 'package.json');
  fs.writeFileSync(pkgPath, JSON.stringify({
    name: 't16-d-malicious-project',
    version: '0.0.0',
    scripts: { preinstall: malicious('preinstall'), install: malicious('install'), postinstall: malicious('postinstall') },
  }, null, 2));
  const fixtureParsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.ok(fixtureParsed && fixtureParsed.name === 't16-d-malicious-project' && fixtureParsed.scripts && typeof fixtureParsed.scripts.postinstall === 'string' && fixtureParsed.scripts.postinstall.includes('writeFileSync'), '夹具 package.json 必须是合法 JSON 且恶意 lifecycle 脚本保留');
  const typeOf = (stat) => stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : `other:${(stat.mode & 0o170000).toString(8)}`;
  const snapshot = (dir, prefix = '') => {
    const out = { [prefix ? `${prefix}/` : '/']: { type: typeOf(fs.lstatSync(dir)) } };
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const stat = fs.lstatSync(abs);
      if (stat.isFile()) { out[rel] = { type: 'file', bytes: fs.readFileSync(abs) }; }
      else if (stat.isDirectory()) { out[rel] = { type: 'dir' }; Object.assign(out, snapshot(abs, rel)); }
      else { out[rel] = { type: typeOf(stat) }; }
    }
    return out;
  };
  const before = { project: snapshot(projectDir), backup: snapshot(backupRoot) };
  const res = spawnSync(process.execPath, [
    entry, 'integrate', 'apply',
    '--project', projectDir,
    '--api-url', 'https://api.t16-d-blackbox.invalid',
    '--registry', 'https://registry.t16-d-blackbox.invalid',
    '--backup-root', backupRoot,
    '--allow-install', 'false',
  ], { env: {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    ZHINEXUS_API_TOKEN: apiToken,
    ZHINEXUS_REGISTRY_TOKEN: registryToken,
  }, shell: false, timeout: 10000, encoding: 'utf8' });
  assert.ok(!res.error, `spawn 不应失败: ${redact(res.error && res.error.message)}`);
  assert.strictEqual(res.signal, null, '不应被信号终止');
  assert.strictEqual(res.status, 1, `期望退出码 1，实际 ${res.status}，stdout=${redact(res.stdout)} stderr=${redact(res.stderr)}`);
  assert.ok(typeof res.stdout === 'string' && typeof res.stderr === 'string', 'stdout 与 stderr 必须是字符串');
  const payload = JSON.parse(res.stdout.trim());
  assert.strictEqual(payload.status, 'error', '整体 stdout 必须是严格 JSON 且 status 为 error');
  assert.ok(payload.error && typeof payload.error.message === 'string' && payload.error.message, 'error.message 必须是非空字符串');
  assert.strictEqual(payload.error && payload.error.code, 'INVALID_ARGUMENTS', `error.code 必须是 INVALID_ARGUMENTS: ${redact(JSON.stringify(payload))}`);
  for (const text of [res.stdout, res.stderr]) {
    assert.ok(!text.includes(apiToken), '输出不得回显 ZHINEXUS_API_TOKEN');
    assert.ok(!text.includes(registryToken), '输出不得回显 ZHINEXUS_REGISTRY_TOKEN');
  }
  assert.deepStrictEqual(snapshot(projectDir), before.project, '工程目录快照（根目录及各条目 lstat 类型、路径、文件原字节，不含 atime）调用前后必须一致（零写入）');
  assert.deepStrictEqual(snapshot(backupRoot), before.backup, 'backup 根目录快照（根目录及各条目 lstat 类型）调用前后必须一致（零写入）');
  assert.ok(!fs.existsSync(path.join(evidenceDir, 'marker-ran')), '恶意 lifecycle 脚本不得执行（marker 文件必须不存在）');
  console.log(`t16-d 证据目录保留于: ${evidenceDir}`);
});
