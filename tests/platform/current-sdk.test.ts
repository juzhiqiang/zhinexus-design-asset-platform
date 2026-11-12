import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { sha256 } from '@company/contracts';
import { prepareReleaseBundle } from '../../packages/component-cli/src/local/manifest.js';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { buildServer as buildGateway } from '../../apps/preview-gateway/dist/app.js';
import { platformHarness, grant, upload, release } from './http-support.js';
import { realRegistry, registryToken } from './t06-support.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
async function child(args: string[], cwd: string) {
  await new Promise<void>((resolveChild, reject) => {
    const proc = spawn(process.execPath, args, { cwd, stdio: 'ignore', windowsHide: true, shell: false });
    const timeout = setTimeout(() => { proc.kill(); reject(new Error('Registry consumer timed out')); }, 120_000);
    proc.once('error', () => { clearTimeout(timeout); reject(new Error('Registry consumer failed to start')); });
    proc.once('exit', code => { clearTimeout(timeout); code === 0 ? resolveChild() : reject(new Error('Registry consumer verification failed')); });
  });
}

it('publishes one frozen current SDK bundle, serves all ten previews and installs exact Vue/React registry consumers', async () => {
  const bundleDir = join(root, '.tools', 'operations', 'current-sdk', randomUUID());
  const prepared = await prepareReleaseBundle({ repoRoot: root, bundleDir,
    components: ['line', 'bar', 'pie', 'scatter', 'trend-card'], frameworks: ['vue', 'react'], timeoutMs: 60_000 });
  expect(prepared.ok, JSON.stringify(prepared.issues)).toBe(true);
  expect(prepared.manifest.variants).toHaveLength(10);
  const preview = { platformOrigin: 'https://gallery.platform.test', apiOrigin: 'https://api.platform.test', previewOrigin: 'https://preview.assets.test' };
  const h = await platformHarness({ preview });
  let gateway: Awaited<ReturnType<typeof buildGateway>> | undefined;
  const consumers: { framework: string; version: string; exports: number }[] = [];
  try {
    await grant(h, 'alice', true);
    await h.db.query("INSERT INTO package_permissions(subject,package_name) VALUES ('alice','@company/charts-core')");
    const auth = await h.token('alice', ['publisher', 'maintainer'], 'cli');
    const accepted = await release(h, await upload(h, { manifest: prepared.manifest, files: prepared.filesMap }, auth), auth);
    expect(accepted.status).toBe(202); const { jobId } = await accepted.json();
    const registry = await realRegistry(); const worker = new ReleaseWorker(h.db, h.store, registry);
    await worker.runOnce(jobId);
    expect((await h.db.query('SELECT state FROM release_jobs WHERE id=$1', [jobId])).rows[0]!.state).toBe('READY');
    while (await worker.tags.runOnce()) { /* tags run after immutable versions are available */ }
    for (const pkg of prepared.manifest.packages) {
      expect(await sha256(await readFile(join(bundleDir, pkg.tarball.path)))).toBe(pkg.tarball.sha256);
      await registry.verifyPackage(pkg);
    }
    await h.db.query('UPDATE components SET public=true');
    const catalog = await (await h.request('/v1/components', undefined, undefined, 'GET')).json();
    expect(catalog.items).toHaveLength(5);
    expect(catalog.items.every((item: { variants: unknown[] }) => item.variants.length === 2)).toBe(true);
    gateway = await buildGateway({ databaseUrl: h.options.databaseUrl, storage: h.options.storage, preview });
    await gateway.listen(0, '127.0.0.1');
    const port = Number(new URL(await gateway.getUrl()).port);
    const get = (path: string, host: string, cookie?: string) => new Promise<{ status: number; headers: IncomingHttpHeaders; bytes: Buffer }>((done, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port, path, method: 'GET', headers: { host, ...(cookie ? { cookie } : {}) } }, res => {
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
      expect(reports.reports[0]).toMatchObject({ variantId: variant.variantId, packageSha256: variant.screenshots[0]!.packageSha256 });
      const grantResponse = await h.request('/v1/preview-grants', { variantReleaseId: id }, auth);
      expect(grantResponse.status).toBe(201);
      const url = new URL((await grantResponse.json()).bootstrapUrl);
      const redeemed = await get(url.pathname + url.search, url.host);
      expect(redeemed.status).toBe(303);
      const cookie = redeemed.headers['set-cookie']![0]!.split(';')[0]!;
      for (const ref of variant.examples.flatMap(example => example.previewFiles)) {
        const resource = await get(`/${ref.path}`, url.host, cookie);
        expect(resource.status).toBe(200); expect(await sha256(resource.bytes)).toBe(ref.sha256);
      }
      const shot = variant.screenshots[0]!;
      const image = await h.request(`/v1/variant-releases/${id}/artifacts?path=${encodeURIComponent(shot.image.path)}`, undefined, undefined, 'GET');
      expect(image.status).toBe(200); expect(await sha256(new Uint8Array(await image.arrayBuffer()))).toBe(shot.image.sha256);
    }
    const reader = await registryToken('g2reader');
    for (const framework of ['vue', 'react'] as const) {
      const directory = await mkdtemp(join(tmpdir(), 'c-sdk-registry-'));
      try {
        const pkg = prepared.manifest.packages.find(p => p.name === `@company/charts-${framework}`)!;
        await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'c-sdk-consumer', version: '1.0.0', private: true, type: 'module', dependencies: {
          [pkg.name]: pkg.version, echarts: '6.1.0', ...(framework === 'vue' ? { vue: '3.5.45' } : { react: '19.3.1', 'react-dom': '19.3.1' }),
        } }));
        await writeFile(join(directory, '.npmrc'), `@company:registry=http://127.0.0.1:14873/\n//127.0.0.1:14873/:_authToken=${reader}\nignore-scripts=true\naudit=false\nfund=false\n`, { mode: 0o600 });
        await child([join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), 'install', '--ignore-scripts', '--no-audit', '--no-fund'], directory);
        const variants = prepared.manifest.variants.filter(v => v.framework === framework);
        await writeFile(join(directory, 'verify.mjs'), variants.map(v => `if (!(await import(${JSON.stringify(`${v.packageName}${v.exportPath.slice(1)}`)}))[${JSON.stringify(v.exportName)}]) throw new Error('Missing export');`).join('\n'));
        await child([join(directory, 'verify.mjs')], directory);
        const installed = JSON.parse(await readFile(join(directory, 'node_modules', ...pkg.name.split('/'), 'package.json'), 'utf8'));
        expect(installed.version).toBe(pkg.version);
        consumers.push({ framework, version: installed.version as string, exports: variants.length });
      } finally {
        const rel = relative(resolve(tmpdir()), resolve(directory));
        if (!/^c-sdk-registry-[^/\\]+$/.test(rel)) throw new Error('Consumer cleanup path is outside its owned temp directory');
        await rm(directory, { recursive: true, force: true });
      }
    }
    await mkdir(bundleDir, { recursive: true });
    await writeFile(join(bundleDir, 'acceptance.json'), JSON.stringify({ verifiedAt: new Date().toISOString(),
      packages: prepared.manifest.packages.map(p => ({ name: p.name, version: p.version, sha256: p.tarball.sha256 })),
      implementationCount: 10, registryConsumers: consumers, state: 'READY', previewFilesMatch: true,
      limitations: ['Local signed OIDC fixtures; no company login.', 'Gateway HTTP uses test host routing; production TLS/cookie behavior remains external acceptance.', 'Consumer capture is default state only.'],
    }, null, 2) + '\n');
  } finally { await gateway?.close(); await h.close(); }
}, 300_000);
