import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

type LoginCredential={apiOrigin:string;accessToken:string};
export function platformApiOrigin(value: string): string {
  const origin = new URL(value);
  if (origin.origin !== value || origin.username || origin.password || !['http:', 'https:'].includes(origin.protocol)) throw new Error('API_ORIGIN_INVALID');
  return origin.origin;
}
export function credentialPath(explicit?:string):string {
  return explicit || process.env.ZHINEXUS_CREDENTIAL_FILE || join(homedir(),'.zhinexus','session.local');
}
export function validPlatformToken(value:string):boolean {
  return value.length > 0 && value.length <= 16384 && !/[\s\u0000-\u001f\u007f]/u.test(value);
}
async function readLogin(file?:string):Promise<LoginCredential | undefined> {
  let handle:Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle=await open(credentialPath(file),'r');
    const stat=await handle.stat();if (!stat.isFile() || stat.size>16384) return;
    const value:unknown=JSON.parse(await handle.readFile('utf8'));
    if (!value || typeof value!=='object' || Object.keys(value).sort().join(',')!=='accessToken,apiOrigin' || !('apiOrigin' in value) || typeof value.apiOrigin!=='string' || !('accessToken' in value) || typeof value.accessToken!=='string' || !validPlatformToken(value.accessToken)) return;
    platformApiOrigin(value.apiOrigin);
    return{apiOrigin:value.apiOrigin,accessToken:value.accessToken};
  } catch {return;} finally {await handle?.close();}
}
export async function resolvePlatformApiUrl(explicit?:string,file?:string):Promise<string | undefined> {
  return explicit || process.env.PLATFORM_API_URL || process.env.ZHINEXUS_API_URL || (await readLogin(file))?.apiOrigin;
}
export async function resolvePlatformToken(apiOrigin:string,explicit?:string):Promise<string | undefined> {
  const provided=explicit ?? (process.env.ZHINEXUS_API_TOKEN || process.env.PLATFORM_TOKEN || process.env.PLATFORM_API_TOKEN || process.env.ZHINEXUS_TOKEN || undefined);
  if (provided!==undefined) {
    if (!validPlatformToken(provided)) throw new Error('TOKEN_INVALID: 凭证不能为空或含空白字符');
    return provided;
  }
  const saved=await readLogin();
  if (saved) {
    const parts=saved.accessToken.split('.');
    if (parts.length===3) {
      try {
        const payload:unknown=JSON.parse(Buffer.from(parts[1]!,'base64url').toString());
        if (!payload || typeof payload!=='object' || !('exp' in payload) || typeof payload.exp!=='number' || !Number.isFinite(payload.exp) || payload.exp<=Date.now()/1000) return;
      } catch { return; }
    }
  }
  return saved?.apiOrigin===apiOrigin ? saved.accessToken : undefined;
}
