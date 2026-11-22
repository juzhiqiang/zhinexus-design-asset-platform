import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('pins permitted DNS addresses, validates IP SAN, bounds replies and rejects redirects and unsafe endpoints', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zh-access-tls-'));
  const key = join(dir, 'key.pem'), cert = join(dir, 'cert.pem');
  execFileSync('C:/Program Files/Git/usr/bin/openssl.exe', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=access-local', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore', windowsHide: true });
  const pem = await readFile(cert, 'utf8');
  const server = createServer({ key: await readFile(key), cert: pem }, (request, response) => {
    if (request.url === '/redirect') { response.writeHead(302, { location: 'https://169.254.169.254/' }); response.end(); }
    else if (request.url === '/large') response.end('a'.repeat(300_000));
    else { response.setHeader('content-type','application/json'); response.end('{"status":"ok"}'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const network = await import('../../apps/api/dist/access/outbound.js').catch(() => ({ RestrictedHttps: undefined }));
    expect(typeof network.RestrictedHttps).toBe('function');
    if (!network.RestrictedHttps) throw new Error('Restricted HTTPS missing');
    const client = new network.RestrictedHttps([{ hostname: '127.0.0.1', port, networks: ['127.0.0.1/32'] }], pem);
    expect(await client.json(`https://127.0.0.1:${port}/ok`)).toEqual({ status:'ok' });
    for (const path of ['/redirect','/large']) await expect(client.json(`https://127.0.0.1:${port}${path}`)).rejects.toThrow();
    await expect(client.json(`https://127.0.0.1:${port}/ok?token=secret`)).rejects.toThrow();
    await expect(new network.RestrictedHttps([{ hostname:'127.0.0.1',port,networks:['192.0.2.0/24'] }], pem).json(`https://127.0.0.1:${port}/ok`)).rejects.toThrow();
    await expect(new network.RestrictedHttps([{ hostname:'localhost',port,networks:['127.0.0.0/8','::1/128'] }], pem).json(`https://localhost:${port}/ok`)).rejects.toThrow();
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir,{ recursive:true,force:true }); }
});
