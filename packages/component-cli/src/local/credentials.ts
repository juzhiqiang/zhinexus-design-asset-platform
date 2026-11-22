import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

type LoginCredential={apiOrigin:string;accessToken:string};
async function readLogin():Promise<LoginCredential | undefined> {
  let handle:Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle=await open(process.env.ZHINEXUS_CREDENTIAL_FILE || join(homedir(),'.zhinexus','session.local'),'r');
    const stat=await handle.stat();if (!stat.isFile() || stat.size>16384) return;
    const value:unknown=JSON.parse(await handle.readFile('utf8'));
    if (!value || typeof value!=='object' || Object.keys(value).sort().join(',')!=='accessToken,apiOrigin' || !('apiOrigin' in value) || typeof value.apiOrigin!=='string' || !('accessToken' in value) || typeof value.accessToken!=='string' || value.accessToken.length>16384 || /[\s\u0000-\u001f\u007f]/u.test(value.accessToken)) return;
    const origin=new URL(value.apiOrigin);
    if (origin.origin!==value.apiOrigin || origin.username || origin.password || (origin.protocol!=='https:' && !(origin.protocol==='http:' && ['127.0.0.1','localhost'].includes(origin.hostname)))) return;
    const parts=value.accessToken.split('.');if (parts.length!==3) return;
    const payload:unknown=JSON.parse(Buffer.from(parts[1]!,'base64url').toString());
    if (!payload || typeof payload!=='object' || !('exp' in payload) || typeof payload.exp!=='number' || !Number.isFinite(payload.exp) || payload.exp<=Date.now()/1000) return;
    return{apiOrigin:value.apiOrigin,accessToken:value.accessToken};
  } catch {return;} finally {await handle?.close();}
}
export async function resolvePlatformApiUrl(explicit?:string):Promise<string | undefined> {
  return explicit || process.env.PLATFORM_API_URL || process.env.ZHINEXUS_API_URL || (await readLogin())?.apiOrigin;
}
export async function resolvePlatformToken(apiOrigin:string,explicit?:string):Promise<string | undefined> {
  const provided=explicit ?? (process.env.ZHINEXUS_API_TOKEN || process.env.PLATFORM_TOKEN || process.env.PLATFORM_API_TOKEN || process.env.ZHINEXUS_TOKEN || undefined);
  if (provided!==undefined) return provided;
  const saved=await readLogin();
  return saved?.apiOrigin===apiOrigin ? saved.accessToken : undefined;
}
