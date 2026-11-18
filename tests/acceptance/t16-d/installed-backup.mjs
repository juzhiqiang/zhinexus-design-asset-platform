// tests/acceptance/t16-d/installed-backup.mjs — T16-D 安装后备份黑盒校验
import { lstat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const norm = (p) => String(p).replace(/\\/g, '/');
const isIso = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(v) && !Number.isNaN(Date.parse(v));

export async function checkBackup(ctx) {
  const { s, plan, applied, planDigest, sourceAfter } = ctx;
  const ref = applied.backupRef;
  assert(ref?.id && ref?.sha256, 'applied.backupRef 必须包含 id 与 sha256');
  const latestPath = join(s.backupRoot, ref.id, 'latest.json');
  const versionPath = join(s.backupRoot, ref.id, 'versions', `backup-${ref.sha256}.json`);
  for (const target of [latestPath, versionPath]) {
    const st = await lstat(target);
    assert(st.isFile() && st.nlink === 1, `${target} 必须为普通文件（非链接）且 nlink=1`);
  }
  const docBytes = await readFile(versionPath);
  const latestBytes = await readFile(latestPath);
  assert(sha(docBytes) === ref.sha256, '仅对不可变 version doc 独立计算 SHA-256，必须等于 ref.sha256（不将 latest 字节摘要等同 ref）');
  const doc = JSON.parse(docBytes.toString('utf8'));
  const latest = JSON.parse(latestBytes.toString('utf8'));
  assert(latest.schemaVersion === 1 && latest.operationId === ref.id && latest.sha256 === ref.sha256 && isIso(latest.updatedAt), 'latest.json 指针字段不合法');
  assert(doc.schemaVersion === 1 && doc.operationId === applied.operationId && norm(doc.projectRoot) === norm(s.root) && doc.planDigest === planDigest && doc.installPlanned === true && doc.installStarted === true, 'doc 头字段不合法');
  const paths = doc.files.map((f) => f.path);
  assert(new Set(paths).size === paths.length, 'doc.files 路径必须唯一');
  assert.deepEqual([...paths].sort(), [...plan.allowedPaths].sort(), 'doc.files 排序后必须恰好等于 plan.allowedPaths');
  const originals = new Map([...s.original].map(([k, v]) => [norm(k), v]));
  const entries = (Array.isArray(sourceAfter) ? sourceAfter : sourceAfter.files) ?? [];
  for (const item of doc.files) {
    const p = item.path;
    const orig = originals.get(norm(p));
    const snap = entries.find((e) => e && e.type === 'file' && norm(e.name) === norm(p));
    assert.deepEqual(item.before, orig ? { path: p, exists: true, sha256: sha(orig) } : { path: p, exists: false }, `before 必须与 s.original 一致: ${p}`);
    assert.deepEqual(item.after, snap ? { path: p, exists: true, sha256: snap.sha } : { path: p, exists: false }, `after 必须与 sourceAfter 快照一致: ${p}`);
    const ob = item.originalBase64;
    assert(orig ? typeof ob === 'string' && ob === orig.toString('base64') && Buffer.from(ob, 'base64').equals(orig) && sha(Buffer.from(ob, 'base64')) === item.before.sha256 : ob === undefined, `originalBase64 规则违反: ${p}`);
  }
  return { ...ctx, ref, doc, docBytes, latestBytes, latestPath, versionPath };
}
