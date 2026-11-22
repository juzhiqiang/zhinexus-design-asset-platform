import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer,request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect,it } from 'vitest';
import { workerHarness,realRegistry } from './t06-support.js';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { buildServer } from '../../apps/preview-gateway/dist/app.js';
import { Database } from '../../apps/api/dist/db/database.js';

it('checks two release TLS hosts and switches IP/domain grants with monotonic rollback generations',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'zh-preview-switch-')),key=join(dir,'key.pem'),cert=join(dir,'cert.pem');
  execFileSync('C:/Program Files/Git/usr/bin/openssl.exe',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=preview-local','-addext','subjectAltName=IP:127.0.0.1,DNS:*.preview.assets.test'],{stdio:'ignore',windowsHide:true});
  const pem=await readFile(cert,'utf8');let gatewayPort=0;let wrongGateway=false;
  const visited:string[]=[];const forwarded:import('node:http').IncomingHttpHeaders[]=[];
  const tls=createServer({key:await readFile(key),cert:pem},(request,response)=>{
    visited.push(request.headers.host!);
    if(wrongGateway){response.setHeader('content-type','application/json');response.end('{"service":"other"}');return;}
    const headers={...request.headers};delete headers.cookie;delete headers.authorization;
    if(request.headers.host?.startsWith('r-') && request.url!=='/access-probe'){
      const previewCookies=(request.headers.cookie ?? '').split(';').map(value=>value.trim()).filter(value=>value.startsWith('__Host-preview='));
      if(previewCookies.length===1 && /^__Host-preview=[A-Za-z0-9_-]{43}$/u.test(previewCookies[0]!))headers.cookie=previewCookies[0];
    }
    forwarded.push(headers);
    const upstream=httpRequest({hostname:'127.0.0.1',port:gatewayPort,path:request.url,method:request.method,headers},reply=>{response.writeHead(reply.statusCode!,reply.headers);reply.pipe(response);});
    upstream.on('error',()=>{response.statusCode=502;response.end();});request.pipe(upstream);
  });
  await new Promise<void>(resolve=>tls.listen(0,'127.0.0.1',resolve));
  const port=(tls.address() as {port:number}).port;
  const preview={mode:'ip-port' as const,platformOrigin:'https://127.0.0.1:4443',apiOrigin:'https://127.0.0.1:4444',previewOrigin:`https://127.0.0.1:${port}`};
  const h=await workerHarness(undefined,{preview,access:{apiOrigin:preview.apiOrigin,administrators:[{issuer:'https://issuer.t05.test',subject:'operator'}],outbound:[{hostname:'127.0.0.1',port,networks:['127.0.0.1/32']},{hostname:'*.preview.assets.test',port,networks:['127.0.0.1/32']}],ca:pem,gatewayId:'local-preview'},accessLookup:async()=>[{address:'127.0.0.1',family:4}]});
  const reader='access_preview_'+randomUUID().replaceAll('-','');
  let gateway:Awaited<ReturnType<typeof buildServer>> | undefined,roleCreated=false;
  try {
  await h.db.query('CREATE ROLE '+reader+' NOLOGIN');roleCreated=true;
  await h.db.query((await readFile('infra/gateway/preview-role.sql','utf8')).replaceAll('preview_reader',reader));
  const readerUrl=new URL(h.options.databaseUrl);readerUrl.searchParams.set('options','-c role='+reader);
  const permissions=new Database(readerUrl.href);
  try {
    await expect(permissions.query("UPDATE access_active SET generation=generation+1 WHERE section='oidc'")).rejects.toMatchObject({code:'42501'});
    await expect(permissions.query('SELECT * FROM oidc_sessions')).rejects.toMatchObject({code:'42501'});
    await expect(permissions.query('SELECT * FROM identity_bindings')).rejects.toMatchObject({code:'42501'});
  }finally {await permissions.close();}
  gateway=await buildServer({databaseUrl:readerUrl.href,storage:h.options.storage,preview,deploymentId:'local-preview'});
  await gateway.listen(0,'127.0.0.1');gatewayPort=Number(new URL(await gateway.getUrl()).port);
  const get=(path:string,host:string,cookie?:string)=>new Promise<{status:number;headers:import('node:http').IncomingHttpHeaders}>((resolve,reject)=>{
    const req=httpsRequest({hostname:new URL('https://'+host).hostname,port,path,ca:pem,lookup:(_hostname,_options,callback)=>callback(null,[{address:'127.0.0.1',family:4}]),headers:{host,authorization:'Bearer ingress-canary',...(cookie?{cookie}:{})}},response=>{response.resume();response.on('end',()=>resolve({status:response.statusCode!,headers:response.headers}));});req.on('error',reject);req.end();
  });
    await new ReleaseWorker(h.db,h.store,await realRegistry()).runOnce(h.jobId);
    const id=(await h.db.query("SELECT id FROM variant_releases WHERE variant_id='line-vue'")).rows[0]!.id;
    const token=await h.token('operator',['reader']);
    const mutate=(section:string,action:string,body:unknown)=>h.request(`/v1/access-settings/${section}/${action}`,body,token);
    const grant=async()=>{const result=await h.request('/v1/preview-grants',{variantReleaseId:id},h.auth);expect(result.status).toBe(201);return result.json();};
    const legacy=await grant();
    const first=await mutate('preview','draft',{expectedGeneration:'0',expectedRevision:null,config:{mode:'ip-port',previewOrigin:preview.previewOrigin}});
    const firstRevision=(await first.json()).sections.preview.draft.id;
    expect((await (await mutate('preview','validate',{expectedGeneration:'0',revision:firstRevision})).json()).sections.preview.draft.checks.gateway).toBe('passed');
    const activated=await mutate('preview','activate',{expectedGeneration:'0',revision:firstRevision});
    expect(activated.status).toBe(200);
    expect((await activated.json()).sections.preview.gatewayGeneration).toBe('1');
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
    expect((await get(redeemed.headers.location!,url.host,'__Host-platform=private; '+session+'; other=private')).status).toBe(200);
    expect(forwarded.at(-1)?.cookie).toBe(session);expect(forwarded.at(-1)?.authorization).toBeUndefined();
    expect((await get(redeemed.headers.location!,url.host,session+'; '+session)).status).toBe(404);
    expect((await mutate('preview','rollback',{expectedGeneration:'2',revision:firstRevision})).status).toBe(200);
    expect((await get(redeemed.headers.location!,url.host,session)).status).toBe(404);
    const oldIp=new URL(ipGrant.bootstrapUrl);expect((await get(oldIp.pathname+oldIp.search,oldIp.host)).status).toBe(404);
    const view=await (await h.request('/v1/access-settings',undefined,token,'GET')).json();expect(view.sections.preview.generation).toBe('3');
    const current=await grant(),currentUrl=new URL(current.bootstrapUrl);
    const currentSession=await get(currentUrl.pathname+currentUrl.search,currentUrl.host);
    expect(currentSession.status).toBe(303);
    const pending=await grant(),pendingUrl=new URL(pending.bootstrapUrl);
    await h.db.query("INSERT INTO subject_role_restrictions(subject,role) VALUES ('alice','publisher')");
    expect((await get(currentSession.headers.location!,currentUrl.host)).status).toBe(404);
    expect((await get(pendingUrl.pathname+pendingUrl.search,pendingUrl.host)).status).toBe(404);
    expect((await h.request('/v1/preview-grants',{variantReleaseId:id},h.auth)).status).toBe(403);
  }finally{
    try {await gateway?.close();if(roleCreated){await h.db.query('DROP OWNED BY '+reader);await h.db.query('DROP ROLE '+reader);}}
    finally {await h.close();await new Promise<void>(resolve=>tls.close(()=>resolve()));await rm(dir,{recursive:true,force:true});}
  }
});
