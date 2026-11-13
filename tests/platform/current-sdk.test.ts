import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { connect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { chromium } from '@playwright/test';
import { sha256 } from '@company/contracts';
import { prepareReleaseBundle } from '../../packages/component-cli/src/local/manifest.js';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { buildServer as buildGateway } from '../../apps/preview-gateway/dist/app.js';
import { platformHarness, grant, upload, release } from './http-support.js';
import { realRegistry, registryToken } from './t06-support.js';
import { RecoveryStack } from '../../infra/scripts/recovery-stack.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
async function child(args: string[], cwd: string) {
  await new Promise<void>((resolveChild, reject) => {
    const proc = spawn(process.execPath, args, { cwd, stdio: 'ignore', windowsHide: true, shell: false });
    const timeout = setTimeout(() => { proc.kill(); reject(new Error('Registry consumer timed out')); }, 120_000);
    proc.once('error', () => { clearTimeout(timeout); reject(new Error('Registry consumer failed to start')); });
    proc.once('exit', code => { clearTimeout(timeout); code === 0 ? resolveChild() : reject(new Error('Registry consumer verification failed')); });
  });
}

it('publishes one frozen current SDK bundle, serves all fourteen previews and installs exact Vue/React registry consumers', async () => {
  const bundleDir = join(root, '.tools', 'operations', 'current-sdk', randomUUID());
  const prepared = await prepareReleaseBundle({ repoRoot: root, bundleDir,
    frameworks: ['vue', 'react'], timeoutMs: 60_000 });
  expect(prepared.ok, JSON.stringify(prepared.issues)).toBe(true);
  expect(prepared.manifest.variants).toHaveLength(14);
  const components = ['line', 'bar', 'pie', 'scatter', 'trend-card', 'ranking', 'proportion'];
  expect(prepared.manifest.variants.map(v => `${v.componentId}/${v.framework}`).sort())
    .toEqual(components.flatMap(id => [`${id}/vue`, `${id}/react`]).sort());
  expect(prepared.manifest.packages).toHaveLength(3);
  let stack: RecoveryStack | undefined;
  let harness: Awaited<ReturnType<typeof platformHarness>> | undefined;
  let gateway: Awaited<ReturnType<typeof buildGateway>> | undefined;
  const consumers: { framework: string; version: string; exports: number }[] = [];
  const previewEvidence: Array<{ variantId: string; entry: string; checks: Array<{ name: string; status: string }>;
    resources: Array<{ path: string; sha256: string }> }> = [];
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let tls: ReturnType<typeof httpsServer> | undefined;
  let proxy: ReturnType<typeof createHttpServer> | undefined;
  let tlsDirectory: string | undefined;
  let gatewayPort: number | undefined;
  let previewPort = 0;
  const tunnels = new Set<import('node:net').Socket>();
  try {
    tlsDirectory = await mkdtemp(join(tmpdir(), 'c-sdk-preview-tls-'));
    const openssl = process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
    const keyPath = join(tlsDirectory, 'key.pem'); const certPath = join(tlsDirectory, 'cert.pem');
    execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
      '-days', '1', '-subj', '/CN=local-preview-test', '-addext', 'subjectAltName=DNS:*.preview.assets.test'], { stdio: 'ignore', windowsHide: true });
    tls = httpsServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, (request, response) => {
      if (!gatewayPort) { response.statusCode = 503; response.end(); return; }
      const upstream = httpRequest({ hostname: '127.0.0.1', port: gatewayPort, path: request.url, method: request.method, headers: request.headers }, reply => {
        response.writeHead(reply.statusCode!, reply.headers); reply.pipe(response);
      });
      upstream.on('error', () => { response.statusCode = 502; response.end(); }); request.pipe(upstream);
    });
    await new Promise<void>((resolveTls, rejectTls) => { tls!.once('error', rejectTls); tls!.listen(0, '127.0.0.1', resolveTls); });
    previewPort = (tls.address() as AddressInfo).port;
    const preview = { platformOrigin: 'https://gallery.platform.test', apiOrigin: 'https://api.platform.test', previewOrigin: `https://preview.assets.test:${previewPort}` };
    // Fresh stores allow immutable current-version publication without touching shared G2 data.
    const password = () => randomBytes(32).toString('base64url');
    stack = new RecoveryStack({ postgresPassword: password(), publisherPassword: password(), readerPassword: password(), minioUser: 'recovery-user', minioPassword: password() });
    await stack.start();
    const services = { credentials: stack.secrets, postgresPort: stack.ports.postgres,
      storageEndpoint: `http://127.0.0.1:${stack.ports.minio}`, registryOrigin: `http://127.0.0.1:${stack.ports.verdaccio}` };
    const h = harness = await platformHarness({ preview }, services);
    await grant(h, 'alice', true);
    await h.db.query("INSERT INTO package_permissions(subject,package_name) VALUES ('alice','@company/charts-core')");
    const auth = await h.token('alice', ['publisher', 'maintainer'], 'cli');
    const accepted = await release(h, await upload(h, { manifest: prepared.manifest, files: prepared.filesMap }, auth), auth);
    expect(accepted.status).toBe(202); const { jobId } = await accepted.json();
    const registry = await realRegistry(services); const worker = new ReleaseWorker(h.db, h.store, registry);
    await worker.runOnce(jobId);
    expect((await h.db.query('SELECT state FROM release_jobs WHERE id=$1', [jobId])).rows[0]!.state).toBe('READY');
    while (await worker.tags.runOnce()) { /* tags run after immutable versions are available */ }
    for (const pkg of prepared.manifest.packages) {
      expect(await sha256(await readFile(join(bundleDir, pkg.tarball.path)))).toBe(pkg.tarball.sha256);
      await registry.verifyPackage(pkg);
    }
    await h.db.query('UPDATE components SET public=true');
    const catalog = await (await h.request('/v1/components', undefined, undefined, 'GET')).json();
    expect(catalog.items).toHaveLength(7);
    expect(catalog.items.every((item: { variants: unknown[] }) => item.variants.length === 2)).toBe(true);
    gateway = await buildGateway({ databaseUrl: h.options.databaseUrl, storage: h.options.storage, preview });
    await gateway.listen(0, '127.0.0.1');
    gatewayPort = Number(new URL(await gateway.getUrl()).port);
    proxy = createHttpServer((_request, response) => { response.statusCode = 403; response.end(); });
    proxy.on('connect', (request, socket, head) => {
      if (!new RegExp(`^r-[a-f0-9-]+\\.preview\\.assets\\.test:${previewPort}$`).test(request.url ?? '')) { socket.destroy(); return; }
      const upstream = connect(previewPort, '127.0.0.1', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); upstream.write(head); socket.pipe(upstream); upstream.pipe(socket); });
      tunnels.add(upstream); upstream.on('close', () => tunnels.delete(upstream)); upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy()); socket.on('close', () => upstream.destroy());
    });
    await new Promise<void>((resolveProxy, rejectProxy) => { proxy!.once('error', rejectProxy); proxy!.listen(0, '127.0.0.1', resolveProxy); });
    const proxyPort = (proxy.address() as AddressInfo).port;
    browser = await chromium.launch({ headless: true });
    const get = (path: string, host: string, cookie?: string) => new Promise<{ status: number; headers: IncomingHttpHeaders; bytes: Buffer }>((done, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: gatewayPort!, path, method: 'GET', headers: { host, ...(cookie ? { cookie } : {}) } }, res => {
        const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.on('end', () => done({ status: res.statusCode!, headers: res.headers, bytes: Buffer.concat(chunks) }));
        res.on('error', reject);
      });
      req.on('error', reject); req.setTimeout(15_000, () => req.destroy(new Error('Gateway timed out'))); req.end();
    });
    for (const variant of prepared.manifest.variants) {
      const id = (await h.db.query('SELECT id FROM variant_releases WHERE variant_id=$1', [variant.variantId])).rows[0]!.id;
      const detail = await (await h.request(`/v1/variant-releases/${id}`, undefined, undefined, 'GET')).json();
      expect(detail).toMatchObject({ reportSource: 'local-automatic', baselineStatus: 'unconfirmed', indexStatus: 'pending' });
      const reports = await (await h.request(`/v1/variant-releases/${id}/reports`, undefined, undefined, 'GET')).json();
      expect(reports.reports).toHaveLength(1);
      expect(detail.variant).toEqual(variant);
      const packageRef = prepared.manifest.packages.find(pkg => pkg.name === variant.packageName);
      expect(detail.package).toEqual(packageRef);
      const reportRef = prepared.manifest.reports.find(ref => ref.path === `reports/${variant.variantId}.json`)!;
      const reportBytes = await readFile(join(bundleDir, reportRef.path));
      expect(await sha256(reportBytes)).toBe(reportRef.sha256);
      expect(reports.reports[0]).toEqual(JSON.parse(reportBytes.toString('utf8')));
      expect(reports.reports[0]).toMatchObject({ variantId: variant.variantId, packageSha256: variant.screenshots[0]!.packageSha256 });
      const grantResponse = await h.request('/v1/preview-grants', { variantReleaseId: id }, auth);
      expect(grantResponse.status).toBe(201);
      const url = new URL((await grantResponse.json()).bootstrapUrl);
      const context = await browser.newContext({ ignoreHTTPSErrors: true, proxy: { server: `http://127.0.0.1:${proxyPort}` } });
      let cookie = '';
      const observed = { variantId: variant.variantId, entry: '', checks: [] as Array<{ name: string; status: string }>,
        resources: [] as Array<{ path: string; sha256: string }> };
      try {
        const page = await context.newPage();
        const pageErrors: string[] = [];
        const failedRequests: string[] = [];
        const responses: string[] = [];
        const requests: string[] = [];
        const safeUrl = (value: string) => { const parsed = new URL(value); return `${parsed.origin}${parsed.pathname}`; };
        const grantValue = url.searchParams.get('grant');
        const redact = (value: string) => (grantValue ? value.replaceAll(grantValue, '[redacted]') : value)
          .replace(/([?&]grant=)[^\s"'<>]+/g, '$1[redacted]');
        page.on('requestfailed', request => failedRequests.push(`${safeUrl(request.url())} ${redact(request.failure()?.errorText ?? '')}`));
        page.on('request', request => requests.push(`${safeUrl(request.url())} cookie=${Boolean(request.headers().cookie)}`));
        page.on('response', response => responses.push(`${response.status()} ${safeUrl(response.url())}`));
        page.on('pageerror', error => pageErrors.push(redact(error.message)));
        let checks: Array<{ name: string; status: string }>;
        try {
          await page.goto(url.href, { waitUntil: 'networkidle' });
          checks = await page.evaluate(async () => {
            const example = (window as unknown as { __COMPONENT_EXAMPLE__?: { ready: Promise<void>; getChecks: () => Array<{ name: string; status: string }> } }).__COMPONENT_EXAMPLE__;
            if (!example) throw new Error('__COMPONENT_EXAMPLE__.missing');
            await example.ready;
            return example.getChecks();
          });
        } catch (error) {
          throw new Error(redact(`${error instanceof Error ? error.message : String(error)} variant=${variant.variantId} url=${safeUrl(page.url())} pageErrors=${pageErrors.join(';')} failed=${failedRequests.join(';')} requests=${requests.join(';')} responses=${responses.join(';')}`));
        }
        const expectedEntryPath = `/${variant.examples[0]!.previewEntry.split('/').map(encodeURIComponent).join('/')}`;
        expect(safeUrl(page.url())).toBe(`${url.origin}${expectedEntryPath}`);
        expect(new URL(page.url()).searchParams.has('grant')).toBe(false);
        expect(pageErrors).toEqual([]);
        expect(checks.length).toBeGreaterThan(0);
        const checkSummary = (items: Array<{ name: string; status: string }>) => items.map(({ name, status }) => ({ name, status })).sort((a, b) => a.name.localeCompare(b.name));
        expect(checkSummary(checks)).toEqual(checkSummary(reports.reports[0].checks));
        expect(checks.every(check => check.status === 'passed'), JSON.stringify({ variantId: variant.variantId, checks })).toBe(true);
        expect(await page.locator('canvas,svg').count()).toBeGreaterThan(0);
        expect(responses.some(response => response.startsWith('303 '))).toBe(true);
        const previewCookie = (await context.cookies(url.origin)).find(item => item.name === '__Host-preview');
        expect(previewCookie && { name: previewCookie.name, httpOnly: previewCookie.httpOnly, secure: previewCookie.secure,
          sameSite: previewCookie.sameSite, domain: previewCookie.domain, path: previewCookie.path })
          .toEqual({ name: '__Host-preview', httpOnly: true, secure: true, sameSite: 'None', domain: url.hostname, path: '/' });
        cookie = `${previewCookie!.name}=${previewCookie!.value}`;
        observed.entry = safeUrl(page.url());
        observed.checks = checkSummary(checks);
        await page.close();
      } finally { await context.close(); }
      for (const ref of variant.examples.flatMap(example => example.previewFiles)) {
        const resource = await get(`/${ref.path}`, url.host, cookie);
        const digest = await sha256(resource.bytes);
        expect(resource.status).toBe(200); expect(digest).toBe(ref.sha256);
        observed.resources.push({ path: ref.path, sha256: digest });
      }
      previewEvidence.push(observed);
      for (const ref of [variant.api, variant.docs]) {
        const artifact = await h.request(`/v1/variant-releases/${id}/artifacts?path=${encodeURIComponent(ref.path)}`, undefined, undefined, 'GET');
        expect(artifact.status).toBe(200);
        expect(await sha256(new Uint8Array(await artifact.arrayBuffer()))).toBe(ref.sha256);
      }
      const shot = variant.screenshots[0]!;
      const image = await h.request(`/v1/variant-releases/${id}/artifacts?path=${encodeURIComponent(shot.image.path)}`, undefined, undefined, 'GET');
      expect(image.status).toBe(200); expect(await sha256(new Uint8Array(await image.arrayBuffer()))).toBe(shot.image.sha256);
    }
    const reader = await registryToken('g2reader', services);
    for (const framework of ['vue', 'react'] as const) {
      const directory = await mkdtemp(join(tmpdir(), 'c-sdk-registry-'));
      try {
        const pkg = prepared.manifest.packages.find(p => p.name === `@company/charts-${framework}`)!;
        await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'c-sdk-consumer', version: '1.0.0', private: true, type: 'module', dependencies: {
          [pkg.name]: pkg.version, echarts: '6.1.0', ...(framework === 'vue' ? { vue: '3.5.45' } : { react: '19.3.1', 'react-dom': '19.3.1' }),
        } }));
        await writeFile(join(directory, '.npmrc'), `@company:registry=${services.registryOrigin}/\n//${new URL(services.registryOrigin).host}/:_authToken=${reader}\nignore-scripts=true\naudit=false\nfund=false\n`, { mode: 0o600 });
        await child([join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), 'install', '--ignore-scripts', '--no-audit', '--no-fund'], directory);
        const variants = prepared.manifest.variants.filter(v => v.framework === framework);
        expect(variants).toHaveLength(7);
        await writeFile(join(directory, 'verify.mjs'), variants.map(v => `if (!(await import(${JSON.stringify(`${v.packageName}${v.exportPath.slice(1)}`)}))[${JSON.stringify(v.exportName)}]) throw new Error('Missing export');`).join('\n'));
        await child([join(directory, 'verify.mjs')], directory);
        const installed = JSON.parse(await readFile(join(directory, 'node_modules', ...pkg.name.split('/'), 'package.json'), 'utf8'));
        expect(installed.version).toBe(pkg.version);
        const core = prepared.manifest.packages.find(p => p.name === '@company/charts-core')!;
        expect(installed.dependencies['@company/charts-core']).toBe(core.version);
        const installedCore = JSON.parse(await readFile(join(directory, 'node_modules/@company/charts-core/package.json'), 'utf8'));
        expect(installedCore.version).toBe(core.version);
        consumers.push({ framework, version: installed.version as string, exports: variants.length });
      } finally {
        const rel = relative(resolve(tmpdir()), resolve(directory));
        if (!/^c-sdk-registry-[^/\\]+$/.test(rel)) throw new Error('Consumer cleanup path is outside its owned temp directory');
        await rm(directory, { recursive: true, force: true });
      }
    }
    await mkdir(bundleDir, { recursive: true });
    await writeFile(join(bundleDir, 'acceptance.json'), JSON.stringify({ verifiedAt: new Date().toISOString(),
      os: process.platform, arch: process.arch, components,
      packages: prepared.manifest.packages.map(p => ({ name: p.name, version: p.version, sha256: p.tarball.sha256 })),
      implementationCount: 14, registryConsumers: consumers, state: 'READY', previewFilesMatch: true,
      browserPreviews: previewEvidence,
      variants: prepared.manifest.variants.map(v => ({ componentId: v.componentId, framework: v.framework, variantId: v.variantId,
        api: v.api, docs: v.docs, reports: prepared.manifest.reports.filter(r => r.path === `reports/${v.variantId}.json`),
        screenshots: v.screenshots.map(s => ({ path: s.image.path, sha256: s.image.sha256, packageSha256: s.packageSha256 })) })),
      limitations: ['Local signed OIDC fixtures and test-only self-signed TLS; no company login or production TLS validation.', 'Consumer capture is default state only.'],
    }, null, 2) + '\n');
  } finally {
    try { await browser?.close(); }
    finally {
      try {
        for (const tunnel of tunnels) tunnel.destroy();
        try {
          if (proxy?.listening) await new Promise<void>((resolveClose, rejectClose) => proxy!.close(error => error ? rejectClose(error) : resolveClose()));
        } finally {
          if (tls?.listening) await new Promise<void>((resolveClose, rejectClose) => tls!.close(error => error ? rejectClose(error) : resolveClose()));
        }
      } finally {
        try { await gateway?.close(); }
        finally {
          try { await harness?.close(); }
          finally {
            try { await stack?.close(); }
            finally {
              try { if (tlsDirectory) await rm(tlsDirectory, { recursive: true, force: true }); }
              finally {
                if (stack) {
                  const recoveryRoot = resolve(root, '.tools', 'recovery');
                  const ownedPath = relative(recoveryRoot, resolve(stack.directory));
                  if (!/^[0-9a-f-]{36}$/.test(ownedPath)) throw new Error('Recovery cleanup path is outside its owned UUID directory');
                  await rm(stack.directory, { recursive: true, force: true });
                }
              }
            }
          }
        }
      }
    }
  }
}, 300_000);
