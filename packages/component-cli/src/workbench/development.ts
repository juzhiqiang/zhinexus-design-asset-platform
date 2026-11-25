import {fork} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import type {LoadedProject,ProjectVariant} from '../project/config.js';
import {componentEnvironment,operationSignal,terminateTree} from '../project/lifecycle.js';
/** Project compilers and watchers run without access to the credential-holding process. */
export async function startDevelopmentPreview(project:LoadedProject,variant:ProjectVariant,parentOrigin:string){
 const signal=operationSignal();const source=import.meta.url.endsWith('.ts');
 const entry=new URL('./development-worker.'+(source?'ts':'js'),import.meta.url);
 const child=fork(fileURLToPath(entry),[],{env:componentEnvironment(),execArgv:source?['--import',pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href]:[],windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe','ipc']});
 let errors='',stopped:Promise<void>|undefined;
 for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>{errors=(errors+String(chunk)).slice(-8192);});
 const exited=new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.once('error',()=>resolve());});
 const close=()=>stopped??=(async()=>{signal?.removeEventListener('abort',abort);const timer=setTimeout(()=>{void terminateTree(child);},3000);try{if(child.connected)child.send({type:'close'},()=>{});await exited;}finally{clearTimeout(timer);}})();
 const abort=()=>{void close();};signal?.addEventListener('abort',abort,{once:true});
 try{
  const result=await new Promise<{origin:string;url:string;mode:'source'|'built-export'}>((resolve,reject)=>{
   const timer=setTimeout(()=>{reject(new Error('PREVIEW_START_TIMEOUT'));void close();},90000);
   child.once('error',error=>{clearTimeout(timer);reject(error);});
   child.once('exit',()=>{clearTimeout(timer);reject(new Error('PREVIEW_PROCESS_EXIT: '+errors));});
   child.on('message',message=>{if(!message||typeof message!=='object'||!('type'in message))return;const value=message as Record<string,unknown>;
    if(value.type==='ready'&&typeof value.url==='string'&&typeof value.origin==='string'&&['source','built-export'].includes(String(value.mode))){clearTimeout(timer);resolve({url:value.url,origin:value.origin,mode:value.mode as 'source'|'built-export'});}
    else if(value.type==='error'){clearTimeout(timer);reject(new Error(String(value.message)));}
   });
   child.send({type:'start',project,variant,parentOrigin});if(signal?.aborted)abort();
  });
  return {...result,close};
 }catch(error){await close();throw error;}
}
