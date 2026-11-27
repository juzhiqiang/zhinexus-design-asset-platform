import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { validateApiMessage } from '../contracts/api.js';

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
async function writeCredential(target: string, credential: LoginCredential, previousToken?: string): Promise<string> {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const lock = target + '.lock';
  let handle: Awaited<ReturnType<typeof open>>;
  for (let attempt = 0; ; attempt++) {
    try { handle = await open(lock, 'wx', 0o600); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (attempt >= 200) throw new Error('CREDENTIAL_BUSY: 凭据锁正在使用: ' + lock + '；请稍后重试，异常退出遗留的锁需确认无相关 CLI 操作后手动移除');
      await delay(25);
    }
  }
  const temporary = target + '.' + randomUUID() + '.local';
  try {
    if (previousToken !== undefined) {
      const saved = await readLogin(target);
      if (saved?.apiOrigin !== credential.apiOrigin || saved.accessToken !== previousToken) return target;
    }
    await writeFile(temporary, JSON.stringify(credential) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, target);
  } finally {
    try { await rm(temporary, { force: true }); }
    finally { await handle.close().finally(() => rm(lock, { force: true })); }
  }
  return target;
}
export async function savePlatformCredential(apiOrigin: string, accessToken: string, file?: string): Promise<string> {
  platformApiOrigin(apiOrigin);
  if (!validPlatformToken(accessToken)) throw new Error('TOKEN_INVALID');
  return writeCredential(resolve(credentialPath(file)), { apiOrigin, accessToken });
}

/** JWT decoding only schedules renewal; the server remains the authority for signature and access checks. */
function expiration(token: string): number | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());
    return payload && typeof payload === 'object' && 'exp' in payload && typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp : NaN;
  } catch { return NaN; }
}
const renewals = new Map<string, Promise<string | undefined>>();
async function currentToken(apiOrigin: string, token: string): Promise<string | undefined> {
  const expires = expiration(token);
  if (expires === undefined) return token;
  if (!Number.isFinite(expires) || expires <= Date.now() / 1000) return;
  if (expires - Date.now() / 1000 >= 300) return token;
  const file = resolve(credentialPath());
  const key = file + '\0' + apiOrigin + '\0' + token;
  const pending = renewals.get(key);
  if (pending) return pending;
  const renewal = (async () => {
    try {
      const response = await fetch(apiOrigin + '/v1/auth/oidc/renew', {
        method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: '{}', signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 404) return expires > Date.now() / 1000 ? token : undefined;
      if (!response.ok) throw new Error(response.status === 401 ? 'UNAUTHENTICATED' : response.status === 403 ? 'FORBIDDEN' : 'HTTP_' + response.status);
      const body = await response.text();
      if (body.length > 32768) throw new Error('INVALID_RESPONSE');
      const result = validateApiMessage('renewTokenResponse', JSON.parse(body));
      if (!result.ok || !validPlatformToken(result.value.accessToken)) throw new Error('INVALID_RESPONSE');
      const next = result.value.accessToken, nextExpires = expiration(next);
      if (nextExpires === undefined || !Number.isFinite(nextExpires) || nextExpires <= expires || nextExpires <= Date.now() / 1000 + 300) throw new Error('INVALID_RESPONSE');
      const saved = await readLogin(file);
      if (saved?.apiOrigin === apiOrigin && saved.accessToken === token) await writeCredential(file, { apiOrigin, accessToken: next }, token);
      return next;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('CREDENTIAL_BUSY:')) throw error;
      // Do not include server response bodies, credentials or upstream error messages in diagnostics.
      throw new Error('TOKEN_RENEWAL_FAILED: 自动续签失败，请检查连接或重新 juz login；原凭据已保留');
    }
  })();
  renewals.set(key, renewal);
  try { return await renewal; } finally { renewals.delete(key); }
}

/** Retains the latest token for repeated requests in one operation, including explicit/environment credentials. */
export function platformAuthorization(apiOrigin: string, initial: string): () => Promise<string> {
  platformApiOrigin(apiOrigin);
  let token = initial;
  return async () => {
    const current = await currentToken(apiOrigin, token);
    if (!current) throw new Error('UNAUTHENTICATED: 登录已过期，请重新 juz login');
    token = current;
    return 'Bearer ' + token;
  };
}
export async function resolvePlatformApiUrl(explicit?:string,file?:string):Promise<string | undefined> {
  return explicit || process.env.PLATFORM_API_URL || process.env.ZHINEXUS_API_URL || (await readLogin(file))?.apiOrigin;
}
export async function resolvePlatformToken(apiOrigin:string,explicit?:string):Promise<string | undefined> {
  platformApiOrigin(apiOrigin);
  const provided=explicit ?? (process.env.ZHINEXUS_API_TOKEN || process.env.PLATFORM_TOKEN || process.env.PLATFORM_API_TOKEN || process.env.ZHINEXUS_TOKEN || undefined);
  if (provided!==undefined) {
    if (!validPlatformToken(provided)) throw new Error('TOKEN_INVALID: 凭证不能为空或含空白字符');
    return currentToken(apiOrigin, provided);
  }
  const saved=await readLogin();
  return saved?.apiOrigin===apiOrigin ? currentToken(apiOrigin, saved.accessToken) : undefined;
}
