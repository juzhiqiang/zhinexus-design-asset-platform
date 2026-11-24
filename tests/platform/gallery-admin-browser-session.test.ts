import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { request as httpRequest, createServer as httpServer } from 'node:http';
import { createServer } from 'node:https';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { expect, it } from 'vitest';
import { platformHarness } from './http-support.js';

it('shares a host-only API session between gallery/admin, rejects other origins and logs both out in Chromium', async () => {
  // Local signed OIDC + real API/database/network; minimal pages deliberately do not stand in for Next UI acceptance.
  const directory = await mkdtemp(join(tmpdir(), 'zh-web-session-'));
  let h: Awaited<ReturnType<typeof platformHarness>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let tls: ReturnType<typeof createServer> | undefined;
  let proxy: ReturnType<typeof httpServer> | undefined;
  const tunnels = new Set<Socket>();
  try {
    const cert = join(directory, 'cert.pem'), key = join(directory, 'key.pem');
    const openssl = process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
    execFileSync(openssl, ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=browser-session-local','-addext','subjectAltName=IP:127.0.0.1,DNS:*.platform.test,DNS:*.api.platform.test'], {stdio:'ignore',windowsHide:true});
    const pem = await readFile(cert, 'utf8');
    const keys = await generateKeyPair('RS256');
    const jwk = {...await exportJWK(keys.publicKey),kid:'browser-local',alg:'RS256'};
    let issuer = '', apiOrigin = '';
    const codes = new Map<string, {nonce:string;challenge:string}>();
    const frontendCookies: string[] = [];
    const observed: {path:string;origin?:string;cookie:boolean;status:number;allowOrigin?:string|string[];credentials?:string|string[]}[] = [];
    tls = createServer({key:await readFile(key),cert:pem}, async (request,response) => {
      const host = request.headers.host?.split(':')[0];
      if (host === 'api.platform.test') {
        const upstream = httpRequest(h!.origin() + request.url, {method:request.method,headers:request.headers}, reply => {
          observed.push({path:request.url!,origin:request.headers.origin,cookie:(request.headers.cookie ?? '').includes('__Host-platform='),status:reply.statusCode!,allowOrigin:reply.headers['access-control-allow-origin'],credentials:reply.headers['access-control-allow-credentials']});
          response.writeHead(reply.statusCode!,reply.headers); reply.pipe(response);
        });
        upstream.on('error', () => { response.statusCode=502; response.end(); });
        request.pipe(upstream); return;
      }
      if (host !== '127.0.0.1') {
        frontendCookies.push(request.headers.cookie ?? '');
        response.setHeader('content-type','text/html');
        response.end('<!doctype html><html><body><h1>Local session acceptance</h1></body></html>'); return;
      }
      const url = new URL(request.url!, issuer);
      response.setHeader('content-type','application/json');
      if (url.pathname === '/.well-known/openid-configuration') {
        response.end(JSON.stringify({issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',response_types_supported:['code'],code_challenge_methods_supported:['S256']}));
      } else if (url.pathname === '/jwks') response.end(JSON.stringify({keys:[jwk]}));
      else if (url.pathname === '/authorize') {
        const params = url.searchParams;
        if (params.get('client_id') !== 'browser-web' || params.get('redirect_uri') !== apiOrigin+'/v1/auth/oidc/callback' || params.get('code_challenge_method') !== 'S256') { response.statusCode=400; response.end('{}'); return; }
        const code = randomBytes(24).toString('base64url');
        codes.set(code,{nonce:params.get('nonce')!,challenge:params.get('code_challenge')!});
        const callback = new URL(params.get('redirect_uri')!);
        callback.search = new URLSearchParams({state:params.get('state')!,code,iss:issuer}).toString();
        response.writeHead(303,{location:callback.href}); response.end();
      } else if (url.pathname === '/token') {
        const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const form = new URLSearchParams(Buffer.concat(chunks).toString());
        const code = codes.get(form.get('code')!); codes.delete(form.get('code')!);
        if (!code || form.get('client_id') !== 'browser-web' || form.get('redirect_uri') !== apiOrigin+'/v1/auth/oidc/callback' || createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') !== code.challenge) { response.statusCode=400; response.end('{}'); return; }
        const sign = (audience:string,claims:Record<string,unknown>) => new SignJWT(claims).setProtectedHeader({alg:'RS256',kid:'browser-local'}).setIssuer(issuer).setAudience(audience).setSubject('local-reader').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
        response.end(JSON.stringify({token_type:'Bearer',id_token:await sign('browser-web',{nonce:code.nonce,azp:'browser-web'}),access_token:await sign('platform-api',{client_id:'browser-web',roles:['reader']})}));
      } else { response.statusCode=404; response.end('{}'); }
    });
    await new Promise<void>(resolve => tls!.listen(0,'127.0.0.1',resolve));
    const port = (tls.address() as {port:number}).port;
    issuer = `https://127.0.0.1:${port}`;
    apiOrigin = `https://api.platform.test:${port}`;
    const galleryOrigin = `https://gallery.platform.test:${port}`, adminOrigin = `https://admin.platform.test:${port}`;
    h = await platformHarness({galleryOrigin,adminOrigin,access:{apiOrigin,administrators:[{issuer,subject:'operator'}],outbound:[{hostname:'127.0.0.1',port,networks:['127.0.0.1/32']}],ca:pem,
      initialOidc:{issuer,audience:'platform-api',webClientId:'browser-web',cliClientId:'browser-cli',webRedirectUri:apiOrigin+'/v1/auth/oidc/callback',cliRedirectUri:'http://127.0.0.1:43129/callback',roleClaim:'roles',roleMapping:{reader:'reader',publisher:'publisher',maintainer:'maintainer'}}}});
    // Resolve only these test hosts through a local CONNECT tunnel, preserving their real browser origins.
    proxy = httpServer((_request,response) => { response.statusCode=403; response.end(); });
    proxy.on('connect', (request,socket,head) => {
      const hosts = ['gallery.platform.test','admin.platform.test','api.platform.test','evil.platform.test','child.api.platform.test','127.0.0.1'];
      if (!hosts.some(host => request.url === `${host}:${port}`)) { socket.destroy(); return; }
      const upstream = connect(port,'127.0.0.1',() => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); upstream.write(head); socket.pipe(upstream); upstream.pipe(socket); });
      tunnels.add(upstream); upstream.on('close',() => tunnels.delete(upstream)); upstream.on('error',() => socket.destroy()); socket.on('error',() => upstream.destroy()); socket.on('close',() => upstream.destroy());
    });
    await new Promise<void>(resolve => proxy!.listen(0,'127.0.0.1',resolve));
    browser = await chromium.launch();
    // Only this browser context trusts the ephemeral test certificate; TLS verification in the API uses its explicit CA.
    const context = await browser.newContext({ignoreHTTPSErrors:true,proxy:{server:`http://127.0.0.1:${(proxy.address() as {port:number}).port}`}});
    const gallery = await context.newPage(), admin = await context.newPage(), outsider = await context.newPage();
    const call = (page:Page,path='/session',method='GET') => page.evaluate(async ({url,method}) => {
      try { const reply = await fetch(url,{method,credentials:'include'}); return {status:reply.status,body:await reply.json()}; }
      catch { return {status:0,body:null}; }
    }, {url:apiOrigin+'/v1/auth/oidc'+path,method});

    await gallery.goto(apiOrigin+'/v1/auth/oidc/start?target=gallery');
    await gallery.waitForURL(galleryOrigin+'/library');
    await admin.goto(adminOrigin+'/upload');
    const session = (await context.cookies(apiOrigin)).find(cookie => cookie.name === '__Host-platform');
    expect(session).toMatchObject({domain:'api.platform.test',path:'/',secure:true,httpOnly:true,sameSite:'None'});
    expect((await h.db.query('SELECT count(*)::int AS count FROM oidc_sessions')).rows[0]!.count).toBe(1);
    for (const [page,origin] of [[gallery,galleryOrigin],[admin,adminOrigin]] as const) {
      expect(await call(page)).toMatchObject({status:200,body:{authenticated:true,roles:['reader']}});
      expect(observed.at(-1)).toMatchObject({origin,cookie:true,status:200,allowOrigin:origin,credentials:'true'});
      expect(await page.evaluate(() => document.cookie)).not.toContain('__Host-platform');
    }
    await outsider.goto(`https://child.api.platform.test:${port}`);
    expect((await context.cookies(`https://child.api.platform.test:${port}`)).some(cookie => cookie.name === '__Host-platform')).toBe(false);
    expect(frontendCookies.every(value => !value.includes('__Host-platform='))).toBe(true);
    await outsider.goto(`https://evil.platform.test:${port}`);
    expect(await call(outsider)).toEqual({status:0,body:null});
    expect(observed.at(-1)).toMatchObject({cookie:true,status:200,allowOrigin:undefined});
    expect(await call(outsider,'/logout','POST')).toEqual({status:0,body:null});
    expect(observed.at(-1)).toMatchObject({cookie:true,status:403,allowOrigin:undefined});
    expect((await h.db.query('SELECT count(*)::int AS count FROM oidc_sessions')).rows[0]!.count).toBe(1);
    expect(await call(admin,'/logout','POST')).toMatchObject({status:200,body:{authenticated:false}});
    expect((await h.db.query('SELECT count(*)::int AS count FROM oidc_sessions')).rows[0]!.count).toBe(0);
    expect((await context.cookies(apiOrigin)).some(cookie => cookie.name === '__Host-platform')).toBe(false);
    for (const page of [gallery,admin]) expect(await call(page)).toMatchObject({status:401,body:{code:'UNAUTHENTICATED'}});
  } finally {
    await browser?.close();
    for (const tunnel of tunnels) tunnel.destroy();
    if (proxy) { proxy.closeAllConnections(); await new Promise<void>(resolve => proxy!.close(() => resolve())); }
    if (tls) { tls.closeAllConnections(); await new Promise<void>(resolve => tls!.close(() => resolve())); }
    await h?.close();
    await rm(directory,{recursive:true,force:true});
  }
});
