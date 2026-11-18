// tests/acceptance/t16-d/installed-recovery-source.mjs
import assert from 'node:assert/strict';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export async function checkRestored(ctx) {
  const { s, plan, ref } = ctx;
  console.error(`[t16-d/source] area=${s.area} evidence=${s.evidence} ref=${ref.id}`);
  const snap = await s.snapshot(s.root, { excludeRootNodeModules: true });
  const files = snap.filter((e) => e.type === 'file');
  assert.deepEqual(files.map((e) => e.name).sort(), [...s.original.keys()].sort());
  for (const f of files) {
    const original = s.original.get(f.name);
    assert.ok(original);
    assert.equal(f.size, original.length);
    assert.equal(f.bytes, original.toString('base64'));
    assert.equal(f.sha, s.sha(original));
    assert.ok((await readFile(join(s.root, f.name))).equals(original));
  }
  for (const change of plan.changes) {
    if (change.kind === 'generated-component') {
      const target = isAbsolute(change.path) ? change.path : join(s.root, change.path);
      await assert.rejects(lstat(target), { code: 'ENOENT' });
    }
  }
  const nodeModules = await lstat(join(s.root, 'node_modules'));
  assert.ok(nodeModules.isDirectory());
  assert.ok(!nodeModules.isSymbolicLink());
  const pkgPath = join(s.root, 'node_modules', '@company', 'charts-vue', 'package.json');
  const pkgStat = await lstat(pkgPath);
  assert.ok(pkgStat.isFile());
  assert.ok(!pkgStat.isSymbolicLink());
  assert.equal(pkgStat.nlink, 1);
  assert.equal(JSON.parse(await readFile(pkgPath, 'utf8')).version, '0.0.12');
  const userKey = [...s.original.keys()].find((k) => k.replaceAll('\\', '/') === 'src/user.txt');
  assert.ok(userKey);
  assert.ok((await readFile(join(s.root, 'src', 'user.txt'))).equals(s.original.get(userKey)));
  await assert.rejects(lstat(s.poison), { code: 'ENOENT' });
}
