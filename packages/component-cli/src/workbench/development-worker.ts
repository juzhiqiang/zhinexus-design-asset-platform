import {startDevelopmentPreview} from './development-runtime.js';
import {inOperation} from '../project/lifecycle.js';
import type {LoadedProject,ProjectVariant} from '../project/config.js';
const controller=new AbortController();let pending:ReturnType<typeof startDevelopmentPreview>|undefined,preview:Awaited<ReturnType<typeof startDevelopmentPreview>>|undefined,closing=false;
async function close(){if(closing)return;closing=true;controller.abort();await pending?.catch(()=>{});await preview?.close();process.exit(0);}
process.on('disconnect',()=>{void close();});
process.on('SIGTERM',()=>{void close();});
process.on('message',message=>{
 if(!message||typeof message!=='object'||!('type'in message))return;
 if(message.type==='close'){void close();return;}
 if(message.type!=='start'||pending||closing)return;
 const input=message as {type:'start';project:LoadedProject;variant:ProjectVariant;parentOrigin:string};
 pending=inOperation(controller.signal,()=>startDevelopmentPreview(input.project,input.variant,input.parentOrigin));
 void pending.then(value=>{preview=value;if(!closing)process.send?.({type:'ready',url:value.url,origin:value.origin,mode:value.mode});},error=>{if(!closing)process.send?.({type:'error',message:String(error)});});
});
