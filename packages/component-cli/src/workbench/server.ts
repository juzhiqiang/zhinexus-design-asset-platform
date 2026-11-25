import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createServer,type IncomingMessage } from 'node:http';
import { randomBytes,randomUUID } from 'node:crypto';
import { z } from 'zod';
import { readWorkspace,selectProject } from './workspace.js';
import { readPlayground,savePlayground,checked,validateExample } from './examples.js';
import { configRelative,inputFingerprint,readPointer,stateKey } from './state.js';
import { projectPath,readVariantApi,validateProjectConfig,type LoadedProject,type ProjectVariant } from '../project/config.js';
import { publishingAccess } from '../project/doctor.js';
import { resolvePlatformApiUrl } from '../local/credentials.js';
import { canonicalJson } from '../contracts/schema.js';
import { manifestDigest } from '../contracts/digests.js';
import { computeBufferSha256 } from '../local/digest.js';
import { loadProjectBundle } from '../project/prepare.js';
import { runProjectCommand } from '../commands/project.js';
import { startDevelopmentPreview } from './development.js';
import { startFrozenPreview,mime } from './frozen.js';
import { inOperation } from '../project/lifecycle.js';
import { withPackageLock } from './lock.js';
export type WorkbenchOptions={root:string;version:string;configFile?:string;bundleDir?:string;port?:number;apiOrigin?:string;log?:(message:string)=>void};
type Item={project:LoadedProject;variant:ProjectVariant};
type Job={id:string;packageId:string;kind:string;status:'queued'|'running'|'succeeded'|'failed';logs:string[];result?:unknown;error?:string};
const idSchema=z.strictObject({id:z.string().min(1).max(256)});
async function body(request:IncomingMessage):Promise<unknown>{let size=0;const chunks:Buffer[]=[];for await(const chunk of request){size+=chunk.length;if(size>1024*1024)throw new Error('REQUEST_TOO_LARGE');chunks.push(Buffer.from(chunk));}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
export async function startWorkbench(options:WorkbenchOptions){
 const token=randomBytes(32).toString('hex');let origin='',closed=false;
 const abort=new AbortController();
 const jobs=new Map<string,Job>();const queues=new Map<string,Promise<unknown>>();
 let active:Awaited<ReturnType<typeof startDevelopmentPreview>>|undefined;let frozen:Awaited<ReturnType<typeof startFrozenPreview>>|undefined;let candidatePreview:Awaited<ReturnType<typeof startFrozenPreview>>|undefined;let selection=Promise.resolve();
 const serial=<T>(key:string,operation:()=>Promise<T>):Promise<T>=>{const previous=queues.get(key)??Promise.resolve();const next=previous.catch(()=>{}).then(()=>{if(closed)throw new Error('WORKBENCH_CLOSED');return operation();});queues.set(key,next);void next.finally(()=>{if(queues.get(key)===next)queues.delete(key);}).catch(()=>{});return next;};
 const workspace=async()=>readWorkspace(options.root,options.configFile);
 const itemId=(p:LoadedProject,v:ProjectVariant)=>stateKey(p)+':'+v.componentId+':'+v.framework;
 async function resolveItem(id:string):Promise<Item>{for(const project of (await workspace()).projects)for(const variant of project.config.variants)if(itemId(project,variant)===id)return{project,variant};throw new Error('VARIANT_UNKNOWN');}
 async function resolvePackage(id:string){return selectProject(await workspace(),id);}
 async function catalog(){
  if(frozen){const b=frozen.bundle;const digest=await manifestDigest(b.manifest);return {readOnly:true,packages:b.manifest.packages.map(p=>({id:p.name,name:p.name,version:p.version,prepared:{digest,changed:false}})),variants:b.manifest.variants.map(v=>{
   const preview=v.examples[0]!;const meta=preview.previewFiles.find(f=>f.path.endsWith('/playground.json'));let example;try{example=meta?checked(JSON.parse(Buffer.from(b.filesMap.get(meta.path)!).toString('utf8'))):undefined;}catch{example=undefined;}
   return {id:v.variantId,packageId:v.packageName,packageName:v.packageName,version:v.packageVersion,componentId:v.componentId,framework:v.framework,category:v.category,mode:'frozen',example,digest:'',api:JSON.parse(Buffer.from(b.filesMap.get(v.api.path)!).toString('utf8')),docs:Buffer.from(b.filesMap.get(v.docs.path)!).toString('utf8'),width:preview.width,height:preview.height};
  })};}
  const w=await workspace();const packages=[];const variants=[];
  for(const p of w.projects){const pointer=await readPointer(p);let prepared:unknown;
   if(pointer){try{const bundle=await loadProjectBundle(await projectPath(p.root,pointer.bundleDir));prepared={bundleDir:pointer.bundleDir,digest:await manifestDigest(bundle.manifest),changed:pointer.inputDigest?pointer.inputDigest!==await inputFingerprint(p):null,variants:bundle.manifest.variants.map(v=>({componentId:v.componentId,framework:v.framework,category:v.category})),tarballSha256:bundle.manifest.packages[0]?.tarball.sha256};}catch{prepared={changed:true,error:'冻结材料缺失或校验失败'};}}
   packages.push({id:p.pkg.name,name:p.pkg.name,version:p.pkg.version,configDigest:computeBufferSha256(canonicalJson(p.config)),prepared});
   for(const v of p.config.variants){const example=await readPlayground(p,v);variants.push({id:itemId(p,v),packageId:p.pkg.name,packageName:p.pkg.name,version:p.pkg.version,componentId:v.componentId,framework:v.framework,category:v.category,mode:v.sourceEntry?'source':'built-export',example:example.value,digest:example.digest,api:await readVariantApi(p,v),docs:await fs.readFile(await projectPath(p.root,v.docs),'utf8'),width:v.readiness.width,height:v.readiness.height});}
  }
  return {readOnly:false,packages,variants};
 }
 function startJob(packageId:string,kind:string,operation:(log:(message:string)=>void)=>Promise<unknown>){
  const job:Job={id:randomUUID(),packageId,kind,status:'queued',logs:[]};jobs.set(job.id,job);
  void serial(packageId,async()=>{job.status='running';const log=(message:string)=>{job.logs.push(message.slice(0,8192));if(job.logs.length>200)job.logs.shift();options.log?.(message);};
   try{job.result=await inOperation(abort.signal,()=>operation(log));job.status='succeeded';}catch(error){job.status='failed';job.error=String(error);}
  }).catch(error=>{job.status='failed';job.error=String(error);});
  return {jobId:job.id};
 }
 const server=createServer((request,response)=>inOperation(abort.signal,async()=>{
  const json=(status:number,value:unknown)=>{response.writeHead(status,{'content-type':'application/json; charset=utf-8'}).end(JSON.stringify(value));};
  response.setHeader('x-content-type-options','nosniff');response.setHeader('cache-control','no-store');response.setHeader('referrer-policy','no-referrer');
  response.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src http://127.0.0.1:*; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'");
  try {
   if(request.headers.host!==new URL(origin).host){json(403,{error:'HOST_REJECTED'});return;}
   const url=new URL(request.url??'/',origin);
   if(!url.pathname.startsWith('/api/')){
    if(!['GET','HEAD'].includes(request.method??'')){json(405,{error:'METHOD_REJECTED'});return;}
    const assets:Record<string,string>={'/':'index.html','/client.js':'client.js','/style.css':'style.css'};
    const asset=assets[url.pathname];if(!asset){response.writeHead(404).end();return;}
    const bytes=await fs.readFile(new URL('./ui/'+asset,import.meta.url));response.writeHead(200,{'content-type':mime[path.extname(asset)]??'text/html; charset=utf-8'}).end(bytes);return;
   }
   if(request.headers.origin!==origin||request.headers['x-juz-session']!==token){json(403,{error:'SESSION_REJECTED'});return;}
   if(!['GET','POST'].includes(request.method??'')){json(405,{error:'METHOD_REJECTED'});return;}
   const input=request.method==='POST'?await body(request):{};
   if(url.pathname==='/api/catalog'){json(200,await catalog());return;}
   if(url.pathname==='/api/select'){
    const {id}=idSchema.parse(input);
    if(frozen){json(200,{url:frozen.url(id),mode:'frozen'});return;}
    let result:unknown;
    const next=selection.catch(()=>{}).then(async()=>{await active?.close();active=undefined;await candidatePreview?.close();candidatePreview=undefined;const {project,variant}=await resolveItem(id);active=await inOperation(abort.signal,()=>startDevelopmentPreview(project,variant,origin));result={url:active.url,mode:active.mode};});selection=next;
    await next;json(200,result);return;
   }
   if(frozen){json(405,{error:'FROZEN_READ_ONLY'});return;}
   if(url.pathname==='/api/frozen'){
    const parsed=z.strictObject({id:z.string(),variantId:z.string()}).parse(input);const project=await resolvePackage(parsed.id);const pointer=await readPointer(project);if(!pointer)throw new Error('PREPARE_REQUIRED');
    let result:unknown;const next=selection.catch(()=>{}).then(async()=>{await active?.close();active=undefined;await candidatePreview?.close();candidatePreview=await startFrozenPreview(await projectPath(project.root,pointer.bundleDir),origin);
     const bundle=candidatePreview.bundle;if(await manifestDigest(bundle.manifest)!==pointer.manifestDigest)throw new Error('FROZEN_MANIFEST_MISMATCH');const variant=bundle.manifest.variants.find(v=>v.variantId===parsed.variantId);if(!variant)throw new Error('VARIANT_UNKNOWN');const metadata=variant.examples[0]?.previewFiles.find(f=>f.path.endsWith('/playground.json'));
     result={url:candidatePreview.url(parsed.variantId),mode:'frozen',snapshot:{api:JSON.parse(Buffer.from(bundle.filesMap.get(variant.api.path)!).toString('utf8')),docs:Buffer.from(bundle.filesMap.get(variant.docs.path)!).toString('utf8'),example:metadata?checked(JSON.parse(Buffer.from(bundle.filesMap.get(metadata.path)!).toString('utf8'))):undefined,category:variant.category}};
    });selection=next;await next;json(200,result);return;
   }
   if(url.pathname==='/api/validate'||url.pathname==='/api/save'){
    const parsed=z.strictObject({id:z.string(),value:z.unknown(),digest:z.string()}).parse(input);const {project,variant}=await resolveItem(parsed.id);
    if(url.pathname==='/api/validate'){json(200,{value:await validateExample(project,variant,parsed.value)});return;}
    json(200,await serial(project.pkg.name,()=>withPackageLock(project,()=>savePlayground(project,variant,parsed.digest,parsed.value))));return;
   }
   if(url.pathname==='/api/publishing'){
    try{const access=await publishingAccess(options.apiOrigin);json(200,{authenticated:true,apiOrigin:access.apiUrl,identity:access.identity,options:access.options});}
    catch{json(200,{authenticated:false,apiOrigin:await resolvePlatformApiUrl(options.apiOrigin)??'http://127.0.0.1:3000',message:'请登录，或检查账号的发布权限和平台连接。'});}return;
   }
   if(url.pathname==='/api/login'){
    const parsed=z.strictObject({apiOrigin:z.string().url()}).parse(input);
    const {companyLogin}=await import('../commands/login.js');await companyLogin({apiOrigin:parsed.apiOrigin,signal:abort.signal});options.apiOrigin=parsed.apiOrigin;json(200,{authenticated:true});return;
   }
   if(url.pathname==='/api/category'){
    const parsed=z.strictObject({componentId:z.string(),category:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)}).parse(input);
    const access=await publishingAccess(options.apiOrigin);if(!access.options.categories.some(c=>c.id===parsed.category&&c.enabled))throw new Error('CATEGORY_DISABLED');
    const w=await workspace();const affected=w.projects.filter(p=>p.config.variants.some(v=>v.componentId===parsed.componentId)).sort((a,b)=>a.pkg.name.localeCompare(b.pkg.name));
    // Enter every affected package queue in stable order so category updates cannot
    // race a prepare/save on either implementation of the same logical component.
    async function update(index:number):Promise<void>{const p=affected[index];if(!p){for(const project of affected){const old=await fs.readFile(project.configPath,'utf8');const config=JSON.parse(old);for(const v of config.variants)if(v.componentId===parsed.componentId)v.category=parsed.category;validateProjectConfig(config);const temporary=project.configPath+'.'+randomUUID()+'.tmp';await fs.writeFile(temporary,JSON.stringify(config,null,2)+'\n',{flag:'wx'});try{if(await fs.readFile(project.configPath,'utf8')!==old)throw new Error('CONFIG_CONFLICT');await fs.rename(temporary,project.configPath);}finally{await fs.rm(temporary,{force:true});}}return;}await serial(p.pkg.name,()=>withPackageLock(p,()=>update(index+1)));}
    await update(0);json(200,{saved:true});return;
   }
   if(url.pathname==='/api/jobs'){const parsed=z.object({id:z.string().optional()}).parse(input);json(200,parsed.id?jobs.get(parsed.id)??{error:'JOB_UNKNOWN'}:[...jobs.values()]);return;}
   if(url.pathname==='/api/prepare'){
    const {id}=idSchema.parse(input);const p=await resolvePackage(id);
    json(202,startJob(p.pkg.name,'prepare',async log=>{const result=await runProjectCommand('package',['--project',p.root,'--config',configRelative(p)],options.version,{onProgress:log});if(result.exitCode)throw new Error(result.stderr);return JSON.parse(result.stdout);}));return;
   }
   if(url.pathname==='/api/publish'){
    const parsed=z.strictObject({id:z.string(),confirmDigest:z.string().regex(/^[a-f0-9]{64}$/)}).parse(input);const p=await resolvePackage(parsed.id);
    json(202,startJob(p.pkg.name,'publish',async log=>{
     const current=await resolvePackage(parsed.id);const pointer=await readPointer(current);if(!pointer)throw new Error('PREPARE_REQUIRED');
     const bundle=await loadProjectBundle(await projectPath(current.root,pointer.bundleDir));if(await manifestDigest(bundle.manifest)!==parsed.confirmDigest)throw new Error('CONFIRMATION_STALE');
     if(!pointer.inputDigest||pointer.inputDigest!==await inputFingerprint(current))throw new Error('INPUTS_CHANGED');
     const result=await runProjectCommand('release',['--project',current.root,'--config',configRelative(current),...(options.apiOrigin?['--api-url',options.apiOrigin]:[])],options.version,{onProgress:log});if(result.exitCode)throw new Error(result.stderr);return JSON.parse(result.stdout);
    }));return;
   }
   json(404,{error:'ROUTE_UNKNOWN'});
  }catch(error){json(400,{error:error instanceof Error?error.message:'REQUEST_FAILED'});}
 }));
 await new Promise<void>((resolve,reject)=>{server.once('error',error=>reject(new Error((error as NodeJS.ErrnoException).code==='EADDRINUSE'?'PORT_IN_USE: '+(options.port??1111):String(error))));server.listen(options.port??1111,'127.0.0.1',resolve);});
 origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
 try{if(options.bundleDir)frozen=await startFrozenPreview(options.bundleDir,origin);else await workspace();}
 catch(error){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));throw error;}
 return {origin,token,url:origin+'/#'+token,close:async()=>{if(closed)return;closed=true;abort.abort();await selection.catch(()=>{});await active?.close();await candidatePreview?.close();await frozen?.close();await Promise.allSettled([...queues.values()]);server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}

