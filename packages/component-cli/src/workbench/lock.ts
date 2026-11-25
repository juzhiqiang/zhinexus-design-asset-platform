import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pointerPath } from './state.js';
import type { LoadedProject } from '../project/config.js';
export async function acquirePackageLock(project:LoadedProject):Promise<()=>Promise<void>>{
 const file=(await pointerPath(project)).replace(/\.json$/,'.lock');await fs.mkdir(path.dirname(file),{recursive:true});const nonce=randomUUID();let handle;
 try{handle=await fs.open(file,'wx');}
 catch(error){
  if(!(error&&typeof error==='object'&&'code'in error&&error.code==='EEXIST'))throw error;
  const old=JSON.parse(await fs.readFile(file,'utf8').catch(()=>'{"pid":0}'));
  if(Number.isSafeInteger(old.pid)&&old.pid>0){try{process.kill(old.pid,0);}catch(e){if(e&&typeof e==='object'&&'code'in e&&e.code==='ESRCH'){await fs.rm(file);return acquirePackageLock(project);}}}
  throw new Error('PACKAGE_BUSY: '+project.pkg.name);
 }
 await handle.writeFile(JSON.stringify({pid:process.pid,nonce}));await handle.close();let released=false;
 return async()=>{if(released)return;released=true;const owner=JSON.parse(await fs.readFile(file,'utf8'));if(owner.nonce===nonce)await fs.rm(file);};
}
export async function withPackageLock<T>(project:LoadedProject,operation:()=>Promise<T>):Promise<T>{const release=await acquirePackageLock(project);try{return await operation();}finally{await release();}}

