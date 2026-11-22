import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect,it } from 'vitest';

it('runs both Nginx templates and forwards only the domain preview cookie while filtering probe and IP credentials',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'zh-access-ingress-')),name='zh-access-ingress-'+randomUUID();
  const docker=(args:string[])=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:20_000}).trim();
  const upstream=createServer((req,res)=>{
    res.setHeader('content-type','application/json');
    res.setHeader('Set-Cookie','__Host-preview='+'a'.repeat(43)+'; Secure; HttpOnly; Path=/');
    res.end(JSON.stringify({host:req.headers.host,cookie:req.headers.cookie,authorization:req.headers.authorization}));
  });
  await new Promise<void>(resolve=>upstream.listen(0,'0.0.0.0',resolve));
  let created=false;
  try {
    const upstreamPort=(upstream.address() as {port:number}).port;
    execFileSync('C:/Program Files/Git/usr/bin/openssl.exe',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=preview-local','-addext','subjectAltName=IP:127.0.0.1,DNS:*.preview.company-assets.net'],{stdio:'ignore',windowsHide:true});
    const templates=await Promise.all(['preview.conf','preview-ip.conf'].map(file=>readFile(join('infra/gateway',file),'utf8')));
    const configure=(source:string)=>source.replaceAll('127.0.0.1:3001','host.docker.internal:'+upstreamPort).replace(/\/run\/secrets\/preview(?:-ip)?-fullchain.pem/g,'/fixtures/cert.pem').replace(/\/run\/secrets\/preview(?:-ip)?-key.pem/g,'/fixtures/key.pem');
    await writeFile(join(dir,'nginx.conf'),'events {}\nhttp {\n'+templates.map(configure).join('\n')+'\n}\n');
    // Resolve the already installed image to its immutable ID; this test never pulls a floating image.
    const image=docker(['image','inspect','nginx:latest','--format','{{.Id}}']);
    expect(image).toMatch(/^sha256:[a-f0-9]{64}$/);
    const mount=['--mount','type=bind,source='+dir+',target=/fixtures,readonly'];
    expect(docker(['run','--rm',...mount,'--entrypoint','nginx',image,'-t','-c','/fixtures/nginx.conf'])).toBe('');
    docker(['run','--detach','--name',name,...mount,'-p','127.0.0.1::443','-p','127.0.0.1::8443',image,'nginx','-c','/fixtures/nginx.conf','-g','daemon off;']);created=true;
    const domainPort=Number(docker(['port',name,'443/tcp']).split(':').at(-1)),ipPort=Number(docker(['port',name,'8443/tcp']).split(':').at(-1));
    const ca=await readFile(join(dir,'cert.pem'));
    const call=(mode:'domain'|'ip',path:string,cookie:string)=>new Promise<{status:number;headers:import('node:http').IncomingHttpHeaders;body:Record<string,string>}>((resolve,reject)=>{
      const port=mode==='domain'?domainPort:ipPort;
      const hostname=mode==='domain'?'r-123e4567-e89b-42d3-a456-426614174000.preview.company-assets.net':'127.0.0.1';
      const req=request({hostname,port,path,ca,lookup:(_hostname,_options,callback)=>callback(null,[{address:'127.0.0.1',family:4}]),headers:{cookie,authorization:'Bearer private-ingress',host:hostname+':'+port}},res=>{
        const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(Buffer.from(chunk)));res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,body:JSON.parse(Buffer.concat(chunks).toString())}));
      });req.on('error',reject);req.end();
    });
    const preview='__Host-preview='+'a'.repeat(43),mixed='platform=private; '+preview+'; __Host-platform=private';
    const domain=await call('domain','/preview/example/index.html',mixed);
    expect(domain.status).toBe(200);expect(domain.body.cookie).toBe(preview);expect(domain.body.authorization).toBeUndefined();
    expect(domain.body.host).toContain(':'+domainPort);expect(domain.headers['set-cookie']).toHaveLength(1);
    for(const value of [preview+'; '+preview,'__Host-preview=invalid; '+preview,'__Host-preview=invalid',preview+'; __Host-preview=invalid'])expect((await call('domain','/preview/example/index.html',value)).body.cookie).toBeUndefined();
    const probe=await call('domain','/access-probe',mixed);expect(probe.body.cookie).toBeUndefined();expect(probe.body.authorization).toBeUndefined();
    for(const path of ['/bootstrap','/_preview/session/index.html','/access-probe']){
      const ip=await call('ip',path,mixed);expect(ip.status).toBe(200);expect(ip.body.cookie).toBeUndefined();expect(ip.body.authorization).toBeUndefined();expect(ip.headers['set-cookie']).toBeUndefined();
    }
  }finally{
    if(created)docker(['rm','--force',name]);
    await new Promise<void>(resolve=>upstream.close(()=>resolve()));await rm(dir,{recursive:true,force:true});
  }
});
