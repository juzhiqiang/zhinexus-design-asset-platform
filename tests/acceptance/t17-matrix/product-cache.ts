import { lstat, mkdir, readdir, readlink, realpath, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { OwnedRun } from '../t17-host/host.js';

type Identity = { dev: string; ino: string };
type DirectoryIdentity = Identity & { path: string };
type ProjectReference = { path: string; target: string; identity: Identity };
export type ProductPnpmReferenceRecord = {
  schemaVersion: 1; kind: 'owned-pnpm-project-references'; cacheRoot: string; projectRoot: string;
  directories: DirectoryIdentity[]; references: ProjectReference[];
};
export type ProductPnpmCache = {
  root: string;
  captureReferences(): Promise<void>;
  releaseReferences(retain: (record: ProductPnpmReferenceRecord) => Promise<void>): Promise<void>;
  retireReferences(retain: (record: ProductPnpmReferenceRecord) => Promise<void>): Promise<void>;
  registerOwnedContents(): Promise<void>;
};
const identity = (info: { dev: bigint; ino: bigint }): Identity => ({ dev: String(info.dev), ino: String(info.ino) });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A capability for one freshly created private cache and one already-owned consumer. */
export async function createProductPnpmCache(run: OwnedRun, consumerRoot: string): Promise<ProductPnpmCache> {
  const projectRoot = resolve(consumerRoot);
  await run.assertOwnedProject(projectRoot);
  const root = await run.makeOwnedProject('native-pnpm-cache');
  const projects = join(root, 'pnpm/v11/projects');
  await mkdir(projects, { recursive: true });
  const chain = [root, join(root, 'pnpm'), join(root, 'pnpm/v11'), projects];
  const directories: DirectoryIdentity[] = [];
  for (const path of chain) {
    const info = await lstat(path, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) throw new Error('Private pnpm cache directory is unsafe.');
    directories.push({ path, ...identity(info) });
  }
  if ((await readdir(projects)).length) throw new Error('Private pnpm project references were not initially empty.');
  let state: 'fresh' | 'captured' | 'released' | 'failed' = 'fresh';
  let captured: ProjectReference[] = [];
  const assertDirectories = async () => {
    await run.assertOwnedProject(root); await run.assertOwnedProject(projectRoot);
    for (const expected of directories) {
      const info = await lstat(expected.path, { bigint: true });
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(expected.path) !== expected.path
        || !same(identity(info), { dev: expected.dev, ino: expected.ino })) throw new Error('Private pnpm cache directory identity changed.');
    }
  };
  const references = async (): Promise<ProjectReference[]> => {
    await assertDirectories();
    const result: ProjectReference[] = [];
    for (const name of (await readdir(projects)).sort()) {
      const path = join(projects, name), before = await lstat(path, { bigint: true });
      if (!before.isSymbolicLink()) throw new Error('Unexpected non-link pnpm project reference.');
      const target = resolve(dirname(path), await readlink(path));
      if (target !== projectRoot || await realpath(path) !== projectRoot) throw new Error('Pnpm project reference target is not this owned consumer.');
      const after = await lstat(path, { bigint: true });
      if (!after.isSymbolicLink() || !same(identity(before), identity(after))) throw new Error('Pnpm project reference identity changed while reading.');
      result.push({ path, target, identity: identity(after) });
    }
    await assertDirectories();
    return result;
  };
  const capability: ProductPnpmCache = {
    root,
    async captureReferences() {
      if (state !== 'fresh') throw new Error('Pnpm reference capture is one-use and cannot follow a refusal.');
      try { captured = await references(); state = 'captured'; } catch (error) { state = 'failed'; throw error; }
    },
    async releaseReferences(retain) {
      if (state !== 'captured') throw new Error('Pnpm reference identities must be captured before release.');
      try {
        if (!same(await references(), captured)) throw new Error('Pnpm project reference inventory changed after capture.');
        const record: ProductPnpmReferenceRecord = { schemaVersion: 1, kind: 'owned-pnpm-project-references', cacheRoot: root, projectRoot,
          directories: structuredClone(directories), references: structuredClone(captured) };
        await retain(record);
        if (!same(await references(), captured)) throw new Error('Pnpm project reference inventory changed after evidence retention.');
        for (const reference of captured) {
          await assertDirectories();
          const info = await lstat(reference.path, { bigint: true });
          if (!info.isSymbolicLink() || !same(identity(info), reference.identity)
            || resolve(dirname(reference.path), await readlink(reference.path)) !== reference.target
            || await realpath(reference.path) !== projectRoot) throw new Error('Pnpm reference identity changed before unlink.');
          await unlink(reference.path);
        }
        if ((await readdir(projects)).length) throw new Error('Pnpm project references changed during release.');
        state = 'released';
      } catch (error) { state = 'failed'; throw error; }
    },
    async registerOwnedContents() {
      if (state !== 'released') throw new Error('Private pnpm cache references have not been safely released.');
      await assertDirectories();
      if ((await readdir(projects)).length) throw new Error('Pnpm project reference inventory changed after release.');
      await run.registerOwnedPath(root, (await readdir(root)).filter(name => name !== '.t17-owner.json'));
    },
    async retireReferences(retain) {
      if (state === 'fresh') await capability.captureReferences();
      if (state === 'captured') await capability.releaseReferences(retain);
      if (state !== 'released') throw new Error('Private pnpm cache reference retirement previously refused.');
      await assertDirectories();
      if ((await readdir(projects)).length) throw new Error('Pnpm project reference inventory changed after release.');
    },
  };
  return capability;
}
