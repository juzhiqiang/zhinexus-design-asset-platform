import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {expect,it} from 'vitest';
import {sha256,manifestDigest,type ReleaseManifestV1} from '@company/contracts';
import {resolvePnpmExecutable} from '../../packages/component-cli/src/local/pack.js';
import {loadReleaseSession} from '../../packages/component-cli/src/local/release.js';
import {platformHarness} from './http-support.js';
import {localServices} from './support.js';
import {realRegistry,registryToken} from './t06-support.js';
const execute=promisify(execFile);
const commandOptions=(cwd:string,env=process.env)=>({cwd,env,timeout:180000,windowsHide:true,maxBuffer:4*1024*1024});
it('publishes newly scaffolded independent React and Vue packages with installed juz through real stores and recovers original jobs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'juz-real-workbench-'));const evidence:unknown[]=[];
 try{
  const packed=JSON.parse((await execute(process.execPath,[resolve('packages/component-cli/scripts/pack-juz.mjs'),'--out',join(root,'cli')],commandOptions(root))).stdout);
  const install=join(root,'installed');await mkdir(install);await writeFile(join(install,'package.json'),JSON.stringify({name:'cli-real-workbench',version:'1.0.0',private:true}));
  await execute(resolvePnpmExecutable(),['add',packed.tarballPath,'--ignore-scripts','--config.manage-package-manager-versions=false'],commandOptions(install));
  const installed=await realpath(join(install,'node_modules/juz-cli'));expect(installed.startsWith(install)).toBe(true);const bin=join(installed,'dist/bin.js');
  const slug='workbench-'+randomUUID();await execute(process.execPath,[bin,'create',slug,'--framework','all'],commandOptions(root));const project=join(root,slug);
  for(const framework of ['react','vue']){
   const dir=join(project,'packages',framework);const file=join(dir,'package.json');const pkg=JSON.parse(await readFile(file,'utf8'));const old=pkg.name;pkg.name='@company/'+old;await writeFile(file,JSON.stringify(pkg));
   const main=join(dir,'consumer/main.js');await writeFile(main,(await readFile(main,'utf8')).replaceAll(old,pkg.name));
   const configFile=join(dir,'component.config.json');const config=JSON.parse(await readFile(configFile,'utf8'));config.variants[0].category='general';await writeFile(configFile,JSON.stringify(config));
   const exampleFile=join(dir,'playground.json');const example=JSON.parse(await readFile(exampleFile,'utf8'));example.props.label='Real saved '+framework;example.states[0].props=example.props;await writeFile(exampleFile,JSON.stringify(example));
  }
  await execute(resolvePnpmExecutable(),['install','--ignore-scripts','--config.manage-package-manager-versions=false'],commandOptions(project));
  const h=await platformHarness({access:{apiOrigin:'https://api.example.com',administrators:[{issuer:'https://issuer.t05.test',subject:'admin'}],outbound:[{hostname:'127.0.0.1',port:443,networks:['127.0.0.1/32']}]}});
  try{
   const admin=await h.token('admin',['reader']);expect((await h.request('/v1/categories',{id:'general',name:'通用'},admin)).status).toBe(201);
   await h.db.query('INSERT INTO components(id) VALUES ($1)',[slug]);await h.db.query("INSERT INTO component_permissions(subject,component_id,can_publish) VALUES ('alice',$1,true)",[slug]);
   const auth=await h.token('alice',['publisher'],'cli');const env={...process.env,NODE_PATH:'',NODE_OPTIONS:'',ZHINEXUS_API_TOKEN:auth,PLATFORM_TOKEN:'',PLATFORM_API_TOKEN:'',ZHINEXUS_TOKEN:''};
   const cli=(args:string[])=>execute(process.execPath,[bin,...args,'--api-url',h.origin()],commandOptions(project,env));const registry=await realRegistry();
   for(const framework of ['react','vue']){
    const name='@company/'+slug+'-'+framework;await h.db.query("INSERT INTO package_permissions(subject,package_name) VALUES ('alice',$1)",[name]);
    const {bundleDir,manifest}=JSON.parse((await cli(['package','--package',name])).stdout) as {bundleDir:string;manifest:ReleaseManifestV1};
    expect(manifest.variants.map(v=>v.framework)).toEqual([framework]);const pkg=manifest.packages[0]!;
    const metadata=manifest.files.find(f=>f.path.endsWith('/playground.json'))!;expect(JSON.parse(await readFile(join(bundleDir,metadata.path),'utf8')).props.label).toBe('Real saved '+framework);
    const key='workbench-real-'+randomUUID();await expect(cli(['publish','--package',name,'--idempotency-key',key,'--timeout','1'])).rejects.toMatchObject({code:1,stderr:expect.stringContaining('RELEASE_TIMEOUT')});
    const session=await loadReleaseSession(bundleDir);expect(session?.jobId).toBeTruthy();
    const workerEnv={...process.env,PLATFORM_DATABASE_URL:h.db.pool.options.connectionString,PLATFORM_S3_ENDPOINT:h.store.config.endpoint,PLATFORM_S3_REGION:h.store.config.region,PLATFORM_S3_BUCKET:h.store.config.bucket,PLATFORM_S3_ACCESS_KEY:h.store.config.accessKeyId,PLATFORM_S3_SECRET_KEY:h.store.config.secretAccessKey,PLATFORM_REGISTRY_ORIGIN:localServices().registryOrigin,PLATFORM_REGISTRY_TOKEN:await registryToken(),PLATFORM_WORKER_JOB_ID:session!.jobId};
    await execute(process.execPath,[resolve('apps/api/dist/releases/runner.js'),'--once'],commandOptions(resolve('.'),workerEnv));
    const ready=JSON.parse((await cli(['publish','--package',name,'--idempotency-key','ignored-retry-key'])).stdout);expect(ready.state).toBe('READY');expect((await loadReleaseSession(bundleDir))?.idempotencyKey).toBe(key);await registry.verifyPackage(pkg);
    for(const ref of manifest.files)expect(await sha256(await readFile(join(bundleDir,ref.path)))).toBe(ref.sha256);
    evidence.push({framework,name,jobId:ready.jobId,manifestDigest:await manifestDigest(manifest),tarballSha256:pkg.tarball.sha256,exampleSha256:metadata.sha256,state:ready.state,originalKeyRetained:true});
   }
   expect((await h.db.query('SELECT count(*) FROM release_jobs')).rows[0]!.count).toBe('2');expect((await h.db.query("SELECT count(*) FROM variant_releases WHERE availability='Ready'")).rows[0]!.count).toBe('2');
   await h.restart();for(const item of evidence as {name:string;jobId:string}[])expect(JSON.parse((await cli(['publish','--package',item.name])).stdout).jobId).toBe(item.jobId);
  }finally{await h.close();}
  await mkdir(resolve('test-results/workbench'),{recursive:true});await writeFile(resolve('test-results/workbench/real-platform.json'),JSON.stringify({event:'JUZ_WORKBENCH_REAL_STORES',cliVersion:packed.version,cliTarballSha256:packed.sha256,services:['Nest HTTP','PostgreSQL','MinIO','Verdaccio'],identity:'test-signed OIDC CLI identity',productionOidcTlsAcceptance:false,cases:evidence},null,2));
 }finally{await rm(root,{recursive:true,force:true});}
},300000);
