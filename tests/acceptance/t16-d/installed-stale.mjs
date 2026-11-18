// tests/acceptance/t16-d/installed-stale.mjs
// D 独立黑盒：冷 stale-ref 回滚必须受控失败。仅 Node 内建，不导入产品，不 mock/skip/清理。
// 本模块只覆盖冷 stale-ref，不声称运行时竞态。
// 契约（按已给 public 接口，非假定）：ctx.versionPath 是 active version JSON 文件路径，
// 旧 version 遍历/lstat/read 一律取 dirname(versionPath) 的真实 versions 目录；
// s.snapshot 仅认 {excludeRootNodeModules:true}，不支持 exclude 数组；s.cli 返回 {code,json}；
// ctx.docBytes/latestBytes 均为 Buffer；receipt 落实际 s.evidence 目录，不写 D 源码目录。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function checkStale(ctx) {
  const { s, planDigest, sourceAfter, backupAfter, ref, docBytes, latestBytes, latestPath, versionPath } = ctx;
  const sha256 = (b) => createHash('sha256').update(b).digest('hex');
  const norm = (p) => String(p).replace(/\\/g, '/');
  const versionsDir = dirname(versionPath); // versionPath 是文件路径；旧 version 一律从其 dirname 构造
  const snapSrc = () => s.snapshot(s.root, { excludeRootNodeModules: true });
  const snapBak = () => s.snapshot(s.backupRoot);
  const latestBuf = await readFile(latestPath);
  assert.ok(latestBuf.equals(latestBytes), '前置失败：latest 与 ctx.latestBytes（Buffer）不精确相等');
  const latest = JSON.parse(latestBuf.toString('utf8'));
  assert.ok(latest.schemaVersion === 1 && latest.operationId === ref.id && latest.sha256 === ref.sha256, '前置失败：latest schema/operationId/sha256 与 active ref 不符');
  const srcBefore = await snapSrc();
  const bakBefore = await snapBak();
  assert.deepStrictEqual(srcBefore, sourceAfter, '前置失败：SOURCE 实际快照≠ctx.sourceAfter');
  assert.deepStrictEqual(bakBefore, backupAfter, '前置失败：BACKUP 实际快照≠ctx.backupAfter');
  const stale = [];
  for (const name of (await readdir(versionsDir)).sort()) {
    const m = /^backup-([0-9a-f]{64})\.json$/.exec(name);
    if (!m || m[1] === ref.sha256) continue;
    const file = join(versionsDir, name);
    const st = await lstat(file);
    if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1) continue;
    const bytes = await readFile(file);
    if (sha256(bytes) !== m[1]) continue;
    const v = JSON.parse(bytes.toString('utf8'));
    if (v.schemaVersion === 1 && v.operationId === ref.id && v.planDigest === planDigest && norm(v.projectRoot) === norm(s.root)) stale.push({ name, fileSha: m[1] });
  }
  assert.ok(stale.length > 0, 'fixture 不足：真实 versions 目录内无保留且 SHA≠active 的旧不可变 version；不得 skip 或伪造');
  const prior = stale[0];
  const res = await s.cli(['rollback', '--project', s.root, '--backup-id', ref.id, '--backup-sha256', prior.fileSha, '--backup-root', s.backupRoot], 't16-d installed-stale 冷stale-ref回滚');
  assert.strictEqual(res.code, 1, '退出码≠1');
  assert.deepStrictEqual(res.json, { status: 'error', error: { code: 'EXECUTION_FAILED', message: '受控应用执行失败' } }, 'res.json≠受控失败');
  assert.deepStrictEqual(await snapSrc(), srcBefore, '调用后 SOURCE 快照改变');
  assert.deepStrictEqual(await snapBak(), bakBefore, '调用后 BACKUP 快照改变');
  const receipt = { check: 'installed-stale', scope: '仅冷stale-ref（不声称运行时竞态）', backupId: ref.id, activeSha256: ref.sha256, activeDocSha256: sha256(docBytes), staleVersionSha256: prior.fileSha, staleVersionFile: prior.name, planDigest, rollbackExitCode: res.code, errorCode: 'EXECUTION_FAILED', sourceUntouched: true, backupUntouched: true };
  const receiptPath = join(s.evidence, `installed-stale-${ref.id}.json`);
  await mkdir(s.evidence, { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return { priorSha: prior.fileSha, receiptPath };
}
