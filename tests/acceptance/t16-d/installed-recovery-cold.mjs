// tests/acceptance/t16-d/installed-recovery-cold.mjs
import assert from 'node:assert/strict';

export async function checkWrongSHA(ctx) {
  const { s, sourceAfter, backupAfter, ref } = ctx;
  console.error(`[t16-d/cold] area=${s.area} ref=${ref.id}`);
  const beforeSource = await s.snapshot(s.root, { excludeRootNodeModules: true });
  const beforeBackup = await s.snapshot(s.backupRoot);
  assert.deepEqual(beforeSource, sourceAfter);
  assert.deepEqual(beforeBackup, backupAfter);
  const alt = '0123456789abcdef'.replace(ref.sha256[0], '')[0];
  const wrongSHA = alt + ref.sha256.slice(1);
  const { code, json } = await s.cli(
    ['rollback', '--project', s.root, '--backup-id', ref.id, '--backup-sha256', wrongSHA, '--backup-root', s.backupRoot],
    `cold-wrong-sha-${s.area}-${ref.id}`,
  );
  assert.equal(code, 1);
  assert.deepEqual(json, { status: 'error', error: { code: 'EXECUTION_FAILED', message: '受控应用执行失败' } });
  assert.deepEqual(await s.snapshot(s.root, { excludeRootNodeModules: true }), beforeSource);
  assert.deepEqual(await s.snapshot(s.backupRoot), beforeBackup);
}
