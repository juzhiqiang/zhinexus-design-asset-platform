import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { InlineConfig,Plugin,PluginOption,ResolvedConfig,UserConfig,ViteDevServer } from 'vite';
import { consumerTemplate } from '../project/consumer.js';
import { projectPath,type LoadedProject,type ProjectVariant } from '../project/config.js';
import { readPlayground } from './examples.js';
import { inOperation,operationSignal } from '../project/lifecycle.js';
import { runLocal } from '../project/process.js';
import { setTimeout as delay } from 'node:timers/promises';
export async function startDevelopmentPreview(project:LoadedProject,variant:ProjectVariant,parentOrigin:string) {
 // This dedicated worker has the same cwd as a normal package-local Vite run.
 process.chdir(project.packageDir);
 const template=await consumerTemplate(project,variant);
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'juz-development-'));const capability=randomBytes(24).toString('hex');const base='/'+capability+'/';
 const allowedRoots=await Promise.all([temporary,project.root].map(root=>fs.realpath(root)));
 const sensitive=/(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|\.git|\.tools|\.zhinexus|\.component-state|\.component-releases|\.component-release[^/]*|\.release-session\.json)(?:\/|$)|\.(?:pem|key|p12|pfx|local)$/i;
 const require=createRequire(path.join(project.packageDir,'package.json'));
 let vite:ViteDevServer|undefined,origin='';
 const controller=new AbortController(),parent=operationSignal();const abort=()=>controller.abort();parent?.addEventListener('abort',abort,{once:true});
 let script:Promise<void>|undefined,scriptError:unknown,stopping=false;
 async function stopScript(){stopping=true;controller.abort();await script;parent?.removeEventListener('abort',abort);}
 const server=createServer(async(request,response)=>{
  response.setHeader('x-content-type-options','nosniff');response.setHeader('cache-control','no-store');response.setHeader('referrer-policy','no-referrer');
  try {
   const url=new URL(request.url??'/',origin);
   if(request.headers.host!==new URL(origin).host||!url.pathname.startsWith(base)||!['GET','HEAD'].includes(request.method??''))throw new Error();
   const decoded=decodeURIComponent(url.pathname);if(decoded.includes('%')||decoded.includes(String.fromCharCode(92)))throw new Error();
   if(sensitive.test(decoded))throw new Error();
   // Do not delegate absolute file authorization to project Vite plugins.
   if(decoded.startsWith(base+'@fs/')){
    const file=await fs.realpath(decoded.slice((base+'@fs/').length));
    if(sensitive.test(file.replace(/\\/g,'/'))||!allowedRoots.some(root=>{const relative=path.relative(root,file);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));}))throw new Error();
   }
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
 const {createServer:createVite,loadConfigFromFile,mergeConfig}=await import(pathToFileURL(viteEntry).href) as typeof import('vite');
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
  let compiler:UserConfig={};
  if(variant.sourceEntry) {
   // This module runs only in the credential-sanitized compiler child. Reuse
   // project compilation settings, never its HTTP/env/filesystem policy.
   const loaded=await loadConfigFromFile({command:'serve',mode:'development'},undefined,project.packageDir);
   const config=loaded?.config??{};
   async function collect(option:PluginOption):Promise<void>{const resolved=await option;if(Array.isArray(resolved)){for(const child of resolved)await collect(child);}else if(resolved)plugins.push(resolved);}
   for(const option of config.plugins??[])await collect(option);
   compiler={resolve:config.resolve,define:config.define,css:{...config.css,postcss:config.css?.postcss??project.packageDir},json:config.json,assetsInclude:config.assetsInclude,esbuild:config.esbuild,oxc:config.oxc};
   const pluginName=variant.framework==='vue'?'@vitejs/plugin-vue':'@vitejs/plugin-react';
   try {if(!plugins.some(plugin=>plugin.name.startsWith('vite:'+variant.framework))){const imported=await import(pathToFileURL(require.resolve(pluginName)).href);plugins.push(...[imported.default()].flat());}}
   catch(error){throw new Error('PROJECT_TOOLCHAIN_REQUIRED: 在组件项目安装 '+pluginName+'；'+String(error));}
  }
  plugins.push({name:'juz-workbench-parent',transformIndexHtml(html){return html.replace('<head>','<head><meta name="juz-parent" content="'+parentOrigin+'">');}});
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
  const policy:InlineConfig={root:temporary,configFile:false,envFile:false,envDir:false,envPrefix:[],publicDir:false,base,cacheDir:path.join(temporary,'.vite'),
   server:{middlewareMode:true,host:'127.0.0.1',origin,cors:false,hmr:{server,path:base+'hmr'},fs:{strict:true,allow:[temporary,project.root],deny:['**/.tools/**','**/.zhinexus/**','**/*.local','**/.git/**','**/.env','**/.env.*','**/.npmrc','**/*.{pem,key,p12,pfx}','**/.component-state/**','**/.component-releases/**','**/.component-release*','**/.release-session.json']}},
  };
  const protectedKeys=['root','configFile','envFile','envDir','envPrefix','publicDir','base','cacheDir'] as const;
  function enforce(config:Pick<UserConfig,'server'>){
   for(const key of protectedKeys)Object.assign(config,{[key]:policy[key]});
   Object.assign(config,{envPrefix:[]});
   config.server={...policy.server,hmr:{server,path:base+'hmr'},fs:{...policy.server!.fs,allow:[temporary,project.root],deny:[...policy.server!.fs!.deny!]}};
  }
  let restoreResolved:(()=>void)|undefined;
  function enforceResolved(config:ResolvedConfig){
   if(!restoreResolved){
    // Vite has normalized Windows paths, disabled publicDir as '', and added
    // its own client directory. Preserve that resolved policy, not raw inputs.
    const top=Object.fromEntries(protectedKeys.map(key=>[key,Reflect.get(config,key)]));
    const network={...config.server},files={...config.server.fs,allow:[...config.server.fs.allow],deny:[...config.server.fs.deny]};
    const hmr=typeof config.server.hmr==='object'?{...config.server.hmr}:config.server.hmr;
    restoreResolved=()=>{Object.assign(config,top,{envPrefix:[]});for(const key of Object.keys(config.server))if(!(key in network))Reflect.deleteProperty(config.server,key);Object.assign(config.server,network,{hmr:typeof hmr==='object'?{...hmr}:hmr,fs:{...files,allow:[...files.allow],deny:[...files.deny]}});};
   }
   restoreResolved();
  }
  // Config hooks run after mergeConfig; resolved/server hooks can mutate again.
  // Keep their compilation lifecycle, restoring the CLI policy after each hook.
  const guarded=plugins.map(plugin=>{
   const result={...plugin};
   if(plugin.config){const hook=plugin.config,handler=typeof hook==='function'?hook:hook.handler;const run:typeof handler=async function(config,env){try{const output=mergeConfig(await handler.call(this,config,env)??{},policy);enforce(output);return output;}finally{enforce(config);}};result.config=typeof hook==='function'?run:{...hook,handler:run};}
   if(plugin.configResolved){const hook=plugin.configResolved,handler=typeof hook==='function'?hook:hook.handler;const run:typeof handler=async function(config){enforceResolved(config);try{await handler.call(this,config);}finally{enforceResolved(config);}};result.configResolved=typeof hook==='function'?run:{...hook,handler:run};}
   if(plugin.configureServer){const hook=plugin.configureServer,handler=typeof hook==='function'?hook:hook.handler;const run:typeof handler=async function(value){enforceResolved(value.config);try{const post=await handler.call(this,value);if(post)return async()=>{try{await post();}finally{enforceResolved(value.config);}};}finally{enforceResolved(value.config);}};result.configureServer=typeof hook==='function'?run:{...hook,handler:run};}
   return result;
  });
  vite=await createVite(mergeConfig(compiler,{...policy,logLevel:'error',plugins:guarded,
   resolve:{alias:[{find:new RegExp('^'+moduleName.replace(/[.*+?^$()|[\]\\]/g,'\\$&')+'$'),replacement:entry}],dedupe:['react','react-dom','vue']},
  }));
  return {origin,url:origin+base+'index.html',mode:variant.sourceEntry?'source':'built-export',close:async()=>{await stopScript();await vite?.close();await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});await fs.rm(temporary,{recursive:true,force:true});}};
 }catch(error){await stopScript();await vite?.close();await new Promise<void>(resolve=>{if(!server.listening){resolve();return;}server.close(()=>resolve());server.closeAllConnections();});await fs.rm(temporary,{recursive:true,force:true});throw error;}
}
