import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, cp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { sha256, manifestDigest, type ReleaseManifestV1 } from '@company/contracts';
import { packPackage, resolvePnpmExecutable } from '../../packages/component-cli/src/local/pack.js';
import { loadReleaseSession } from '../../packages/component-cli/src/local/release.js';
import { platformHarness } from './http-support.js';
import { localServices } from './support.js';
import { realRegistry, registryToken } from './t06-support.js';

const execute = promisify(execFile);
const commandOptions = (cwd: string, env = process.env) => ({ cwd, env, timeout: 180_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });

async function project(parent: string, mode: 'all' | 'vue' | 'react') {
  const root = join(parent, mode); await cp(resolve('tests/consumers/project'), root, { recursive: true });
  const name = '@company/project-' + mode + '-' + randomUUID();
  const pkgPath = join(root, 'component/package.json'); const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  pkg.name = name;
  if (mode !== 'all') {
    pkg.exports = { '.': { import: './dist/' + mode + '.mjs' }, ['./' + mode]: pkg.exports['./' + mode], './theme.css': './dist/theme.css' };
    await writeFile(join(root, 'component/build.mjs'), `import { mkdir, copyFile, appendFile, writeFile } from 'node:fs/promises';\nawait mkdir('dist', { recursive: true }); await copyFile('src/${mode}.mjs', 'dist/${mode}.mjs'); await writeFile('dist/theme.css', '.badge { color: navy; }'); await appendFile('build-count', 'build\\n');\n`);
  }
  await writeFile(pkgPath, JSON.stringify(pkg));
  await mkdir(join(root, 'api')); await mkdir(join(root, 'docs'));
  const variants = [];
  for (const framework of mode === 'all' ? ['vue', 'react'] as const : [mode]) {
    const consumerDir = join(root, 'consumers', framework);
    const consumer = JSON.parse(await readFile(join(consumerDir, 'package.json'), 'utf8'));
    delete consumer.dependencies['@fixture/project-badge']; consumer.dependencies[name] = pkg.version;
    await writeFile(join(consumerDir, 'package.json'), JSON.stringify(consumer));
    await writeFile(join(consumerDir, 'main.js'), (await readFile(join(consumerDir, 'main.js'), 'utf8')).replaceAll('@fixture/project-badge', name));
    const variant = { componentId: 'badge', framework, category: 'general', exportName: framework === 'vue' ? 'BadgeVue' : 'BadgeReact', exportPath: './' + framework, api: `api/${framework}.json`, docs: `docs/${framework}.md`, consumer: { templateDir: `consumers/${framework}`, adapter: 'vite', previewDir: 'dist', previewEntry: 'index.html' }, readiness: { selector: '#app', states: ['default'], width: 800, height: 400, renderer: 'canvas', theme: 'light' } };
    await writeFile(join(root, variant.api), JSON.stringify({ schemaVersion: 1, componentId: 'badge', framework, exportName: variant.exportName, exportPath: variant.exportPath, props: [], events: [], notes: [] }));
    await writeFile(join(root, variant.docs), '# Test fixture badge\n'); variants.push(variant);
  }
  await writeFile(join(root, 'component.config.json'), JSON.stringify({ schemaVersion: 1, packageDir: 'component', build: { program: process.execPath, args: ['build.mjs'] }, dev: {}, variants }));
  // A private business application selects its public component subpackage.
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'private-business-fixture', version: '1.0.0', private: true }));
  return { root, name };
}

it('publishes installed project CLI shared and exclusive framework packages through real stores, frozen retries and process recovery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'project-ready-'));
  const evidence: Record<string, unknown>[] = [];
  try {
    const packed = await packPackage({ packageDir: resolve('packages/component-cli'), outputDir: join(directory, 'cli-freeze') });
    const installRoot = join(directory, 'cli-installed'); await mkdir(installRoot);
    await writeFile(join(installRoot, 'package.json'), JSON.stringify({ name: 'installed-cli-acceptance', version: '1.0.0', private: true }));
    await execute(resolvePnpmExecutable(), ['add', packed.tarballPath, '--ignore-scripts'], commandOptions(installRoot));
    const installedRoot = await realpath(join(installRoot, 'node_modules/@company/component-cli'));
    expect(installedRoot.startsWith(installRoot)).toBe(true);
    const installedPkg = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'));
    expect(installedPkg.dependencies['@company/contracts']).toBeUndefined();
    const bin = join(installedRoot, 'dist/bin.js');
    const registry = await realRegistry();
    for (const mode of ['all', 'vue', 'react'] as const) {
      const fixture = await project(directory, mode);
      const h = await platformHarness({ access: { apiOrigin: 'https://api.example.com', administrators: [{ issuer: 'https://issuer.t05.test', subject: 'admin' }], outbound: [{ hostname: '127.0.0.1', port: 443, networks: ['127.0.0.1/32'] }] } });
      try {
        const adminToken = await h.token('admin', ['reader']);
        expect((await h.request('/v1/categories', { id: 'general', name: '通用' }, adminToken)).status).toBe(201);
        await h.db.query("INSERT INTO components(id) VALUES ('badge')");
        await h.db.query("INSERT INTO component_permissions(subject,component_id,can_publish) VALUES ('alice','badge',true)");
        await h.db.query("INSERT INTO package_permissions(subject,package_name) VALUES ('alice',$1)", [fixture.name]);
        const auth = await h.token('alice', ['publisher'], 'cli');
        const env = { ...process.env, PLATFORM_TOKEN: auth, NODE_PATH: '', NODE_OPTIONS: '' };
        const cli = (args: string[]) => execute(process.execPath, [bin, ...args, '--api-url', h.origin()], commandOptions(fixture.root, env));
        if (mode === 'all') {
          await expect(cli(['prepare-release', '--framework', 'react', '--bundle-dir', 'partial'])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('PACKAGE_IMPLEMENTATIONS_INCOMPLETE') });
          await expect(readFile(join(fixture.root, 'partial/manifest.json'))).rejects.toThrow();
          await expect(readFile(join(fixture.root, 'partial/screenshots'))).rejects.toThrow();
          expect((await h.db.query('SELECT count(*) FROM upload_sessions')).rows[0]?.count).toBe('0');
          await rm(join(fixture.root, 'component/build-count'));
        }
        const doctor = await cli(['doctor', '--framework', mode]); expect(JSON.parse(doctor.stdout).ok).toBe(true);
        const prepared = await cli(['prepare-release', '--framework', mode]);
        const { bundleDir, manifest } = JSON.parse(prepared.stdout) as { bundleDir: string; manifest: ReleaseManifestV1 };
        expect(manifest.variants.map(variant => variant.framework)).toEqual(mode === 'all' ? ['vue', 'react'] : [mode]);
        const pkg = manifest.packages[0]!;
        for (const ref of manifest.files) expect(await sha256(await readFile(join(bundleDir, ref.path)))).toBe(ref.sha256);
        for (const variant of manifest.variants) {
          expect(variant.screenshots[0]?.packageSha256).toBe(pkg.tarball.sha256);
          const report = JSON.parse(await readFile(join(bundleDir, `reports/${variant.variantId}.json`), 'utf8'));
          expect(report.environment.echartsVersion).toBeUndefined(); expect(report.checks.every((check: { status: string }) => check.status === 'passed')).toBe(true);
        }
        const key = 'project-ready-' + randomUUID();
        // Deliberate client deadline after upload/create: the job persists without a running CLI.
        await expect(cli(['release', '--idempotency-key', key, '--timeout', '1'])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('RELEASE_TIMEOUT') });
        const original = await loadReleaseSession(bundleDir); expect(original?.jobId).toBeTruthy();
        expect(original?.idempotencyKey).toBe(key);
        const workerEnv = { ...process.env, PLATFORM_DATABASE_URL: h.db.pool.options.connectionString,
          PLATFORM_S3_ENDPOINT: h.store.config.endpoint, PLATFORM_S3_REGION: h.store.config.region, PLATFORM_S3_BUCKET: h.store.config.bucket,
          PLATFORM_S3_ACCESS_KEY: h.store.config.accessKeyId, PLATFORM_S3_SECRET_KEY: h.store.config.secretAccessKey,
          PLATFORM_REGISTRY_ORIGIN: localServices().registryOrigin, PLATFORM_REGISTRY_TOKEN: await registryToken(), PLATFORM_WORKER_JOB_ID: original!.jobId };
        const runner = resolve('apps/api/dist/releases/runner.js');
        if (mode === 'all') {
          await execute(process.execPath, [runner, '--once'], commandOptions(resolve('.'), { ...workerEnv, PLATFORM_REGISTRY_ORIGIN: 'http://127.0.0.1:1' }));
          expect((await h.db.query('SELECT state,stage FROM release_jobs')).rows[0]).toEqual({ state: 'RETRY_WAIT', stage: 'ENSURE_PACKAGES' });
          expect((await h.request(`/v1/releases/${original!.jobId}/retry`, {}, auth)).status).toBe(202);
        }
        await execute(process.execPath, [runner, '--once'], commandOptions(resolve('.'), workerEnv));
        const ready = await cli(['release', '--idempotency-key', 'ignored-new-key']); expect(JSON.parse(ready.stdout).state).toBe('READY');
        const job = (await h.db.query('SELECT id,state,attempt,manifest_digest FROM release_jobs')).rows[0]!;
        expect(job.state).toBe('READY'); expect(job.attempt).toBe(mode === 'all' ? 2 : 1);
        expect(job.manifest_digest).toBe(await manifestDigest(manifest));
        expect((await h.db.query("SELECT metadata->>'category' AS category,availability FROM variant_releases ORDER BY variant_id")).rows).toEqual(manifest.variants.map(() => ({ category: 'general', availability: 'Ready' })));
        await registry.verifyPackage(pkg);
        // Category changes do not rewrite the frozen successful job on replay.
        expect((await h.request('/v1/categories/general/update', { name: '历史通用', enabled: false, expectedRevision: '0' }, adminToken)).status).toBe(200);
        await h.restart();
        const resumed = await cli(['release']); expect(JSON.parse(resumed.stdout).jobId).toBe(original!.jobId);
        const replay = await h.request('/v1/releases', { uploadSessionId: original!.uploadSessionId, manifest }, auth, 'POST', { 'Idempotency-Key': key });
        expect(replay.status).toBe(202); expect((await replay.json()).jobId).toBe(original!.jobId);
        expect((await loadReleaseSession(bundleDir))?.idempotencyKey).toBe(key);
        expect((await h.db.query('SELECT count(*) FROM upload_sessions')).rows[0]?.count).toBe('1');
        expect((await h.db.query('SELECT count(*) FROM release_jobs')).rows[0]?.count).toBe('1');
        expect(await readFile(join(fixture.root, 'component/build-count'), 'utf8')).toBe('build\n');
        expect(await sha256(await readFile(join(bundleDir, pkg.tarball.path)))).toBe(pkg.tarball.sha256);
        const consumer = join(fixture.root, 'registry-installed'); await mkdir(consumer);
        await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'ready-consumer', version: '1.0.0', private: true, dependencies: { [pkg.name]: pkg.version } }));
        const origin = new URL(localServices().registryOrigin);
        await writeFile(join(consumer, '.npmrc'), `@company:registry=${origin.origin}/\n//${origin.host}/:_authToken=${await registryToken('g2reader')}\nignore-scripts=true\n`);
        await execute(resolvePnpmExecutable(), ['install', '--ignore-scripts'], commandOptions(consumer));
        for (const variant of manifest.variants) expect(await readFile(join(consumer, 'node_modules', pkg.name, 'dist', variant.framework + '.mjs'))).toEqual(await readFile(join(fixture.root, 'component/dist', variant.framework + '.mjs')));
        evidence.push({ mode, package: pkg.name, version: pkg.version, tarballSha256: pkg.tarball.sha256, manifestDigest: job.manifest_digest, jobId: job.id, state: job.state, attempts: job.attempt, frameworks: manifest.variants.map(variant => variant.framework), screenshotDigests: manifest.variants.flatMap(variant => variant.screenshots.map(shot => shot.image.sha256)), reportDigests: manifest.reports.map(ref => ref.sha256), buildCount: 1, uploadSessions: 1, releaseJobs: 1, retryKeyUnchanged: true, apiRestartPersisted: true, registryDigestVerified: true, registryConsumerInstalled: true });
      } finally { await h.close(); }
    }
    const result = { event: 'PROJECT_CLI_REAL_READY', cliVersion: installedPkg.version, cliTarballSha256: packed.sha256, services: ['Nest HTTP', 'PostgreSQL', 'MinIO', 'Verdaccio'], cases: evidence, productionOidcTlsAcceptance: false, businessPilotAcceptance: false };
    await mkdir(resolve('test-results/project-ready'), { recursive: true });
    await writeFile(resolve('test-results/project-ready/evidence.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 300_000);
