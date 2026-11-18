// tests/acceptance/t16-d/installed-report-files.mjs
import { deepStrictEqual } from 'node:assert';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export async function reportFiles({ s, plan, applied }) {
  const sourceAfter = await s.snapshot(s.root, { excludeRootNodeModules: true });
  const backupAfter = await s.snapshot(s.backupRoot, { excludeRootNodeModules: false });
  const fileMap = (snap) => new Map(snap.filter((e) => e.type === 'file').map((e) => [e.name, e]));
  const before = fileMap(s.sourceBefore);
  const after = fileMap(sourceAfter);
  const diff = [...new Set([...before.keys(), ...after.keys()])].sort().filter((p) => {
    const a = before.get(p), b = after.get(p);
    return !a !== !b || (!!a && !!b && a.bytes !== b.bytes);
  });
  const sameList = (xs, ys) => xs.length === ys.length && xs.every((v, i) => v === ys[i]);
  if (!sameList(diff, [...applied.changedFiles].sort()) || !sameList(diff, [...plan.allowedPaths].sort())) {
    throw new Error('真实差异路径与 changedFiles / allowedPaths 不完全一致');
  }
  const hashesOf = (m) => diff.map((p) => (m.has(p) ? { path: p, exists: true, sha256: m.get(p).sha } : { path: p, exists: false }));
  const byPath = (xs) => [...xs].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const sameHashes = (xs, ys) => { try { deepStrictEqual(xs, byPath(ys)); return true; } catch { return false; } };
  if (!sameHashes(hashesOf(before), applied.beforeHashes) || !sameHashes(hashesOf(after), applied.afterHashes)) {
    throw new Error('beforeHashes / afterHashes 与真实差异哈希不一致');
  }
  const readCur = (p) => readFile(isAbsolute(p) ? p : join(s.root, p));
  for (const [p, buf] of s.original) {
    if (!plan.allowedPaths.includes(p) && Buffer.compare(await readCur(p), buf) !== 0) throw new Error(`原有文件被修改: ${p}`);
  }
  const user = [...s.original].find(([p]) => p.split(/[\\/]/).join('/') === 'src/user.txt');
  if (!user || Buffer.compare(await readCur(user[0]), user[1]) !== 0) throw new Error('src/user.txt 必须等于原 Buffer');
  try { await lstat(s.poison); throw new Error('poison marker 不应存在'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return { sourceAfter, backupAfter };
}
