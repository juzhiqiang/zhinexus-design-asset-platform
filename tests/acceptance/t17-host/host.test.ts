import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { link, lstat, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { createOwnedRun, installFrozenCli, type OwnedRun, verifyBuiltImportEvidence, startBuiltHost } from './host.js';
import { scaffoldConsumerProject } from './consumer.js';
import { fixedScriptInvocation, type FixedToolchain } from './runtime.js';

const runs: OwnedRun[] = [];
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const exists=async(path:string)=>Boolean(await lstat(path).catch(()=>undefined));
afterEach(async () => { for (const run of runs.splice(0)) await run.abortForTest(); });

async function buildFixture(run:OwnedRun, framework:'vue'|'react'='react') {
  const root=run.projectRoots[framework], generatedPath='src/components/zhinexus/component-0001.'+(framework==='vue'?'vue':'tsx');
  const generated=join(root,generatedPath), entry='dist/assets/index-123.js', bundle=join(root,entry), mapPath='dist/assets/index-123.js.map';
  await mkdir(dirname(generated),{recursive:true}); await writeFile(generated,framework==='vue'?'<template><div /></template>':'export function ZhinexusLineChart(){return null;}');
  await mkdir(dirname(bundle),{recursive:true}); const bundleBytes=Buffer.from('actual emitted bundle bytes'); await writeFile(bundle,bundleBytes);
  const source=relative(dirname(join(root,mapPath)),generated).replaceAll('\\','/');
  await writeFile(join(root,mapPath),JSON.stringify({version:3,sources:[source],names:[],mappings:''}));
  await run.registerOwnedPath(root,[generatedPath,'dist']);
  return {root,generatedPath,entry,mapPath,bundleBytes};
}

type DeliveryGuard = { register(operationId: string): Promise<void> };
type DeliveryRun = OwnedRun & { prepareInstallDelivery(options: { projectRoot: string; backupRoot: string; planDigest: string; targets?: string[] }): Promise<DeliveryGuard> };

async function deliveryFixture(framework: 'vue' | 'react' = 'vue', targets = ['node_modules']) {
  const run = await createOwnedRun() as DeliveryRun;
  const projectRoot = run.projectRoots[framework];
  const backupRoot = await run.createEvidenceArea('delivery-backups');
  const planDigest = 'a'.repeat(64), operationId = 'apply-owned-delivery';
  for (const target of targets) {
    await mkdir(join(projectRoot, target), { recursive: true });
    await writeFile(join(projectRoot, target, 'original.txt'), 'owned original ' + target);
  }
  const guard = await run.prepareInstallDelivery({ projectRoot, backupRoot, planDigest, targets });
  const quarantineRoot = join(run.parentRoot, '.t16-quarantine-owned-delivery');
  await mkdir(quarantineRoot);
  const entries = [];
  for (const target of targets) {
    const importer = target === 'node_modules' ? '.' : target.slice(0, -'/node_modules'.length);
    const quarantine = join(quarantineRoot, importer === '.' ? 'root' : importer.replace(/[^A-Za-z0-9._-]+/g, '_'));
    await rename(join(projectRoot, target), quarantine);
    await mkdir(join(projectRoot, target));
    await writeFile(join(projectRoot, target, 'replacement.txt'), 'new installed dependency bytes');
    entries.push({ importer, target, hadOriginal: true, state: 'delivered', quarantine });
  }
  const journalDir = join(backupRoot, operationId);
  await mkdir(journalDir);
  const journalPath = join(journalDir, 'install-delivery.json');
  const journal = { schemaVersion: 1, kind: 't16-install-delivery', operationId, projectRoot: projectRoot.replaceAll('\\', '/'), planDigest, entries };
  await writeFile(journalPath, JSON.stringify(journal));
  return { run, projectRoot, backupRoot, operationId, guard, quarantineRoot, journalPath, journal };
}

describe('T17 temporary host ownership', () => {
  it.each(['vue', 'react'] as const)('registers only journal-bound original dependency trees and cleans synthetic quarantine: %s', async framework => {
    const fixture = await deliveryFixture(framework);
    const { run, guard, operationId, projectRoot, backupRoot, quarantineRoot } = fixture;
    try {
      await guard.register(operationId);
      await expect(guard.register(operationId)).rejects.toThrow(/used|once|closed/i);
      await run.registerOwnedPath(projectRoot, ['node_modules']);
      await run.registerEvidenceAreaContents(backupRoot, [operationId]);
      await run.stopOwnedProcesses();
      const seal = JSON.parse(await readFile(await run.sealEvidence({ result: 'verified' }), 'utf8'));
      expect(seal.inventories.installQuarantines).toHaveProperty('.t16-quarantine-owned-delivery');
      await run.cleanup();
      expect(await exists(quarantineRoot)).toBe(false);
      expect(await exists(run.parentRoot)).toBe(false);
    } finally {
      await rm(run.parentRoot, { recursive: true, force: true });
      await rm(run.evidenceRoot, { recursive: true, force: true });
    }
  });

  it('binds every explicitly captured workspace importer in the same delivery journal', async () => {
    const fixture = await deliveryFixture('vue', ['node_modules', 'packages/feature/node_modules']);
    const { run, guard, operationId, projectRoot, backupRoot } = fixture;
    try {
      await guard.register(operationId);
      await run.registerOwnedPath(projectRoot, ['node_modules', 'packages']);
      await run.registerEvidenceAreaContents(backupRoot, [operationId]);
      await run.stopOwnedProcesses();await run.sealEvidence({ result: 'verified' });await run.cleanup();
      expect(await exists(run.parentRoot)).toBe(false);
    } finally {
      await rm(run.parentRoot, { recursive: true, force: true });
      await rm(run.evidenceRoot, { recursive: true, force: true });
    }
  });

  it.each([
    'journal-operation', 'journal-plan', 'journal-project', 'journal-importer', 'journal-target', 'duplicate-entry',
    'unknown-operation', 'unknown-quarantine', 'extra-sibling', 'changed-bytes', 'changed-inode', 'quarantine-junction', 'journal-hardlink',
  ] as const)('refuses unknown or changed delivery output and retains the original tree: %s', async defect => {
    const fixture = await deliveryFixture();
    const { run, guard, operationId, backupRoot, quarantineRoot, journalPath, journal } = fixture;
    try {
      const entry = journal.entries[0]!;
      if (defect === 'journal-operation') journal.operationId = 'apply-other';
      if (defect === 'journal-plan') journal.planDigest = 'b'.repeat(64);
      if (defect === 'journal-project') journal.projectRoot = run.projectRoots.react.replaceAll('\\', '/');
      if (defect === 'journal-importer') entry.importer = 'unplanned';
      if (defect === 'journal-target') entry.target = 'packages/unplanned/node_modules';
      if (defect === 'duplicate-entry') journal.entries.push({ ...entry });
      if (defect === 'unknown-operation') await mkdir(join(backupRoot, 'apply-other'));
      if (defect === 'unknown-quarantine') await writeFile(join(quarantineRoot, 'unregistered.txt'), 'keep unknown');
      if (defect === 'extra-sibling') await writeFile(join(run.parentRoot, 'unregistered.txt'), 'keep unknown');
      if (defect === 'changed-bytes') await writeFile(join(entry.quarantine, 'original.txt'), 'concurrent user bytes');
      if (defect === 'changed-inode') {
        await rename(entry.quarantine, entry.quarantine + '-saved');
        await mkdir(entry.quarantine);await writeFile(join(entry.quarantine, 'original.txt'), 'owned original node_modules');
      }
      if (defect === 'quarantine-junction') {
        await rename(quarantineRoot, quarantineRoot + '-saved');
        await symlink(quarantineRoot + '-saved', quarantineRoot, 'junction');
      }
      await writeFile(journalPath, JSON.stringify(journal));
      if (defect === 'journal-hardlink') await link(journalPath, join(run.projectRoots.vue, 'journal-linked.json'));
      await expect(guard.register(operationId)).rejects.toThrow();
      expect(await exists(quarantineRoot)).toBe(true);
      await expect(run.abortForTest()).rejects.toThrow(/inventory|unregistered|changed/i);
      expect(await exists(quarantineRoot)).toBe(true);
    } finally {
      await rm(run.parentRoot, { recursive: true, force: true });
      await rm(run.evidenceRoot, { recursive: true, force: true });
    }
  });

  it('requires an exact run project and backup area before capturing delivery ownership', async () => {
    const run = await createOwnedRun() as DeliveryRun;
    try {
      const backupRoot = await run.createEvidenceArea('delivery-backups');
      await expect(run.prepareInstallDelivery({ projectRoot: tmpdir(), backupRoot, planDigest: 'a'.repeat(64) })).rejects.toThrow(/owned|project/i);
      await expect(run.prepareInstallDelivery({ projectRoot: run.projectRoots.vue, backupRoot: tmpdir(), planDigest: 'a'.repeat(64) })).rejects.toThrow(/owned|area|backup/i);
      await mkdir(join(run.parentRoot, '.t16-quarantine-preexisting'));
      await expect(run.prepareInstallDelivery({ projectRoot: run.projectRoots.vue, backupRoot, planDigest: 'a'.repeat(64) })).rejects.toThrow(/inventory|unregistered/i);
    } finally {
      await rm(run.parentRoot, { recursive: true, force: true });
      await rm(run.evidenceRoot, { recursive: true, force: true });
    }
  });

  it('creates separate project roots and external evidence under one random run id', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);
    expect(run.projectRoots.vue).not.toBe(run.projectRoots.react);
    expect(resolve(run.evidenceRoot).startsWith(resolve(run.parentRoot))).toBe(false);
    expect(await readFile(join(run.projectRoots.vue,'.t17-owner.json'),'utf8')).toContain(run.runId);
    expect(await readFile(join(run.projectRoots.react,'.t17-owner.json'),'utf8')).toContain(run.runId);
  });
  it('validates a registered temporary project before a frozen CLI may execute in it', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);const cliRoot=await run.makeOwnedProject('cli-consumer');
    await expect(run.assertOwnedProject(cliRoot)).resolves.toBeUndefined();
    await expect(run.assertOwnedProject(tmpdir())).rejects.toThrow(/owned project/i);
  });
  it('requires an external evidence seal and stopped owned processes before cleanup', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);
    await expect(run.cleanup()).rejects.toThrow(/evidence/i);
    await run.stopOwnedProcesses();await run.sealEvidence({result:'verified'});await run.cleanup();
    await expect(lstat(run.projectRoots.vue)).rejects.toMatchObject({code:'ENOENT'});
    expect(await lstat(run.evidenceRoot)).toBeTruthy();runs.splice(runs.indexOf(run),1);
  });
  it('freezes evidence writes after sealing', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);
    await run.stopOwnedProcesses();await run.sealEvidence({result:'verified'});
    await expect(run.writeEvidence('late.txt',Buffer.from('late'))).rejects.toThrow(/closed|evidence/i);
  });
  it('refuses cleanup when a project ownership marker changes', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);
    const marker=await readFile(join(run.projectRoots.vue,'.t17-owner.json'));
    await run.stopOwnedProcesses();await run.sealEvidence({result:'verified'});
    await writeFile(join(run.projectRoots.vue,'.t17-owner.json'),'{}\n');
    await expect(run.cleanup()).rejects.toThrow(/owner|marker|identity/i);
    expect(await lstat(run.projectRoots.vue)).toBeTruthy();await writeFile(join(run.projectRoots.vue,'.t17-owner.json'),marker);
  });
  it('refuses failure cleanup when the evidence root path is replaced', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);
    const replaced=run.evidenceRoot,saved=replaced+'-saved',sentinel=join(replaced,'keep.txt');
    await rename(replaced,saved);await mkdir(replaced);await writeFile(sentinel,'outside evidence sentinel');
    try {
      await expect(run.abortForTest()).rejects.toThrow(/owner|marker|identity/i);
      await expect(readFile(sentinel,'utf8')).resolves.toBe('outside evidence sentinel');
    } finally {
      await rm(replaced,{recursive:true,force:true});await rename(saved,replaced);
    }
  });
  it('refuses failure evidence preservation when the retained evidence root identity changes', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);
    const replaced=run.evidenceRoot,saved=replaced+'-saved',sentinel=join(replaced,'keep.txt');
    await rename(replaced,saved);await mkdir(replaced);await writeFile(sentinel,'outside evidence sentinel');
    try {
      await expect(run.abortForTest({preserveEvidence:true})).rejects.toThrow(/owner|marker|identity/i);
      await expect(readFile(sentinel,'utf8')).resolves.toBe('outside evidence sentinel');
      await expect(lstat(run.parentRoot)).resolves.toBeTruthy();
    } finally {
      await rm(replaced,{recursive:true,force:true});await rename(saved,replaced);
    }
  });
  it('can remove only owned projects while retaining registered failure evidence', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);
    const evidence=await run.writeEvidence('failure.stdout',Buffer.from('captured before failure'));
    const retainedRoot=run.evidenceRoot;
    await run.abortForTest({preserveEvidence:true});
    runs.splice(runs.indexOf(run),1);
    try {
      await expect(lstat(run.parentRoot)).rejects.toMatchObject({code:'ENOENT'});
      await expect(readFile(evidence.path,'utf8')).resolves.toBe('captured before failure');
      const retainedStat=await lstat(retainedRoot);expect(retainedStat.isDirectory()).toBe(true);
    } finally { await rm(retainedRoot,{recursive:true,force:true}); }
  });
  it('refuses failure cleanup when a project child directory is replaced', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);
    const replaced=run.projectRoots.vue,saved=run.parentRoot+'-vue-saved',sentinel=join(replaced,'keep.txt');
    await rename(replaced,saved);await mkdir(replaced);await writeFile(sentinel,'outside project sentinel');
    try {
      await expect(run.abortForTest()).rejects.toThrow(/owner|marker|identity/i);
      await expect(readFile(sentinel,'utf8')).resolves.toBe('outside project sentinel');
    } finally {
      await rm(replaced,{recursive:true,force:true});
      if(await exists(run.parentRoot))await rename(saved,replaced);else await rm(saved,{recursive:true,force:true});
    }
  });
  it('refuses failure cleanup when the owner root contains an untracked entry', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);
    const sentinel=join(run.parentRoot,'unexpected-user-file.txt');
    await writeFile(sentinel,'keep untracked user file');
    await expect(run.abortForTest()).rejects.toThrow(/unexpected|owner-root|cleanup/i);
    await expect(readFile(sentinel,'utf8')).resolves.toBe('keep untracked user file');
    await rm(sentinel,{force:false});
  });
  it('refuses failure cleanup when a project root contains an unregistered entry', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);
    const sentinel=join(run.projectRoots.vue,'unregistered-user-file.txt');
    await writeFile(sentinel,'keep unregistered project file');
    await expect(run.abortForTest()).rejects.toThrow(/inventory|project|unexpected|cleanup/i);
    await expect(readFile(sentinel,'utf8')).resolves.toBe('keep unregistered project file');
    await rm(sentinel,{force:false});
  });
  it('rejects whole-area evidence registration and preserves unlisted files', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);
    const area=await run.createEvidenceArea('narrow-evidence'),listed=join(area,'listed.txt'),unlisted=join(area,'unlisted.txt');
    await writeFile(listed,'listed');await run.registerEvidenceAreaContents(area,['listed.txt']);await writeFile(unlisted,'keep unlisted evidence');
    await expect(run.registerEvidenceAreaContents(area,['.'])).rejects.toThrow(/whole-area|relative|owned|unsafe|explicit/i);
    await expect(run.abortForTest()).rejects.toThrow(/unregistered|inventory|evidence/i);
    await expect(readFile(unlisted,'utf8')).resolves.toBe('keep unlisted evidence');
    await rm(unlisted,{force:false});
  });
  it('does not adopt an unregistered project entry when registering known generated paths', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);
    const known=join(run.projectRoots.vue,'generated.ts'),sentinel=join(run.projectRoots.vue,'unregistered-user-file.txt');
    await writeFile(known,'generated');await writeFile(sentinel,'keep unregistered content');
    await expect(run.registerOwnedPath(run.projectRoots.vue,['generated.ts'])).rejects.toThrow(/unregistered/i);
    await expect(readFile(sentinel,'utf8')).resolves.toBe('keep unregistered content');
    await rm(sentinel,{force:false});await run.registerOwnedPath(run.projectRoots.vue,['generated.ts']);
    await run.abortForTest();runs.splice(runs.indexOf(run),1);
    await expect(lstat(run.parentRoot)).rejects.toMatchObject({code:'ENOENT'});
  });
  it('refuses failure cleanup when the evidence root is replaced with a copied owner marker', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);
    const replaced=run.evidenceRoot,saved=replaced+'-saved',sentinel=join(replaced,'keep.txt');
    const marker=await readFile(join(replaced,'.t17-owner.json'));
    await rename(replaced,saved);await mkdir(replaced);
    await writeFile(join(replaced,'.t17-owner.json'),marker);await writeFile(sentinel,'outside evidence sentinel');
    try {
      await expect(run.abortForTest()).rejects.toThrow(/owner|marker|identity/i);
      await expect(readFile(sentinel,'utf8')).resolves.toBe('outside evidence sentinel');
    } finally {
      await rm(replaced,{recursive:true,force:true});
      if(await exists(run.parentRoot))await rename(saved,replaced);else await rm(saved,{recursive:true,force:true});
    }
  });
  it('refuses cleanup if a project snapshot changes after sealing', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);
    await writeFile(join(run.projectRoots.vue,'user-file.ts'),'original');
    await run.registerOwnedPath(run.projectRoots.vue,['user-file.ts']);
    await run.stopOwnedProcesses();await run.sealEvidence({result:'verified'});
    await writeFile(join(run.projectRoots.vue,'user-file.ts'),'changed');
    await expect(run.cleanup()).rejects.toThrow(/snapshot|project|changed/i);
    await writeFile(join(run.projectRoots.vue,'user-file.ts'),'original');
  });
  it('seals external script temporary output and retains it with logs after owned project cleanup', async () => {
    const run = await createOwnedRun({ baseDirectory: tmpdir() });
    runs.push(run);
    const area = await run.createEvidenceArea('t17-vue-script-temp');
    const cache = join(area, 'node-compile-cache', 'nested');
    await mkdir(cache, { recursive: true });
    await writeFile(join(cache, 'entry'), 'child compile cache');
    await run.registerEvidenceAreaContents(area, ['node-compile-cache']);
    const output = await run.writeEvidence('build.stdout', Buffer.from('bounded build output'));
    await run.stopOwnedProcesses();
    const sealPath = await run.sealEvidence({ result: 'verified' });
    const seal = JSON.parse(await readFile(sealPath, 'utf8'));
    const inventory = seal.inventories.evidenceAreas['t17-vue-script-temp'];
    expect(inventory.children[0].children[0].children[0]).toMatchObject({ name: 'entry', kind: 'file', sha256: sha(Buffer.from('child compile cache')) });
    await run.cleanup();
    runs.splice(runs.indexOf(run), 1);
    try {
      await expect(lstat(run.parentRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(cache, 'entry'), 'utf8')).resolves.toBe('child compile cache');
      await expect(readFile(output.path, 'utf8')).resolves.toBe('bounded build output');
    } finally {
      await rm(run.evidenceRoot, { recursive: true, force: false });
    }
  });
  it('refuses cleanup if the evidence seal itself changes after sealing', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);
    const sealPath=await (async()=>{await run.stopOwnedProcesses();return run.sealEvidence({result:'verified'});})();
    const sealBytes=await readFile(sealPath);
    await writeFile(sealPath,'{}\n');
    await expect(run.cleanup()).rejects.toThrow(/seal|evidence/i);
    await writeFile(sealPath,sealBytes);
  });
  it('refuses cleanup if a sealed evidence file changes after sealing', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);
    const evidence=await run.writeEvidence('report.json',Buffer.from('{"status":"passed"}'));
    await run.stopOwnedProcesses();await run.sealEvidence({result:'verified'});
    await writeFile(evidence.path,'{}');
    await expect(run.cleanup()).rejects.toThrow(/evidence|changed/i);
    await writeFile(evidence.path,'{"status":"passed"}');
  });
  it('refuses cleanup when the evidence root gains an unregistered entry after sealing', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);
    await run.stopOwnedProcesses();await run.sealEvidence({result:'verified'});
    const sentinel=join(run.evidenceRoot,'unregistered-after-seal.txt');
    await writeFile(sentinel,'keep unregistered evidence');
    await expect(run.cleanup()).rejects.toThrow(/inventory|evidence|unexpected/i);
    await expect(readFile(sentinel,'utf8')).resolves.toBe('keep unregistered evidence');
    await rm(sentinel,{force:false});
  });
  it('accepts the exact generated module in a real Vite graph and source map, bound to served dist bytes', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);const fixture=await buildFixture(run);
    const host=await startBuiltHost({projectRoot:fixture.root,run});
    const assetUrl=new URL(fixture.entry.replace(/^dist\//,''),host.url).href,response=await fetch(assetUrl),bytes=Buffer.from(await response.arrayBuffer());
    const evidence=await verifyBuiltImportEvidence({projectRoot:fixture.root,generatedPath:fixture.generatedPath,emittedEntry:fixture.entry,sourceMapPath:fixture.mapPath,viteModules:[join(fixture.root,'src/main.tsx'),join(fixture.root,fixture.generatedPath)],host,loadedAssets:[{url:assetUrl,path:'/assets/index-123.js',sha256:sha(bytes),bytes:bytes.length,status:response.status}],emittedAssetSha256:sha(fixture.bundleBytes)});
    expect(evidence).toMatchObject({generatedModuleIncluded:true,sourceMapContainsGeneratedModule:true,browserLoadedBuiltAsset:true});
  });
  it('rejects Vite graph or source map evidence that points at another module', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);const fixture=await buildFixture(run);
    const host=await startBuiltHost({projectRoot:fixture.root,run}),url=new URL('dist/assets/index-123.js'.replace(/^dist\//,''),host.url).href,response=await fetch(url),bytes=Buffer.from(await response.arrayBuffer());
    await expect(verifyBuiltImportEvidence({projectRoot:fixture.root,generatedPath:fixture.generatedPath,emittedEntry:fixture.entry,sourceMapPath:fixture.mapPath,viteModules:[join(fixture.root,'src/fake.tsx')],host,loadedAssets:[{url,path:'/assets/index-123.js',sha256:sha(bytes),bytes:bytes.length,status:200}],emittedAssetSha256:sha(fixture.bundleBytes)})).rejects.toThrow(/generated/i);
  });
  it('rejects a fabricated browser digest that differs from the actual emitted bundle', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);const fixture=await buildFixture(run),host=await startBuiltHost({projectRoot:fixture.root,run});
    const url=new URL('assets/index-123.js',host.url).href,response=await fetch(url),bytes=Buffer.from(await response.arrayBuffer());
    await expect(verifyBuiltImportEvidence({projectRoot:fixture.root,generatedPath:fixture.generatedPath,emittedEntry:fixture.entry,sourceMapPath:fixture.mapPath,viteModules:[join(fixture.root,fixture.generatedPath)],host,loadedAssets:[{url,path:'/assets/index-123.js',sha256:sha(bytes),bytes:bytes.length,status:200}],emittedAssetSha256:'a'.repeat(64)})).rejects.toThrow(/digest|hash|bytes/i);
  });
  it('rejects browser-loaded bundle metadata not served by the owned host', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);const fixture=await buildFixture(run),host=await startBuiltHost({projectRoot:fixture.root,run});
    await expect(verifyBuiltImportEvidence({projectRoot:fixture.root,generatedPath:fixture.generatedPath,emittedEntry:fixture.entry,sourceMapPath:fixture.mapPath,viteModules:[join(fixture.root,fixture.generatedPath)],host,loadedAssets:[{url:'http://127.0.0.1:41000/assets/index-123.js',path:'/assets/index-123.js',sha256:sha(fixture.bundleBytes),bytes:fixture.bundleBytes.length,status:200}],emittedAssetSha256:sha(fixture.bundleBytes)})).rejects.toThrow(/host|served|loopback/i);
  });
  it('does not trust caller mutations to the exposed served-asset map', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);const fixture=await buildFixture(run),host=await startBuiltHost({projectRoot:fixture.root,run});
    (host.servedAssets as Map<string,{path:string;sha256:string;bytes:number}>).set('/assets/index-123.js',{path:'/assets/index-123.js',sha256:sha(fixture.bundleBytes),bytes:fixture.bundleBytes.length});
    await expect(verifyBuiltImportEvidence({projectRoot:fixture.root,generatedPath:fixture.generatedPath,emittedEntry:fixture.entry,sourceMapPath:fixture.mapPath,viteModules:[join(fixture.root,fixture.generatedPath)],host,loadedAssets:[{url:new URL('assets/index-123.js',host.url).href,path:'/assets/index-123.js',sha256:sha(fixture.bundleBytes),bytes:fixture.bundleBytes.length,status:200}],emittedAssetSha256:sha(fixture.bundleBytes)})).rejects.toThrow(/host|served/i);
  });
  it('rejects source-map paths that escape the project', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);const fixture=await buildFixture(run),host=await startBuiltHost({projectRoot:fixture.root,run});
    await expect(verifyBuiltImportEvidence({projectRoot:fixture.root,generatedPath:fixture.generatedPath,emittedEntry:fixture.entry,sourceMapPath:'../outside.map',viteModules:[join(fixture.root,fixture.generatedPath)],host,loadedAssets:[],emittedAssetSha256:sha(fixture.bundleBytes)})).rejects.toThrow(/source map/i);
  });
  it('uses the repository pnpm wrapper with --dir for project-local scripts', () => {
    const tools:FixedToolchain={nodeExecutable:'C:/repo/.tools/node/node.exe',npmCliPath:'C:/repo/.tools/node/npm-cli.js',pnpmWrapper:'C:/repo/scripts/pnpm.ps1',repositoryRoot:'C:/repo'};
    const call=fixedScriptInvocation('C:/tmp/vue-consumer','pnpm','build',tools);
    expect(call.args[0]).toBe('-NoLogo');expect(call.args).toContain('-File');expect(call.args).toContain(resolve('C:/tmp/vue-consumer'));expect(call.args).not.toContain('-Command');
  });
  it('scaffolds sentinel lifecycle hooks so external installs prove they were suppressed', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);await scaffoldConsumerProject(run,'vue','pnpm');
    await run.registerOwnedPath(run.projectRoots.vue,['package.json','.t17-hook.cjs','pnpm-workspace.yaml','index.html','tsconfig.json','src/vite-env.d.ts','src/components/zhinexus']);
    const manifest=JSON.parse(await readFile(join(run.projectRoots.vue,'package.json'),'utf8')) as {scripts:Record<string,string>};
    expect(manifest.scripts.preinstall).toMatch(/t17-hook/);expect(manifest.scripts.postinstall).toMatch(/t17-hook/);expect(manifest.scripts.prebuild).toMatch(/t17-hook/);expect(manifest.scripts.postbuild).toMatch(/t17-hook/);
    expect(await readFile(join(run.projectRoots.vue,'.t17-hook.cjs'),'utf8')).toContain('.t17-hooks');
  });
  it('rejects a malformed installed CLI identity before it can be accepted', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);const area=await run.createEvidenceArea('cli-test'),tarball=join(area,'dummy.tgz');await writeFile(tarball,'frozen bytes');
    const fakeNpm=join(area,'fake-npm.cjs');await writeFile(fakeNpm,`const fs=require('node:fs');const path=require('node:path');const root=process.argv[process.argv.indexOf('--prefix')+1];const pkg=path.join(root,'node_modules/@company/component-cli');fs.mkdirSync(pkg,{recursive:true});fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:'@company/not-cli',version:'0.0.14',bin:{component:'bin.js'}}));fs.writeFileSync(path.join(pkg,'bin.js'),'process.exit(0)');const cache=process.env.npm_config_cache;fs.mkdirSync(path.join(cache,'_cacache','content'),{recursive:true});fs.writeFileSync(path.join(cache,'_cacache','content','entry'),'temporary cache');`);await run.registerEvidenceAreaContents(area,['dummy.tgz','fake-npm.cjs']);
    await expect(installFrozenCli({run,tarballPath:tarball,nodeExecutable:process.execPath,npmCliPath:fakeNpm,expectedVersion:'0.0.14',expectedTarballSha256:sha(Buffer.from('frozen bytes'))})).rejects.toThrow(/package|identity|version/i);
    await expect(lstat(join(run.evidenceRoot,'cli-install','npm-cache'))).rejects.toMatchObject({code:'ENOENT'});
    await expect(readdir(join(run.evidenceRoot,'cli-install')).then(names=>names.sort())).resolves.toEqual(['npm-globalconfig','npm-userconfig']);
  });
  it('tracks a running frozen CLI install and waits for process exit during run shutdown', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);const area=await run.createEvidenceArea('cli-test'),tarball=join(area,'dummy.tgz'),fakeNpm=join(area,'slow-npm.cjs'),started=join(area,'started');
    await writeFile(tarball,'frozen bytes');await writeFile(fakeNpm,"require('node:fs').writeFileSync("+JSON.stringify(started)+",'started');setInterval(()=>{},1000);");
    const install=installFrozenCli({run,tarballPath:tarball,nodeExecutable:process.execPath,npmCliPath:fakeNpm,expectedVersion:'0.0.14',expectedTarballSha256:sha(Buffer.from('frozen bytes'))});
    for(let i=0;i<100;i++){try{await readFile(started);break;}catch{await new Promise(resolve=>setTimeout(resolve,10));}}
    await expect(readFile(started,'utf8')).resolves.toBe('started');await run.registerEvidenceAreaContents(area,['dummy.tgz','slow-npm.cjs','started']);await run.stopOwnedProcesses();
    await expect(install).rejects.toThrow(/exited|stopped|timed out/i);
  });
  it('rejects a tarball whose bytes do not match the caller-frozen digest before spawn', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);const area=await run.createEvidenceArea('cli-test'),tarball=join(area,'dummy.tgz'),fakeNpm=join(area,'record-npm.cjs'),started=join(area,'spawned');
    await writeFile(tarball,'frozen bytes');await writeFile(fakeNpm,"require('node:fs').writeFileSync("+JSON.stringify(started)+",'spawned');");await run.registerEvidenceAreaContents(area,['dummy.tgz','record-npm.cjs']);
    await expect(installFrozenCli({run,tarballPath:tarball,nodeExecutable:process.execPath,npmCliPath:fakeNpm,expectedVersion:'0.0.14',expectedTarballSha256:'0'.repeat(64)})).rejects.toThrow(/digest|sha/i);
    await expect(readFile(started)).rejects.toMatchObject({code:'ENOENT'});
  });
  it('pins the frozen tarball in the owned consumer manifest instead of allowing npm to rewrite it', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);const area=await run.createEvidenceArea('cli-contract'),tarball=join(area,'dummy.tgz'),fakeNpm=join(area,'inspect-npm.cjs');
    await writeFile(tarball,'frozen bytes');
    const fakeSource=['const fs=require("node:fs")','const path=require("node:path")','const root=process.argv[process.argv.indexOf("--prefix")+1]','const pkg=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"))','fs.writeFileSync(path.join(root,"tarball-reference.txt"),pkg.dependencies?.["@company/component-cli"]||"missing")','const install=path.join(root,"node_modules/@company/component-cli")','fs.mkdirSync(path.join(install,"dist"),{recursive:true})','fs.writeFileSync(path.join(install,"package.json"),JSON.stringify({name:"@company/component-cli",version:"0.0.14",bin:{component:"dist/bin.js"}}))','fs.writeFileSync(path.join(install,"dist/bin.js"),"frozen CLI entry")'].join(';');
    await writeFile(fakeNpm,fakeSource);await run.registerEvidenceAreaContents(area,['dummy.tgz','inspect-npm.cjs']);

    const installed=await installFrozenCli({run,tarballPath:tarball,nodeExecutable:process.execPath,npmCliPath:fakeNpm,expectedVersion:'0.0.14',expectedTarballSha256:sha(Buffer.from('frozen bytes'))});
    const reference=await readFile(join(installed.root,'tarball-reference.txt'),'utf8');
    expect(reference).toContain('file:');expect(reference).toContain(tarball.replaceAll('\\','/'));
    expect(installed.entrySha256).toBe(sha(Buffer.from('frozen CLI entry')));
  });
});
