import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn,type ChildProcess } from 'node:child_process';
const operation=new AsyncLocalStorage<AbortSignal>();
export function componentEnvironment():NodeJS.ProcessEnv {
 return {...Object.fromEntries(Object.entries(process.env).filter(([key])=>!/(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|COOKIE|AUTHORIZATION|PRIVATE_KEY|ACCESS_KEY)|^(?:PLATFORM_|ZHINEXUS_|DATABASE_URL$|PGPASSWORD$|AWS_|AZURE_|GOOGLE_)/i.test(key))),NODE_PATH:'',NODE_OPTIONS:''};
}
export function inOperation<T>(signal:AbortSignal,action:()=>Promise<T>){return operation.run(signal,action);}
export function operationSignal(){const signal=operation.getStore();signal?.throwIfAborted();return signal;}
export function operationTimeout(milliseconds:number){const signal=operationSignal();return signal?AbortSignal.any([signal,AbortSignal.timeout(milliseconds)]):AbortSignal.timeout(milliseconds);}
export async function terminateTree(child:ChildProcess):Promise<void>{
 if(!child.pid||child.exitCode!==null)return;
 if(process.platform==='win32')await new Promise<void>(resolve=>{const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>{child.kill();resolve();});killer.on('close',()=>resolve());});
 else {try{process.kill(-child.pid,'SIGTERM');}catch{child.kill();}}
}
export function bindChild(child:ChildProcess){const signal=operation.getStore();const abort=()=>{void terminateTree(child);};signal?.addEventListener('abort',abort,{once:true});child.once('close',()=>signal?.removeEventListener('abort',abort));if(signal?.aborted)abort();}

