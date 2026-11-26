import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach,expect,it } from 'vitest';
import { runCli } from '../../packages/component-cli/src/cli.js';
import { request } from 'node:http';
import { createServer } from 'node:net';
const roots:string[]=[];const running:{close:()=>Promise<void>}[]=[];
afterEach(async()=>{for(const r of running.splice(0))await r.close();for(const r of roots.splice(0))await fs.rm(r,{recursive:true,force:true});});
it('binds control to loopback, requires session plus exact Host and Origin, and rejects frame mutations',async()=>{
 const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'juz-control-'));roots.push(cwd);await runCli(['create','demo','--framework','react'],'0.1.0',{cwd});
 const {startWorkbench}=await import('../../packages/component-cli/src/workbench/server.js');
 const service=await startWorkbench({root:path.join(cwd,'demo'),version:'0.1.0',port:0});running.push(service);
 const endpoint=service.origin+'/api/catalog';
 expect((await fetch(endpoint)).status).toBe(403);
 expect((await fetch(endpoint,{headers:{'x-juz-session':service.token,origin:'null'}})).status).toBe(403);
 expect((await fetch(endpoint,{headers:{'x-juz-session':service.token,origin:'http://evil.example'}})).status).toBe(403);
 const rejectedHost=await new Promise<number|undefined>((resolve,reject)=>{const req=request(endpoint,{headers:{'x-juz-session':service.token,origin:service.origin,host:'evil.example'}},response=>{response.resume();resolve(response.statusCode);});req.on('error',reject);req.end();});
 expect(rejectedHost).toBe(403);
 const auth={'x-juz-session':service.token,origin:service.origin};
 const response=await fetch(endpoint,{headers:auth});expect(response.status).toBe(200);expect((await response.json()).variants).toHaveLength(1);
 const catalog=await (await fetch(endpoint,{headers:auth})).json();
 const variant=catalog.variants[0];const invalid=structuredClone(variant.example);invalid.props.label=42;invalid.controls=[];
 const validation=await fetch(service.origin+'/api/validate',{method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({id:variant.id,digest:variant.digest,value:invalid})});
 expect(validation.status).toBe(400);expect(await validation.text()).toContain('PLAYGROUND_INVALID');
 expect((await fetch(service.origin+'/.env',{headers:auth})).status).toBe(404);
 expect((await fetch(service.origin+'/api/save',{method:'POST',headers:{'content-type':'application/json',origin:'null'},body:'{}'})).status).toBe(403);
 const port=Number(new URL(service.origin).port);
 await expect(startWorkbench({root:path.join(cwd,'demo'),version:'0.1.0',port})).rejects.toThrow('PORT_IN_USE');
 const html=await (await fetch(service.origin)).text();expect(html).not.toContain(service.token);
});

it.each([['missing','vue'],['demo-react','vue']])('rejects package/framework selection before starting any listener: %s %s',async(selected,framework)=>{
 const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'juz-selection-'));roots.push(cwd);await runCli(['create','demo','--framework','all'],'0.1.0',{cwd});
 const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));
 const result=await runCli(['dev','--project',path.join(cwd,'demo'),'--package',selected,'--framework',framework,'--port',String(port),'--no-open'],'0.1.0',{cwd});
 // A regressed implementation starts a service; close it via its own lifecycle
 // signal after probing so the assertion cannot leave the test worker hanging.
 let occupied=false;const check=createServer();try{await new Promise<void>((resolve,reject)=>{check.once('error',reject);check.listen(port,'127.0.0.1',resolve);});}catch{occupied=true;}finally{if(check.listening)await new Promise<void>(r=>check.close(()=>r()));if(result.exitCode===0)process.emit('SIGINT');}
 expect(result.exitCode).toBe(1);expect(result.stderr).toMatch(/PACKAGE_SELECTION_REQUIRED|FRAMEWORK_NOT_CONFIGURED/);expect(occupied).toBe(false);
});
