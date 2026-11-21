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
  const h = await platformHarness({ galleryOrigin:'https://gallery.example.com',access:{apiOrigin:'https://api.example.com',administrators:[{issuer:'https://issuer.t05.test',subject:'operator'},{issuer,subject:'operator'}],outbound:[{hostname:'127.0.0.1',port:Number(new URL(issuer).port),networks:['127.0.0.1/32']}],ca:await readFile(cert,'utf8')} });
  try {
    const admin = await h.token('operator',['reader']);
    const saved = await h.request('/v1/access-settings/oidc/draft',{expectedGeneration:'0',expectedRevision:null,config},admin);
    expect(saved.status).toBe(200);
    const revision = (await saved.json()).sections.oidc.draft.id;
    const validated = await h.request('/v1/access-settings/oidc/validate',{expectedGeneration:'0',revision},admin);
    expect((await validated.json()).sections.oidc.draft.checks.discovery).toBe('passed');
    const login = async (candidate?:string) => {
      const start = await fetch(h.origin()+'/v1/auth/oidc/start'+(candidate ? '?revision='+candidate : ''),{headers:candidate ? {authorization:'Bearer '+admin} : {},redirect:'manual'});
      expect(start.status).toBe(303);
      const url = new URL(start.headers.get('location')!);
      const browserCookie = start.headers.get('set-cookie')!.split(';')[0]!;
      const code = randomBytes(24).toString('base64url');
      codes.set(code,{nonce:url.searchParams.get('nonce')!,challenge:url.searchParams.get('code_challenge')!,client:url.searchParams.get('client_id')!,redirect:url.searchParams.get('redirect_uri')!});
      const reply = await fetch(h.origin()+`/v1/auth/oidc/callback?state=${url.searchParams.get('state')}&code=${code}`,{headers:{cookie:browserCookie},redirect:'manual'});
      return reply;
    };
    wrongNonce=true;
    expect((await login(revision)).status).toBe(401);
    wrongNonce=false;
    const candidate = await login(revision);
    expect(candidate.status).toBe(303);
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
    expect((await h.request('/v1/releases/123e4567-e89b-42d3-a456-426614174000',undefined,cliToken,'GET')).status).toBe(401);
    expect((await h.request('/v1/access-settings/oidc/activate',{expectedGeneration:'0',revision},admin)).status).toBe(200);
    expect((await h.request('/v1/access-settings',undefined,admin,'GET')).status).toBe(401);
    const signedIn = await login();
    expect(signedIn.status).toBe(303);
    const session = signedIn.headers.get('set-cookie')!.split(';')[0]!;
    const info = () => fetch(h.origin()+'/v1/auth/oidc/session',{headers:{cookie:session}});
    expect((await info()).status).toBe(200);
    const sessionView = await (await info()).json();
    expect(sessionView.administrator).toBe(true);
    expect(sessionView.subject).toMatch(/^oidc:/);
    await h.db.query('INSERT INTO subject_role_restrictions(subject,role) VALUES ($1,$2)',[sessionView.subject,'publisher']);
    const afterRole = await (await info()).json();
    expect(afterRole.roles).not.toContain('publisher');
    await h.db.query("UPDATE access_active SET generation=generation+1 WHERE section='oidc'");
    expect((await info()).status).toBe(401);
  } finally { await h.close(); await new Promise<void>(resolve => idp.close(()=>resolve()));await rm(dir,{recursive:true,force:true}); }
});
