import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {expect,it} from 'vitest';
import {runLocal} from '../../packages/component-cli/src/project/process.js';

it('aborts a pending publication HTTP request when the workbench operation closes',async()=>{
 const {createServer}=await import('node:http');const {makeFixture}=await import('../fixtures/releases/g1/factory.js');const {executeReleaseCommand}=await import('../../packages/component-cli/src/local/release.js');const {inOperation}=await import('../../packages/component-cli/src/project/lifecycle.js');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'juz-abort-upload-'));const fixture=makeFixture('cli');
 for(const [name,bytes]of fixture.files){await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),bytes);}await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify(fixture.manifest));
 let requested=false,settled=false;const server=createServer(request=>{requested=true;request.resume();});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const controller=new AbortController();const running=inOperation(controller.signal,()=>executeReleaseCommand({bundleDir:root,apiUrl:'http://127.0.0.1:'+(server.address() as {port:number}).port,token:'mock-token'})).catch(()=>{}).finally(()=>{settled=true;});
 try{await expect.poll(()=>requested).toBe(true);controller.abort();await expect.poll(()=>settled,{timeout:700}).toBe(true);}
 finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await running;await fs.rm(root,{recursive:true,force:true});}
});

it('cancels an owned component process tree and closes its children',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'juz-child-tree-'));const controller=new AbortController();
 const {inOperation}=await import('../../packages/component-cli/src/project/lifecycle.js');
 const running=inOperation(controller.signal,()=>runLocal({program:process.execPath,args:['-e',"const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('node:fs').writeFileSync('pids.json',JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);"]},root));
 const rejected=expect(running).rejects.toThrow('LOCAL_COMMAND_FAILED');
 try{await expect.poll(async()=>{try{return JSON.parse(await fs.readFile(path.join(root,'pids.json'),'utf8'));}catch{return[];}}).toHaveLength(2);
  const pids=JSON.parse(await fs.readFile(path.join(root,'pids.json'),'utf8'));controller.abort();await rejected;
  for(const pid of pids)await expect.poll(()=>{try{process.kill(pid,0);return true;}catch{return false;}}).toBe(false);
 }finally{controller.abort();await running.catch(()=>{});await fs.rm(root,{recursive:true,force:true});}
});
it('does not forward platform credentials to component build processes',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'juz-child-env-'));process.env.ZHINEXUS_API_TOKEN='synthetic-test-secret';
 try{await runLocal({program:process.execPath,args:['-e',"require('fs').writeFileSync('environment.json',JSON.stringify({secret:process.env.ZHINEXUS_API_TOKEN,path:!!process.env.PATH}))"]},root);
 expect(JSON.parse(await fs.readFile(path.join(root,'environment.json'),'utf8'))).toEqual({path:true});}
 finally{delete process.env.ZHINEXUS_API_TOKEN;await fs.rm(root,{recursive:true,force:true});}
});

