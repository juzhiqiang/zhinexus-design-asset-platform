import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { startWorkbench } from './server.js';
import type { ProjectCliContext } from '../commands/project.js';
import { readWorkspace,selectProject } from './workspace.js';
export async function runWorkbenchCommand(command:string,args:readonly string[],version:string,context:ProjectCliContext){
 try{
  const options:Record<string,string>={};let open=true;
  for(let i=0;i<args.length;i++){const key=args[i]!;if(key==='--no-open'){open=false;continue;}const value=args[++i];if(!['--project','--config','--port','--bundle-dir','--api-url','--package','--framework'].includes(key)||!value||value.startsWith('--')||options[key]!==undefined)throw new Error('ARGUMENT_INVALID: '+key);options[key]=value;}
  const port=options['--port']===undefined?1111:Number(options['--port']);if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error('PORT_INVALID: 端口应为 1–65535');
  if(command==='preview'&&!options['--bundle-dir'])throw new Error('ARGUMENT_REQUIRED: preview --bundle-dir <目录>');
  if(options['--framework']&&!['react','vue'].includes(options['--framework']))throw new Error('ARGUMENT_INVALID: --framework');
  const root=await fs.realpath(options['--project']??context.cwd??process.cwd());
  if(command!=='preview'){
   const workspace=await readWorkspace(root,options['--config']);
   const project=options['--package']?await selectProject(workspace,options['--package']):undefined;
   if(project)options['--package']=project.pkg.name;
   if(options['--framework']&&!(project?[project]:workspace.projects).some(p=>p.config.variants.some(v=>v.framework===options['--framework'])))throw new Error('FRAMEWORK_NOT_CONFIGURED: '+options['--framework']);
  }
  const service=await startWorkbench({root,version,port,configFile:options['--config'],apiOrigin:options['--api-url'],bundleDir:command==='preview'?path.resolve(root,options['--bundle-dir']!):undefined,log:context.onProgress});
  const url=new URL(service.url);if(options['--package'])url.searchParams.set('package',options['--package']);if(options['--framework'])url.searchParams.set('framework',options['--framework']);
  let closing=false;
  const stop=()=>{if(closing)return;closing=true;void service.close().finally(()=>{process.off('SIGINT',stop);process.off('SIGTERM',stop);});};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  if(open)await new Promise<void>(resolve=>{const child=process.platform==='win32'?spawn('rundll32.exe',['url.dll,FileProtocolHandler',url.href],{windowsHide:true,stdio:'ignore'}):spawn(process.platform==='darwin'?'open':'xdg-open',[url.href],{stdio:'ignore'});child.once('error',()=>{context.onProgress?.('自动打开浏览器失败，请打开输出中的完整 url。');resolve();});child.once('spawn',()=>{child.unref();resolve();});});
  return {exitCode:0,stdout:JSON.stringify({url:url.href,mode:command==='preview'?'frozen':'development',host:'127.0.0.1',port})+'\n',stderr:''};
 }catch(error){return {exitCode:1,stdout:'',stderr:(error instanceof Error?error.message:String(error))+'\n'};}
}
