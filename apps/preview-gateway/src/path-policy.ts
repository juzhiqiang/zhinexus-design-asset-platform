export class PreviewDenied extends Error { constructor() { super('Preview unavailable'); } }
export function resourcePath(raw: string): string {
  const path = raw.split('?')[0]!;
  if (raw.length > 8192 || !/^\/[A-Za-z0-9._/-]+$/.test(path) || path.slice(1).split('/').some(p => !p || p === '.' || p === '..')) throw new PreviewDenied();
  return path.slice(1);
}
const mimes: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml',
  woff: 'font/woff', woff2: 'font/woff2', txt: 'text/plain; charset=utf-8' };
export function resourceMime(path: string): string {
  const extension = path.split('.').at(-1)!;
  if (!Object.hasOwn(mimes, extension)) throw new PreviewDenied();
  return mimes[extension]!;
}
export function sessionToken(cookie: string | undefined): string {
  const tokens = (cookie ?? '').split(';').map(s => s.trim()).filter(s => s.startsWith('__Host-preview='));
  const token = tokens[0]?.slice('__Host-preview='.length);
  if (tokens.length !== 1 || !token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new PreviewDenied();
  return token;
}
