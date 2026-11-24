import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { expect, it } from 'vitest';
import { platformHarness } from './http-support.js';
import { companyLogin } from '../../packages/component-cli/dist/commands/login.js';

it('runs candidate Web/CLI PKCE, isolates permissions and invalidates sessions after activation and rollback', async () => {
  const dir = await mkdtemp(join(tmpdir(),'zh-oidc-'));
  const cert = join(dir,'cert.pem'), key = join(dir,'key.pem');
  execFileSync('C:/Program Files/Git/usr/bin/openssl.exe', ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=local-idp','-addext','subjectAltName=IP:127.0.0.1'], { stdio:'ignore',windowsHide:true });
  const keys = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(keys.publicKey), kid:'local',alg:'RS256' };
  let issuer = '', wrongNonce = false;
  const codes = new Map<string,{ nonce:string; challenge:string; client:string; redirect:string }>();
  const idp = createServer({ key:await readFile(key),cert:await readFile(cert) }, async (request,response) => {
    response.setHeader('content-type','application/json');
    if (request.url === '/.well-known/openid-configuration') {
      response.end(JSON.stringify({ issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',response_types_supported:['code'],code_challenge_methods_supported:['S256'],id_token_signing_alg_values_supported:['RS256'] }));
    } else if (request.url === '/jwks') response.end(JSON.stringify({ keys:[jwk] }));
    else if (request.url === '/token') {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const form = new URLSearchParams(Buffer.concat(chunks).toString());
      const code = codes.get(form.get('code')!); codes.delete(form.get('code')!);
      if (!code || createHash('sha256').update(form.get('code_verifier')!).digest('base64url') !== code.challenge || form.get('client_id') !== code.client || form.get('redirect_uri') !== code.redirect) { response.statusCode=400;response.end('{}');return; }
      const sign = (aud:string, claims:Record<string,unknown>) => new SignJWT(claims).setProtectedHeader({alg:'RS256',kid:'local'}).setIssuer(issuer).setAudience(aud).setSubject('operator').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
      response.end(JSON.stringify({ token_type:'Bearer',access_token:await sign('platform-api',{client_id:code.client,groups:['read','publish','maintain']}),id_token:await sign(code.client,{nonce:wrongNonce ? 'wrong' : code.nonce,azp:code.client}) }));
    } else { response.statusCode=404;response.end('{}'); }
  });
  await new Promise<void>(resolve => idp.listen(0,'127.0.0.1',resolve));
  issuer = `https://127.0.0.1:${(idp.address() as {port:number}).port}`;
  const config = { issuer,audience:'platform-api',webClientId:'web-company',cliClientId:'cli-company',webRedirectUri:'https://api.example.com/v1/auth/oidc/callback',cliRedirectUri:'http://127.0.0.1:43129/callback',roleClaim:'groups',roleMapping:{reader:'read',publisher:'publish',maintainer:'maintain'} };
  const h = await platformHarness({ galleryOrigin:'https://gallery.example.com',adminOrigin:'https://admin.example.com',access:{apiOrigin:'https://api.example.com',administrators:[{issuer:'https://issuer.t05.test',subject:'operator'},{issuer,subject:'operator'}],outbound:[{hostname:'127.0.0.1',port:Number(new URL(issuer).port),networks:['127.0.0.1/32']}],ca:await readFile(cert,'utf8')} });
  try {
    const admin = await h.token('operator',['reader']);
    expect((await fetch(h.origin()+'/v1/auth/oidc/callback?state=private-state&code=private-code')).status).toBe(401);
    expect((await h.request('/v1/auth/oidc/session',undefined,'private-token','GET')).status).toBe(401);
    const denied=(await h.db.query("SELECT target_id,data FROM audit_events WHERE event='AUTH_DENIED' ORDER BY id")).rows;
    expect(denied.map(row=>row.target_id)).toEqual(['oidc-callback','oidc-session']);
    expect(JSON.stringify(denied)).not.toMatch(/private-state|private-code|private-token/);
    let administration = admin;
    const {Platform:BootstrapPlatform}=await import('../../apps/api/dist/platform.js');
    const bootstrapOptions={...h.options,keyResolver:undefined,oidc:{issuer,audience:'platform-api',jwksUri:issuer+'/jwks',webClientIds:['web-company'],cliClientIds:['cli-company']}};
    const bootstrap=new BootstrapPlatform(bootstrapOptions);
    const bootstrapToken=await new SignJWT({client_id:'web-company',roles:['reader']}).setProtectedHeader({alg:'RS256',kid:'local'}).setIssuer(issuer).setAudience('platform-api').setSubject('operator').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
    try {expect((await bootstrap.authenticate('Bearer '+bootstrapToken)).roles).toEqual(['reader']);}
    finally {await bootstrap.onApplicationShutdown();}
    const blockedBootstrap=new BootstrapPlatform({...bootstrapOptions,access:{...h.platform().access!.options,outbound:[]}});
    try {await expect(blockedBootstrap.authenticate('Bearer '+bootstrapToken)).rejects.toMatchObject({code:'UNAUTHENTICATED'});}
    finally {await blockedBootstrap.onApplicationShutdown();}
    const saved = await h.request('/v1/access-settings/oidc/draft',{expectedGeneration:'0',expectedRevision:null,config},admin);
    expect(saved.status).toBe(200);
    const revision = (await saved.json()).sections.oidc.draft.id;
    const handoff=async()=>{
      const reply=await h.request('/v1/auth/oidc/candidate-start',{revision},admin);
      expect(reply.status).toBe(200);return (await reply.json()).ticket as string;
    };
    const ticketUrl=(ticket:string)=>h.origin()+'/v1/auth/oidc/candidate?ticket='+ticket;
    const single=await handoff();
    expect((await fetch(ticketUrl(single),{redirect:'manual'})).status).toBe(303);
    expect((await fetch(ticketUrl(single),{redirect:'manual'})).status).toBe(401);
    const expired=await handoff();
    await h.db.query("UPDATE oidc_start_tickets SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1",[createHash('sha256').update(expired).digest('hex')]);
    expect((await fetch(ticketUrl(expired),{redirect:'manual'})).status).toBe(401);
    const disabled=await handoff();
    await h.db.query("INSERT INTO disabled_subjects(subject) VALUES ('operator')");
    expect((await fetch(ticketUrl(disabled),{redirect:'manual'})).status).toBe(401);
    await h.db.query("DELETE FROM disabled_subjects WHERE subject='operator'");
    const staleTicket=await handoff();
    const validated = await h.request('/v1/access-settings/oidc/validate',{expectedGeneration:'0',revision},admin);
    expect((await validated.json()).sections.oidc.draft.checks.discovery).toBe('passed');
    const login = async (candidate?:string,responseIssuer=issuer,target?:string,restart=false) => {
      let entry='/v1/auth/oidc/start'+(target ? '?target='+target : '');
      if(candidate){
        const handoff=await h.request('/v1/auth/oidc/candidate-start',{revision:candidate},administration);
        expect(handoff.status).toBe(200);
        const ticket=(await handoff.json()).ticket;
        expect(JSON.stringify(ticket)).not.toContain('https://');
        entry='/v1/auth/oidc/candidate?ticket='+ticket;
      }
      const start = await fetch(h.origin()+entry,{redirect:'manual'});
      expect(start.status).toBe(303);
      const url = new URL(start.headers.get('location')!);
      const browserCookie = start.headers.get('set-cookie')!.split(';')[0]!;
      if (restart) await h.restart();
      const code = randomBytes(24).toString('base64url');
      codes.set(code,{nonce:url.searchParams.get('nonce')!,challenge:url.searchParams.get('code_challenge')!,client:url.searchParams.get('client_id')!,redirect:url.searchParams.get('redirect_uri')!});
      const reply = await fetch(h.origin()+`/v1/auth/oidc/callback?state=${url.searchParams.get('state')}&code=${code}&iss=${encodeURIComponent(responseIssuer)}&session_state=company-session`,{headers:{cookie:browserCookie},redirect:'manual'});
      return reply;
    };
    wrongNonce=true;
    expect((await login(revision)).status).toBe(401);
    wrongNonce=false;
    expect((await login(revision,'https://wrong-issuer.example.com')).status).toBe(401);
    const candidate = await login(revision);
    expect(candidate.status).toBe(303);
    expect(candidate.headers.get('location')).toBe('https://admin.example.com/access-settings?candidate=passed');
    expect(candidate.headers.get('set-cookie') ?? '').not.toContain('__Host-platform=');
    expect((await h.request('/v1/access-settings/oidc/activate',{expectedGeneration:'0',revision},admin)).status).toBe(409);
    const cli = await companyLogin({apiOrigin:h.origin(),candidate:revision,administratorToken:admin,caFile:cert,openBrowser:async address=>{
      const url=new URL(address),code=randomBytes(24).toString('base64url');
      codes.set(code,{nonce:'',challenge:url.searchParams.get('code_challenge')!,client:url.searchParams.get('client_id')!,redirect:url.searchParams.get('redirect_uri')!});
      const callback=new URL(url.searchParams.get('redirect_uri')!);
      callback.search=new URLSearchParams({code,state:url.searchParams.get('state')!}).toString();
      expect((await fetch(callback)).status).toBe(200);
    }});
    expect(cli).toEqual({authenticated:true,candidate:true});
    const cliToken = await new SignJWT({client_id:'cli-company',groups:['read','publish','maintain']}).setProtectedHeader({alg:'RS256',kid:'local'}).setIssuer(issuer).setAudience('platform-api').setSubject('operator').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
    expect((await h.request('/v1/auth/oidc/candidate-cli',{revision,expectedGeneration:'0',accessToken:cliToken},admin)).status).toBe(200);
    const candidateSubject='oidc:'+createHash('sha256').update(issuer+'\0operator').digest('hex');
    for(const role of ['reader','publisher','maintainer'])await h.db.query('INSERT INTO subject_role_restrictions(subject,role) VALUES ($1,$2)',[candidateSubject,role]);
    expect((await h.request('/v1/auth/oidc/candidate-cli',{revision,expectedGeneration:'0',accessToken:cliToken},admin)).status).toBe(200);
    expect((await (await h.request('/v1/access-settings',undefined,admin,'GET')).json()).sections.oidc.draft.checks.roles).toBe('failed');
    await h.db.query('DELETE FROM subject_role_restrictions WHERE subject=$1',[candidateSubject]);
    expect((await h.request('/v1/auth/oidc/candidate-cli',{revision,expectedGeneration:'0',accessToken:cliToken},admin)).status).toBe(200);
    expect((await h.request('/v1/releases/123e4567-e89b-42d3-a456-426614174000',undefined,cliToken,'GET')).status).toBe(401);
    expect((await h.request('/v1/access-settings/oidc/activate',{expectedGeneration:'0',revision},admin)).status).toBe(200);
    expect((await fetch(ticketUrl(staleTicket),{redirect:'manual'})).status).toBe(401);
    expect((await h.request('/v1/access-settings',undefined,admin,'GET')).status).toBe(401);
    administration = cliToken;
    const credentialFile = join(dir,'session.local');
    const normalCli = () => companyLogin({apiOrigin:h.origin(),credentialFile,caFile:cert,openBrowser:async address=>{
      const url=new URL(address),code=randomBytes(24).toString('base64url');
      codes.set(code,{nonce:'',challenge:url.searchParams.get('code_challenge')!,client:url.searchParams.get('client_id')!,redirect:url.searchParams.get('redirect_uri')!});
      const callback=new URL(url.searchParams.get('redirect_uri')!);
      callback.search=new URLSearchParams({code,state:url.searchParams.get('state')!}).toString();
      expect((await fetch(callback)).status).toBe(200);
    }});
    expect(await normalCli()).toMatchObject({authenticated:true,candidate:false});
    expect(await normalCli()).toMatchObject({authenticated:true,candidate:false});
    const credential = JSON.parse(await readFile(credentialFile,'utf8'));
    expect((await h.request('/v1/auth/oidc/session',undefined,credential.accessToken,'GET')).status).toBe(200);
    const signedIn = await login();
    expect(signedIn.status).toBe(303);
    expect(signedIn.headers.get('location')).toBe('https://gallery.example.com/library');
    expect((await login(undefined,issuer,'gallery')).headers.get('location')).toBe('https://gallery.example.com/library');
    expect((await login(undefined,issuer,'admin',true)).headers.get('location')).toBe('https://admin.example.com/upload');
    const targets=(await h.db.query('SELECT DISTINCT web_target FROM oidc_attempts')).rows.map(row=>row.web_target).sort();
    expect(targets).toEqual(['admin','gallery']);
    const session = signedIn.headers.get('set-cookie')!.split(';')[0]!;
    const info = () => fetch(h.origin()+'/v1/auth/oidc/session',{headers:{cookie:session}});
    expect((await info()).status).toBe(200);
    const sessionView = await (await info()).json();
    expect(sessionView.administrator).toBe(true);
    expect(sessionView.subject).toMatch(/^oidc:/);
    await h.db.query('INSERT INTO subject_role_restrictions(subject,role) VALUES ($1,$2)',[sessionView.subject,'publisher']);
    const afterRole = await (await info()).json();
    expect(afterRole.roles).not.toContain('publisher');
    expect((await h.request('/v1/access-settings/oidc/rollback',{expectedGeneration:'1',revision},cliToken)).status).toBe(409);
    expect((await login(revision)).status).toBe(303);
    expect((await h.request('/v1/auth/oidc/candidate-cli',{revision,expectedGeneration:'1',accessToken:cliToken},cliToken)).status).toBe(200);
    expect((await h.request('/v1/access-settings/oidc/rollback',{expectedGeneration:'1',revision},cliToken)).status).toBe(200);
    expect((await info()).status).toBe(401);
    const {Platform}=await import('../../apps/api/dist/platform.js');
    const missingAccess=new Platform({...h.options,access:undefined});
    try {await expect(missingAccess.authenticate('Bearer '+admin)).rejects.toMatchObject({code:'UNAUTHENTICATED'});}
    finally {await missingAccess.onApplicationShutdown();}
  } finally { await h.close(); await new Promise<void>(resolve => idp.close(()=>resolve()));await rm(dir,{recursive:true,force:true}); }
});
