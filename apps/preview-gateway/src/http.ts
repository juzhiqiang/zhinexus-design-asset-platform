import { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { PreviewRuntime } from './auth.js';
import { PreviewDenied, previewSessionPrefix, resourcePath, sessionResource, sessionToken } from './path-policy.js';

function previewCsp(platform: string, source: string, sandbox: string): string {
  return `default-src 'none'; script-src ${source} 'unsafe-inline'; style-src ${source} 'unsafe-inline'; img-src ${source} data:; font-src ${source}; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${platform}; sandbox ${sandbox}`;
}

export function previewHandler(runtime: PreviewRuntime) {
  return async (request: IncomingMessage, response: ServerResponse, next: () => void): Promise<void> => {
    if (request.url === '/healthz') { next(); return; }
    const requestId = randomUUID(); response.setHeader('X-Request-Id', requestId);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    const config = runtime.config;
    const ipPort = config?.mode === 'ip-port';
    const platform = config?.platformOrigin ?? "'none'";
    response.setHeader('Content-Security-Policy', ipPort
      ? `default-src 'none'; frame-ancestors ${platform}; sandbox allow-scripts`
      : previewCsp(platform, "'self'", 'allow-scripts allow-same-origin'));
    try {
      if (!config) throw new PreviewDenied();
      if (request.method !== 'GET' && request.method !== 'HEAD') { response.statusCode = 405; response.setHeader('Allow', 'GET, HEAD'); response.end(); return; }
      const raw = request.url ?? '';
      const session = ipPort && raw.startsWith(previewSessionPrefix) ? sessionResource(raw) : undefined;
      const path = session?.path ?? resourcePath(raw);
      if (!session && path === 'bootstrap') {
        if (request.method !== 'GET') throw new PreviewDenied();
        const query = new URLSearchParams(raw.split('?')[1]);
        if (raw.split('?').length !== 2 || [...query.keys()].length !== 1 || !query.has('grant')) throw new PreviewDenied();
        const redeemed = await runtime.redeem(query.get('grant')!, request.headers.host);
        const entry = redeemed.entry.split('/').map(encodeURIComponent).join('/');
        let location = '/' + entry;
        if (ipPort) {
          location = previewSessionPrefix + redeemed.token + location;
        } else {
          const maxAge = Math.max(0, Math.floor((redeemed.expires.getTime() - Date.now()) / 1000));
          response.setHeader('Set-Cookie', `__Host-preview=${redeemed.token}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=None`);
        }
        response.statusCode = 303; response.setHeader('Location', location); response.end(); return;
      }
      if (ipPort && !session) throw new PreviewDenied();
      const result = await runtime.resource(path, session?.token ?? sessionToken(request.headers.cookie), request.headers.host);
      if (session) {
        response.setHeader('Content-Security-Policy', previewCsp(platform, config.previewOrigin + session.prefix, 'allow-scripts'));
        // Sandboxed ES modules fetch with an opaque origin. The path authorizes each response.
        response.setHeader('Access-Control-Allow-Origin', '*');
      }
      response.statusCode = 200; response.setHeader('Content-Type', result.mime); response.setHeader('Content-Length', result.bytes.length);
      response.end(request.method === 'HEAD' ? undefined : result.bytes);
    } catch (error) {
      await runtime.recordFailure(request.headers.host, requestId, error instanceof PreviewDenied);
      response.statusCode = 404; response.setHeader('Content-Type', 'text/plain; charset=utf-8'); response.end('Preview unavailable');
    }
  };
}
