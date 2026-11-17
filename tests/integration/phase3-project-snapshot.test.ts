import { it, expect } from 'vitest';
import { mkdtemp, writeFile, unlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { snapshot } from '../fixtures/phase3-project-snapshot.js';

it('全树只读验收快照识别 __proto__ 文件的新增、修改和删除', async () => {
  const root = await mkdtemp(join(tmpdir(), 't15-snapshot-'));
  try {
    const empty = await snapshot(root);
    const file = join(root, '__proto__');
    await writeFile(file, 'before');
    const added = await snapshot(root);
    expect(Object.keys(added)).toEqual(['__proto__']);
    expect(added).not.toEqual(empty);
    await writeFile(file, 'after');
    const changed = await snapshot(root);
    expect(changed).not.toEqual(added);
    await unlink(file);
    const removed = await snapshot(root);
    expect(removed).not.toEqual(changed);
    expect(removed).toEqual(empty);
  } finally { await rm(root, { recursive: true, force: true }); }
});
