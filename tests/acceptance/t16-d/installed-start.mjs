// T16-D 独立黑盒：真实安装基线后执行 integrate apply，仅校验 apply 响应契约。
// 深度复核由 installed-report.mjs 独立完成；备份/回滚断言由其他 D 模块承担。
import assert from 'node:assert/strict';
import { prepare } from './installed-plan.mjs';
import { report } from './installed-report.mjs';

export async function start() {
  const ctx = await prepare();
  const { s, plan, planDigest } = ctx;
  const { code, json } = await s.cli(
    ['apply', '--project', s.root, '--plan', s.planFile, '--api-url', s.api, '--registry', s.registry, '--backup-root', s.backupRoot, '--allow-install', 'true'],
    'apply',
  );
  assert.equal(code, 0);
  assert.equal(json.schemaVersion, 1);
  assert.equal(json.operation, 'apply');
  assert.equal(json.status, 'applied');
  assert.equal(json.installState, 'succeeded');
  assert.deepEqual(json.issues, []);
  assert.equal(typeof json.operationId, 'string');
  assert.ok(json.operationId.length > 0);
  assert.equal(json.backupRef.id, json.operationId);
  assert.match(json.backupRef.sha256, /^[0-9a-f]{64}$/);
  assert.equal(String(json.projectRoot).split(String.fromCharCode(92)).join(String.fromCharCode(47)), String(s.root).split(String.fromCharCode(92)).join(String.fromCharCode(47)));
  assert.equal(json.planDigest, planDigest);
  const applied = json;
  const { sourceAfter, backupAfter } = await report({ s, plan, applied });
  return { s, plan, applied, planDigest, sourceAfter, backupAfter };
}
