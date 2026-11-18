// tests/acceptance/t16-d/installed-recovery-result.mjs
import assert from 'node:assert/strict';

export async function recover(ctx) {
  const { s, applied, planDigest, ref, doc } = ctx;
  const { code, json } = await s.cli(
    ['rollback', '--project', s.root, '--backup-id', ref.id, '--backup-sha256', ref.sha256, '--backup-root', s.backupRoot],
    `rollback-valid-${s.area}-${ref.id}`,
  );
  assert.equal(code, 0);
  assert.equal(json.schemaVersion, 1);
  assert.equal(json.operation, 'rollback');
  assert.equal(json.status, 'rolled-back');
  assert.equal(json.installState, 'reinstall-required');
  assert.deepEqual(json.issues, []);
  assert.deepEqual(json.preservedPaths, []);
  assert.deepEqual(json.unresolvedPaths, []);
  assert.equal(json.operationId, applied.operationId);
  assert.equal(json.operationId, ref.id);
  const norm = (p) => p.replaceAll('\\', '/');
  assert.equal(norm(json.projectRoot), norm(s.root));
  assert.equal(norm(json.projectRoot), norm(applied.projectRoot));
  assert.equal(json.planDigest, planDigest);
  assert.equal(json.planDigest, applied.planDigest);
  const changed = (f) => f.before.exists !== f.after.exists
    || (f.before.exists === true && f.after.exists === true && f.before.sha256 !== f.after.sha256);
  const restoredExpected = doc.files.filter(changed).map((f) => f.path).sort();
  const unchangedExpected = doc.files.filter((f) => !changed(f)).map((f) => f.path).sort();
  const restored = [...json.restoredPaths].sort();
  const unchanged = [...json.unchangedPaths].sort();
  assert.equal(new Set(restored).size, restored.length);
  assert.equal(new Set(unchanged).size, unchanged.length);
  assert.deepEqual(restored.filter((p) => unchanged.includes(p)), []);
  assert.deepEqual(restored, restoredExpected);
  assert.deepEqual(unchanged, unchangedExpected);
  assert.deepEqual([...restored, ...unchanged].sort(), doc.files.map((f) => f.path).sort());
  return json;
}
