import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { createServer,request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile,mkdir,writeFile,rename,rm } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { rootCertificates } from 'node:tls';
import { validateOidcCliMetadata } from '../contracts/access-settings.js';
import { credentialPath, resolvePlatformApiUrl, validPlatformToken } from '../local/credentials.js';

export type LoginOptions = { apiOrigin?:string;token?:string;credentialFile?:string;caFile?:string;candidate?:string;administratorToken?:string;openBrowser?:(url:string)=>Promise<void>;timeoutMs?:number };
export async function companyLogin(options:LoginOptions):Promise<{authenticated:true;candidate:boolean;credentialFile?:string}> {
  if (options.token !== undefined && !validPlatformToken(options.token)) throw new Error('Invalid token');
  if (options.token !== undefined && options.candidate !== undefined) throw new Error('Token and candidate login cannot be combined');
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0)) throw new Error('Invalid login timeout');
  const apiOrigin = await resolvePlatformApiUrl(options.apiOrigin, options.credentialFile) ?? 'http://127.0.0.1:3000';
  const api = new URL(apiOrigin);
  if (api.origin !== apiOrigin || api.username || api.password || (api.protocol !== 'https:' && !(api.protocol === 'http:' && ['127.0.0.1','localhost'].includes(api.hostname)))) throw new Error('Invalid API origin');
  if (options.candidate && (!/^[a-f0-9-]{36}$/.test(options.candidate) || !options.administratorToken)) throw new Error('Candidate login requires administrator');
  const ca = options.caFile ? [...rootCertificates,await readFile(options.caFile,'utf8')] : undefined;
  async function json(endpoint:string,body?:string,authorization?:string,form=false):Promise<unknown> {
    const url = new URL(endpoint);
    return new Promise((resolveResult,reject) => {
      const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url,{method:body ? 'POST':'GET',...(url.protocol === 'https:' ? {ca,rejectUnauthorized:true} : {}),signal:AbortSignal.timeout(Math.min(options.timeoutMs ?? 10_000, 10_000)),headers:{accept:'application/json',...(body ? {'content-type':form ? 'application/x-www-form-urlencoded':'application/json'} : {}),...(authorization ? {authorization:'Bearer '+authorization} : {})}},res => {
        const chunks:Buffer[]=[];let size=0;
        res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>256000){res.destroy();reject(new Error('Response too large'));}else chunks.push(chunk);});
        res.on('end',()=>{try{if(!res.statusCode || res.statusCode<200 || res.statusCode>=300)throw new Error();resolveResult(JSON.parse(Buffer.concat(chunks).toString()));}catch{reject(new Error('Login failed'));}});res.on('error',reject);
      });req.on('error',reject);req.end(body);
    });
  }
  const saveCredential = async (accessToken: string) => {
    const target=resolve(credentialPath(options.credentialFile));
    await mkdir(dirname(target),{recursive:true,mode:0o700});
    const temporary = target+'.'+randomUUID()+'.local';
    try {
      await writeFile(temporary,JSON.stringify({apiOrigin,accessToken})+'\n',{mode:0o600,flag:'wx'});
      await rename(temporary,target);
    } finally {await rm(temporary,{force:true});}
    return target;
  };
  if (options.token !== undefined) {
    const session = await json(apiOrigin+'/v1/auth/oidc/session',undefined,options.token);
    if (!session || typeof session !== 'object' || !('authenticated' in session) || session.authenticated !== true) throw new Error('Protected access denied');
    return { authenticated: true, candidate: false, credentialFile: await saveCredential(options.token) };
  }
  const metadata = validateOidcCliMetadata(await json(apiOrigin+'/v1/auth/oidc/cli'+(options.candidate ? '?revision='+encodeURIComponent(options.candidate) : ''),undefined,options.candidate ? options.administratorToken : undefined));
  if (!metadata.ok) throw new Error('Invalid login metadata');
  const config = metadata.value,redirect = new URL(config.redirectUri);
  const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
  let complete!:(code:string)=>void,fail!:(error:Error)=>void;
  const completion = new Promise<string>((accept,reject)=>{complete=accept;fail=reject;});
  const server = createServer((req,res)=>{
    const url=new URL(req.url ?? '/',config.redirectUri);
    if (req.method !== 'GET' || req.headers.host !== redirect.host || url.pathname !== redirect.pathname || url.searchParams.get('state') !== state || url.searchParams.getAll('state').length !== 1 || url.searchParams.getAll('code').length !== 1 || [...url.searchParams.keys()].some(k=>!['code','state','iss','session_state'].includes(k)) || (url.searchParams.has('iss') && url.searchParams.get('iss') !== config.issuer)) {res.statusCode=400;res.end('Login callback rejected');return;}
    const code=url.searchParams.get('code');
    if(!code || code.length>4096){res.statusCode=400;res.end();return;}
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");res.setHeader('Referrer-Policy','no-referrer');res.end('公司登录完成，可以关闭此窗口。');complete(code);
  });
  let timer:ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((accept,reject)=>{server.once('error',reject);server.listen(Number(redirect.port),'127.0.0.1',()=>{server.off('error',reject);accept();});});
    timer=setTimeout(()=>fail(new Error('Login timed out')),options.timeoutMs ?? 120_000);
    const url=new URL(config.authorizationEndpoint);
    url.search=new URLSearchParams({response_type:'code',client_id:config.clientId,redirect_uri:config.redirectUri,scope:['openid',...config.scopes].join(' '),state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
    if(options.openBrowser) await options.openBrowser(url.href);
    else await new Promise<void>((accept,reject)=>{
      const child=process.platform==='win32' ? spawn('rundll32.exe',['url.dll,FileProtocolHandler',url.href],{windowsHide:true,stdio:'ignore'}) : spawn(process.platform==='darwin' ? 'open':'xdg-open',[url.href],{stdio:'ignore'});
      child.once('error',reject);child.once('spawn',()=>{child.unref();accept();});
    });
    const code=await completion;
    const tokens=await json(config.tokenEndpoint,new URLSearchParams({grant_type:'authorization_code',client_id:config.clientId,redirect_uri:config.redirectUri,code,code_verifier:verifier}).toString(),undefined,true);
    if(!tokens || typeof tokens!=='object' || !('access_token' in tokens) || typeof tokens.access_token!=='string' || !('token_type' in tokens) || tokens.token_type !== 'Bearer') throw new Error('Invalid token response');
    const accessToken=tokens.access_token;
    if (!validPlatformToken(accessToken)) throw new Error('Invalid token response');
    if(options.candidate){await json(apiOrigin+'/v1/auth/oidc/candidate-cli',JSON.stringify({revision:options.candidate,expectedGeneration:config.generation,accessToken}),options.administratorToken);return{authenticated:true,candidate:true};}
    const session=await json(apiOrigin+'/v1/auth/oidc/session',undefined,accessToken);
    if(!session || typeof session!=='object' || !('authenticated' in session) || session.authenticated!==true)throw new Error('Protected access denied');
    return{authenticated:true,candidate:false,credentialFile:await saveCredential(accessToken)};
  } finally {clearTimeout(timer);server.closeAllConnections();await new Promise<void>(accept=>{if(!server.listening){accept();return;}server.close(()=>accept());});}
}
