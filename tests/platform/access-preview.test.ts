import { execFileSync } from 'node:child_process';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect,it } from 'vitest';
import { workerHarness,realRegistry } from './t06-support.js';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { buildServer } from '../../apps/preview-gateway/dist/app.js';

it('checks two release TLS hosts and switches IP/domain grants with monotonic rollback generations',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'zh-preview-switch-')),key=join(dir,'key.pem'),cert=join(dir,'cert.pem');
  execFileSync('C:/Program Files/Git/usr/bin/openssl.exe',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=preview-local','-addext','subjectAltName=IP:127.0.0.1,DNS:*.preview.assets.test'],{stdio:'ignore',windowsHide:true});
  const pem=await readFile(cert,'utf8');let gatewayPort=0;let wrongGateway=false;
  const visited:string[]=[];
  const tls=createServer({key:await readFile(key),cert:pem},(request,response)=>{
    visited.push(request.headers.host!);
    if(wrongGateway){response.setHeader('content-type','application/json');response.end('{"service":"other"}');return;}
    const headers={...request.headers};delete headers.cookie;delete headers.authorization;
    const upstream=httpRequest({hostname:'127.0.0.1',port:gatewayPort,path:request.url,method:request.method,headers},reply=>{response.writeHead(reply.statusCode!,reply.headers);reply.pipe(response);});
    upstream.on('error',()=>{response.statusCode=502;response.end();});request.pipe(upstream);
  });
  await new Promise<void>(resolve=>tls.listen(0,'127.0.0.1',resolve));
  const port=(tls.address() as {port:number}).port;
  const preview={mode:'ip-port' as const,platformOrigin:'https://127.0.0.1:4443',apiOrigin:'https://127.0.0.1:4444',previewOrigin:`https://127.0.0.1:${port}`};
  const h=await workerHarness(undefined,{preview,access:{apiOrigin:preview.apiOrigin,administrators:[{issuer:'https://issuer.t05.test',subject:'operator'}],outbound:[{hostname:'127.0.0.1',port,networks:['127.0.0.1/32']},{hostname:'*.preview.assets.test',port,networks:['127.0.0.1/32']}],ca:pem,gatewayId:'local-preview'},accessLookup:async()=>[{address:'127.0.0.1',family:4}]});
  const gateway=await buildServer({databaseUrl:h.options.databaseUrl,storage:h.options.storage,preview,deploymentId:'local-preview'});
  await gateway.listen(0,'127.0.0.1');gatewayPort=Number(new URL(await gateway.getUrl()).port);
  const get=(path:string,host:string,cookie?:string)=>new Promise<{status:number;headers:import('node:http').IncomingHttpHeaders}>(resolve=>{
    const req=httpRequest({hostname:'127.0.0.1',port:gatewayPort,path,headers:{host,...(cookie?{cookie}:{})}},response=>{response.resume();response.on('end',()=>resolve({status:response.statusCode!,headers:response.headers}));});req.end();
  });
  try{
    await new ReleaseWorker(h.db,h.store,await realRegistry()).runOnce(h.jobId);
    const id=(await h.db.query("SELECT id FROM variant_releases WHERE variant_id='line-vue'")).rows[0]!.id;
    const token=await h.token('operator',['reader']);
    const mutate=(section:string,action:string,body:unknown)=>h.request(`/v1/access-settings/${section}/${action}`,body,token);
    const grant=async()=>{const result=await h.request('/v1/preview-grants',{variantReleaseId:id},h.auth);expect(result.status).toBe(201);return result.json();};
    const legacy=await grant();
    const first=await mutate('preview','draft',{expectedGeneration:'0',expectedRevision:null,config:{mode:'ip-port',previewOrigin:preview.previewOrigin}});
    const firstRevision=(await first.json()).sections.preview.draft.id;
    expect((await (await mutate('preview','validate',{expectedGeneration:'0',revision:firstRevision})).json()).sections.preview.draft.checks.gateway).toBe('passed');
    expect((await mutate('preview','activate',{expectedGeneration:'0',revision:firstRevision})).status).toBe(200);
    const legacyUrl=new URL(legacy.bootstrapUrl);expect((await get(legacyUrl.pathname+legacyUrl.search,legacyUrl.host)).status).toBe(404);
    const ipGrant=await grant();expect(ipGrant.mode).toBe('ip-port');
    const second=await mutate('preview','draft',{expectedGeneration:'1',expectedRevision:firstRevision,config:{mode:'domain',previewOrigin:`https://preview.assets.test:${port}`}});
    expect(second.status).toBe(200);const secondRevision=(await second.json()).sections.preview.draft.id;
    wrongGateway=true;
    const failed=await (await mutate('preview','validate',{expectedGeneration:'1',revision:secondRevision})).json();
    expect(failed.sections.preview.draft.checks.routing).toBe('failed');
    expect((await mutate('preview','activate',{expectedGeneration:'1',revision:secondRevision})).status).toBe(409);
    wrongGateway=false;
    const checks=await (await mutate('preview','validate',{expectedGeneration:'1',revision:secondRevision})).json();
    expect(checks.sections.preview.draft.checks).toMatchObject({dns:'passed',tls:'passed',routing:'passed',gateway:'passed'});
    expect(new Set(visited.filter(host=>host.startsWith('r-'))).size).toBeGreaterThanOrEqual(2);
    expect((await mutate('preview','activate',{expectedGeneration:'1',revision:secondRevision})).status).toBe(200);
    const domain=await grant();expect(domain.mode).toBe('domain');const url=new URL(domain.bootstrapUrl);
    const redeemed=await get(url.pathname+url.search,url.host);expect(redeemed.status).toBe(303);
    const session=redeemed.headers['set-cookie']![0]!.split(';')[0]!;
    expect((await get(redeemed.headers.location!,url.host,session)).status).toBe(200);
    expect((await mutate('preview','rollback',{expectedGeneration:'2',revision:firstRevision})).status).toBe(200);
    expect((await get(redeemed.headers.location!,url.host,session)).status).toBe(404);
    const oldIp=new URL(ipGrant.bootstrapUrl);expect((await get(oldIp.pathname+oldIp.search,oldIp.host)).status).toBe(404);
    const view=await (await h.request('/v1/access-settings',undefined,token,'GET')).json();expect(view.sections.preview.generation).toBe('3');
  }finally{await gateway.close();await h.close();await new Promise<void>(resolve=>tls.close(()=>resolve()));await rm(dir,{recursive:true,force:true});}
});
