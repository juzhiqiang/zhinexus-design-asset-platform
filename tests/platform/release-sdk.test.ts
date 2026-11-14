import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { sha256, type ReleaseManifestV1 } from '@company/contracts';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { platformHarness, grant, upload, release } from './http-support.js';
import { realRegistry, registryToken } from './t06-support.js';
import { localServices } from './support.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
async function child(args: string[], env: NodeJS.ProcessEnv, cwd = root): Promise<void> {
  await new Promise<void>((done, reject) => {
    const processHandle = spawn(process.execPath, args, { env, cwd, windowsHide: true, stdio: 'ignore' });
    const timeout = setTimeout(() => { processHandle.kill(); reject(new Error('Local verification process timed out')); }, 120_000);
    processHandle.once('error', () => { clearTimeout(timeout); reject(new Error('Local verification process failed to start')); });
    processHandle.once('exit', code => { clearTimeout(timeout); if (code === 0) done(); else reject(new Error('Local verification process failed')); });
  });
}

it('publishes unchanged historical real SDK evidence, resumes in a new OS process and installs both framework versions', async () => {
  const bundleDir = join(root, 'tests/fixtures/releases/t05-verified-sdk/bundle');
  const manifest = JSON.parse(await readFile(join(bundleDir, 'manifest.json'), 'utf8')) as ReleaseManifestV1;
  const files = new Map<string, Uint8Array>();
  for (const ref of manifest.files) {
    const bytes = await readFile(join(bundleDir, ref.path)); expect(await sha256(bytes)).toBe(ref.sha256); files.set(ref.path, bytes);
  }
  const h = await platformHarness();
  try {
    await grant(h); await h.db.query("INSERT INTO package_permissions(subject,package_name) VALUES ('alice','@company/charts-core')");
    const auth = await h.token('alice', ['publisher'], 'cli');
    const accepted = await release(h, await upload(h, { manifest, files }, auth), auth);
    expect(accepted.status).toBe(202); const { jobId } = await accepted.json();
    const env = { ...process.env, PLATFORM_DATABASE_URL: h.db.pool.options.connectionString,
      PLATFORM_S3_ENDPOINT: h.store.config.endpoint, PLATFORM_S3_REGION: h.store.config.region, PLATFORM_S3_BUCKET: h.store.config.bucket,
      PLATFORM_S3_ACCESS_KEY: h.store.config.accessKeyId, PLATFORM_S3_SECRET_KEY: h.store.config.secretAccessKey,
      PLATFORM_REGISTRY_ORIGIN: localServices().registryOrigin, PLATFORM_REGISTRY_TOKEN: await registryToken(), PLATFORM_WORKER_JOB_ID: jobId as string };
    const runner = join(root, 'apps/api/dist/releases/runner.js');
    // No CLI remains running. First OS process persists a failure after object finalization.
    await child([runner, '--once'], { ...env, PLATFORM_REGISTRY_ORIGIN: 'http://127.0.0.1:1' });
    expect((await h.db.query('SELECT state,stage FROM release_jobs')).rows[0]).toEqual({ state: 'RETRY_WAIT', stage: 'ENSURE_PACKAGES' });
    await h.request(`/v1/releases/${jobId}/retry`, {}, auth);
    // A different process with the restored registry connection resumes the original bytes.
    await child([runner, '--once'], env);
    expect((await h.db.query('SELECT state,attempt FROM release_jobs')).rows[0]).toEqual({ state: 'READY', attempt: 2 });
    const registry = await realRegistry();
    for (const pkg of manifest.packages) await registry.verifyPackage(pkg);
    const worker = new ReleaseWorker(h.db, h.store, registry);
    while (await worker.tags.runOnce()) { /* finish post-Ready tag work */ }
    const consumerEvidence: { framework: string; packageVersion: string; coreVersion: string }[] = [];
    const reader = await registryToken('g2reader');
    for (const framework of ['vue', 'react']) {
      const temp = await mkdtemp(join(tmpdir(), 't06-registry-consumer-'));
      try {
        await writeFile(join(temp, 'package.json'), JSON.stringify({ name: `t06-${framework}-consumer`, version: '1.0.0', private: true }));
        const registry = new URL(localServices().registryOrigin);
        await writeFile(join(temp, '.npmrc'), `registry=${registry.origin}/\n//${registry.host}/:_authToken=${reader}\nignore-scripts=true\naudit=false\nfund=false\n`, { mode: 0o600 });
        // Peer/runtime rendering was recorded with this exact frozen evidence in T05.
        // This independently proves registry install and dependency resolution, not a new browser run.
        await child([join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), 'install', `@company/charts-${framework}@0.0.2`, '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund'], process.env, temp);
        const frameworkPackage = JSON.parse(await readFile(join(temp, `node_modules/@company/charts-${framework}/package.json`), 'utf8'));
        const core = JSON.parse(await readFile(join(temp, 'node_modules/@company/charts-core/package.json'), 'utf8'));
        expect(frameworkPackage.version).toBe('0.0.2'); expect(core.version).toBe('0.0.2');
        consumerEvidence.push({ framework, packageVersion: frameworkPackage.version, coreVersion: core.version });
      } finally {
        const target = resolve(temp); const rel = relative(resolve(tmpdir()), target);
        if (rel.startsWith('t06-registry-consumer-') && !rel.includes('/') && !rel.includes('\\')) await rm(target, { recursive: true, force: true });
      }
    }
    const directory = join(root, '.tools/t06'); await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `sdk-release-${randomUUID()}.json`), JSON.stringify({
      timestamp: new Date().toISOString(), jobId, state: 'READY', attempts: 2, realProcessRestart: true,
      packages: manifest.packages.map(pkg => ({ name: pkg.name, version: pkg.version, sha256: pkg.tarball.sha256 })),
      implementationCount: manifest.variants.length, consumerEvidence,
      limitations: ['Historical frozen 0.0.2 browser evidence replayed, not recaptured', 'Registry install used legacy-peer-deps; no new peer compatibility claim', 'Current SDK pie bundle, OIDC and isolated preview remain separate acceptance gates'],
    }, null, 2) + '\n');
  } finally { await h.close(); }
}, 300_000);
