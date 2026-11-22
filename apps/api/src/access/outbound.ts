import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { rootCertificates, checkServerIdentity } from 'node:tls';
import type { OutboundRule } from './service.js';

export class ProbeFailure extends Error {
  constructor(readonly step: 'dns' | 'tls' | 'routing' | 'connection' | 'response') { super(`Access check failed: ${step}`); }
}
/** Raised when the identity service answers outside the 2xx range; the body is never surfaced. */
export class RemoteStatusFailure extends Error {
  constructor(readonly status: number, readonly retryable: boolean) { super(`Identity service rejected the operation: ${status}`); }
}
type Target = { url: URL; address: string; family: number };
/** Deployment rules, resolved address pinning and platform trust store apply to every request. */
export class RestrictedHttps {
  constructor(private readonly rules: OutboundRule[], private readonly ca?: string, private readonly resolveAddress=(hostname:string)=>lookup(hostname,{all:true,verbatim:true})) {}
  /** Validates the endpoint against the deployment allow-list and pins one resolved address. */
  private async target(endpoint: string, allowedSearch = ''): Promise<Target> {
    let url: URL;
    try {
      url = new URL(endpoint);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || /[\\\s]/u.test(endpoint) || url.href !== endpoint || url.search !== allowedSearch) throw new Error();
    } catch { throw new ProbeFailure('connection'); }
    const rule = this.rules.find(r => (r.hostname === url.hostname || (r.hostname.startsWith('*.') && url.hostname.split('.').slice(1).join('.') === r.hostname.slice(2))) && r.port === Number(url.port || 443));
    if (!rule) throw new ProbeFailure('dns');
    const allowed = new BlockList();
    try {
      for (const network of rule.networks) {
        const [address, prefix] = network.split('/');
        const family = isIP(address!) === 4 ? 'ipv4' : isIP(address!) === 6 ? 'ipv6' : undefined;
        if (!family) throw new Error();
        if (prefix === undefined) allowed.addAddress(address!, family); else allowed.addSubnet(address!, Number(prefix), family);
      }
    } catch { throw new ProbeFailure('dns'); }
    let addresses: { address: string; family: number }[];
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      addresses = await Promise.race([this.resolveAddress(url.hostname.replace(/^\[|\]$/g, '')), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ProbeFailure('dns')), 3000); })]);
      if (!addresses.length || addresses.some(a => !allowed.check(a.address, a.family === 4 ? 'ipv4' : 'ipv6'))) throw new Error();
    } catch { throw new ProbeFailure('dns'); }
    finally { clearTimeout(timer); }
    const chosen = addresses[0]!;
    return { url, address: chosen.address, family: chosen.family };
  }
  private transmit(target: Target, method: 'GET' | 'POST' | 'PUT' | 'DELETE', body: string | undefined, headers: Record<string, string>): Promise<{ bytes: Buffer; headers: import('node:http').IncomingHttpHeaders }> {
    const { url } = target;
    return new Promise((resolve, reject) => {
      const req = request(url, {
        method, agent: false, family: target.family,
        lookup: (_host, _options, callback) => callback(null, target.address, target.family),
        ca: this.ca ? [...rootCertificates, this.ca] : undefined, rejectUnauthorized: true,
        checkServerIdentity: (_host, cert) => checkServerIdentity(url.hostname, cert),
        signal: AbortSignal.timeout(5000), maxHeaderSize: 8192,
        headers: { accept: 'application/json', ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }) },
      }, response => {
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) { response.destroy(); reject(new RemoteStatusFailure(status, status === 429 || status >= 500)); return; }
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 256_000) { response.destroy(); reject(new ProbeFailure('response')); }
          else chunks.push(chunk);
        });
        response.on('end', () => resolve({ bytes: Buffer.concat(chunks), headers: response.headers }));
        response.on('error', () => reject(new ProbeFailure('response')));
      });
      req.on('error', (error: NodeJS.ErrnoException) => reject(new ProbeFailure(error.code?.includes('CERT') || error.code?.includes('TLS') || error.code?.includes('SELF_SIGNED') ? 'tls' : 'connection')));
      req.end(body);
    });
  }
  async read(endpoint: string, form?: URLSearchParams, probeHeaders: Record<string, string> = {}): Promise<{ bytes: Buffer; headers: import('node:http').IncomingHttpHeaders }> {
    const body = form?.toString();
    return this.transmit(await this.target(endpoint), body === undefined ? 'GET' : 'POST', body, { accept: 'application/json', ...probeHeaders, ...(body === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded' }) });
  }
  /** Identity-service administration: fixed realm endpoints only, JSON bodies, no redirects. */
  async call(endpoint: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', payload?: unknown, headers: Record<string, string> = {}, query: Record<string, string> = {}): Promise<{ status: number; value: unknown; location?: string }> {
    const search = new URLSearchParams(query).toString();
    const target = await this.target(search === '' ? endpoint : `${endpoint}?${search}`, search === '' ? '' : `?${search}`);
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const response = await this.transmit(target, method, body, headers);
    const location = response.headers['location'];
    if (response.bytes.length === 0) return { status: 200, value: undefined, ...(typeof location === 'string' ? { location } : {}) };
    try {
      if (!response.headers['content-type']?.includes('application/json')) throw new Error();
      return { status: 200, value: JSON.parse(response.bytes.toString('utf8')), ...(typeof location === 'string' ? { location } : {}) };
    } catch { throw new ProbeFailure('response'); }
  }
  async json(endpoint: string, form?: URLSearchParams, probeHeaders?: Record<string, string>): Promise<unknown> {
    const response = await this.read(endpoint, form, probeHeaders);
    try { if (!response.headers['content-type']?.includes('application/json')) throw new Error(); return JSON.parse(response.bytes.toString('utf8')); }
    catch { throw new ProbeFailure('response'); }
  }
}
