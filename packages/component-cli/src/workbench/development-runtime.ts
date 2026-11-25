import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { Plugin,ViteDevServer } from 'vite';
import { consumerTemplate } from '../project/consumer.js';
import { projectPath,type LoadedProject,type ProjectVariant } from '../project/config.js';
import { readPlayground } from './examples.js';
import { inOperation,operationSignal } from '../project/lifecycle.js';
import { runLocal } from '../project/process.js';
import { setTimeout as delay } from 'node:timers/promises';
export async function startDevelopmentPreview(project:LoadedProject,variant:ProjectVariant,parentOrigin:string) {
 const template=await consumerTemplate(project,variant);
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'juz-development-'));const capability=randomBytes(24).toString('hex');const base='/'+capability+'/';
 const require=createRequire(path.join(project.packageDir,'package.json'));
 let vite:ViteDevServer|undefined,origin='';
 const controller=new AbortController(),parent=operationSignal();const abort=()=>controller.abort();parent?.addEventListener('abort',abort,{once:true});
 let script:Promise<void>|undefined,scriptError:unknown,stopping=false;
 async function stopScript(){stopping=true;controller.abort();await script;parent?.removeEventListener('abort',abort);}
 const server=createServer((request,response)=>{
  response.setHeader('x-content-type-options','nosniff');response.setHeader('cache-control','no-store');response.setHeader('referrer-policy','no-referrer');
  try {
   const url=new URL(request.url??'/',origin);
   if(request.headers.host!==new URL(origin).host||!url.pathname.startsWith(base)||!['GET','HEAD'].includes(request.method??''))throw new Error();
   const decoded=decodeURIComponent(url.pathname);if(decoded.includes('%')||decoded.includes(String.fromCharCode(92)))throw new Error();
   if(/(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|\.git|\.tools|\.zhinexus|\.component-state|\.component-releases|\.component-release[^/]*|\.release-session\.json)(?:\/|$)|\.(?:pem|key|p12|pfx|local)(?:$|\?)/i.test(decoded))throw new Error();
   if(request.headers.origin!==undefined&&!['null',origin,parentOrigin].includes(request.headers.origin))throw new Error();
   if(request.headers.origin)response.setHeader('access-control-allow-origin',request.headers.origin);
   response.setHeader('content-security-policy',"sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' "+origin+"; style-src 'unsafe-inline' "+origin+"; img-src data: blob: "+origin+"; font-src "+origin+"; connect-src "+origin+' '+origin.replace('http:','ws:')+"; base-uri 'none'; frame-ancestors "+parentOrigin);
   if(!vite)throw new Error();
   vite.middlewares(request,response,()=>{response.writeHead(404).end();});
  }catch{response.writeHead(404).end();}
 });
 // An opaque Origin is accepted only together with the current unpredictable
 // capability path; Vite additionally validates its own per-server WebSocket token.
 server.on('upgrade',(request,socket)=>{
  socket.on('error',()=>{});
  const url=new URL(request.url??'/','http://127.0.0.1');
  if(request.headers.host!==new URL(origin).host||!url.pathname.startsWith(base)||!['null',origin].includes(request.headers.origin??''))socket.destroy();
 });
 try {
  for(const relative of template.files){const file=path.join(temporary,relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.copyFile(path.join(template.root,relative),file);}
  if(variant.playground)await fs.writeFile(path.join(temporary,'playground.json'),JSON.stringify((await readPlayground(project,variant)).value));
  // Only the disposable development directory links project dependencies. The
  // actual consumer template remains pristine and frozen validation is unchanged.
  let dependencies=project.packageDir;while(true){try{await fs.access(path.join(dependencies,'node_modules'));break;}catch{if(dependencies===project.root)throw new Error('PROJECT_DEPENDENCIES_REQUIRED: 请先安装项目依赖');dependencies=path.dirname(dependencies);}}
  await fs.symlink(path.join(dependencies,'node_modules'),path.join(temporary,'node_modules'),'junction');
  let viteEntry:string;try{viteEntry=require.resolve('vite');}catch{if(variant.sourceEntry)throw new Error('PROJECT_TOOLCHAIN_REQUIRED: 请在组件项目安装 Vite');viteEntry=createRequire(import.meta.url).resolve('vite');}
 const {createServer:createVite}=await import(pathToFileURL(viteEntry).href) as typeof import('vite');
  const moduleName=project.pkg.name+variant.exportPath.slice(1);
  let entry:string;
  if(variant.sourceEntry)entry=await projectPath(project.root,variant.sourceEntry);
  else {
   const pkg=JSON.parse(await fs.readFile(path.join(project.packageDir,'package.json'),'utf8'));
   let target=typeof pkg.exports==='string'?pkg.exports:pkg.exports?.[variant.exportPath]??(variant.exportPath==='.'?pkg.exports:undefined);
   while(target&&typeof target==='object')target=target.import??target.browser??target.default;
   if(typeof target!=='string')target=variant.exportPath==='.'?pkg.module??pkg.main:undefined;
   if(typeof target!=='string')throw new Error('BUILD_EXPORT_MISSING: 请构建组件包或登记 sourceEntry');
   entry=await projectPath(project.packageDir,target,true);
   const command=project.config.dev[variant.framework];
   if(command)script=inOperation(controller.signal,()=>runLocal(command,project.packageDir,()=>{},0)).catch(error=>{if(!stopping){scriptError=error;vite?.ws.send({type:'error',err:{message:String(error),stack:''}});}});
   const deadline=Date.now()+60_000;while(true){controller.signal.throwIfAborted();if(scriptError)throw scriptError;try{if((await fs.stat(entry)).isFile())break;}catch(error){if(!(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT'))throw error;}if(!command||Date.now()>deadline)throw new Error('BUILD_EXPORT_MISSING: 请构建组件包或登记 sourceEntry');await delay(50,undefined,{signal:controller.signal});}
  }
  const plugins:Plugin[]=[];
  if(variant.sourceEntry) {
   const pluginName=variant.framework==='vue'?'@vitejs/plugin-vue':'@vitejs/plugin-react';
   try {const imported=await import(pathToFileURL(require.resolve(pluginName)).href);plugins.push(...[imported.default()].flat());}
   catch(error){throw new Error('PROJECT_TOOLCHAIN_REQUIRED: 在组件项目安装 '+pluginName+'；'+String(error));}
  }
  plugins.push({name:'juz-workbench-parent',transformIndexHtml(html){return html.replace('<head>','<head><meta name="juz-parent" content="'+parentOrigin+'">');}});
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
  vite=await createVite({root:temporary,configFile:false,envFile:false,envDir:false,envPrefix:[],base,logLevel:'error',plugins,
   resolve:{alias:[{find:new RegExp('^'+moduleName.replace(/[.*+?^$()|[\]\\]/g,'\\$&')+'$'),replacement:entry}],dedupe:['react','react-dom','vue']},
   server:{middlewareMode:true,host:'127.0.0.1',origin,cors:false,hmr:{server,path:base+'hmr'},fs:{strict:true,allow:[temporary,project.root],deny:['**/.tools/**','**/.zhinexus/**','**/*.local','**/.git/**','**/.env','**/.env.*','**/.npmrc','**/*.{pem,key,p12,pfx}','**/.component-state/**','**/.component-releases/**','**/.component-release*','**/.release-session.json']}},
  });
  return {origin,url:origin+base+'index.html',mode:variant.sourceEntry?'source':'built-export',close:async()=>{await stopScript();await vite?.close();await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});await fs.rm(temporary,{recursive:true,force:true});}};
 }catch(error){await stopScript();await vite?.close();await new Promise<void>(resolve=>{if(!server.listening){resolve();return;}server.close(()=>resolve());server.closeAllConnections();});await fs.rm(temporary,{recursive:true,force:true});throw error;}
}
