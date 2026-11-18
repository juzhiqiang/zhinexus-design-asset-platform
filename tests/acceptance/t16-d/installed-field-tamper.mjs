// tests/acceptance/t16-d/installed-field-tamper.mjs — D 独立黑盒：篡改已安装备份单字段，证明 rollback 拒绝且零写，随后精确恢复并留存证据
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export async function checkTamper(ctx, { label, mutate, verify, foreignRoot }) {
  const { s, ref, doc, latestBytes, latestPath, versionPath } = ctx;
  const src = () => s.snapshot(s.root, { excludeRootNodeModules: true }); // async：所有调用处一律 await
  const bak = () => s.snapshot(s.backupRoot); // async：所有调用处一律 await
  assert.deepEqual(await src(), ctx.sourceAfter, '初始 SOURCE 与 ctx.sourceAfter 相同');
  assert.deepEqual(await bak(), ctx.backupAfter, '整个 BACKUP 与 ctx.backupAfter 相同');
  const mod = structuredClone(doc);
  mutate(mod); // 仅改选定字段
  verify(structuredClone(doc), structuredClone(mod)); // 两次均传独立深拷贝：verify 原地还原选定字段不触碰原 doc、不撤销将序列化的 mod 篡改
  const modBytes = Buffer.from(JSON.stringify(mod));
  const newSHA = s.sha(modBytes);
  assert.notEqual(newSHA, ref.sha256, 'newSHA 必须异于 active');
  const newVersionPath = path.join(path.dirname(versionPath), `backup-${newSHA}.json`);
  fs.writeFileSync(newVersionPath, modBytes, { flag: 'wx' }); // 普通单链接新文件于 ORIGINAL ref.id versions 目录，不触碰原不可变 version
  fs.writeFileSync(latestPath, Buffer.from(JSON.stringify({ schemaVersion: 1, operationId: ref.id, sha256: newSHA, updatedAt: new Date().toISOString() })));
  const rb = fs.readFileSync(newVersionPath);
  assert.equal(s.sha(rb), newSHA, '独立读回 version SHA == newSHA');
  const lb = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  assert.equal(lb.schemaVersion, 1, 'latest schemaVersion');
  assert.equal(lb.operationId, ref.id, 'latest operationId');
  assert.equal(lb.sha256, newSHA, 'latest sha256');
  verify(structuredClone(doc), JSON.parse(rb.toString('utf8'))); // 真实读回 doc（独立解析副本，非 mod 引用）仍为单字段篡改
  const srcT = await src(), bakT = await bak();
  const frnT = foreignRoot ? await s.snapshot(foreignRoot) : null;
  const r = await s.cli(['rollback', '--project', s.root, '--backup-id', ref.id, '--backup-sha256', newSHA, '--backup-root', s.backupRoot], `${label}-rollback`);
  assert.equal(r.code, 1, 'rollback code 1');
  assert.deepEqual(r.json, { status: 'error', error: { code: 'EXECUTION_FAILED', message: '受控应用执行失败' } }, '精确内层拒绝负载，排除 missing/stale 伪造');
  assert.deepEqual(await src(), srcT, '拒绝后 SOURCE 严格不变');
  assert.deepEqual(await bak(), bakT, '拒绝后 BACKUP 严格不变');
  if (foreignRoot) assert.deepEqual(await s.snapshot(foreignRoot), frnT, '拒绝后 foreignRoot 严格不变');
  fs.writeFileSync(latestPath, latestBytes); // 精确恢复原字节
  fs.renameSync(newVersionPath, path.join(s.evidence, `${label}-backup.json`)); // move 留证：不删、不覆盖原不可变 version
  assert.deepEqual(await bak(), ctx.backupAfter, 'BACKUP 基线精确恢复');
  assert.deepEqual(await src(), ctx.sourceAfter, 'SOURCE 全程未变');
  const changed = Object.keys(mod).filter((k) => JSON.stringify(mod[k]) !== JSON.stringify(doc[k]));
  fs.writeFileSync(path.join(s.evidence, `${label}-receipt.json`), Buffer.from(JSON.stringify({ label, sha256: newSHA, ref: { id: ref.id, sha256: ref.sha256 }, selected: changed.map((k) => ({ field: k, type: typeof mod[k] })) })));
  return { label, sha256: newSHA, rejected: true, baselineRestored: true };
}
