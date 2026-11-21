import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { rootCertificates, checkServerIdentity } from 'node:tls';
import type { OutboundRule } from './service.js';

export class ProbeFailure extends Error {
  constructor(readonly step: 'dns' | 'tls' | 'routing' | 'connection' | 'response') { super(`Access check failed: ${step}`); }
}
/** Deployment rules, resolved address pinning and platform trust store apply to every request. */
export class RestrictedHttps {
  constructor(private readonly rules: OutboundRule[], private readonly ca?: string) {}
  async read(endpoint: string, form?: URLSearchParams): Promise<{ bytes: Buffer; headers: import('node:http').IncomingHttpHeaders }> {
    let url: URL;
    try {
      url = new URL(endpoint);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || /[\\\s]/u.test(endpoint) || url.href !== endpoint) throw new Error();
    } catch { throw new ProbeFailure('connection'); }
    const rule = this.rules.find(r => r.hostname === url.hostname && r.port === Number(url.port || 443));
    if (!rule) throw new ProbeFailure('dns');
    const allowed = new BlockList();
    try {
      for (const network of rule.networks) {
        const [address, prefix] = network.split('/');
        const family = isIP(address!) === 4 ? 'ipv4' : isIP(address!) === 6 ? 'ipv6' : undefined;
        if (!family) throw new Error();
        if (prefix === undefined) allowed.addAddress(address!, family);
        else allowed.addSubnet(address!, Number(prefix), family);
      }
    } catch { throw new ProbeFailure('dns'); }
    let addresses: { address: string; family: number }[];
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      addresses = await Promise.race([lookup(url.hostname.replace(/^\[|\]$/g,''), { all:true,verbatim:true }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ProbeFailure('dns')), 3000); })]);
      if (!addresses.length || addresses.some(a => !allowed.check(a.address, a.family === 4 ? 'ipv4' : 'ipv6'))) throw new Error();
    } catch { throw new ProbeFailure('dns'); }
    finally { clearTimeout(timer); }
    const chosen = addresses[0]!;
    const body = form?.toString();
    return new Promise((resolve, reject) => {
      const req = request(url, {
        method: body === undefined ? 'GET' : 'POST', agent:false, family:chosen.family,
        lookup: (_host, _options, callback) => callback(null, chosen.address, chosen.family),
        ca:this.ca ? [...rootCertificates,this.ca] : undefined, rejectUnauthorized:true,
        checkServerIdentity: (_host, cert) => checkServerIdentity(url.hostname,cert),
        signal:AbortSignal.timeout(5000), maxHeaderSize:8192,
        headers: { accept:'application/json', ...(body === undefined ? {} : { 'content-type':'application/x-www-form-urlencoded','content-length':Buffer.byteLength(body) }) },
      }, response => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) { response.destroy(); reject(new ProbeFailure('routing')); return; }
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 256_000) { response.destroy(); reject(new ProbeFailure('response')); }
          else chunks.push(chunk);
        });
        response.on('end', () => resolve({ bytes:Buffer.concat(chunks),headers:response.headers }));
        response.on('error', () => reject(new ProbeFailure('response')));
      });
      req.on('error', (error: NodeJS.ErrnoException) => reject(new ProbeFailure(error.code?.includes('CERT') || error.code?.includes('TLS') || error.code?.includes('SELF_SIGNED') ? 'tls' : 'connection')));
      req.end(body);
    });
  }
  async json(endpoint: string, form?: URLSearchParams): Promise<unknown> {
    const response = await this.read(endpoint,form);
    try { if (!response.headers['content-type']?.includes('application/json')) throw new Error(); return JSON.parse(response.bytes.toString('utf8')); }
    catch { throw new ProbeFailure('response'); }
  }
}
