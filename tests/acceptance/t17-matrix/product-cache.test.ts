import { afterEach, describe, expect, it } from 'vitest';
import { lstat, mkdir, readFile, readdir, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createOwnedRun } from '../t17-host/host.js';
import { createProductPnpmCache } from './product-cache.js';

const fixtures: { run: Awaited<ReturnType<typeof createOwnedRun>>; cacheRoot: string; createdEntries: string[] }[] = [];
async function fixture() {
  const run = await createOwnedRun();
  const cache = await createProductPnpmCache(run, run.projectRoots.vue);
  const state = { run, cacheRoot: cache.root, createdEntries: [] as string[] };
  fixtures.push(state);
  await writeFile(join(run.projectRoots.vue, 'sentinel.txt'), 'original-target');
  return { ...state, cache, projects: join(cache.root, 'pnpm/v11/projects') };
}
afterEach(async () => {
  for (const { run, cacheRoot, createdEntries } of fixtures.splice(0)) {
    for (const path of createdEntries) if (await lstat(path).catch(() => undefined)) await unlink(path);
    for (const root of [...Object.values(run.projectRoots), cacheRoot]) {
      const names = (await readdir(root)).filter(name => name !== '.t17-owner.json');
      if (names.length) await run.registerOwnedPath(root, names);
    }
    await run.abortForTest();
  }
});

describe('T17 private pnpm project-reference retirement', () => {
  it('retains an immutable reference record before unlinking only the new exact-project junction', async () => {
    const f = await fixture(), link = join(f.projects, 'project-reference');
    await symlink(f.run.projectRoots.vue, link, 'junction'); f.createdEntries.push(link);
    await f.cache.captureReferences();
    const retained: unknown[] = [];
    await f.cache.releaseReferences(async record => {
      expect((await lstat(link)).isSymbolicLink()).toBe(true);
      retained.push(structuredClone(record));
    });
    expect(await lstat(link).catch(() => undefined)).toBeUndefined();
    expect(await readFile(join(f.run.projectRoots.vue, 'sentinel.txt'), 'utf8')).toBe('original-target');
    expect(retained).toHaveLength(1);
    expect(retained[0]).toMatchObject({ kind: 'owned-pnpm-project-references', projectRoot: f.run.projectRoots.vue,
      references: [{ path: link, target: f.run.projectRoots.vue, identity: { dev: expect.any(String), ino: expect.any(String) } }] });
    await f.cache.registerOwnedContents();
  });

  it('rejects a project junction aimed at a different owner child', async () => {
    const f = await fixture(), link = join(f.projects, 'unknown-reference');
    await symlink(f.run.projectRoots.react, link, 'junction'); f.createdEntries.push(link);
    await expect(f.cache.captureReferences()).rejects.toThrow(/target|project/i);
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readFile(join(f.run.projectRoots.vue, 'sentinel.txt'), 'utf8')).toBe('original-target');
  });

  it('rejects ordinary files in the project-reference directory', async () => {
    const f = await fixture(), file = join(f.projects, 'ordinary-file');
    await writeFile(file, 'do-not-delete'); f.createdEntries.push(file);
    await expect(f.cache.captureReferences()).rejects.toThrow(/link|reference/i);
    expect(await readFile(file, 'utf8')).toBe('do-not-delete');
  });

  it('rejects replacement of a captured link even when its new target is identical', async () => {
    const f = await fixture(), link = join(f.projects, 'project-reference');
    await symlink(f.run.projectRoots.vue, link, 'junction'); f.createdEntries.push(link);
    await f.cache.captureReferences();
    const moved = join(f.projects, 'original-reference');
    await rename(link, moved); f.createdEntries.push(moved);
    await symlink(f.run.projectRoots.vue, link, 'junction');
    let retained = false;
    await expect(f.cache.releaseReferences(async () => { retained = true; })).rejects.toThrow(/changed|identity|inventory/i);
    expect(retained).toBe(false);
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readFile(join(f.run.projectRoots.vue, 'sentinel.txt'), 'utf8')).toBe('original-target');
  });

  it('refuses to unlink a reference unless its record was successfully retained', async () => {
    const f = await fixture(), link = join(f.projects, 'project-reference');
    await symlink(f.run.projectRoots.vue, link, 'junction'); f.createdEntries.push(link);
    await f.cache.captureReferences();
    await expect(f.cache.releaseReferences(async () => { throw new Error('evidence write refused'); })).rejects.toThrow('evidence write refused');
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
  });

  it('rejects replacement of an intermediate cache directory before unlinking', async () => {
    const f = await fixture();
    await f.cache.captureReferences();
    const old = join(f.cache.root, 'pnpm/v11/original-projects');
    await rename(f.projects, old); await mkdir(f.projects);
    await expect(f.cache.releaseReferences(async () => {})).rejects.toThrow(/identity|changed/i);
    expect(await readFile(join(f.run.projectRoots.vue, 'sentinel.txt'), 'utf8')).toBe('original-target');
  });
});
