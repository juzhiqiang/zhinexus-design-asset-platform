import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import fsp from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VUE_PACKAGE_NAME = '@company/charts-vue';
const PACKAGE_VERSION = '0.0.12';
const VUE_FRAMEWORK_VERSION = '3.5.45';
const ECHARTS_VERSION = '6.1.0';
const API_TOKEN = 'synthetic-api-token-t16d';
const REGISTRY_TOKEN = 'synthetic-registry-token-t16d';
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const sha1 = (b) => createHash('sha1').update(b).digest('hex');
const sha512B64 = (b) => createHash('sha512').update(b).digest('base64');
const VUE_DEPENDENCIES = [
  { name: VUE_PACKAGE_NAME, version: PACKAGE_VERSION, tarballBytes: Buffer.from('synthetic tarball payload for @company/charts-vue@0.0.12\n') },
  { name: 'vue', version: VUE_FRAMEWORK_VERSION, tarballBytes: Buffer.from('synthetic tarball payload for vue@3.5.45\n') },
  { name: 'echarts', version: ECHARTS_VERSION, tarballBytes: Buffer.from('synthetic tarball payload for echarts@6.1.0\n') },
];
for (const dep of VUE_DEPENDENCIES) {
  const base = dep.name === VUE_PACKAGE_NAME ? `charts-vue-${dep.version}.tgz` : `${dep.name}-${dep.version}.tgz`;
  dep.tarballPath = `/${dep.name}/-/${base}`;
  dep.sha256Hex = sha256(dep.tarballBytes);
  dep.sha1Hex = sha1(dep.tarballBytes);
  dep.integrity = `sha512-${sha512B64(dep.tarballBytes)}`;
}
const VUE_SDK = VUE_DEPENDENCIES[0];
const TARBALL_PATH = `/${VUE_PACKAGE_NAME}/-/charts-vue-${PACKAGE_VERSION}.tgz`;
const TARBALL_SHA256 = VUE_SDK.sha256Hex;
function decodeRegistryPath(pathname) {
  return decodeURIComponent(pathname).toLowerCase();
}
function packumentPathMatches(requestPathname, packageName) {
  return decodeRegistryPath(requestPathname) === `/${packageName.toLowerCase()}`;
}
function sameTarballPath(requestPathname, expectedTarballPath) {
  return decodeRegistryPath(requestPathname) === decodeRegistryPath(expectedTarballPath);
}
function packumentFor(dep, origin) {
  return {
    name: dep.name,
    versions: {
      [dep.version]: {
        name: dep.name,
        version: dep.version,
        dist: { tarball: `${origin}${dep.tarballPath}`, integrity: dep.integrity, shasum: dep.sha1Hex },
      },
    },
  };
}

function vueTarget(overrides = {}) {
  return {
    variantReleaseId: '00000000-0000-4000-8000-000000000001', variantId: 'line-vue', componentId: 'line',
    framework: 'vue', packageName: VUE_PACKAGE_NAME, packageVersion: PACKAGE_VERSION, packageSha256: TARBALL_SHA256,
    exportName: 'LineChart', exportPath: './line',
    evidence: [
      { kind: 'api', path: 'api/line.json', sha256: 'c'.repeat(64) },
      { kind: 'docs', path: 'docs/line.md', sha256: 'd'.repeat(64) },
    ],
    compatibility: { status: 'verified', recordIds: ['synthetic-test-only'] },
    examples: [{ id: 'example', previewEntry: 'preview/index.html' }],
    styleExport: './style.css', readyMethod: 'whenRendered', notes: [], ...overrides,
  };
}
function componentApi() {
  return {
    schemaVersion: 1, componentId: 'line', framework: 'vue', exportName: 'LineChart', exportPath: './line',
    props: [{ name: 'data', type: 'ChartData', required: true }, { name: 'config', type: 'LineChartConfig', required: false }],
    events: [{ name: 'point-click', payload: 'ChartEvent' }],
    styleExport: './style.css', readyMethod: 'whenRendered', notes: [],
  };
}
function matchResponse(query) {
  // 查询逐字段回显，缺失字段显式报错，不得静默回退。
  const required = ['componentId', 'framework', 'packageName', 'packageVersion', 'frameworkVersion', 'echartsVersion'];
  for (const k of required) if (!query.get(k)) return { schemaVersion: 1, status: 'error', error: `missing query field: ${k}` };
  return {
    schemaVersion: 1,
    query: { componentId: query.get('componentId'), framework: query.get('framework'), packageName: query.get('packageName'), packageVersion: query.get('packageVersion'), frameworkVersion: query.get('frameworkVersion'), echartsVersion: query.get('echartsVersion') },
    status: 'matched', target: vueTarget(), api: componentApi(),
    exactDependencies: VUE_DEPENDENCIES.map((d) => ({ name: d.name, version: d.version })), gaps: [],
  };
}
function fullMatchPlan() {
  const element = {
    instanceId: 'node-1', designId: '设计/Line', status: 'mapped', target: vueTarget(),
    props: [
      { name: 'data', type: 'ChartData', required: true, source: 'sales' },
      { name: 'config', type: 'LineChartConfig', required: false },
    ],
    events: [{ name: 'point-click', payload: 'ChartEvent', handler: 'showDetail' }],
    layout: 'grid cell 1', gaps: [],
  };
  return {
    schemaVersion: 1, source: 'design-id', inputDigest: 'a'.repeat(64), ruleSetId: 'library', revision: 'draft-1',
    context: { framework: 'vue', frameworkVersion: VUE_FRAMEWORK_VERSION, echartsVersion: ECHARTS_VERSION, packageManager: 'pnpm', requirements: [] },
    elements: [element], exactDependencies: VUE_DEPENDENCIES.map((d) => ({ name: d.name, version: d.version })), gaps: [],
  };
}
// 精确等于 Bearer 的布尔断言，绝不把 token 值放进失败消息。
function bearerIsExactly(headers, expected) {
  const h = headers.authorization ?? '';
  return typeof h === 'string' && h === `Bearer ${expected}`;
}

test('T16-D single no-install success control: plan -> apply(no install) -> rollback', async () => {
  const cliEntry = process.env.T16_D_CLI_ENTRY;
  assert.ok(typeof cliEntry === 'string' && cliEntry.length > 0, 'T16_D_CLI_ENTRY must point to the real CLI entry');
  assert.notEqual(cliEntry, import.meta.filename, 'CLI entry must not point at this test file');

  let apiServer = null;
  let registryServer = null;
  let apiOrigin = '';
  let registryOrigin = '';
  let apiPort = 0;
  let registryPort = 0;
  const apiLog = [];
  const registryLog = [];
  const apiBad = [];
  const registryBad = [];
  const listenWith = (server, label) => new Promise((resolve, reject) => {
    const onError = (e) => reject(e);
    server.on('error', onError);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  apiServer = createServer((req, res) => {
    apiLog.push(req.url);
    const url = new URL(req.url, 'http://127.0.0.1');
    const oops = () => { apiBad.push(req.url); res.writeHead(404); res.end('{}'); return; };
    if (req.method !== 'GET' || url.pathname !== '/v1/matching/components') return oops();
    if (!bearerIsExactly(req.headers, API_TOKEN)) { apiBad.push(req.url); res.writeHead(401); res.end('{}'); return; }
    const body = matchResponse(url.searchParams);
    if (body.status === 'error') { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  registryServer = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const notAllowed = () => { registryBad.push(req.url); res.writeHead(404); res.end('{}'); return; };
    if (!bearerIsExactly(req.headers, REGISTRY_TOKEN)) { registryBad.push(req.url); res.writeHead(401); res.end('{}'); return; }
    registryLog.push(req.url);
    if (req.method !== 'GET') return notAllowed();
    for (const dep of VUE_DEPENDENCIES) {
      if (packumentPathMatches(url.pathname, dep.name)) {
        // packument 在当前独立实算：tarball origin 来自本 server 实际随机端口。
        const packument = packumentFor(dep, registryOrigin);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(packument));
        return;
      }
    }
    for (const dep of VUE_DEPENDENCIES) {
      if (sameTarballPath(url.pathname, dep.tarballPath)) {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.end(dep.tarballBytes);
        return;
      }
    }
    notAllowed();
  });

  try {
    await listenWith(apiServer, 'api');
    apiPort = apiServer.address().port;
    apiOrigin = `http://127.0.0.1:${apiPort}`;
    await listenWith(registryServer, 'registry');
    registryPort = registryServer.address().port;
    // registryOrigin 在拿到真实端口后才能用于 packument tarball。
    registryOrigin = `http://127.0.0.1:${registryPort}`;

    const base = await fs.mkdtemp(path.join(os.tmpdir(), 't16d-'));
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 't16d-project-'));
    const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 't16d-backup-'));
    const planDir = await fs.mkdtemp(path.join(os.tmpdir(), 't16d-plan-'));
    const matchFile = path.join(planDir, 'match.json');
    const planFile = path.join(planDir, 'plan.json');
    const projectPkg = path.join(projectRoot, 'package.json');
    const projectLock = path.join(projectRoot, 'pnpm-lock.yaml');

    const minimalEnv = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      ZHINEXUS_API_TOKEN: API_TOKEN,
      ZHINEXUS_REGISTRY_TOKEN: REGISTRY_TOKEN,
    };
    const runCli = (args) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cliEntry, ...args], { cwd: projectRoot, shell: false, windowsHide: true, env: minimalEnv });
      let out = '', err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('child CLI process timed out and was killed')); }, 120000);
      const cleanup = () => { clearTimeout(timer); };
      child.on('error', (e) => { cleanup(); reject(e); });
      child.on('close', (code) => { cleanup(); resolve({ code, out, err }); });
    });
    // 先做 token 布尔扫描（stdout+stderr），失败消息里绝不输出原始内容；第二个进程输出上限仅本进程生效。
    const cleanScan = (r, label) => {
      const leak = r.out.includes(API_TOKEN) || r.out.includes(REGISTRY_TOKEN) || r.err.includes(API_TOKEN) || r.err.includes(REGISTRY_TOKEN);
      const redact = (s) => s.split(API_TOKEN).join('<redacted-api-token>').split(REGISTRY_TOKEN).join('<redacted-registry-token>');
      assert.equal(leak, false, `${label}: token must not appear in any stdout/stderr output; redacted stdout: ${redact(r.out)}; redacted stderr: ${redact(r.err)}`);
    };
    const strictParse = (r, label) => {
      cleanScan(r, label);
      assert.equal(r.code, 0, `${label}: exit code must be 0 (err=${r.err.slice(0, 2000)})`);
      const text = r.out.trim();
      assert.ok(text.length > 0, `${label}: stdout must contain exactly one JSON value`);
      const value = JSON.parse(text, (k, v) => v); // JSON.parse 拒绝多余尾随非空白，天然拒绝多 JSON/混日志
      assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: result must be one JSON object`);
      return value;
    };

    await fs.writeFile(matchFile, JSON.stringify(fullMatchPlan(), null, 2), 'utf8');

    const pkgJson = {
      name: 'host-app', version: '1.0.0', private: true, packageManager: 'pnpm@12.18.0',
      dependencies: { vue: VUE_FRAMEWORK_VERSION, echarts: ECHARTS_VERSION, [VUE_PACKAGE_NAME]: PACKAGE_VERSION },
      scripts: {
        preinstall: `node -e "require('node:fs').writeFileSync('preinstall-marker-ran','ran')"`,
        postinstall: `node -e "require('node:fs').writeFileSync('postinstall-marker-ran','ran')"`,
      },
    };
    await fs.writeFile(projectPkg, JSON.stringify(pkgJson, null, 2) + '\n', 'utf8');
    const q = (n) => JSON.stringify(n);
    let lock = `lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n`;
    for (const d of VUE_DEPENDENCIES) {
      lock += `      ${q(d.name)}:\n        specifier: ${q(d.version)}\n        version: ${q(d.version)}\n`;
    }
    lock += `\npackages:\n`;
    for (const d of VUE_DEPENDENCIES) lock += `  ${q(`${d.name}@${d.version}`)}:\n    resolution: {integrity: ${q(d.integrity)}}\n`;
    lock += `\nsnapshots:\n`;
    for (const d of VUE_DEPENDENCIES) lock += `  ${q(`${d.name}@${d.version}`)}:\n    dependencies: {}\n`;
    await fs.writeFile(projectLock, lock, 'utf8');

    // 带 symlink/非普通文件/nlink 检查的 lstat 树快照，不跟链接读取；真正 async 并 await 完整遍历，目录集合包含 root ''，不依赖 mtime。
    const snapshot = async (root) => {
      const files = new Map();
      const dirs = [];
      const walk = async (rel) => {
        const abs = rel ? path.join(root, rel) : root;
        const st = await fs.lstat(abs);
        if (st.isSymbolicLink()) throw new Error(`unexpected symbolic link: ${rel}`);
        if (st.isDirectory()) {
          dirs.push(rel);
          for (const e of await fs.readdir(abs)) await walk(rel ? `${rel}/${e}` : e);
          return;
        }
        if (!st.isFile()) throw new Error(`unexpected non-regular entry: ${rel}`);
        if (st.nlink > 1) throw new Error(`unexpected multiply-linked entry: ${rel}`);
        const bytes = await fs.readFile(abs);
        files.set(rel, { bytes, size: st.size, sha256: sha256(bytes) });
      };
      await walk('');
      return { files, dirs: dirs.slice().sort() };
    };
    const projectSnapshot = async (label) => {
      const snap = await snapshot(projectRoot);
      assert.ok(snap.dirs.includes(''), `${label}: snapshot directory set must include the root ''`);
      return snap;
    };
    const before = await projectSnapshot('baseline');
    assert.ok(before.files.has('package.json') && before.files.has('pnpm-lock.yaml'), 'baseline must contain package.json and pnpm-lock.yaml');
    const originalPkgBytes = before.files.get('package.json').bytes;
    const originalLockBytes = before.files.get('pnpm-lock.yaml').bytes;

    // ---- plan ----
    const planResult = await runCli(['integrate', 'plan', '--project', projectRoot, '--match', matchFile, '--api-url', apiOrigin, '--registry', registryOrigin]);
    cleanScan(planResult, 'plan output');
    assert.equal(planResult.code, 0, 'plan exit code must be 0');
    await fs.writeFile(planFile, planResult.out, 'utf8');
    const planFileBytes = await fs.readFile(planFile);
    const savedPlan = JSON.parse(planFileBytes.toString('utf8'));
    const planJson = strictParse(planResult, 'plan stdout');
    assert.deepEqual(planJson, savedPlan);
    const canonical = (v) => {
      if (v === null || typeof v !== 'object') return JSON.stringify(v);
      if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
      return `{${Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
    };
    const planDigest = sha256(Buffer.from(canonical(savedPlan), 'utf8'));
    assert.equal(planJson.schemaVersion, 1, 'plan.schemaVersion must be 1');
    assert.equal(planJson.stage, 'plan', 'plan.stage must be plan');
    assert.equal(planJson.status, 'planned', 'plan.status must be planned');
    assert.equal(planJson.executionAuthorized, false, 'plan.executionAuthorized must be false');
    assert.ok(Array.isArray(planJson.changes) && planJson.changes.length === 1, 'plan must have exactly one change for the generated component file');
    const generatedChange = planJson.changes[0];
    assert.equal(generatedChange.kind, 'generated-component', 'plan change kind must be generated-component');
    assert.equal(generatedChange.framework, 'vue', 'plan change framework must be vue');
    assert.equal(generatedChange.instanceId, 'node-1', 'plan change instanceId must be node-1');
    assert.ok(typeof generatedChange.path === 'string' && generatedChange.path.length > 0, 'plan change path must be a non-empty string');
    const GENERATED_VUE_PATH = generatedChange.path.split(path.sep).join('/');
    const generatedAbs = path.join(projectRoot, GENERATED_VUE_PATH);
    const generatedParentChain = [];
    for (let cur = path.posix.dirname(GENERATED_VUE_PATH); cur && cur !== '.' && cur !== '/'; cur = path.posix.dirname(cur)) generatedParentChain.push(cur);

    // plan 阶段零写入：快照精确不变。
    const afterPlan = await projectSnapshot('after plan');
    assert.equal(afterPlan.files.size, before.files.size, 'plan must not create files');
    for (const [rel, snap] of before.files) {
      const now = afterPlan.files.get(rel);
      assert.ok(now && Buffer.compare(now.bytes, snap.bytes) === 0, `plan must not modify ${rel}`);
    }
    assert.deepEqual(afterPlan.dirs, before.dirs, 'plan must not create directories');

    // ---- D23：apply 前故意修改 package.json（仅追加 JSON 空白）----
    try {
      const pkgBytesBeforeEdit = await fs.readFile(projectPkg);
      assert.ok(pkgBytesBeforeEdit.equals(originalPkgBytes), 'D23: package.json on-disk bytes must equal baseline before intentional edit');
      const editedPkgBytes = Buffer.concat([originalPkgBytes, Buffer.from('\n', 'utf8')]);
      assert.notEqual(sha256(editedPkgBytes), sha256(originalPkgBytes), 'D23: appended whitespace must change package.json SHA-256');
      assert.deepEqual(JSON.parse(editedPkgBytes.toString('utf8')), JSON.parse(originalPkgBytes.toString('utf8')), 'D23: appended whitespace must not change parsed package.json');
      await fs.writeFile(projectPkg, editedPkgBytes);

      const afterEditProject = await projectSnapshot('after intentional edit');
      const afterEditBackup = await snapshot(backupRoot);
      const assertSameSnapshot = (label, expectedSnap, actualSnap) => {
        assert.deepEqual([...actualSnap.files.keys()].sort(), [...expectedSnap.files.keys()].sort(), `${label}: file key sets must match`);
        for (const rel of [...expectedSnap.files.keys()].sort()) {
          const exp = expectedSnap.files.get(rel);
          const act = actualSnap.files.get(rel);
          assert.ok(act.bytes.equals(exp.bytes), `${label}: bytes must be unchanged for ${rel}`);
          assert.equal(act.size, exp.size, `${label}: size must be unchanged for ${rel}`);
          assert.equal(act.sha256, exp.sha256, `${label}: sha256 must be unchanged for ${rel}`);
        }
        assert.deepEqual(actualSnap.dirs, expectedSnap.dirs, `${label}: directory sets must match`);
      };

      const applyResult = await runCli(['integrate', 'apply', '--project', projectRoot, '--plan', planFile, '--api-url', apiOrigin, '--registry', registryOrigin, '--backup-root', backupRoot, '--allow-install', 'false']);
      cleanScan(applyResult, 'apply (allow-install=false) output');
      assert.equal(applyResult.code, 2, 'D23: apply must exit 2 when project changed after plan');

      const blockedReport = JSON.parse(applyResult.out.trim());
      assert.ok(blockedReport !== null && typeof blockedReport === 'object' && !Array.isArray(blockedReport), 'D23: apply exit-2 stdout must be a single JSON object report, not null and not an array');
      assert.equal(blockedReport.schemaVersion, 1, 'D23: blocked report schemaVersion must be 1');
      assert.equal(blockedReport.operation, 'apply', 'D23: blocked report operation must be apply');
      assert.equal(blockedReport.status, 'blocked', 'D23: blocked report status must be blocked');
      assert.equal(blockedReport.installState, 'not-run', 'D23: blocked report installState must be not-run');
      const assertEmptyArray = (label, value) => {
        assert.ok(Array.isArray(value), `${label} must be an array, an empty object is not accepted`);
        assert.deepEqual(value, [], `${label} must be exactly []`);
      };
      assertEmptyArray('D23: blocked report changedFiles', blockedReport.changedFiles);
      assertEmptyArray('D23: blocked report beforeHashes', blockedReport.beforeHashes);
      assertEmptyArray('D23: blocked report afterHashes', blockedReport.afterHashes);
      assertEmptyArray('D23: blocked report installedVersions', blockedReport.installedVersions);
      const issuesValue = blockedReport.issues;
      assert.ok(Array.isArray(issuesValue) && issuesValue.length > 0, 'D23: blocked report issues must be a non-empty array');
      for (const issue of issuesValue) {
        assert.ok(issue !== null && typeof issue === 'object' && !Array.isArray(issue), 'D23: blocked report issues entries must be issue objects');
      }
      assert.ok(issuesValue.some((issue) => issue !== null && typeof issue === 'object' && !Array.isArray(issue) && issue.code === 'PROJECT_CHANGED'), 'D23: blocked report issues must contain an issue with code exactly PROJECT_CHANGED');

      const pkgAfterBlocked = await fs.readFile(projectPkg);
      assert.ok(pkgAfterBlocked.equals(editedPkgBytes), 'D23: blocked apply must leave intentionally edited package.json bytes untouched');
      const afterBlockedProject = await projectSnapshot('after blocked apply');
      const afterBlockedBackup = await snapshot(backupRoot);
      assertSameSnapshot('project after blocked apply', afterEditProject, afterBlockedProject);
      assertSameSnapshot('backup after blocked apply', afterEditBackup, afterBlockedBackup);
    } finally {
      await fs.writeFile(projectPkg, originalPkgBytes);
    }

    // ---- D26 无效 IntegrationPlan 守卫（逐字段毒化，零写入）----
    const PREINSTALL_MARKER = 'preinstall.marker';
    const POSTINSTALL_MARKER = 'postinstall.marker';
    const escapeAbs = path.resolve(projectRoot, '..', 't16d-escape.vue');
    const parseSingleJson = (out, label) => {
      let parsed;
      try {
        parsed = JSON.parse(out.trim());
      } catch (err) {
        assert.fail(`${label}: stdout must be exactly one JSON object, rejected mixed output: ${err.message}`);
      }
      assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed), `${label}: stdout must be one JSON object, arrays rejected`);
      return parsed;
    };
    const assertSnapshotUnchanged = (baseSnap, nowSnap, label) => {
      assert.deepEqual([...nowSnap.files.keys()].sort(), [...baseSnap.files.keys()].sort(), `${label}: file keys must be unchanged`);
      for (const [rel, snap] of baseSnap.files) {
        const now = nowSnap.files.get(rel);
        assert.ok(now, `${label}: snapshot must still contain ${rel}`);
        assert.equal(now.size, snap.size, `${label}: size of ${rel} must be unchanged`);
        assert.equal(now.sha256, snap.sha256, `${label}: sha256 of ${rel} must be unchanged`);
        assert.ok(Buffer.compare(now.bytes, snap.bytes) === 0, `${label}: bytes of ${rel} must be unchanged`);
      }
      assert.deepEqual(nowSnap.dirs, baseSnap.dirs, `${label}: directory keys must be unchanged`);
    };
    const assertInvalidPlanRejected = async (fixture, casePath, label) => {
      await fs.writeFile(casePath, JSON.stringify(fixture), 'utf8');
      const projBefore = await projectSnapshot(`${label} before`);
      const backupBefore = await snapshot(backupRoot);
      const result = await runCli(['integrate', 'apply', '--project', projectRoot, '--plan', casePath, '--api-url', apiOrigin, '--registry', registryOrigin, '--backup-root', backupRoot, '--allow-install', 'false']);
      cleanScan(result, `${label} output`);
      assert.equal(result.code, 1, `${label}: invalid IntegrationPlan must exit 1`);
      const parsed = parseSingleJson(result.out, `${label} stdout`);
      assert.equal(parsed.status, 'error', `${label}: stdout JSON status must be error`);
      assert.ok(parsed.error && typeof parsed.error === 'object' && !Array.isArray(parsed.error), `${label}: stdout JSON must carry an error object`);
      assert.equal(parsed.error.code, 'INVALID_MATCH_PLAN', `${label}: error.code must be INVALID_MATCH_PLAN`);
      assert.ok(typeof parsed.error.message === 'string' && parsed.error.message.length > 0, `${label}: error.message must be a non-empty string`);
      const projAfter = await projectSnapshot(`${label} after`);
      assertSnapshotUnchanged(projBefore, projAfter, `${label} project`);
      const backupAfter = await snapshot(backupRoot);
      assertSnapshotUnchanged(backupBefore, backupAfter, `${label} backup`);
      assert.ok(!projAfter.files.has(PREINSTALL_MARKER) && !backupAfter.files.has(PREINSTALL_MARKER), `${label}: preinstall marker must be absent`);
      assert.ok(!projAfter.files.has(POSTINSTALL_MARKER) && !backupAfter.files.has(POSTINSTALL_MARKER), `${label}: postinstall marker must be absent`);
      await assert.rejects(fs.lstat(escapeAbs), (err) => err && err.code === 'ENOENT', `${label}: outside escape file must not exist`);
      const planBytesAfter = await fs.readFile(planFile);
      assert.ok(Buffer.compare(planBytesAfter, planFileBytes) === 0, `${label}: original plan file bytes must be unchanged`);
    };

    // case 1：未知根字段。
    const unknownRootPlan = structuredClone(savedPlan);
    assert.deepEqual(unknownRootPlan, savedPlan, 'case1: clone must equal savedPlan before mutation');
    unknownRootPlan.t16dUnknownRootField = 'poison';
    assert.ok(Object.prototype.hasOwnProperty.call(unknownRootPlan, 't16dUnknownRootField') && !Object.prototype.hasOwnProperty.call(savedPlan, 't16dUnknownRootField'), 'case1: fixture must add the unknown root field');
    const unknownRootBase = structuredClone(unknownRootPlan);
    delete unknownRootBase.t16dUnknownRootField;
    assert.deepEqual(unknownRootBase, savedPlan, 'case1: fixture must differ from savedPlan only in the unknown root field');
    await assertInvalidPlanRejected(unknownRootPlan, path.join(planDir, 't16d-invalid-plan-unknown-root-field.json'), 'invalid-plan/unknown-root-field');

    // case 2：根 allowedPaths 含 ../t16d-escape.vue。
    assert.ok(Array.isArray(savedPlan.allowedPaths), 'case2: savedPlan.allowedPaths must be a root string array');
    const savedAllowedPaths = structuredClone(savedPlan.allowedPaths);
    assert.deepEqual(savedAllowedPaths, savedPlan.allowedPaths, 'case2: savedAllowedPaths must be an exact clone');
    const escapePlan = structuredClone(savedPlan);
    assert.ok(!escapePlan.allowedPaths.includes('../t16d-escape.vue'), 'case2: baseline allowedPaths must not contain the escape entry');
    escapePlan.allowedPaths = [...escapePlan.allowedPaths, '../t16d-escape.vue'];
    assert.ok(escapePlan.allowedPaths.includes('../t16d-escape.vue'), 'case2: poisoned allowedPaths must contain the escape entry');
    const escapeBase = structuredClone(escapePlan);
    escapeBase.allowedPaths = savedAllowedPaths;
    assert.deepEqual(escapeBase, savedPlan, 'case2: fixture must differ from savedPlan only in allowedPaths');
    await assertInvalidPlanRejected(escapePlan, path.join(planDir, 't16d-invalid-plan-allowed-paths-escape.json'), 'invalid-plan/allowed-paths-escape');

    // case 3：根 allowedPaths 追加 GENERATED_VUE_PATH 的大小写别名（NFC+小写规范化后重复）。
    const duplicatePlan = structuredClone(savedPlan);
    const caseAlias = GENERATED_VUE_PATH.toUpperCase();
    assert.notEqual(caseAlias, GENERATED_VUE_PATH, 'case3: alias must be case-different from the generated vue path');
    assert.equal(caseAlias.normalize('NFC').toLowerCase(), GENERATED_VUE_PATH.normalize('NFC').toLowerCase(), 'case3: alias must be NFC and lowercase equal to the generated vue path');
    assert.ok(savedPlan.allowedPaths.includes(GENERATED_VUE_PATH), 'case3: baseline allowedPaths must contain the generated vue path');
    assert.ok(!savedPlan.allowedPaths.includes(caseAlias), 'case3: baseline allowedPaths must not contain the alias');
    duplicatePlan.allowedPaths = [...duplicatePlan.allowedPaths, caseAlias];
    const normalizedKey = (p) => p.normalize('NFC').toLowerCase();
    assert.equal(duplicatePlan.allowedPaths.filter((p) => normalizedKey(p) === normalizedKey(GENERATED_VUE_PATH)).length, 2, 'case3: normalized allowedPaths count for the generated path must be two');
    const duplicateBase = structuredClone(duplicatePlan);
    duplicateBase.allowedPaths = savedAllowedPaths;
    assert.deepEqual(duplicateBase, savedPlan, 'case3: fixture must differ from savedPlan only in allowedPaths');
    await assertInvalidPlanRejected(duplicatePlan, path.join(planDir, 't16d-invalid-plan-allowed-paths-duplicate.json'), 'invalid-plan/allowed-paths-duplicate');

    // case 4：根 commands 追加未授权 pnpm 安装命令（apply 侧 allow-install false）。
    const commandPlan = structuredClone(savedPlan);
    assert.ok(Array.isArray(commandPlan.commands), 'case4: baseline commands must be a root IntegrationCommand array');
    const savedCommands = structuredClone(commandPlan.commands);
    assert.deepEqual(savedCommands, commandPlan.commands, 'case4: savedCommands must be an exact clone of baseline commands');
    commandPlan.commands = [...commandPlan.commands, { executable: 'pnpm', purpose: 'install', cwd: '.', args: ['install', '--ignore-scripts', '--unsafe-extra-argument'] }];
    const addedCommand = commandPlan.commands[commandPlan.commands.length - 1];
    assert.equal(addedCommand.executable, 'pnpm', 'case4: added command executable must be literal pnpm, not the inspected node binary');
    assert.equal(addedCommand.purpose, 'install', 'case4: added command purpose must be install');
    assert.equal(addedCommand.cwd, '.', 'case4: added command cwd must be .');
    assert.deepEqual(addedCommand.args, ['install', '--ignore-scripts', '--unsafe-extra-argument'], 'case4: added command args must carry the unsafe extra argument');
    const commandBase = structuredClone(commandPlan);
    commandBase.commands = savedCommands;
    assert.deepEqual(commandBase, savedPlan, 'case4: fixture must differ from savedPlan only in commands');
    await assertInvalidPlanRejected(commandPlan, path.join(planDir, 't16d-invalid-plan-unauthorized-install-command.json'), 'invalid-plan/unauthorized-install-command');

    // ---- apply（不加装）----
    const applyResult = await runCli(['integrate', 'apply', '--project', projectRoot, '--plan', planFile, '--api-url', apiOrigin, '--registry', registryOrigin, '--backup-root', backupRoot, '--allow-install', 'false']);
    const applyJson = strictParse(applyResult, 'apply stdout');
    assert.equal(applyJson.schemaVersion, 1, 'apply.schemaVersion must be 1');
    assert.equal(applyJson.operation, 'apply', 'apply.operation must be apply');
    assert.equal(applyJson.status, 'applied', 'apply.status must be applied');
    assert.equal(applyJson.installState, 'not-run', 'apply.installState must be not-run');
    assert.equal(typeof applyJson.operationId, 'string', 'apply.operationId must be a string');
    assert.ok(applyJson.operationId.length > 0, 'apply.operationId must be non-empty');
    assert.ok(applyJson.backupRef && typeof applyJson.backupRef.id === 'string' && applyJson.backupRef.id.length > 0, 'backupRef.id required');
    assert.equal(applyJson.backupRef.id, applyJson.operationId, 'backupRef.id must equal apply.operationId');
    assert.equal(typeof applyJson.backupRef.sha256, 'string', 'backupRef.sha256 must be a string');
    assert.ok(/^[0-9a-f]{64}$/.test(applyJson.backupRef.sha256), 'backupRef.sha256 must be a sha256 hex digest');
    assert.equal(applyJson.projectRoot, projectRoot.split(path.sep).join('/'), 'apply.projectRoot must be the real project root with forward slashes');
    assert.equal(applyJson.planDigest, planDigest, 'apply.planDigest must be the real plan file bytes sha256');
    assert.deepEqual(applyJson.changedFiles, [GENERATED_VUE_PATH], 'apply.changedFiles must be exactly the generated path');
    assert.deepEqual(applyJson.installedVersions, [], 'apply.installedVersions must be exactly [] because --allow-install false means installState=not-run and no install process ran; real installed-and-verified exact direct dependencies cannot be copied from the plan');
    assert.deepEqual(applyJson.issues, [], 'apply.issues must be empty');
    const st0 = await fs.lstat(generatedAbs);
    assert.ok(st0.isFile(), 'apply must generate the vue component file');
    const generatedBytes = await fs.readFile(generatedAbs);
    const generatedText = generatedBytes.toString('utf8');
    assert.ok(generatedText.includes(VUE_PACKAGE_NAME), 'generated file must import the SDK package');
    assert.ok(generatedText.includes('sales'), 'generated file must bind source=sales');
    assert.ok(generatedText.includes('showDetail'), 'generated file must wire handler=showDetail');
    const GENERATED_SHA = sha256(generatedBytes);
    assert.deepEqual(applyJson.beforeHashes, [
      { path: GENERATED_VUE_PATH, exists: false },
    ]);
    assert.deepEqual(applyJson.afterHashes, [
      { path: GENERATED_VUE_PATH, exists: true, sha256: GENERATED_SHA },
    ]);

    // apply 后仅允许计划 generated 路径新增；其它原文件/目录精确不变。
    const afterApply = await projectSnapshot('after apply');
    const expectedNew = new Set([GENERATED_VUE_PATH]);
    for (const [rel, snap] of before.files) {
      const now = afterApply.files.get(rel);
      assert.ok(now && Buffer.compare(now.bytes, snap.bytes) === 0, `original file ${rel} bytes must be unchanged after apply`);
    }
    for (const rel of afterApply.files.keys()) {
      if (before.files.has(rel)) continue;
      assert.ok(expectedNew.has(rel), `only planned generated paths may be created after apply, got: ${rel}`);
    }
    const expectedNewDirs = new Set(generatedParentChain);
    for (const rel of afterApply.dirs) {
      if (before.dirs.includes(rel)) continue;
      assert.ok(expectedNewDirs.has(rel), `unexpected new directory after apply: ${rel}`);
    }

    // ---- backup 校验：唯一 sha256 匹配文件即版本文档 JSON ----
    const backupEntries = [];
    {
      const walk = async (rel) => {
        const abs = rel ? path.join(backupRoot, rel) : backupRoot;
        const st = await fs.lstat(abs);
        if (st.isSymbolicLink()) throw new Error(`backup must not contain symlinks: ${rel}`);
        if (st.isDirectory()) { for (const e of await fs.readdir(abs)) await walk(rel ? `${rel}/${e}` : e); return; }
        if (!st.isFile()) throw new Error(`backup entry is not a regular file: ${rel}`);
        if (st.nlink > 1) throw new Error(`backup entry multiply-linked: ${rel}`);
        backupEntries.push({ rel, bytes: await fs.readFile(abs) });
      };
      await walk('');
    }
    assert.ok(backupEntries.length > 0, 'backup root must contain real files');
    const matching = backupEntries.filter((e) => e.rel.endsWith('.json') && sha256(e.bytes) === applyJson.backupRef.sha256);
    assert.equal(matching.length, 1, `exactly one backup file must match backupRef.sha256 (raw candidate count checked via boolean, not regex includes)`);
    const backupDocBytes = matching[0].bytes;
    const backupDoc = JSON.parse(backupDocBytes.toString('utf8'));
    assert.ok(backupDoc && typeof backupDoc === 'object' && !Array.isArray(backupDoc), 'backup document must be a JSON object');
    assert.equal(backupDoc.schemaVersion, 1, 'backup document schemaVersion must be 1');
    assert.equal(backupDoc.operationId, applyJson.operationId, 'backup.operationId must equal apply.operationId');
    assert.equal(backupDoc.projectRoot, projectRoot.split(path.sep).join('/'), 'backup.projectRoot must be the real project root with forward slashes');
    assert.equal(backupDoc.planDigest, planDigest, 'backup.planDigest must digest the real plan file');
    assert.equal(backupDoc.installPlanned, false, 'backup.installPlanned must be false');
    assert.equal(backupDoc.installStarted, false, 'backup.installStarted must be false');
    assert.deepEqual(Object.keys(backupDoc).sort(), ['files', 'installPlanned', 'installStarted', 'operationId', 'planDigest', 'projectRoot', 'schemaVersion'], 'backup document must contain exactly the public IntegrationBackupV1 fields');
    assert.ok(Array.isArray(backupDoc.files), 'backup.files must be an array');
    assert.equal(backupDoc.files.length, planJson.changes.length, 'backup.files must exactly cover plan.changes');
    {
      const want = planJson.changes.map((c) => c.path).sort();
      const got = backupDoc.files.map((f) => f.path).sort();
      assert.deepEqual(got, want, 'backup.files paths must exactly equal plan.changes paths');
    }
    for (const item of backupDoc.files) {
      assert.ok(item && typeof item === 'object', 'backup item must be an object');
      assert.equal(item.path, GENERATED_VUE_PATH, 'backup item path must be the generated vue path');
      const b = item.before;
      assert.ok(b && typeof b === 'object', 'backup item.before must exist');
      assert.equal(b.path, item.path, 'backup item.before.path must equal the item path');
      assert.equal(b.exists, false, 'generated file before snapshot must record non-existence');
      assert.ok(!('originalBase64' in item), 'new generated backup item must not carry originalBase64');
      assert.ok(!('originalBase64' in b), 'generated before snapshot must not carry originalBase64');
      assert.ok(!('sha256' in b) || b.sha256 === undefined, 'generated before snapshot must not fabricate a sha256');
      const a = item.after;
      assert.ok(a && typeof a === 'object', 'backup item.after must exist');
      assert.equal(a.path, item.path, 'backup item.after.path must equal the item path');
      assert.equal(a.exists, true, 'generated after snapshot must record existence');
      assert.equal(a.sha256, GENERATED_SHA, 'generated after snapshot sha256 must equal the real generated bytes digest');
      assert.equal(Object.keys(a).filter((k) => a[k] === undefined).length, 0, 'generated after snapshot must not carry explicit undefined values');
    }

    // 两个 lifecycle marker 始终不存在（lstat 证明，不加装绝不触发）。
    assert.throws(() => fsp.lstatSync(path.join(projectRoot, 'preinstall-marker-ran')), /ENOENT/, 'preinstall marker must not exist after apply');
    assert.throws(() => fsp.lstatSync(path.join(projectRoot, 'postinstall-marker-ran')), /ENOENT/, 'postinstall marker must not exist after apply');

    // ---- rollback ----
    const rollbackResult = await runCli(['integrate', 'rollback', '--project', projectRoot, '--backup-id', applyJson.backupRef.id, '--backup-sha256', applyJson.backupRef.sha256, '--backup-root', backupRoot]);
    const rollbackJson = strictParse(rollbackResult, 'rollback stdout');
    assert.equal(rollbackJson.schemaVersion, 1, 'rollback.schemaVersion must be 1');
    assert.equal(rollbackJson.operation, 'rollback', 'rollback.operation must be rollback');
    assert.equal(rollbackJson.operationId, applyJson.operationId, 'rollback.operationId must equal apply.operationId');
    assert.equal(rollbackJson.projectRoot, projectRoot.split(path.sep).join('/'), 'rollback.projectRoot must equal the apply projectRoot');
    assert.equal(rollbackJson.planDigest, planDigest, 'rollback.planDigest must equal the apply planDigest');
    assert.equal(rollbackJson.status, 'rolled-back', 'rollback.status must be rolled-back');
    assert.equal(rollbackJson.installState, 'not-run', 'rollback.installState must be not-run');
    assert.ok(Array.isArray(rollbackJson.issues), 'rollback.issues must be an array');
    assert.deepEqual(rollbackJson.issues, [], 'rollback.issues must be empty');

    {
      const groups = ['restoredPaths', 'unchangedPaths', 'preservedPaths', 'unresolvedPaths'];
      for (const g of groups) assert.ok(Array.isArray(rollbackJson[g]), `rollback.${g} must be an array`);
      assert.deepEqual(rollbackJson.restoredPaths.sort(), [GENERATED_VUE_PATH], 'restoredPaths must be exactly the generated paths');
      assert.deepEqual(rollbackJson.unchangedPaths, [], 'unchangedPaths must be empty');
      assert.deepEqual(rollbackJson.preservedPaths, [], 'preservedPaths must be empty');
      assert.deepEqual(rollbackJson.unresolvedPaths, [], 'unresolvedPaths must be empty');
      // 四组严格互斥且完整覆盖真实 backup.files 候选（数组相等判定，非 JSON.includes 正则）。
      const all = new Set(backupDoc.files.map((f) => f.path));
      const claimed = new Set();
      for (const g of groups) {
        for (const p of rollbackJson[g]) {
          assert.ok(!claimed.has(p), `rollback grouping must be mutually exclusive, duplicate path: ${p}`);
          claimed.add(p);
        }
      }
      assert.deepEqual([...claimed].sort(), [...all].sort(), 'rollback groups must exactly cover backup.files candidates');
      // 无 required package.json / pnpm-lock.yaml 候选被捏造。
      assert.ok(!claimed.has('package.json') && !claimed.has('pnpm-lock.yaml'), 'rollback must not fabricate package/lock candidates');
    }

    // rollback 后：原文件字节完全相同；除允许的空目录链外无任何多余文件/目录。
    const afterRollback = await projectSnapshot('after rollback');
    assert.equal(afterRollback.files.size, before.files.size, 'rollback must remove all generated files and leave only originals');
    for (const [rel, snap] of before.files) {
      const now = afterRollback.files.get(rel);
      assert.ok(now && Buffer.compare(now.bytes, snap.bytes) === 0, `original file ${rel} bytes must be fully identical after rollback`);
    }
    for (const rel of afterRollback.files.keys()) {
      assert.ok(before.files.has(rel), `rollback must not leave any file outside the original snapshot, got: ${rel}`);
    }
    // 目录集合：root '' 与原 dirs 精确保留；额外 dirs 仅允许 generated 父链的任意子集。
    assert.ok(afterRollback.dirs.includes(''), 'rollback snapshot directory set must include the root');
    for (const d of before.dirs) assert.ok(afterRollback.dirs.includes(d), `rollback must preserve original directory ${d}`);
    for (const d of afterRollback.dirs) {
      if (before.dirs.includes(d)) continue;
      assert.ok(generatedParentChain.includes(d), `rollback may only leave generated parent chain directories, got: ${d}`);
    }
    // 父目录不能要求 readdir 全空（合法链含下一级）；仅 kept 链中最末一级若存在必须为空。
    const deepestKept = generatedParentChain.filter((d) => afterRollback.dirs.includes(d)).sort((x, y) => y.length - x.length)[0];
    if (deepestKept !== undefined) {
      const entries = await fs.readdir(path.join(projectRoot, deepestKept));
      assert.deepEqual(entries, [], `deepest kept directory ${deepestKept} must be empty after rollback`);
    }
    // 逐项目录确认：kept 目录的下一级仅允许原 entry 或 generated 链目录。
    for (const d of afterRollback.dirs) {
      const keptChildren = afterRollback.dirs.filter((other) => d === '' ? !other.includes('/') : other.startsWith(`${d}/`) && !other.slice(d.length + 1).includes('/'));
      for (const child of keptChildren) {
        assert.ok(before.dirs.includes(child) || generatedParentChain.includes(child), `kept directory ${d} may only contain original or generated-chain child directories, found ${child}`);
      }
    }
    assert.throws(() => fsp.lstatSync(generatedAbs), /ENOENT/, 'generated file must be absent after rollback');
    assert.ok(await fs.lstat(projectPkg).then((s) => s.isFile(), () => false), `package.json must still exist after rollback`);
    assert.throws(() => fsp.lstatSync(path.join(projectRoot, 'preinstall-marker-ran')), /ENOENT/, 'preinstall marker must remain absent after rollback');
    assert.throws(() => fsp.lstatSync(path.join(projectRoot, 'postinstall-marker-ran')), /ENOENT/, 'postinstall marker must remain absent after rollback');

    // ---- D20 补充：apply 后用户手工修改生成文件，回滚必须保留用户修改并要求人工恢复 ----
    // 先做一次全新真实 apply（不加装）成功控制：从首次回滚后的干净基线重新生成并创建新备份。
    const userApplyResult = await runCli(['integrate', 'apply', '--project', projectRoot, '--plan', planFile, '--api-url', apiOrigin, '--registry', registryOrigin, '--backup-root', backupRoot, '--allow-install', 'false']);
    const userApplyJson = strictParse(userApplyResult, 'apply#2 stdout');
    assert.equal(userApplyJson.schemaVersion, 1, 'apply#2.schemaVersion must be 1');
    assert.equal(userApplyJson.operation, 'apply', 'apply#2.operation must be apply');
    assert.equal(userApplyJson.status, 'applied', 'apply#2.status must be applied');
    assert.equal(userApplyJson.installState, 'not-run', 'apply#2.installState must be not-run');
    assert.equal(userApplyJson.planDigest, planDigest, 'apply#2.planDigest must be the real plan file bytes sha256');
    assert.deepEqual(userApplyJson.changedFiles, [GENERATED_VUE_PATH], 'apply#2.changedFiles must be exactly the generated path');
    assert.deepEqual(userApplyJson.installedVersions, [], 'apply#2.installedVersions must be exactly [] because --allow-install false');
    assert.deepEqual(userApplyJson.issues, [], 'apply#2.issues must be empty');
    assert.ok(userApplyJson.operationId && typeof userApplyJson.operationId === 'string' && userApplyJson.operationId.length > 0, 'apply#2.operationId must be a non-empty string');
    assert.notEqual(userApplyJson.operationId, applyJson.operationId, 'apply#2 must create a fresh backup with a new operationId, not reuse the first apply');
    assert.ok(userApplyJson.backupRef && typeof userApplyJson.backupRef.id === 'string' && userApplyJson.backupRef.id.length > 0, 'apply#2.backupRef.id required');
    assert.equal(userApplyJson.backupRef.id, userApplyJson.operationId, 'apply#2.backupRef.id must equal apply#2.operationId');
    assert.ok(/^[0-9a-f]{64}$/.test(userApplyJson.backupRef.sha256), 'apply#2.backupRef.sha256 must be a sha256 hex digest');
    assert.deepEqual(userApplyJson.beforeHashes, [{ path: GENERATED_VUE_PATH, exists: false }], 'apply#2.beforeHashes must record the clean baseline (generated file absent after the first successful rollback)');
    const stGen2 = await fs.lstat(generatedAbs);
    assert.ok(stGen2.isFile(), 'apply#2 must regenerate the vue component file as a regular file');
    const generated2Bytes = await fs.readFile(generatedAbs);
    assert.deepEqual(userApplyJson.afterHashes, [{ path: GENERATED_VUE_PATH, exists: true, sha256: sha256(generated2Bytes) }], 'apply#2.afterHashes must match the real regenerated file bytes');

    // 写入显式用户编辑字节（与备份记录必然不同的本地手工修改）。
    const userEditBytes = Buffer.from(
      '// 用户本地手工修改（D20 补充用例）：回滚必须保留本文件且不得覆盖。\n' +
      `// local user edit on ${GENERATED_VUE_PATH}\n` +
      'export const userLocalEdit = true;\n',
      'utf8',
    );
    assert.ok(!generated2Bytes.equals(userEditBytes), 'user edit bytes must differ from the apply-generated bytes to represent a real user modification');
    await fs.writeFile(generatedAbs, userEditBytes, 'utf8');

    // 快照完整项目树与备份树，然后用新真实 backupRef 在独立子进程中回滚。
    const projectSnapBeforeUserRollback = await projectSnapshot('user-edit rollback before');
    const backupSnapBeforeUserRollback = await snapshot(backupRoot);
    const userRollbackResult = await runCli(['integrate', 'rollback', '--project', projectRoot, '--backup-id', userApplyJson.backupRef.id, '--backup-sha256', userApplyJson.backupRef.sha256, '--backup-root', backupRoot]);
    // strictParse 仅接受 exit0，本处必须 exit2：先 cleanScan，再手动解析 r.out.trim 为单一 JSON 对象。
    cleanScan(userRollbackResult, 'rollback#2 stdout');
    assert.equal(userRollbackResult.code, 2, 'rollback#2: user-edited generated file must make rollback exit 2 (recovery-required), not 0');
    const userRollbackText = userRollbackResult.out.trim();
    assert.ok(userRollbackText.length > 0, 'rollback#2: stdout must contain exactly one JSON value');
    const userRollbackJson = JSON.parse(userRollbackText, (k, v) => v);
    assert.ok(userRollbackJson !== null && typeof userRollbackJson === 'object' && !Array.isArray(userRollbackJson), 'rollback#2: result must be one JSON object');
    assert.equal(userRollbackJson.schemaVersion, 1, 'rollback#2.schemaVersion must be 1');
    assert.equal(userRollbackJson.operation, 'rollback', 'rollback#2.operation must be rollback');
    assert.equal(userRollbackJson.operationId, userApplyJson.operationId, 'rollback#2.operationId must equal apply#2.operationId (same backup identity)');
    assert.equal(userRollbackJson.projectRoot, projectRoot.split(path.sep).join('/'), 'rollback#2.projectRoot must equal the apply projectRoot');
    assert.equal(userRollbackJson.planDigest, planDigest, 'rollback#2.planDigest must equal the apply planDigest');
    assert.equal(userRollbackJson.status, 'recovery-required', 'rollback#2.status must be recovery-required');
    assert.equal(userRollbackJson.installState, 'not-run', 'rollback#2.installState must be not-run');
    for (const g of ['restoredPaths', 'unchangedPaths', 'preservedPaths', 'unresolvedPaths']) {
      assert.ok(Array.isArray(userRollbackJson[g]), `rollback#2.${g} must be an array`);
    }
    assert.deepEqual(userRollbackJson.restoredPaths, [], 'rollback#2.restoredPaths must be empty: the user-edited file must not be restored or overwritten');
    assert.deepEqual(userRollbackJson.unchangedPaths, [], 'rollback#2.unchangedPaths must be empty: current bytes differ from the backup record');
    assert.deepEqual(userRollbackJson.preservedPaths, [GENERATED_VUE_PATH], 'rollback#2.preservedPaths must be exactly the generated path');
    assert.deepEqual(userRollbackJson.unresolvedPaths, [], 'rollback#2.unresolvedPaths must be empty');
    assert.ok(Array.isArray(userRollbackJson.issues), 'rollback#2.issues must be an array');
    assert.equal(userRollbackJson.issues.length, 1, 'rollback#2.issues must contain exactly one entry');
    const userIssue = userRollbackJson.issues[0];
    assert.ok(userIssue !== null && typeof userIssue === 'object' && !Array.isArray(userIssue), 'rollback#2.issues[0] must be an object');
    assert.equal(userIssue.path, GENERATED_VUE_PATH, 'rollback#2.issues[0].path must be the generated path');
    assert.equal(userIssue.code ?? userIssue.reason, 'USER_EDITED', 'rollback#2.issues[0] must be USER_EDITED');

    // recovery-required 不得改动项目树与备份树的任何字节或目录；用户字节原样保留。
    const projectSnapAfterUserRollback = await projectSnapshot('user-edit rollback after');
    const backupSnapAfterUserRollback = await snapshot(backupRoot);
    const assertTreeUnchanged = (before, after, label) => {
      assert.deepEqual(after.dirs, before.dirs, `${label}: directory set must be identical`);
      assert.deepEqual([...after.files.keys()].sort(), [...before.files.keys()].sort(), `${label}: file set must be identical`);
      for (const [rel, info] of before.files) {
        const cur = after.files.get(rel);
        assert.ok(cur !== undefined, `${label}: file must still exist: ${rel}`);
        assert.equal(cur.size, info.size, `${label}: file size must be unchanged: ${rel}`);
        assert.equal(cur.sha256, info.sha256, `${label}: file bytes must be unchanged (sha256): ${rel}`);
      }
    };
    assertTreeUnchanged(projectSnapBeforeUserRollback, projectSnapAfterUserRollback, 'project tree after user-edit rollback');
    assertTreeUnchanged(backupSnapBeforeUserRollback, backupSnapAfterUserRollback, 'backup tree after user-edit rollback');
    const retainedBytes = await fs.readFile(generatedAbs);
    assert.ok(retainedBytes.equals(userEditBytes), 'rollback#2 must retain the exact user-edited bytes at the generated path');
    // 不清理已编辑的项目树，用户编辑之后也不再重新 apply；后续既有服务端请求断言与 finally 保持原样。

    // 请求与凭据覆盖：全为同一 origin/包路径，全部精确 synthetic Bearer，错误请求计数必须为零。
    assert.ok(apiLog.length > 0, 'API server must have received requests');
    assert.ok(registryLog.length > 0, 'registry server must have received requests');
    assert.deepEqual(apiBad, [], 'API server must not have received any disallowed requests');
    assert.deepEqual(registryBad, [], 'registry server must not have received any disallowed or wrong-scope requests');
    for (const u of registryLog) {
      const pathname = new URL(u, registryOrigin).pathname;
      const decoded = decodeURIComponent(pathname).toLowerCase();
      const allowed = VUE_DEPENDENCIES.some((dep) => decoded === `/${dep.name.toLowerCase()}` || decoded === dep.tarballPath.toLowerCase());
      assert.ok(allowed, `registry requests must only target VUE_DEPENDENCIES packument/tarball paths, got: ${u}`);
    }

    // 本控制唯一交付语义：无安装成功。不宣称任何其它覆盖；既有文件原字节恢复由本测试不覆盖（后续范围）。
    assert.ok(typeof planDigest === 'string' && planDigest.length === 64, 'plan digest chain must remain sanity-verifiable');
  } finally {
    // finally 覆盖所有 listen / 临时准备步骤；关闭部分启动的 server；临时文件一律保留不删除；无重复 request listener（每个 server 仅创建时挂一次）。
    if (apiServer) { apiServer.closeAllConnections?.(); if (apiServer.listening) await new Promise((r) => apiServer.close(r)); }
    if (registryServer) { registryServer.closeAllConnections?.(); if (registryServer.listening) await new Promise((r) => registryServer.close(r)); }
  }
});
