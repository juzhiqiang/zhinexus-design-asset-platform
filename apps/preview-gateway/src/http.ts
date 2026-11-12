import { type IncomingMessage, type ServerResponse } from 'node:http';
import { PreviewRuntime } from './auth.js';
import { PreviewDenied, resourcePath, sessionToken } from './path-policy.js';

export function previewHandler(runtime: PreviewRuntime) {
  return async (request: IncomingMessage, response: ServerResponse, next: () => void): Promise<void> => {
    if (request.url === '/healthz') { next(); return; }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${runtime.config?.platformOrigin ?? "'none'"}; sandbox allow-scripts allow-same-origin`);
    try {
      if (!runtime.config) throw new PreviewDenied();
      if (request.method !== 'GET' && request.method !== 'HEAD') { response.statusCode = 405; response.setHeader('Allow', 'GET, HEAD'); response.end(); return; }
      const raw = request.url ?? ''; const path = resourcePath(raw);
      if (path === 'bootstrap') {
        if (request.method !== 'GET') throw new PreviewDenied();
        const query = new URLSearchParams(raw.split('?')[1]);
        if (raw.split('?').length !== 2 || [...query.keys()].length !== 1 || !query.has('grant')) throw new PreviewDenied();
        const redeemed = await runtime.redeem(query.get('grant')!, request.headers.host);
        response.setHeader('Set-Cookie', `__Host-preview=${redeemed.token}; Path=/; Max-Age=${Math.max(0, Math.floor((redeemed.expires.getTime() - Date.now()) / 1000))}; Secure; HttpOnly; SameSite=None`);
        response.statusCode = 303; response.setHeader('Location', `/${redeemed.entry.split('/').map(encodeURIComponent).join('/')}`); response.end(); return;
      }
      const result = await runtime.resource(path, sessionToken(request.headers.cookie), request.headers.host);
      response.statusCode = 200; response.setHeader('Content-Type', result.mime); response.setHeader('Content-Length', result.bytes.length);
      response.end(request.method === 'HEAD' ? undefined : result.bytes);
    } catch {
      response.statusCode = 404; response.setHeader('Content-Type', 'text/plain; charset=utf-8'); response.end('Preview unavailable');
    }
  };
}
