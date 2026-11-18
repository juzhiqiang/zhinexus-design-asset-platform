import assert from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API_TOKEN = 'synthetic-api-token-t16d-5c9e3a';
const REGISTRY_TOKEN = 'synthetic-registry-token-t16d-8d2f4b';
const API_URL = 'https://api.t16-d-blackbox.invalid';
const REGISTRY_URL = 'https://registry.t16-d-blackbox.invalid';
const BACKUP_ID = '22222222-2222-4222-8222-222222222222';
const caseTable = [
  {
    name: 'apply 提供 plan 文件存在但 JSON 截断，必须以 INVALID_MATCH_PLAN 失败且零写入零回显',
    expectedCode: 'INVALID_MATCH_PLAN',
    plan: { content: '{"schemaVersion": "1", "operations": [{"op": ', mustThrow: true },
    buildArgs: (ctx) => ['integrate', 'apply', '--project', ctx.projectDir, '--plan', ctx.planPath, '--api-url', API_URL, '--registry', REGISTRY_URL, '--backup-root', ctx.backupRoot, '--allow-install', 'false'],
  },
  {
    name: 'apply 提供 plan 为有效 JSON 但不符合公开 IntegrationPlanV1，必须以 INVALID_MATCH_PLAN 失败且零写入零回显',
    expectedCode: 'INVALID_MATCH_PLAN',
    plan: { content: '{"schemaVersion": 1, "unexpectedSynthetic": true}', mustThrow: false, equals: { schemaVersion: 1, unexpectedSynthetic: true } },
    buildArgs: (ctx) => ['integrate', 'apply', '--project', ctx.projectDir, '--plan', ctx.planPath, '--api-url', API_URL, '--registry', REGISTRY_URL, '--backup-root', ctx.backupRoot, '--allow-install', 'false'],
  },
  {
    name: 'rollback 显式提供 project/backup-root/backup-id 仅缺 --backup-sha256，必须以 INVALID_ARGUMENTS 失败且零写入零回显',
    expectedCode: 'INVALID_ARGUMENTS',
    plan: null,
    buildArgs: (ctx) => ['integrate', 'rollback', '--project', ctx.projectDir, '--backup-id', BACKUP_ID, '--backup-root', ctx.backupRoot],
  },
];

const redact = (text) => String(text).split(API_TOKEN).join('<redacted>').split(REGISTRY_TOKEN).join('<redacted>');
const typeOf = (stat) => stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : `other:${(stat.mode & 0o170000).toString(8)}`;
const snapshot = (dir, prefix = '') => {
  const out = { [prefix ? `${prefix}/` : '/']: { type: typeOf(fs.lstatSync(dir)) } };
  for (const name of fs.readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const stat = fs.lstatSync(abs);
    if (stat.isFile()) out[rel] = { type: 'file', bytes: fs.readFileSync(abs) };
    else if (stat.isDirectory()) { out[rel] = { type: 'dir' }; Object.assign(out, snapshot(abs, rel)); }
    else out[rel] = { type: typeOf(stat) };
  }
  return out;
};
const writeMaliciousProject = (projectDir, markerArg) => {
  const malicious = (phase) => `node -e "require('fs').writeFileSync('${markerArg}','${phase}')"`;
  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 't16-d-malicious-project', version: '0.0.0', scripts: { preinstall: malicious('preinstall'), install: malicious('install'), postinstall: malicious('postinstall') } }, null, 2));
  const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
  assert.ok(pkg && pkg.name === 't16-d-malicious-project' && pkg.scripts && typeof pkg.scripts.postinstall === 'string' && pkg.scripts.postinstall.includes('writeFileSync'), '夹具 package.json 必须是合法 JSON 且恶意 lifecycle 脚本保留');
};

for (const spec of caseTable) {
  test(spec.name, () => {
    const entry = process.env.T16_D_CLI_ENTRY;
    assert.ok(typeof entry === 'string' && entry.length > 0 && fs.existsSync(entry), '环境变量 T16_D_CLI_ENTRY 必须指向真实 CLI 入口，缺失必须失败');
    const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 't16-d-cli-input-rejection-'));
    const projectDir = path.join(evidenceDir, 'project');
    const backupRoot = path.join(evidenceDir, 'backup-root');
    const planPath = path.join(evidenceDir, 'plan.json');
    const markerArg = path.join(evidenceDir, 'marker-ran').split(path.sep).join('/');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(backupRoot, { recursive: true });
    if (spec.plan) {
      fs.writeFileSync(planPath, spec.plan.content);
      assert.ok(fs.lstatSync(planPath).isFile() && !planPath.startsWith(projectDir + path.sep), 'plan 文件必须真实创建且位于目标工程之外');
      const planText = fs.readFileSync(planPath, 'utf8');
      if (spec.plan.mustThrow) assert.throws(() => JSON.parse(planText), SyntaxError, '坏 JSON 夹具必须确实无法被 JSON.parse 解析，避免无效夹具冒充字段验证');
      else assert.deepStrictEqual(JSON.parse(planText), spec.plan.equals, '有效 JSON 夹具必须按预期对象原样落盘');
    }
    writeMaliciousProject(projectDir, markerArg);
    const before = { project: snapshot(projectDir), backup: snapshot(backupRoot) };
    const res = spawnSync(process.execPath, [entry, ...spec.buildArgs({ projectDir, planPath, backupRoot })], { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, ZHINEXUS_API_TOKEN: API_TOKEN, ZHINEXUS_REGISTRY_TOKEN: REGISTRY_TOKEN }, shell: false, timeout: 10000, encoding: 'utf8' });
    assert.ok(!res.error, `spawn 不应失败: ${redact(res.error && res.error.message)}`);
    assert.strictEqual(res.signal, null, '不应被信号终止');
    assert.ok(typeof res.stdout === 'string' && typeof res.stderr === 'string', 'stdout 与 stderr 必须是字符串');
    assert.strictEqual(res.status, 1, `期望退出码 1，实际 ${res.status}，stdout=${redact(res.stdout)} stderr=${redact(res.stderr)}`);
    const payload = JSON.parse(res.stdout.trim());
    assert.strictEqual(payload.status, 'error', '整个 stdout 必须是严格单 JSON 且 status 为 error');
    assert.ok(payload.error && typeof payload.error.message === 'string' && payload.error.message, 'error.message 必须是非空字符串');
    assert.strictEqual(payload.error && payload.error.code, spec.expectedCode, `error.code 必须是 ${spec.expectedCode}: ${redact(JSON.stringify(payload))}`);
    for (const text of [res.stdout, res.stderr]) {
      assert.ok(!text.includes(API_TOKEN), '输出不得回显 ZHINEXUS_API_TOKEN');
      assert.ok(!text.includes(REGISTRY_TOKEN), '输出不得回显 ZHINEXUS_REGISTRY_TOKEN');
    }
    assert.deepStrictEqual(snapshot(projectDir), before.project, '工程目录快照（lstat 类型、路径、文件原字节）调用前后必须一致（零写入）');
    assert.deepStrictEqual(snapshot(backupRoot), before.backup, 'backup 根目录快照（lstat 类型）调用前后必须一致（零写入）');
    assert.ok(!fs.existsSync(path.join(evidenceDir, 'marker-ran')), '恶意 lifecycle 脚本不得执行（marker 文件必须不存在）');
    console.log(`t16-d 证据目录保留于: ${evidenceDir}`);
  });
}
