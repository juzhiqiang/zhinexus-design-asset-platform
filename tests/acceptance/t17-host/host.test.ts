import { afterEach, describe, expect, it } from 'vitest';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createOwnedRun, type OwnedRun, verifyBuiltImportEvidence } from './host.js';
import { scaffoldConsumerProject } from './consumer.js';
import { fixedScriptInvocation, type FixedToolchain } from './runtime.js';

const runs: OwnedRun[] = [];
afterEach(async () => { for (const run of runs.splice(0)) await run.abortForTest(); });

describe('T17 temporary host ownership', () => {
  it('creates separate project roots and external evidence under one random run id', async () => {
    const run = await createOwnedRun({ baseDirectory: tmpdir() }); runs.push(run);
    expect(run.projectRoots.vue).not.toBe(run.projectRoots.react);
    expect(resolve(run.evidenceRoot).startsWith(resolve(run.parentRoot))).toBe(false);
    expect(await readFile(join(run.projectRoots.vue, '.t17-owner.json'), 'utf8')).toContain(run.runId);
    expect(await readFile(join(run.projectRoots.react, '.t17-owner.json'), 'utf8')).toContain(run.runId);
  });
  it('requires external evidence seal and stopped process ownership before cleanup', async () => {
    const run = await createOwnedRun({ baseDirectory: tmpdir() }); runs.push(run);
    await expect(run.cleanup()).rejects.toThrow(/evidence/i);
    await run.stopOwnedProcesses(); await run.sealEvidence({ result: 'verified' }); await run.cleanup();
    await expect(lstat(run.projectRoots.vue)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await lstat(run.evidenceRoot)).toBeTruthy(); runs.splice(runs.indexOf(run), 1);
  });
  it('freezes evidence writes after sealing', async () => {
    const run = await createOwnedRun({ baseDirectory: tmpdir() }); runs.push(run);
    await run.stopOwnedProcesses(); await run.sealEvidence({ result: 'verified' });
    await expect(run.writeEvidence('late.txt', Buffer.from('late'))).rejects.toThrow(/closed|evidence/i);
  });
  it('refuses cleanup when a project ownership marker changes', async () => {
    const run = await createOwnedRun({ baseDirectory: tmpdir() }); runs.push(run);
    const owner = await readFile(join(run.projectRoots.vue, '.t17-owner.json'));
    await run.stopOwnedProcesses(); await run.sealEvidence({ result: 'verified' });
    await writeFile(join(run.projectRoots.vue, '.t17-owner.json'), '{}\n');
    await expect(run.cleanup()).rejects.toThrow(/owner|marker|identity/i);
    expect(await lstat(run.projectRoots.vue)).toBeTruthy();
    await writeFile(join(run.projectRoots.vue, '.t17-owner.json'), owner);
  });
  it('accepts the exact generated module in Vite graph and browser-loaded build asset', async () => {
    const run = await createOwnedRun({ baseDirectory: tmpdir() }); runs.push(run);
    await mkdir(join(run.projectRoots.react, 'src/components/zhinexus'), { recursive: true });
    await writeFile(join(run.projectRoots.react, 'src/components/zhinexus/component-0001.tsx'), 'export function ZhinexusLineChart(){return null;}');
    await expect(verifyBuiltImportEvidence({ projectRoot: run.projectRoots.react, generatedPath: 'src/components/zhinexus/component-0001.tsx', emittedEntry: 'dist/assets/index-123.js', viteModules: ['src/main.ts', 'src/components/zhinexus/component-0001.tsx'], sourceMapSources: ['../../src/components/zhinexus/component-0001.tsx'], loadedAssets: [{ url: 'http://127.0.0.1:41000/assets/index-123.js', path: '/assets/index-123.js', sha256: 'a'.repeat(64), bytes: 128, status: 200 }], emittedAssetSha256: 'a'.repeat(64) })).resolves.toMatchObject({ generatedModuleIncluded: true, sourceMapContainsGeneratedModule: true, browserLoadedBuiltAsset: true });
  });
  it('rejects static or wrong-host evidence missing the exact generated module', async () => {
    const run = await createOwnedRun({ baseDirectory: tmpdir() }); runs.push(run);
    await mkdir(join(run.projectRoots.react, 'src/components/zhinexus'), { recursive: true });
    await writeFile(join(run.projectRoots.react, 'src/components/zhinexus/component-0001.tsx'), 'export function ZhinexusLineChart(){return null;}');
    await expect(verifyBuiltImportEvidence({ projectRoot: run.projectRoots.react, generatedPath: 'src/components/zhinexus/component-0001.tsx', emittedEntry: 'dist/assets/index-123.js', viteModules: ['src/main.ts', 'src/fake-chart.tsx'], sourceMapSources: ['../../src/fake-chart.tsx'], loadedAssets: [{ url: 'http://127.0.0.1:41000/assets/index-123.js', path: '/assets/index-123.js', sha256: 'a'.repeat(64), bytes: 128, status: 200 }], emittedAssetSha256: 'a'.repeat(64) })).rejects.toThrow(/generated/i);
  });
  it('rejects a browser asset whose bytes differ from the tested build', async () => {
    const run = await createOwnedRun({ baseDirectory: tmpdir() }); runs.push(run);
    await mkdir(join(run.projectRoots.vue, 'src/components/zhinexus'), { recursive: true });
    await writeFile(join(run.projectRoots.vue, 'src/components/zhinexus/component-0001.vue'), '<template><div /></template>');
    await expect(verifyBuiltImportEvidence({ projectRoot: run.projectRoots.vue, generatedPath: 'src/components/zhinexus/component-0001.vue', emittedEntry: 'dist/assets/index-123.js', viteModules: ['src/main.ts', 'src/components/zhinexus/component-0001.vue'], sourceMapSources: ['../../src/components/zhinexus/component-0001.vue'], loadedAssets: [{ url: 'http://127.0.0.1:41000/assets/index-123.js', path: '/assets/index-123.js', sha256: 'b'.repeat(64), bytes: 128, status: 200 }], emittedAssetSha256: 'a'.repeat(64) })).rejects.toThrow(/asset|digest|hash/i);
  });
  it('uses the repository pnpm wrapper with --dir for project-local scripts', () => {
    const tools: FixedToolchain = { nodeExecutable: 'C:/repo/.tools/node/node.exe', npmCliPath: 'C:/repo/.tools/node/npm-cli.js', pnpmWrapper: 'C:/repo/scripts/pnpm.ps1', repositoryRoot: 'C:/repo' };
    const call = fixedScriptInvocation('C:/tmp/vue-consumer', 'pnpm', 'build', tools);
    expect(call.args[0]).toBe('-NoLogo');
    expect(call.args).toContain('-File');
    expect(call.args).toContain(resolve('C:/tmp/vue-consumer'));
    expect(call.args).not.toContain('-Command');
  });
  it('scaffolds sentinel lifecycle hooks so external installs prove they were suppressed', async () => {
    const run = await createOwnedRun({ baseDirectory: tmpdir() }); runs.push(run);
    await scaffoldConsumerProject(run, 'vue', 'pnpm');
    const manifest = JSON.parse(await readFile(join(run.projectRoots.vue, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(manifest.scripts.preinstall).toMatch(/t17-hook/);
    expect(manifest.scripts.postinstall).toMatch(/t17-hook/);
    expect(manifest.scripts.prebuild).toMatch(/t17-hook/);
    expect(manifest.scripts.postbuild).toMatch(/t17-hook/);
    expect(await readFile(join(run.projectRoots.vue, '.t17-hook.cjs'), 'utf8')).toContain('.t17-hooks');
  });
  it('rejects a browser-loaded bundle from outside the owned loopback host', async () => {
    const run = await createOwnedRun({ baseDirectory: tmpdir() }); runs.push(run);
    await mkdir(join(run.projectRoots.react, 'src/components/zhinexus'), { recursive: true });
    await writeFile(join(run.projectRoots.react, 'src/components/zhinexus/component-0001.tsx'), 'export function ZhinexusLineChart(){return null;}');
    await expect(verifyBuiltImportEvidence({ projectRoot: run.projectRoots.react, generatedPath: 'src/components/zhinexus/component-0001.tsx', emittedEntry: 'dist/assets/index-123.js', viteModules: ['src/components/zhinexus/component-0001.tsx'], sourceMapSources: ['../../src/components/zhinexus/component-0001.tsx'], loadedAssets: [{ url: 'https://example.invalid/assets/index-123.js', path: '/assets/index-123.js', sha256: 'a'.repeat(64), bytes: 128, status: 200 }], emittedAssetSha256: 'a'.repeat(64) })).rejects.toThrow(/loopback/i);
  });
});
