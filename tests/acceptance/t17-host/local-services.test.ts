import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { makeFixture } from '../../fixtures/releases/g1/factory.js';
import { prepareT17LocalServices } from './local-services.js';
import { createHash } from 'node:crypto';

const roots: string[] = [];
async function fixtureRoot() { const root = await mkdtemp(join(tmpdir(), 't17-local-services-unit-')); roots.push(root); return root; }
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function sdkFixture(root: string) {
  const sdkBundle = join(root, 'sdk'), fixture = makeFixture('web');
  await mkdir(sdkBundle);
  for (const [path, bytes] of fixture.files) {
    const target = join(sdkBundle, ...path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  await writeFile(join(sdkBundle, 'manifest.json'), JSON.stringify(fixture.manifest) + '\n');
  return { sdkBundle, fixture };
}

describe('T17 isolated local services fail before allocating infrastructure', () => {
  it('checks the explicitly frozen historical compatibility probe before service allocation', async () => {
    const mod = await import('./local-services.js') as unknown as Record<string, unknown>;
    expect(typeof mod.readT17CompatibilityEvidence).toBe('function');
    const check = mod.readT17CompatibilityEvidence as (input: { file: string; sha256: string }, sdkBundle: string) => Promise<unknown>;
    const root = await fixtureRoot(), { sdkBundle } = await sdkFixture(root), file = join(root, 'historical-probe.json');
    await writeFile(file, JSON.stringify({ schemaVersion: 1, kind: 'a-t10-sdk-probe', recommendation: 'adopt' }));
    await expect(check({ file: 'relative.json', sha256: 'a'.repeat(64) }, sdkBundle)).rejects.toThrow(/absolute/i);
    await expect(check({ file, sha256: 'a'.repeat(64) }, sdkBundle)).rejects.toThrow(/digest|sha/i);
    const bytes = await readFile(file), digest = createHash('sha256').update(bytes).digest('hex');
    await expect(check({ file, sha256: digest }, sdkBundle)).rejects.toThrow(/probe|bundle|evidence/i);
    expect(await readFile(file)).toEqual(bytes);
    expect(await readdir(root)).toEqual(['historical-probe.json', 'sdk']);
  });
  it('rejects relative artifact and evidence paths', async () => {
    const root = await fixtureRoot();
    await expect(prepareT17LocalServices({ sdkBundle: 'relative-sdk', evidenceDirectory: root })).rejects.toThrow(/absolute/i);
    await expect(prepareT17LocalServices({ sdkBundle: root, evidenceDirectory: 'relative-evidence' })).rejects.toThrow(/absolute/i);
    expect(await readdir(root)).toEqual([]);
  });

  it('rejects missing or malformed manifests without creating evidence', async () => {
    const root = await fixtureRoot(), sdkBundle = join(root, 'sdk'), evidenceDirectory = join(root, 'evidence');
    await mkdir(sdkBundle);
    await expect(prepareT17LocalServices({ sdkBundle, evidenceDirectory })).rejects.toThrow(/manifest/i);
    await writeFile(join(sdkBundle, 'manifest.json'), '{invalid json');
    await expect(prepareT17LocalServices({ sdkBundle, evidenceDirectory })).rejects.toThrow(/manifest/i);
    expect(await readdir(root)).toEqual(['sdk']);
  });

  it('rejects changed frozen bytes and leaves the caller bundle untouched', async () => {
    const root = await fixtureRoot(), { sdkBundle, fixture } = await sdkFixture(root);
    const manifestBefore = await readFile(join(sdkBundle, 'manifest.json'));
    const path = fixture.manifest.files[0]!.path, changed = join(sdkBundle, ...path.split('/'));
    await writeFile(changed, 'changed frozen bytes');
    await expect(prepareT17LocalServices({ sdkBundle, evidenceDirectory: join(root, 'evidence') })).rejects.toThrow(/frozen|digest|bundle/i);
    expect(await readFile(join(sdkBundle, 'manifest.json'))).toEqual(manifestBefore);
    expect(await readFile(changed, 'utf8')).toBe('changed frozen bytes');
    expect(await readdir(root)).toEqual(['sdk']);
  });

  it('rejects evidence inside the SDK bundle before writing any owner files', async () => {
    const root = await fixtureRoot(), { sdkBundle } = await sdkFixture(root);
    const before = await readdir(sdkBundle);
    await expect(prepareT17LocalServices({ sdkBundle, evidenceDirectory: join(sdkBundle, 'evidence') })).rejects.toThrow(/evidence.*bundle/i);
    expect(await readdir(sdkBundle)).toEqual(before);
  });

  it('rejects an evidence parent alias into the SDK before creating child directories', async () => {
    const root = await fixtureRoot(), { sdkBundle } = await sdkFixture(root), alias = join(root, 'sdk-alias');
    await symlink(sdkBundle, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const before = await readdir(sdkBundle);
    await expect(prepareT17LocalServices({ sdkBundle, evidenceDirectory: join(alias, 'evidence') })).rejects.toThrow(/evidence.*bundle/i);
    expect(await readdir(sdkBundle)).toEqual(before);
  });
});
