import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { createOwnedRun, installFrozenCli, type OwnedRun, verifyBuiltImportEvidence, startBuiltHost } from './host.js';
import { scaffoldConsumerProject } from './consumer.js';
import { fixedScriptInvocation, type FixedToolchain } from './runtime.js';

const runs: OwnedRun[] = [];
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
afterEach(async () => { for (const run of runs.splice(0)) await run.abortForTest(); });

async function buildFixture(run:OwnedRun, framework:'vue'|'react'='react') {
  const root=run.projectRoots[framework], generatedPath='src/components/zhinexus/component-0001.'+(framework==='vue'?'vue':'tsx');
  const generated=join(root,generatedPath), entry='dist/assets/index-123.js', bundle=join(root,entry), mapPath='dist/assets/index-123.js.map';
  await mkdir(dirname(generated),{recursive:true}); await writeFile(generated,framework==='vue'?'<template><div /></template>':'export function ZhinexusLineChart(){return null;}');
  await mkdir(dirname(bundle),{recursive:true}); const bundleBytes=Buffer.from('actual emitted bundle bytes'); await writeFile(bundle,bundleBytes);
  const source=relative(dirname(join(root,mapPath)),generated).replaceAll('\\','/');
  await writeFile(join(root,mapPath),JSON.stringify({version:3,sources:[source],names:[],mappings:''}));
  return {root,generatedPath,entry,mapPath,bundleBytes};
}

describe('T17 temporary host ownership', () => {
  it('creates separate project roots and external evidence under one random run id', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);
    expect(run.projectRoots.vue).not.toBe(run.projectRoots.react);
    expect(resolve(run.evidenceRoot).startsWith(resolve(run.parentRoot))).toBe(false);
    expect(await readFile(join(run.projectRoots.vue,'.t17-owner.json'),'utf8')).toContain(run.runId);
    expect(await readFile(join(run.projectRoots.react,'.t17-owner.json'),'utf8')).toContain(run.runId);
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
  it('refuses cleanup if a project snapshot changes after sealing', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);
    await writeFile(join(run.projectRoots.vue,'user-file.ts'),'original');
    await run.stopOwnedProcesses();await run.sealEvidence({result:'verified'});
    await writeFile(join(run.projectRoots.vue,'user-file.ts'),'changed');
    await expect(run.cleanup()).rejects.toThrow(/snapshot|project|changed/i);
  });
  it('refuses cleanup if the evidence seal itself changes after sealing', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);
    const sealPath=await (async()=>{await run.stopOwnedProcesses();return run.sealEvidence({result:'verified'});})();
    await writeFile(sealPath,'{}\n');
    await expect(run.cleanup()).rejects.toThrow(/seal|evidence/i);
  });
  it('refuses cleanup if a sealed evidence file changes after sealing', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);
    const evidence=await run.writeEvidence('report.json',Buffer.from('{"status":"passed"}'));
    await run.stopOwnedProcesses();await run.sealEvidence({result:'verified'});
    await writeFile(evidence.path,'{}');
    await expect(run.cleanup()).rejects.toThrow(/evidence|changed/i);
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
    const manifest=JSON.parse(await readFile(join(run.projectRoots.vue,'package.json'),'utf8')) as {scripts:Record<string,string>};
    expect(manifest.scripts.preinstall).toMatch(/t17-hook/);expect(manifest.scripts.postinstall).toMatch(/t17-hook/);expect(manifest.scripts.prebuild).toMatch(/t17-hook/);expect(manifest.scripts.postbuild).toMatch(/t17-hook/);
    expect(await readFile(join(run.projectRoots.vue,'.t17-hook.cjs'),'utf8')).toContain('.t17-hooks');
  });
  it('rejects a malformed installed CLI identity before it can be accepted', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);const tarball=join(run.evidenceRoot,'dummy.tgz');await writeFile(tarball,'frozen bytes');
    const fakeNpm=join(run.evidenceRoot,'fake-npm.cjs');await writeFile(fakeNpm,`const fs=require('node:fs');const path=require('node:path');const root=process.argv[process.argv.indexOf('--prefix')+1];const pkg=path.join(root,'node_modules/@company/component-cli');fs.mkdirSync(pkg,{recursive:true});fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:'@company/not-cli',version:'0.0.14',bin:{component:'bin.js'}}));fs.writeFileSync(path.join(pkg,'bin.js'),'process.exit(0)');`);
    await expect(installFrozenCli({run,tarballPath:tarball,nodeExecutable:process.execPath,npmCliPath:fakeNpm,expectedVersion:'0.0.14',expectedTarballSha256:sha(Buffer.from('frozen bytes'))})).rejects.toThrow(/package|identity|version/i);
  });
  it('tracks a running frozen CLI install and waits for process exit during run shutdown', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);const tarball=join(run.evidenceRoot,'dummy.tgz'),fakeNpm=join(run.evidenceRoot,'slow-npm.cjs'),started=join(run.evidenceRoot,'started');
    await writeFile(tarball,'frozen bytes');await writeFile(fakeNpm,"require('node:fs').writeFileSync("+JSON.stringify(started)+",'started');setInterval(()=>{},1000);");
    const install=installFrozenCli({run,tarballPath:tarball,nodeExecutable:process.execPath,npmCliPath:fakeNpm,expectedVersion:'0.0.14',expectedTarballSha256:sha(Buffer.from('frozen bytes'))});
    for(let i=0;i<100;i++){try{await readFile(started);break;}catch{await new Promise(resolve=>setTimeout(resolve,10));}}
    await expect(readFile(started,'utf8')).resolves.toBe('started');await run.stopOwnedProcesses();
    await expect(install).rejects.toThrow(/exited|stopped|timed out/i);
  });
  it('rejects a tarball whose bytes do not match the caller-frozen digest before spawn', async () => {
    const run=await createOwnedRun({baseDirectory:tmpdir()});runs.push(run);const tarball=join(run.evidenceRoot,'dummy.tgz'),fakeNpm=join(run.evidenceRoot,'record-npm.cjs'),started=join(run.evidenceRoot,'spawned');
    await writeFile(tarball,'frozen bytes');await writeFile(fakeNpm,"require('node:fs').writeFileSync("+JSON.stringify(started)+",'spawned');");
    await expect(installFrozenCli({run,tarballPath:tarball,nodeExecutable:process.execPath,npmCliPath:fakeNpm,expectedVersion:'0.0.14',expectedTarballSha256:'0'.repeat(64)})).rejects.toThrow(/digest|sha/i);
    await expect(readFile(started)).rejects.toMatchObject({code:'ENOENT'});
  });
});
