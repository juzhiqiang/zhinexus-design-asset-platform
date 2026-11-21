import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises';
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext } from '@playwright/test';
import { validateReleaseBundle } from '@company/contracts';
import { expect, it } from 'vitest';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { buildServer as buildGateway } from '../../apps/preview-gateway/dist/app.js';
import { loadReleaseBundle } from '../../packages/component-cli/src/local/manifest.js';
import { grant, platformHarness, release, upload } from './http-support.js';
import { realRegistry } from './t06-support.js';

const bundleInput = process.env.A10_FROZEN_BUNDLE;
const ip = '127.0.0.2';
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const originOf = (server: ReturnType<typeof httpsServer>) => 'https://' + ip + ':' + (server.address() as AddressInfo).port;

async function listen(server: ReturnType<typeof httpsServer>) {
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, ip, () => { server.off('error', reject); done(); });
  });
}

async function close(server: ReturnType<typeof httpsServer> | undefined) {
  if (!server?.listening) return;
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
}

function forward(request: IncomingMessage, response: ServerResponse, port: number, stripCredentials = false) {
  const headers = { ...request.headers };
  if (stripCredentials) {
    delete headers.cookie;
    delete headers.authorization;
  }
  const upstream = httpRequest({ hostname: '127.0.0.1', port, path: request.url, method: request.method, headers }, reply => {
    response.writeHead(reply.statusCode!, reply.headers);
    reply.pipe(response);
  });
  upstream.setTimeout(15_000, () => upstream.destroy());
  upstream.once('error', () => { response.statusCode = 502; response.end(); });
  response.once('close', () => upstream.destroy());
  request.pipe(upstream);
}

it.skipIf(!bundleInput)('serves 14 unchanged frozen previews over IP ports with disjoint and revocable sessions', async () => {
  const bundle = await loadReleaseBundle(resolve(bundleInput!));
  const validated = await validateReleaseBundle(bundle.manifest, bundle.filesMap);
  expect(validated.ok, validated.ok ? undefined : JSON.stringify(validated.issues)).toBe(true);
  const components = ['line', 'bar', 'pie', 'scatter', 'trend-card', 'ranking', 'proportion'];
  expect(bundle.manifest.variants.map(v => v.componentId + '/' + v.framework).sort())
    .toEqual(components.flatMap(component => [component + '/vue', component + '/react']).sort());

  const temp = await mkdtemp(join(tmpdir(), 'zhinexus-ip-preview-tls-'));
  const keyFile = join(temp, 'key.pem');
  const certFile = join(temp, 'cert.pem');
  const openssl = process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe')
    ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
  let platformTls: ReturnType<typeof httpsServer> | undefined;
  let previewTls: ReturnType<typeof httpsServer> | undefined;
  let harness: Awaited<ReturnType<typeof platformHarness>> | undefined;
  let gateway: Awaited<ReturnType<typeof buildGateway>> | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  try {
    execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile,
      '-days', '1', '-subj', '/CN=local-ip-preview-test', '-addext', 'subjectAltName=IP:' + ip], { stdio: 'ignore', windowsHide: true });
    const tls = { key: await readFile(keyFile), cert: await readFile(certFile) };
    const frames = new Map<string, string>();
    let apiPort = 0;
    let gatewayPort = 0;
    const observedAssetOrigins = new Set<string>();
    platformTls = httpsServer(tls, (request, response) => {
      if (request.url?.startsWith('/v1/')) { forward(request, response, apiPort); return; }
      const frame = frames.get(request.url ?? '');
      if (frame) {
        response.setHeader('Content-Type', 'text/html');
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.end('<!doctype html><iframe title="Frozen preview" sandbox="allow-scripts" src="' + frame + '"></iframe>');
        return;
      }
      response.writeHead(404).end();
    });
    previewTls = httpsServer(tls, (request, response) => {
      if (request.headers.origin && /\.(?:js|css)$/.test(request.url ?? '')) observedAssetOrigins.add(request.headers.origin);
      forward(request, response, gatewayPort, true);
    });
    await listen(platformTls);
    await listen(previewTls);
    const platformOrigin = originOf(platformTls);
    const previewOrigin = originOf(previewTls);
    expect(new URL(platformOrigin).hostname).toBe(ip);
    expect(new URL(previewOrigin).hostname).toBe(ip);
    expect(platformOrigin).not.toBe(previewOrigin);
    const preview = { mode: 'ip-port' as const, platformOrigin, apiOrigin: platformOrigin, previewOrigin };
    const h = harness = await platformHarness({ preview });
    apiPort = Number(new URL(h.origin()).port);
    await grant(h, 'alice', true);
    for (const pkg of bundle.manifest.packages) {
      await h.db.query("INSERT INTO package_permissions(subject,package_name) VALUES ('alice',$1) ON CONFLICT DO NOTHING", [pkg.name]);
    }
    const auth = await h.token('alice', ['publisher', 'maintainer'], 'cli');
    const submitted = await release(h, await upload(h, { manifest: bundle.manifest, files: bundle.filesMap }, auth), auth);
    expect(submitted.status).toBe(202);
    const { jobId } = await submitted.json();
    const worker = new ReleaseWorker(h.db, h.store, await realRegistry());
    await worker.runOnce(jobId);
    expect((await h.db.query('SELECT state FROM release_jobs WHERE id=$1', [jobId])).rows[0]?.state).toBe('READY');
    const releases = (await h.db.query<{ id: string; variant_id: string }>('SELECT id,variant_id FROM variant_releases')).rows;
    expect(releases).toHaveLength(14);
    const ids = new Map(releases.map(row => [row.variant_id, row.id]));
    gateway = await buildGateway({ databaseUrl: h.options.databaseUrl, storage: h.options.storage, preview });
    await gateway.listen(0, '127.0.0.1');
    gatewayPort = Number(new URL(await gateway.getUrl()).port);

    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ ignoreHTTPSErrors: true });
    const ctx = context;
    const requestGrant = (variantReleaseId: string, token?: string) => ctx.request.post(platformOrigin + '/v1/preview-grants', {
      data: { variantReleaseId }, ...(token ? { headers: { authorization: 'Bearer ' + token } } : {}),
    });
    const mint = async (variantReleaseId: string) => {
      const response = await requestGrant(variantReleaseId, auth);
      expect(response.status()).toBe(201);
      expect(response.headers()['cache-control']).toBe('no-store');
      const url = new URL((await response.json()).bootstrapUrl);
      expect(url.origin).toBe(previewOrigin);
      expect(url.pathname).toBe('/bootstrap');
      return url;
    };
    const previewGet = async (url: URL) => {
      try { return await ctx.request.get(url.href, { maxRedirects: 0 }); }
      catch { throw new Error('Local preview HTTPS request failed'); }
    };
    const vueId = ids.get('line-vue')!;
    const reactId = ids.get('line-react')!;
    expect((await requestGrant(vueId)).status()).toBe(401);
    expect((await requestGrant(vueId, await h.token('bob', ['reader']))).status()).toBe(404);

    const render = async (variant: (typeof bundle.manifest.variants)[number]) => {
      const bootstrap = await mint(ids.get(variant.variantId)!);
      const shellPath = '/shell/' + variant.variantId;
      frames.set(shellPath, bootstrap.href);
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.name));
      try {
        await page.goto(platformOrigin + shellPath);
        const frame = page.frameLocator('iframe');
        try {
          await frame.locator('canvas').first().waitFor({ state: 'visible', timeout: 12_000 });
        } catch { throw new Error('Frozen preview failed to render for ' + variant.variantId); }
        const runtime = await frame.locator('body').evaluate(() => ({ origin: self.origin, styles: document.styleSheets.length }));
        expect(runtime).toEqual({ origin: 'null', styles: 2 });
        expect(errors).toEqual([]);
        const child = page.frames().find(frame => frame !== page.mainFrame())!;
        const url = new URL(child.url());
        expect(url.origin).toBe(previewOrigin);
        expect(url.search).toBe('');
        const prefix = /^\/_preview\/[A-Za-z0-9_-]{43}\//.exec(url.pathname)?.[0];
        expect(Boolean(prefix)).toBe(true);
        expect(url.pathname.slice(prefix!.length)).toBe(variant.examples[0]!.previewEntry);
        expect((await previewGet(bootstrap)).status()).toBe(404);
        return { url, prefix: prefix!, page, grantHash: hash(bootstrap.searchParams.get('grant')!) };
      } catch (error) { await page.close(); throw error; }
      finally { frames.delete(shellPath); }
    };

    const vue = await render(bundle.manifest.variants.find(variant => variant.variantId === 'line-vue')!);
    const react = await render(bundle.manifest.variants.find(variant => variant.variantId === 'line-react')!);
    expect(vue.prefix === react.prefix).toBe(false);
    for (const variant of bundle.manifest.variants.filter(v => v.variantId !== 'line-vue' && v.variantId !== 'line-react')) {
      const rendered = await render(variant);
      await rendered.page.close();
    }
    expect(await ctx.cookies(previewOrigin)).toEqual([]);
    expect([...observedAssetOrigins]).toEqual(['null']);
    for (const entry of [vue, react]) {
      const response = await previewGet(entry.url);
      expect(response.status()).toBe(200);
      const headers = response.headers();
      expect(headers['set-cookie']).toBeUndefined();
      expect(headers['cache-control']).toBe('no-store');
      expect(headers['referrer-policy']).toBe('no-referrer');
      const csp = headers['content-security-policy'] ?? '';
      expect(csp.includes('sandbox allow-scripts')).toBe(true);
      expect(csp.includes('allow-same-origin')).toBe(false);
      expect(csp.includes('frame-ancestors ' + platformOrigin)).toBe(true);
      expect(csp.includes(previewOrigin + entry.prefix)).toBe(true);
    }
    const sample = bundle.manifest.variants.find(variant => variant.variantId === 'line-vue')!.examples[0]!;
    for (const artifact of sample.previewFiles) {
      const response = await previewGet(new URL(vue.prefix + artifact.path, previewOrigin));
      expect(response.status(), artifact.path).toBe(200);
      expect(hash(await response.body())).toBe(artifact.sha256);
      if (artifact.path.match(/\.(?:css|js)$/)) {
        expect(response.headers()['access-control-allow-origin']).toBe('*');
        expect(response.headers()['access-control-allow-credentials']).toBeUndefined();
      }
    }
    expect((await previewGet(new URL('/' + sample.previewEntry, previewOrigin))).status()).toBe(404);
    expect((await previewGet(new URL(vue.prefix + react.url.pathname.slice(react.prefix.length), previewOrigin))).status()).toBe(404);
    const wrongPort = await fetch('http://127.0.0.1:' + gatewayPort + vue.url.pathname, {
      headers: { host: new URL(platformOrigin).host }, signal: AbortSignal.timeout(10_000),
    });
    expect(wrongPort.status).toBe(404);
    await h.db.query('UPDATE release_artifacts SET sha256=$1 WHERE job_id=$2 AND path=$3', ['0'.repeat(64), jobId, sample.previewEntry]);
    expect((await previewGet(vue.url)).status()).toBe(404);
    await h.db.query('UPDATE release_artifacts SET sha256=$1 WHERE job_id=$2 AND path=$3', [sample.previewFiles.find(ref => ref.path === sample.previewEntry)!.sha256, jobId, sample.previewEntry]);
    expect((await previewGet(vue.url)).status()).toBe(200);
    await h.db.query("UPDATE preview_grants SET expires_at=now()-interval '1 second' WHERE token_hash=$1", [vue.grantHash]);
    expect((await previewGet(vue.url)).status()).toBe(404);
    expect((await previewGet(react.url)).status()).toBe(200);
    await h.db.query('UPDATE preview_grants SET revoked_at=now() WHERE token_hash=$1', [react.grantHash]);
    expect((await previewGet(react.url)).status()).toBe(404);
    const fresh = await mint(reactId);
    const redirect = await previewGet(fresh);
    expect(redirect.status()).toBe(303);
    expect(redirect.headers()['set-cookie']).toBeUndefined();
    const renewedUrl = new URL(redirect.headers().location!, previewOrigin);
    expect((await previewGet(renewedUrl)).status()).toBe(200);
    await h.db.query("DELETE FROM component_permissions WHERE subject='alice' AND component_id='line'");
    expect((await previewGet(renewedUrl)).status()).toBe(404);
  } finally {
    try { await context?.close(); }
    finally {
      try { await browser?.close(); }
      finally {
        try { await Promise.all([close(platformTls), close(previewTls)]); }
        finally {
          try { await gateway?.close(); }
          finally {
            try { await harness?.close(); }
            finally {
              for (const file of [keyFile, certFile]) if (existsSync(file)) await unlink(file);
              await rmdir(temp);
            }
          }
        }
      }
    }
  }
}, 180_000);
