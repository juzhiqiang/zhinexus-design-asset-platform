import { execFileSync } from 'node:child_process';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PUBLIC_CONF = 'infra/gateway/gallery-public.conf';
const INTERNAL_CONF = 'infra/gateway/admin-internal.conf';
const GALLERY_HOST = 'assets.example.com';
const API_HOST = 'api.assets.example.com';
const ADMIN_HOST = 'admin.assets.example.com';
const RELEASE_ID = '123e4567-e89b-42d3-a456-426614174000';
/** RFC5737 documentation range: unroutable, so an unreplaced placeholder denies everyone. */
const PLACEHOLDER_CIDR = '203.0.113.0/24';
/** Docker's default bridge range: requests published from the host appear to come from here. */
const TRUSTED_CIDR = '172.16.0.0/12';
const UNTRUSTED_CIDR = '192.0.2.0/24';
/** Reviewed immutable image; the test never pulls a floating tag. */
const NGINX_IMAGE = 'nginx@sha256:124b44bfc9ccd1f3cedf4b592d4d1e8bddb78b51ec2ed5056c52d3692baebc19';

type Hit = IncomingHttpHeaders & { __url?: string; __method?: string };
type Trust = 'trusted' | 'untrusted';
type Listener = 'public443' | 'internal8443';

// ---------------------------------------------------------------------------------------------
// Part 1: fail-closed configuration guard. Runs everywhere, needs no Docker.
// Deliberately small: everything it checks is also exercised for real in Part 2. This part only
// catches the failures that would otherwise surface as an nginx syntax error or a silent
// mis-binding on the host, where they are much harder to read.
// ---------------------------------------------------------------------------------------------

function serverBodies(source: string): { name: string; body: string }[] {
  return [...source.matchAll(/^server\s*\{([\s\S]*?)^\}/gm)].map(match => {
    const name = /server_name ([^;]+);/.exec(match[1]!);
    return { name: name ? name[1]!.trim() : '', body: match[1]! };
  });
}

export function auditIngress(source: string, kind: 'public' | 'internal'): string[] {
  const problems: string[] = [];
  const servers = serverBodies(source);
  const expected = kind === 'public' ? [GALLERY_HOST, API_HOST] : [ADMIN_HOST, API_HOST];
  const trusted = kind === 'public' ? '$public_api_trusted_network' : '$internal_edge_trusted_network';
  const port = kind === 'public' ? 443 : 8443;
  // Brace balance: a truncated or duplicated block is the cheapest failure to catch here.
  let depth = 0;
  for (const char of source) {
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
  }
  if (depth !== 0) problems.push(`braces are unbalanced by ${depth}`);
  if (servers.length !== 3) problems.push(`expected two named servers plus a handshake-reject default, found ${servers.length}`);
  for (const name of expected) if (!servers.some(server => server.name === name)) problems.push(`missing the server for ${name}`);
  if (problems.length) return problems;
  if (!new RegExp(`listen ${port} ssl default_server;[\\s\\S]*ssl_reject_handshake on;`).test(source)) problems.push(`must reject handshakes for unserved hostnames on ${port}`);
  for (const forbidden of ['allow all', '0.0.0.0/0', 'listen 80']) {
    if (source.includes(forbidden)) problems.push(`must not contain ${forbidden}`);
  }
  // No unreviewed route to the isolated preview gateway; its own templates own that ingress.
  if (/(?:upstream|server)\s+127\.0\.0\.1:3001/.test(source)) problems.push('must not route to the preview gateway');
  const gate = new RegExp(`${trusted.replace(/\$/g, '\\$')} = 0`);
  const gated = servers.filter(server => server.name && gate.test(server.body));
  if (kind === 'internal' && gated.length !== servers.length - 1) problems.push('every named internal server must gate on trusted source network');
  if (kind === 'public' && gated.length !== 1) problems.push('exactly one public server (the API origin) may gate on trusted source network');
  // Client-supplied forwarding headers must be overwritten, never appended, and no location may
  // redefine a hoisted header — otherwise one-liners silently lose the override.
  if (!source.includes('proxy_set_header X-Forwarded-For $remote_addr;')) problems.push('must overwrite X-Forwarded-For with the real client address');
  if (!source.includes('proxy_set_header Forwarded "";')) problems.push('must strip the Forwarded header');
  for (const server of servers) {
    if (!server.name) continue;
    const re = /^(\s*)location\s+((?:[^{]|\{\d+(?:,\d*)?\})*)\{/gm;
    let match: RegExpExecArray | null;
    while ((match = re.exec(server.body))) {
      const start = match.index + match[0].length;
      let inner = 1;
      let cursor = start;
      while (cursor < server.body.length && inner > 0) {
        if (server.body[cursor] === '{') inner += 1;
        else if (server.body[cursor] === '}') inner -= 1;
        cursor += 1;
      }
      if (server.body.slice(start, cursor - 1).includes('proxy_set_header')) {
        problems.push(`location ${match[2]!.trim()} must inherit the hoisted proxy headers`);
      }
      re.lastIndex = cursor - 1;
    }
  }
  // The credential-bearing edge must not record query strings or upstream error bodies.
  for (const line of source.split('\n').filter(l => l.startsWith('log_format'))) {
    if (/\$request_uri|\$args/.test(line)) problems.push(`log format must not record the query string: ${line.trim()}`);
  }
  if (!source.includes('error_log /dev/null;')) problems.push('must not log upstream errors that can echo request URIs');
  const api = servers.find(server => server.name === API_HOST)!.body;
  const app = servers.find(server => server.name === expected[0])!.body;
  if (!app.includes('proxy_pass')) problems.push(`${expected[0]} must proxy its application`);
  for (const denied of ['/v1/', '/identity/', '/internal/']) {
    if (!app.includes(`location ${denied} { return 404; }`)) problems.push(`${expected[0]} must not serve ${denied}`);
  }
  // Next.js App Router Server Actions are POSTs, so the frontends stay method-open.
  if (app.includes('limit_except')) problems.push(`${expected[0]} must not restrict methods`);
  if (kind === 'public') {
    if (!api.includes('location /v1/ { return 404; }')) problems.push('the public API origin must default-deny /v1/');
    if (!api.includes('location / { return 404; }')) problems.push('the public API origin must default-deny unknown paths');
  } else if (/location \/v1\/\s*\{\s*return 404;/.test(api) || !api.includes('proxy_pass')) {
    problems.push('the internal API origin must serve the full API surface');
  }
  return problems;
}

describe('画廊 / 管理端入口模板的失效安全属性', () => {
  it('公网模板默认拒绝一切未列名路径，只放行浏览 / 登录 / 预览所需接口', async () => {
    expect(auditIngress(await readFile(PUBLIC_CONF, 'utf8'), 'public')).toEqual([]);
  });
  it('内网模板只提供管理端与完整 API，且整体按可信网络来源门控', async () => {
    expect(auditIngress(await readFile(INTERNAL_CONF, 'utf8'), 'internal')).toEqual([]);
  });
  it('两个入口声明同一个 API hostname，避免出现第二个 cookie jar', async () => {
    const [publicSource, internalSource] = await Promise.all([readFile(PUBLIC_CONF, 'utf8'), readFile(INTERNAL_CONF, 'utf8')]);
    const apiHost = (source: string) => serverBodies(source).find(server => server.name === API_HOST)?.name;
    expect(apiHost(publicSource)).toBe(API_HOST);
    expect(apiHost(internalSource)).toBe(API_HOST);
  });
  it('守卫本身能抓到被放宽的配置，而不是永远返回空', async () => {
    const source = await readFile(PUBLIC_CONF, 'utf8');
    // Removing the default deny on /v1/.
    expect(auditIngress(source.replace('location /v1/ { return 404; }', 'location /v1/ { proxy_pass http://api_public; }'), 'public').length).toBeGreaterThan(0);
    // Opening the trusted network to everyone.
    expect(auditIngress(source.replaceAll(`${PLACEHOLDER_CIDR} 1;`, '0.0.0.0/0 1;'), 'public').length).toBeGreaterThan(0);
    // Letting a client-supplied Forwarded header through.
    expect(auditIngress(source.replaceAll('proxy_set_header Forwarded "";', ''), 'public').length).toBeGreaterThan(0);
    // A location redefining a hoisted header.
    expect(auditIngress(source.replace('location = /v1/components { limit_except', 'location = /v1/components { proxy_set_header Host $host;\n        limit_except'), 'public').length).toBeGreaterThan(0);
    // An unbalanced block.
    expect(auditIngress(source.slice(0, source.length - 3), 'public').length).toBeGreaterThan(0);
    // The public template is not a valid internal template, and vice versa.
    expect(auditIngress(source, 'internal').length).toBeGreaterThan(0);
    const internal = await readFile(INTERNAL_CONF, 'utf8');
    expect(auditIngress(internal, 'public').length).toBeGreaterThan(0);
    // Dropping the network gate from the internal servers.
    expect(auditIngress(internal.replaceAll('if ($internal_edge_trusted_network = 0) { return 403; }', ''), 'internal').length).toBeGreaterThan(0);
    // Turning the internal API origin into a deny-by-default one.
    expect(auditIngress(internal.replace('proxy_pass http://api_internal;', 'return 404;'), 'internal').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Part 2: real proxy behaviour against nginx. Needs Docker; run it on the Windows host.
// Two containers from the same reviewed image, differing only in the trusted source CIDR, so the
// allow and deny branches of the network gate are both exercised for real.
// ---------------------------------------------------------------------------------------------

let docker = false;
try {
  execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8', timeout: 20_000, windowsHide: true });
  docker = true;
} catch { docker = false; }

describe('画廊 / 管理端入口的真实代理行为', () => {
  const workdir = mkdtemp(join(tmpdir(), 'zh-gallery-admin-'));
  let hits: Hit[] = [];
  let upstream: Server | undefined;
  let upstreamPort = 0;
  const containers: string[] = [];
  const listeners: Partial<Record<Trust, Record<Listener, number>>> = {};
  const certificates = new Map<Trust, string>();

  beforeAll(async () => {
    if (!docker) return;
    expect(NGINX_IMAGE).toMatch(/^nginx@sha256:[a-f0-9]{64}$/);
    const dir = await workdir;
    upstream = createServer((req, res) => {
      hits.push({ ...req.headers, __url: req.url, __method: req.method });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    await new Promise<void>(resolve => upstream!.listen(0, '0.0.0.0', resolve));
    upstreamPort = (upstream!.address() as { port: number }).port;
    execFileSync('C:/Program Files/Git/usr/bin/openssl.exe', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=edge-local',
      '-addext', `subjectAltName=DNS:${GALLERY_HOST},DNS:${API_HOST},DNS:${ADMIN_HOST},IP:127.0.0.1`], { stdio: 'ignore', windowsHide: true });
    await start(TRUSTED_CIDR, 'trusted');
    await start(UNTRUSTED_CIDR, 'untrusted');
  }, 300_000);

  afterAll(async () => {
    for (const name of containers) execFileSync('docker', ['rm', '--force', name], { stdio: 'ignore' });
    if (upstream) await new Promise<void>(resolve => upstream!.close(() => resolve()));
    await rm(await workdir, { recursive: true, force: true });
  });

  async function start(trustedCidr: string, trust: Trust): Promise<void> {
    const dir = await workdir;
    const [publicSource, internalSource] = await Promise.all([readFile(PUBLIC_CONF, 'utf8'), readFile(INTERNAL_CONF, 'utf8')]);
    const rewrite = (source: string) => source
      .replaceAll('127.0.0.1:5173', 'host.docker.internal:' + upstreamPort)
      .replaceAll('127.0.0.1:5177', 'host.docker.internal:' + upstreamPort)
      .replaceAll('127.0.0.1:3000', 'host.docker.internal:' + upstreamPort)
      .replaceAll('/run/secrets/gallery-fullchain.pem', '/fixtures/fullchain.pem')
      .replaceAll('/run/secrets/gallery-key.pem', '/fixtures/key.pem')
      .replaceAll('/run/secrets/admin-fullchain.pem', '/fixtures/fullchain.pem')
      .replaceAll('/run/secrets/admin-key.pem', '/fixtures/key.pem')
      .replaceAll(PLACEHOLDER_CIDR, trustedCidr)
      // Exercise routing independently of the production login rate limiter.
      .replace('rate=5r/s', 'rate=1000r/s');
    const config = 'events {}\nhttp {\n' + rewrite(publicSource) + '\n' + rewrite(internalSource) + '\n}\n';
    await writeFile(join(dir, `nginx-${trust}.conf`), config);
    await writeFile(join(dir, 'fullchain.pem'), await readFile(join(dir, 'cert.pem')));
    await writeFile(join(dir, 'key.pem'), await readFile(join(dir, 'key.pem')));
    const name = 'zh-gallery-admin-' + randomUUID().slice(0, 8);
    const mount = ['--mount', `type=bind,source=${dir},target=/fixtures,readonly`];
    // Syntax first: a broken template must fail here rather than as an opaque 502 later.
    expect(execFileSync('docker', ['run', '--rm', ...mount, '--entrypoint', 'nginx', NGINX_IMAGE, '-t', '-c', `/fixtures/nginx-${trust}.conf`],
      { encoding: 'utf8', timeout: 60_000, windowsHide: true })).toBe('');
    execFileSync('docker', ['run', '--detach', '--name', name, ...mount,
      '-p', '127.0.0.1::443', '-p', '127.0.0.1::8443', NGINX_IMAGE, 'nginx', '-c', `/fixtures/nginx-${trust}.conf`, '-g', 'daemon off;'],
      { encoding: 'utf8', timeout: 60_000, windowsHide: true });
    containers.push(name);
    listeners[trust] = {
      public443: Number(execFileSync('docker', ['port', name, '443/tcp'], { encoding: 'utf8', windowsHide: true }).trim().split(':').at(-1)),
      internal8443: Number(execFileSync('docker', ['port', name, '8443/tcp'], { encoding: 'utf8', windowsHide: true }).trim().split(':').at(-1)),
    };
    certificates.set(trust, await readFile(join(dir, 'cert.pem'), 'utf8'));
  }

  async function call(trust: Trust, which: Listener, hostname: string, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<number> {
    const port = listeners[trust]![which];
    const ca = certificates.get(trust)!;
    return new Promise<number>((resolve, reject) => {
      const req = httpsRequest({
        hostname, port, path, method: init.method ?? 'GET', ca,
        lookup: (_hostname, _options, callback) => callback(null, [{ address: '127.0.0.1', family: 4 }]),
        headers: { host: hostname, ...(init.body ? { 'content-length': String(Buffer.byteLength(init.body)) } : {}), ...(init.headers ?? {}) },
      }, res => {
        res.resume();
        res.on('end', () => resolve(res.statusCode!));
      });
      req.on('error', reject);
      req.setTimeout(10_000, () => req.destroy(new Error('Ingress response timed out')));
      req.end(init.body);
    });
  }

  const hitsFor = (host: string) => hits.filter(hit => hit.host === host);
  const lastHitFor = (host: string) => hitsFor(host).at(-1);
  const spoof = { 'x-forwarded-for': '203.0.113.7', forwarded: 'for=203.0.113.7', 'x-real-ip': '203.0.113.7' };
  const json = { 'content-type': 'application/json' };

  it.skipIf(!docker)('公网入口放行浏览 / 登录 / 预览，查询串里的百分号编码值不受影响', async () => {
    const allowed: [string, string][] = [
      ['GET', '/healthz'], ['GET', '/v1/components'], ['GET', '/v1/me/components'],
      ['GET', `/v1/variant-releases/${RELEASE_ID}`], ['GET', `/v1/variant-releases/${RELEASE_ID}/compatibility`],
      ['GET', `/v1/variant-releases/${RELEASE_ID}/artifacts?path=docs%2Fline-vue.md`], ['GET', `/v1/variant-releases/${RELEASE_ID}/reports`],
      ['GET', '/v1/variants/line-vue/releases/0.0.1'], ['GET', '/v1/variants/line-vue/releases/0.0.1/artifacts?path=docs%2Fline-vue.md'],
      ['GET', '/v1/me/variants/line-vue/releases/0.0.1/reports'],
      ['GET', '/v1/auth/oidc/session'], ['POST', '/v1/auth/oidc/logout'], ['POST', '/v1/preview-grants'],
      ['GET', '/v1/auth/oidc/start'], ['GET', '/v1/auth/oidc/start?target=gallery'],
      ['GET', '/v1/auth/oidc/callback?code=a%2Fb%2Bc&state=s&iss=https%3A%2F%2Fid.example.com'],
    ];
    for (const [method, path] of allowed) {
      expect(await call('trusted', 'public443', API_HOST, path, { method, headers: json }), `${method} ${path}`).toBe(200);
    }
    // Encoded values live in the query string, which is not traversal-checked.
    expect(await call('trusted', 'public443', API_HOST, '/v1/components?query=%2F&framework=react')).toBe(200);
    expect(await call('trusted', 'public443', API_HOST, '/v1/components', { method: 'HEAD' })).toBe(200);
    // The public gallery host serves the gallery and nothing else.
    expect(await call('trusted', 'public443', GALLERY_HOST, '/')).toBe(200);
    for (const path of ['/v1/components', '/v1/me/components', '/admin/', '/internal/metrics', '/identity/jwks']) {
      expect(await call('trusted', 'public443', GALLERY_HOST, path), `gallery host ${path}`).toBe(404);
    }
    // Default deny on the API origin, and traversal refused before any upstream hop.
    for (const path of ['/v1/unknown', '/identity/token', '/identity/.well-known/openid-configuration', '/whatever']) {
      expect(await call('trusted', 'public443', API_HOST, path), `api host ${path}`).toBe(404);
    }
    for (const path of ['/v1/%2e%2e/components', '/v1//components', '/v1/components/..%2fadmin', '/v1/variant-releases/%2e%2e/admin']) {
      expect(await call('trusted', 'public443', API_HOST, path), `bypass ${path}`).toBe(400);
    }
    // Simple one-line locations inherit the hoisted forwarding-header overrides.
    expect(lastHitFor(API_HOST)!['x-forwarded-for']).toMatch(/^172\.\d+\.\d+\.\d+$/);
    expect(lastHitFor(API_HOST)!.forwarded).toBeUndefined();
    expect(lastHitFor(API_HOST)!['x-forwarded-proto']).toBe('https');
    expect(lastHitFor(GALLERY_HOST)!['x-forwarded-for']).toMatch(/^172\.\d+\.\d+\.\d+$/);
    expect(lastHitFor(GALLERY_HOST)!.forwarded).toBeUndefined();
  });

  it.skipIf(!docker)('公开读路径只接受 GET / HEAD / OPTIONS，写方法一律拒绝', async () => {
    const before = hitsFor(API_HOST).length;
    for (const [method, path] of [
      ['POST', '/v1/components'], ['PUT', '/v1/components'], ['DELETE', '/v1/components'],
      ['POST', '/v1/me/components'], ['PATCH', `/v1/variant-releases/${RELEASE_ID}`],
      ['DELETE', `/v1/variant-releases/${RELEASE_ID}/compatibility`], ['GET', '/v1/preview-grants'],
      ['POST', '/v1/auth/oidc/session'], ['POST', '/v1/auth/oidc/start'],
    ] as [string, string][]) {
      expect(await call('trusted', 'public443', API_HOST, path, { method, headers: json }), `${method} ${path}`).toBe(403);
    }
    expect(hitsFor(API_HOST).length).toBe(before);
  });

  it.skipIf(!docker)('兼容性写入、候选验证与 CLI 元数据只在可信网络来源可用', async () => {
    // Public read of the same path stays public on both edges.
    expect(await call('untrusted', 'public443', API_HOST, `/v1/variant-releases/${RELEASE_ID}/compatibility`)).toBe(200);
    expect(await call('trusted', 'public443', API_HOST, `/v1/variant-releases/${RELEASE_ID}/compatibility`)).toBe(200);
    // Its POST is a maintainer write.
    expect(await call('untrusted', 'public443', API_HOST, `/v1/variant-releases/${RELEASE_ID}/compatibility`, { method: 'POST', headers: json })).toBe(403);
    expect(await call('trusted', 'public443', API_HOST, `/v1/variant-releases/${RELEASE_ID}/compatibility`, { method: 'POST', headers: json })).toBe(200);
    // Candidate verification and CLI login metadata, with and without a candidate pointer.
    for (const path of ['/v1/auth/oidc/candidate-start', '/v1/auth/oidc/candidate', '/v1/auth/oidc/cli', `/v1/auth/oidc/cli?revision=${RELEASE_ID}`]) {
      expect(await call('untrusted', 'public443', API_HOST, path, { method: 'POST', headers: json }), `untrusted ${path}`).toBe(403);
      expect(await call('untrusted', 'public443', API_HOST, path, { method: 'POST', headers: { ...json, ...spoof } }), `spoofed ${path}`).toBe(403);
    }
    expect(await call('trusted', 'public443', API_HOST, '/v1/auth/oidc/cli')).toBe(200);
    // target=admin is an internal console entry.
    expect(await call('untrusted', 'public443', API_HOST, '/v1/auth/oidc/start?target=admin')).toBe(403);
    expect(await call('trusted', 'public443', API_HOST, '/v1/auth/oidc/start?target=admin')).toBe(200);
  });

  it.skipIf(!docker)('登录入口拒绝候选指针、未知 target、编码与重复参数', async () => {
    const before = hitsFor(API_HOST).length;
    const refused = [
      `revision=${RELEASE_ID}`, `rev%69sion=${RELEASE_ID}`, 'revision=a&revision=b', `target=gallery&revision=${RELEASE_ID}`,
      'target=evil', 'TARGET=gallery', 'target=gallery&target=gallery', 'target=admin', `target=admin&revision=${RELEASE_ID}`,
      'redirect=https%3A%2F%2Fevil.example.com', 'target=gallery&redirect=https%3A%2F%2Fevil.example.com', 'session_state=x',
    ];
    for (const args of refused) {
      const path = `/v1/auth/oidc/start?${args}`;
      expect(await call('untrusted', 'public443', API_HOST, path), path).toBe(403);
      expect(await call('untrusted', 'public443', API_HOST, path, { headers: spoof }), `spoofed ${path}`).toBe(403);
    }
    for (const args of [`revision=${RELEASE_ID}`, 'target=admin', 'code=a&state=b&revision=x', 'redirect=https%3A%2F%2Fevil.example.com', 'code=a&state=b&iss=c&session_state=d&revision=e']) {
      expect(await call('untrusted', 'public443', API_HOST, `/v1/auth/oidc/callback?${args}`), `callback ${args}`).toBe(400);
    }
    for (const path of ['/v1/auth/oidc/session?revision=x', '/v1/preview-grants?x=1', '/v1/auth/oidc/logout?x=1']) {
      expect(await call('untrusted', 'public443', API_HOST, path, { method: path.includes('/session?') ? 'GET' : 'POST', headers: json }), path).toBe(400);
    }
    expect(hitsFor(API_HOST).length).toBe(before);
  });

  it.skipIf(!docker)('公网入口对管理写接口按可信网络来源拒绝，伪造转发头不能换取权限', async () => {
    const before = hitsFor(API_HOST).length;
    const writes: [string, string][] = [
      ['POST', '/v1/releases'], ['POST', '/v1/uploads'], ['POST', '/v1/baselines'],
      ['POST', `/v1/variant-releases/${RELEASE_ID}/deprecate`], ['GET', `/v1/releases/${RELEASE_ID}`],
      ['POST', '/v1/search/candidates'], ['POST', '/v1/matching/plans'], ['GET', '/v1/access-settings'],
      ['GET', '/v1/managed-accounts'], ['POST', '/v1/auth/oidc/candidate-start'], ['POST', '/v1/auth/oidc/candidate-cli'],
      ['GET', `/v1/auth/oidc/candidate?ticket=${'a'.repeat(43)}`], ['GET', '/internal/metrics'],
    ];
    for (const [method, path] of writes) {
      expect(await call('untrusted', 'public443', API_HOST, path, { method, headers: json }), `${method} ${path}`).toBe(403);
      expect(await call('untrusted', 'public443', API_HOST, path, { method, headers: { ...json, ...spoof } }), `spoofed ${method} ${path}`).toBe(403);
    }
    expect(hitsFor(API_HOST).length).toBe(before);
  });

  it.skipIf(!docker)('可信来源可写同一 API hostname，且一个 cookie jar 同时覆盖公网与内网路径', async () => {
    const before = hitsFor(API_HOST).length;
    for (const [method, path] of [['POST', '/v1/releases'], ['GET', '/v1/access-settings'], ['GET', '/internal/metrics']] as [string, string][]) {
      expect(await call('trusted', 'public443', API_HOST, path, { method, headers: json }), `${method} ${path}`).toBe(200);
    }
    expect(hitsFor(API_HOST).length).toBe(before + 3);
    const write = lastHitFor(API_HOST)!;
    expect(write['x-forwarded-for']).toMatch(/^172\.\d+\.\d+\.\d+$/);
    expect(write['x-forwarded-for']).not.toContain('203.0.113.7');
    expect(write.forwarded).toBeUndefined();
    expect(write['x-forwarded-host']).toBe(API_HOST);
    expect(write.host).toBe(API_HOST);
    // The same session cookie is accepted on the internal path of the same hostname.
    const cookie = '__Host-platform=' + 'a'.repeat(43);
    expect(await call('trusted', 'public443', API_HOST, '/v1/auth/oidc/session', { headers: { cookie } })).toBe(200);
    expect(lastHitFor(API_HOST)!.cookie).toBe(cookie);
    expect(await call('trusted', 'internal8443', API_HOST, '/v1/auth/oidc/session', { headers: { cookie } })).toBe(200);
    expect(lastHitFor(API_HOST)!.cookie).toBe(cookie);
    expect(lastHitFor(API_HOST)!.host).toBe(API_HOST);
  });

  it.skipIf(!docker)('内网入口只服务管理端，拒绝不可信来源，且不形成第二个 API 入口', async () => {
    expect(await call('trusted', 'internal8443', ADMIN_HOST, '/')).toBe(200);
    for (const path of ['/v1/components', '/v1/me/components', '/identity/jwks', '/internal/metrics']) {
      expect(await call('trusted', 'internal8443', ADMIN_HOST, path), `admin host ${path}`).toBe(404);
    }
    // The same API hostname serves the full surface on the internal path.
    for (const [method, path] of [
      ['GET', '/v1/components'], ['POST', '/v1/releases'], ['POST', '/v1/uploads'], ['POST', '/v1/baselines'],
      ['GET', '/v1/access-settings'], ['GET', '/v1/managed-accounts'], ['POST', '/v1/search/candidates'],
      ['POST', '/v1/matching/plans'], ['POST', '/v1/auth/oidc/candidate-start'], ['POST', '/v1/auth/oidc/candidate-cli'],
      ['POST', '/v1/auth/oidc/start'], ['POST', '/identity/token'], ['GET', '/internal/metrics'],
    ] as [string, string][]) {
      expect(await call('trusted', 'internal8443', API_HOST, path, { method, headers: json }), `internal ${method} ${path}`).toBe(200);
    }
    expect(lastHitFor(API_HOST)!.host).toBe(API_HOST);
    expect(lastHitFor(API_HOST)!.forwarded).toBeUndefined();
    // The public listener does not serve the admin hostname, so TLS rejects it.
    await expect(call('untrusted', 'public443', ADMIN_HOST, '/')).rejects.toThrow();
    expect(await call('untrusted', 'public443', API_HOST, '/')).toBe(404);
    // Every named internal server rejects an untrusted connection.
    for (const hostname of [ADMIN_HOST, API_HOST]) {
      expect(await call('untrusted', 'internal8443', hostname, '/', { headers: spoof }), `untrusted ${hostname}`).toBe(403);
    }
    expect(await call('trusted', 'internal8443', API_HOST, '/v1/%2e%2e/components')).toBe(400);
  });

  it.skipIf(!docker)('API 入口保留服务的 8 MiB JSON 上限', async () => {
    for (const which of ['public443', 'internal8443'] as Listener[]) {
      expect(await call('trusted', which, API_HOST, '/v1/uploads', { method: 'POST', headers: json, body: JSON.stringify({ manifest: 'x'.repeat(2 * 1024 ** 2) }) })).toBe(200);
      expect(await call('trusted', which, API_HOST, '/v1/uploads', { method: 'POST', headers: json, body: JSON.stringify({ manifest: 'x'.repeat(9 * 1024 ** 2) }) })).toBe(413);
    }
  });

  it.skipIf(!docker)('未服务的 hostname 在 TLS 握手阶段即被拒绝', async () => {
    const ca = certificates.get('trusted')!;
    for (const port of [listeners.trusted!.public443, listeners.trusted!.internal8443]) {
      await expect(new Promise<void>((resolve, reject) => {
        const req = httpsRequest({
          hostname: 'evil.example.com', port, path: '/', ca,
          lookup: (_hostname, _options, callback) => callback(null, [{ address: '127.0.0.1', family: 4 }]),
        }, () => resolve());
        req.on('error', reject);
        req.end();
      })).rejects.toThrow();
    }
  });
});
