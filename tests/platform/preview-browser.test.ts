import { createServer as httpsServer } from 'node:https';
import { request as httpRequest, createServer as httpServer } from 'node:http';
import { connect } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { it, expect } from 'vitest';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { buildServer } from '../../apps/preview-gateway/dist/app.js';
import { replaceBundleArtifact } from '../fixtures/t05-artifacts.js';
import { workerHarness, realRegistry } from './t06-support.js';

it('isolates active preview HTML from platform credentials, network, top navigation and revoked resources in local Chromium', async () => {
  // Test-only HTTPS and local browser. These keys are generated locally, never checked in or trusted globally.
  const temp = await mkdtemp(join(tmpdir(), 'zhinexus-t07-tls-'));
  const openssl = process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
  const key = join(temp, 'key.pem'); const cert = join(temp, 'cert.pem');
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=local-preview-test', '-addext', 'subjectAltName=DNS:*.platform.test,DNS:*.assets.test,DNS:*.preview.assets.test'], { stdio: 'ignore', windowsHide: true });
  let gatewayPort = 0; let bootstrapUrl = ''; let apiRequests = 0;
  const tls = httpsServer({ key: await readFile(key), cert: await readFile(cert) }, (request, response) => {
    const host = request.headers.host?.split(':')[0];
    if (host === 'gallery.platform.test') {
      response.setHeader('Content-Type', 'text/html'); response.setHeader('Set-Cookie', 'platform-test-secret=platform-only; Secure; HttpOnly; Path=/');
      response.end(`<html><body><h1>Local test parent</h1><script>localStorage.setItem('platform-token','platform-only'); sessionStorage.setItem('platform-token','platform-only');</script><iframe id="preview" sandbox="allow-scripts allow-same-origin" src="${bootstrapUrl}"></iframe></body></html>`); return;
    }
    if (host === 'api.platform.test') { apiRequests++; response.end('must not reach this'); return; }
    const upstream = httpRequest({ hostname: '127.0.0.1', port: gatewayPort, path: request.url, method: request.method, headers: request.headers }, reply => {
      response.writeHead(reply.statusCode!, reply.headers); reply.pipe(response);
    }); upstream.on('error', () => { response.statusCode = 502; response.end(); }); request.pipe(upstream);
  });
  await new Promise<void>(resolve => tls.listen(0, '127.0.0.1', resolve));
  const port = (tls.address() as { port: number }).port;
  const tunnels = new Set<import('node:net').Socket>();
  const proxy = httpServer((_request, response) => { response.statusCode = 403; response.end(); });
  proxy.on('connect', (request, socket, head) => {
    if (!/^(?:gallery\.platform\.test|api\.platform\.test|r-[a-f0-9-]+\.preview\.assets\.test):[0-9]+$/.test(request.url ?? '') || Number(request.url?.split(':')[1]) !== port) { socket.destroy(); return; }
    const upstream = connect(port, '127.0.0.1', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); upstream.write(head); socket.pipe(upstream); upstream.pipe(socket); });
    tunnels.add(upstream); upstream.on('close', () => tunnels.delete(upstream)); upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy()); socket.on('close', () => upstream.destroy());
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const preview = { platformOrigin: `https://gallery.platform.test:${port}`, apiOrigin: `https://api.platform.test:${port}`, previewOrigin: `https://preview.assets.test:${port}` };
  let h: Awaited<ReturnType<typeof workerHarness>> | undefined;
  let gateway: Awaited<ReturnType<typeof buildServer>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    h = await workerHarness(fixture => {
      replaceBundleArtifact(fixture, 'preview/line-vue/index.html', Buffer.from(`<!doctype html><html><body>
        <button id="escape" onclick="try { top.location.href='${preview.platformOrigin}/escaped'; } catch {}">escape</button>
        <script type="module">
          const probe={ownStorage:false,parentDOM:false,parentStorage:false,network:false,worker:false,cookies:document.cookie};
          localStorage.setItem('preview-key','local'); probe.ownStorage=localStorage.getItem('preview-key')==='local';
          try { probe.parentDOM=!!parent.document.body; } catch {}
          try { probe.parentStorage=!!parent.localStorage.getItem('platform-token'); } catch {}
          try { await fetch('${preview.apiOrigin}/v1/me/components',{credentials:'include'}); probe.network=true; } catch {}
          try { await navigator.serviceWorker.register('/preview/line-vue/worker.js'); probe.worker=true; } catch {}
          window.__probe=probe; document.body.dataset.ready='yes';
        </script></body></html>`));
      const oldPath = 'preview/line-vue/index.html'; const newPath = 'preview/line-vue/图表.HTML';
      fixture.files.set(newPath, fixture.files.get(oldPath)!); fixture.files.delete(oldPath);
      for (const file of fixture.manifest.files) if (file.path === oldPath) file.path = newPath;
      const example = fixture.manifest.variants[0]!.examples[0]!;
      example.previewEntry = newPath; example.previewFiles[0]!.path = newPath;
    }, { preview });
    await new ReleaseWorker(h.db, h.store, await realRegistry()).runOnce(h.jobId);
    const ids = (await h.db.query('SELECT id,variant_id FROM variant_releases')).rows;
    const id = ids.find(v => v.variant_id === 'line-vue')!.id;
    const other = ids.find(v => v.variant_id === 'line-react')!.id;
    const issued = await h.request('/v1/preview-grants', { variantReleaseId: id }, h.auth);
    expect(issued.status).toBe(201); bootstrapUrl = (await issued.json()).bootstrapUrl;
    gateway = await buildServer({ databaseUrl: h.options.databaseUrl, storage: h.options.storage, preview });
    await gateway.listen(0, '127.0.0.1'); gatewayPort = Number(new URL(await gateway.getUrl()).port);
    browser = await chromium.launch();
    // Test-local CONNECT proxy resolves only the synthetic domains to loopback, including redirects.
    const context = await browser.newContext({ ignoreHTTPSErrors: true, proxy: { server: `http://127.0.0.1:${(proxy.address() as { port: number }).port}` } });
    const page = await context.newPage();
    await page.goto(preview.platformOrigin);
    const frame = page.frameLocator('#preview');
    await frame.locator('body[data-ready="yes"]').waitFor({ timeout: 10_000 });
    expect(await frame.locator('body').evaluate(() => (window as unknown as { __probe: unknown }).__probe)).toEqual({ ownStorage: true, parentDOM: false, parentStorage: false, network: false, worker: false, cookies: '' });
    const childOrigin = new URL(bootstrapUrl).origin;
    const child = page.frames().find(f => f.url().startsWith(childOrigin))!;
    expect(child.url()).toBe(`${childOrigin}/preview/line-vue/%E5%9B%BE%E8%A1%A8.HTML`);
    const cookies = await context.cookies(childOrigin);
    expect(cookies.find(c => c.name === '__Host-preview')).toMatchObject({ httpOnly: true, secure: true, sameSite: 'None', domain: new URL(childOrigin).hostname });
    expect((await context.cookies(`https://r-${other}.preview.assets.test:${port}`)).some(c => c.name === '__Host-preview')).toBe(false);
    await frame.locator('#escape').click();
    expect(page.url()).toBe(`${preview.platformOrigin}/`); expect(apiRequests).toBe(0);
    await h.db.query("DELETE FROM component_permissions WHERE subject='alice'");
    await child.goto(`${childOrigin}/preview/line-vue/%E5%9B%BE%E8%A1%A8.HTML?after=revoked`);
    expect(await child.locator('body').textContent()).toBe('Preview unavailable');
  } finally {
    await browser?.close(); await gateway?.close(); await h?.close();
    for (const tunnel of tunnels) tunnel.destroy();
    await new Promise<void>((resolve, reject) => proxy.close(error => error ? reject(error) : resolve()));
    await new Promise<void>((resolve, reject) => tls.close(error => error ? reject(error) : resolve()));
    await rm(temp, { recursive: true, force: true });
  }
}, 60_000);
