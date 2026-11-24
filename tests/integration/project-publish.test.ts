import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../packages/component-cli/src/cli.js';
import { validateReleaseBundle } from '../../packages/component-cli/src/contracts/bundle.js';
import { computeFileSha256 } from '../../packages/component-cli/src/local/digest.js';
import { executeReleaseCommand, loadReleaseSession } from '../../packages/component-cli/src/local/release.js';
import { makeFixture } from '../fixtures/releases/g1/factory.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { packPackage, resolvePnpmExecutable } from '../../packages/component-cli/src/local/pack.js';
const execute = promisify(execFile);

const roots: string[] = []; const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-publish-real-')); roots.push(root);
  await fs.cp(path.resolve('tests/consumers/project'), root, { recursive: true });
  await fs.mkdir(path.join(root, 'api')); await fs.mkdir(path.join(root, 'docs'));
  const variants = ['vue', 'react'].map(framework => ({ componentId: 'badge', framework, category: 'general', exportName: framework === 'vue' ? 'BadgeVue' : 'BadgeReact', exportPath: './' + framework, api: `api/${framework}.json`, docs: `docs/${framework}.md`, consumer: { templateDir: `consumers/${framework}`, adapter: 'vite', previewDir: 'dist', previewEntry: 'index.html' }, readiness: { selector: '#app', states: ['default'], width: 800, height: 400, renderer: 'canvas', theme: 'light' } }));
  for (const v of variants) {
    await fs.writeFile(path.join(root, v.api), JSON.stringify({ schemaVersion: 1, componentId: v.componentId, framework: v.framework, exportName: v.exportName, exportPath: v.exportPath, props: [], events: [], notes: ['Developer maintained generic component'] }));
    await fs.writeFile(path.join(root, v.docs), '# Developer maintained badge\n');
  }
  const config = { schemaVersion: 1, packageDir: 'component', build: { program: process.execPath, args: ['build.mjs'] }, dev: {}, variants };
  await fs.writeFile(path.join(root, 'component.config.json'), JSON.stringify(config));
  const uploaded = new Map<string, Buffer>(); let origin = ''; let categoriesEnabled = true; let uploadCreates = 0; let rejectUpload = false;
  const releaseKeys: string[] = [];
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/auth/oidc/session') res.end(JSON.stringify({ authenticated: true, subject: 'developer', roles: ['publisher'] }));
    else if (req.url === '/v1/publishing/options') res.end(JSON.stringify({ categories: categoriesEnabled ? [{ id: 'general', name: '通用', revision: '0', enabled: true }] : [], components: [{ componentId: 'badge', category: 'general' }], packages: ['@fixture/project-badge'] }));
    else if (req.url === '/v1/uploads') {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()); uploadCreates++;
      if (rejectUpload) { res.writeHead(400).end('{}'); return; }
      res.end(JSON.stringify({ uploadSessionId: 'project-upload', files: body.files.map((file: { path: string }) => ({ path: file.path, uploadUrl: origin + '/objects/' + encodeURIComponent(file.path), expiresAt: new Date(Date.now() + 60_000).toISOString() })) }));
    } else if (req.method === 'PUT') {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); uploaded.set(decodeURIComponent(req.url!.slice('/objects/'.length)), Buffer.concat(chunks)); res.end();
    } else if (req.url === '/v1/uploads/project-upload/complete') {
      const files = [...uploaded].map(([file, bytes]) => ({ path: file, sha256: '', bytes: bytes.length }));
      const { computeBufferSha256 } = await import('../../packages/component-cli/src/local/digest.js');
      for (const file of files) file.sha256 = computeBufferSha256(uploaded.get(file.path)!);
      res.end(JSON.stringify({ status: 'complete', verifiedFiles: files }));
    } else if (req.url === '/v1/releases') {
      for await (const _chunk of req) { /* consume the real request body */ }
      releaseKeys.push(String(req.headers['idempotency-key']));
      res.end(JSON.stringify({ jobId: 'project-job', state: 'VALIDATING' }));
    }
    else res.end(JSON.stringify({ state: 'READY', stage: 'READY', attempt: 0, missingArtifacts: [], pollAfterMs: 1 }));
  }); servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  return { root, config, origin, uploaded, releaseKeys, uploadCreates: () => uploadCreates, rejectUploads: (reject: boolean) => { rejectUpload = reject; }, disableCategory: () => { categoriesEnabled = false; } };
}
describe('project frozen consumer publication', () => {
  it.each(['--idempotency-key', '--key'])('honors %s on the first release of prepared materials and keeps the original session key on resume', async flag => {
    const { root, origin, rejectUploads, releaseKeys } = await fixture();
    const prepared = await runCli(['release', '--prepare-only', '--framework', 'vue', '--api-url', origin, '--token', 'test-token'], '0.0.27', { cwd: root });
    expect(prepared.exitCode, prepared.stderr).toBe(0);
    const { bundleDir } = JSON.parse(prepared.stdout);
    rejectUploads(true);
    const first = await runCli(['release', flag, 'review-explicit-key', '--api-url', origin, '--token', 'test-token'], '0.0.27', { cwd: root });
    expect(first.exitCode).toBe(1);
    expect((await loadReleaseSession(bundleDir))?.idempotencyKey).toBe('review-explicit-key');
    rejectUploads(false);
    const resumed = await runCli(['release', flag, 'different-resume-key', '--api-url', origin, '--token', 'test-token'], '0.0.27', { cwd: root });
    expect(resumed.exitCode, resumed.stderr).toBe(0);
    expect(releaseKeys).toEqual(['review-explicit-key']);
    expect((await loadReleaseSession(bundleDir))?.idempotencyKey).toBe('review-explicit-key');
    expect(await fs.readFile(path.join(root, 'component/build-count'), 'utf8')).toBe('build\n');
  }, 180_000);
  it('rejects a React preview declared as Vue even when the configured Vue API and export exist', async () => {
    const { root, origin } = await fixture();
    await fs.copyFile(path.join(root, 'consumers/react/main.js'), path.join(root, 'consumers/vue/main.js'));
    const result = await runCli(['prepare-release', '--framework', 'vue', '--bundle-dir', 'rejected-bundle', '--api-url', origin, '--token', 'test-token'], '0.0.27', { cwd: root });
    expect(result.exitCode, result.stderr).toBe(1);
    expect(result.stderr).toContain('PREVIEW_IMPLEMENTATION_UNUSED');
    await expect(fs.stat(path.join(root, 'rejected-bundle/manifest.json'))).rejects.toThrow();
    await expect(fs.stat(path.join(root, 'rejected-bundle/reports/badge-vue.json'))).rejects.toThrow();
  }, 180_000);
  it('rejects the actual quoted Vite alias resolving a frozen export to a consumer-external substitute', async () => {
    const { root, origin } = await fixture();
    const substitute = path.join(root, 'substitute.mjs').replace(/\\/g, '/');
    await fs.writeFile(substitute, "export const BadgeVue = { render() { return 'Vue frozen badge'; } };\n");
    await fs.writeFile(path.join(root, 'consumers/vue/vite.config.js'), `export default { resolve: { "alias": { "@fixture/project-badge/vue": ${JSON.stringify(substitute)} } } };\n`);
    const result = await runCli(['prepare-release', '--framework', 'vue', '--bundle-dir', 'rejected-bundle', '--api-url', origin, '--token', 'test-token'], '0.0.27', { cwd: root });
    expect(result.exitCode, result.stderr).toBe(1);
    expect(result.stderr).toContain('CONSUMER_SOURCE_LINK');
    await expect(fs.stat(path.join(root, 'rejected-bundle/manifest.json'))).rejects.toThrow();
    await expect(fs.stat(path.join(root, 'rejected-bundle/reports/badge-vue.json'))).rejects.toThrow();
  }, 180_000);
  it('rejects importing the selected export without rendering it even when developer readiness checks claim success', async () => {
    const { root, origin } = await fixture();
    await fs.writeFile(path.join(root, 'consumers/vue/main.js'), `import { BadgeVue } from '@fixture/project-badge/vue';\nconsole.log(BadgeVue); document.querySelector('#app').textContent = 'unrelated preview';\nwindow.__COMPONENT_EXAMPLE__ = { ready: Promise.resolve(), states: ['default'], async runState() {}, getChecks() { return [{ name: 'developer-render', status: 'passed' }]; } };\n`);
    const result = await runCli(['prepare-release', '--framework', 'vue', '--bundle-dir', 'rejected-bundle', '--api-url', origin, '--token', 'test-token'], '0.0.27', { cwd: root });
    expect(result.exitCode, result.stderr).toBe(1); expect(result.stderr).toContain('PREVIEW_IMPLEMENTATION_UNUSED');
    await expect(fs.stat(path.join(root, 'rejected-bundle/reports/badge-vue.json'))).rejects.toThrow();
  }, 180_000);
  it('preserves Vue setup expose and React memo forwardRef handles, props and events during actual rendering', async () => {
    const { root, origin } = await fixture();
    await fs.writeFile(path.join(root, 'component/src/vue.mjs'), `import { h } from 'vue';\nexport const BadgeVue = { props: ['label'], emits: ['selected'], setup(props, { emit, expose }) { expose({ ready: Promise.resolve() }); return () => h('button', { onClick: () => emit('selected', props.label) }, props.label); } };\n`);
    await fs.writeFile(path.join(root, 'consumers/vue/main.js'), `import { createApp, h, ref, nextTick } from 'vue'; import { BadgeVue } from '@fixture/project-badge/vue';\nconst instance = ref(); let selected; createApp({ render: () => h(BadgeVue, { ref: instance, label: 'Vue props', onSelected: value => { selected = value; } }) }).mount('#app');\nconst ready = nextTick().then(() => instance.value.ready); window.__COMPONENT_EXAMPLE__ = { ready, states: ['default'], async runState() { await ready; document.querySelector('button').click(); await nextTick(); }, getChecks() { return [{ name: 'vue-props-event-ref-ready', status: selected === 'Vue props' && document.querySelector('button').textContent === 'Vue props' ? 'passed' : 'failed' }]; } };\n`);
    await fs.writeFile(path.join(root, 'component/src/react.mjs'), `import { createElement, memo, forwardRef, useImperativeHandle } from 'react';\nexport const BadgeReact = memo(forwardRef(function Badge({ label, onSelected }, ref) { useImperativeHandle(ref, () => ({ ready: Promise.resolve() }), []); return createElement('button', { onClick: () => onSelected(label) }, label); }));\n`);
    await fs.writeFile(path.join(root, 'consumers/react/main.js'), `import { createElement, createRef } from 'react'; import { createRoot } from 'react-dom/client'; import { BadgeReact } from '@fixture/project-badge/react';\nconst instance = createRef(); let selected; createRoot(document.querySelector('#app')).render(createElement(BadgeReact, { ref: instance, label: 'React props', onSelected: value => { selected = value; } }));\nconst ready = (async () => { while (!instance.current) await new Promise(requestAnimationFrame); await instance.current.ready; })(); window.__COMPONENT_EXAMPLE__ = { ready, states: ['default'], async runState() { await ready; document.querySelector('button').click(); }, getChecks() { return [{ name: 'react-props-event-ref-ready', status: selected === 'React props' && document.querySelector('button').textContent === 'React props' ? 'passed' : 'failed' }]; } };\n`);
    const result = await runCli(['prepare-release', '--framework', 'all', '--api-url', origin, '--token', 'test-token'], '0.0.27', { cwd: root });
    expect(result.exitCode, result.stderr).toBe(0);
    const material = JSON.parse(result.stdout);
    for (const variant of material.manifest.variants) {
      const report = JSON.parse(await fs.readFile(path.join(material.bundleDir, `reports/${variant.variantId}.json`), 'utf8'));
      expect(report.checks).toContainEqual({ name: 'frozen-export-render', status: 'passed' });
      expect(report.checks.every((check: { status: string }) => check.status === 'passed')).toBe(true);
    }
  }, 180_000);
  it('resumes the original upload plan after a real socket disconnect and sends every missing file before complete', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-publish-upload-')); roots.push(root);
    const fixture = makeFixture('cli');
    await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(fixture.manifest));
    for (const [relative, bytes] of fixture.files) { await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true }); await fs.writeFile(path.join(root, relative), bytes); }
    const uploaded = new Map<string, Buffer>(); let disconnected = false; let creates = 0; let complete = false; let origin = '';
    const server = createServer(async (req, res) => {
      if (req.method === 'PUT') {
        const relative = decodeURIComponent(req.url!.slice('/objects/'.length));
        if (!disconnected && uploaded.size === 1) { disconnected = true; req.socket.destroy(); return; }
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); uploaded.set(relative, Buffer.concat(chunks)); res.end(); return;
      }
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/uploads') { creates++; res.end(JSON.stringify({ uploadSessionId: 'original-upload', files: fixture.manifest.files.map(file => ({ path: file.path, uploadUrl: origin + '/objects/' + encodeURIComponent(file.path), expiresAt: new Date(Date.now() + 60_000).toISOString() })) })); }
      else if (req.url === '/v1/uploads/original-upload/complete') {
        complete = uploaded.size === fixture.files.size;
        if (!complete) { res.writeHead(400).end('{}'); return; }
        res.end(JSON.stringify({ status: 'complete', verifiedFiles: fixture.manifest.files }));
      } else if (req.url === '/v1/releases') {
        if (!complete) { res.writeHead(400).end('{}'); return; }
        res.end(JSON.stringify({ jobId: 'recovered-job', state: 'VALIDATING' }));
      } else res.end(JSON.stringify({ state: 'READY', stage: 'READY', attempt: 0, missingArtifacts: [], pollAfterMs: 1 }));
    }); servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    const options = { bundleDir: root, apiUrl: origin, token: 'test-token', timeoutMs: 3000, pollIntervalMs: 1 };
    await expect(executeReleaseCommand(options)).rejects.toThrow();
    const before = await loadReleaseSession(root); expect(before?.uploadSessionId).toBe('original-upload');
    const result = await executeReleaseCommand(options);
    expect(result.ok).toBe(true); expect(result.session.idempotencyKey).toBe(before?.idempotencyKey); expect(creates).toBe(1); expect(complete).toBe(true);
    for (const [relative, bytes] of fixture.files) expect(uploaded.get(relative)).toEqual(Buffer.from(bytes));
  });
  it('builds and packs once, installs that tarball outside the project and captures both static framework previews with honest reports', async () => {
    const { root, origin, uploaded, uploadCreates, disableCategory } = await fixture(); const progress: string[] = [];
    const result = await runCli(['prepare-release', '--framework', 'all', '--api-url', origin, '--token', 'test-token'], '0.0.27', { cwd: root, onProgress: message => progress.push(message) });
    expect(result.exitCode, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.manifest.variants).toHaveLength(2); expect(output.manifest.packages).toHaveLength(1);
    expect(await fs.readFile(path.join(root, 'component/build-count'), 'utf8')).toBe('build\n');
    const files = new Map<string, Uint8Array>();
    for (const file of output.manifest.files) files.set(file.path, await fs.readFile(path.join(output.bundleDir, file.path)));
    const checked = await validateReleaseBundle(output.manifest, files); expect(checked.ok, JSON.stringify(checked)).toBe(true);
    const pkg = output.manifest.packages[0];
    expect(await computeFileSha256(path.join(output.bundleDir, pkg.tarball.path))).toBe(pkg.tarball.sha256);
    for (const variant of output.manifest.variants) {
      expect(variant.category).toBe('general'); expect(variant.compatibility).toEqual([]);
      expect(variant.screenshots).toHaveLength(1); expect(variant.screenshots[0].framework).toBe(variant.framework);
      expect(variant.screenshots[0].packageSha256).toBe(pkg.tarball.sha256);
      const report = JSON.parse(Buffer.from(files.get(`reports/${variant.variantId}.json`)!).toString());
      expect(report.environment.echartsVersion).toBeUndefined();
      expect(report.environment.frameworkVersion).toBe(variant.framework === 'vue' ? '3.5.45' : '19.3.1');
      expect(report.environment.browserRevision).toMatch(/^@[a-f0-9]+$/i);
      expect(report.checks.every((check: { status: string }) => check.status === 'passed')).toBe(true);
      expect(Buffer.from(files.get(variant.examples[0].previewEntry)! ).toString()).toContain('assets/');
      expect(Buffer.from(files.get(variant.screenshots[0].image.path)!).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    }
    expect(progress.some(message => message.includes('--ignore-scripts'))).toBe(true);
    expect(progress.some(message => message.includes('tarball'))).toBe(true);
    disableCategory();
    const release = await runCli(['release', '--api-url', origin, '--token', 'test-token'], '0.0.27', { cwd: root });
    expect(release.exitCode, release.stderr).toBe(0); expect(JSON.parse(release.stdout).state).toBe('READY');
    const again = await runCli(['release', '--api-url', origin, '--token', 'test-token'], '0.0.27', { cwd: root });
    expect(again.exitCode, again.stderr).toBe(0); expect(JSON.parse(again.stdout).jobId).toBe('project-job');
    expect(uploadCreates()).toBe(1); expect(await fs.readFile(path.join(root, 'component/build-count'), 'utf8')).toBe('build\n');
    expect(uploaded.get(pkg.tarball.path)).toEqual(files.get(pkg.tarball.path));
    const configPath = path.join(root, 'component.config.json'); const originalConfig = await fs.readFile(configPath, 'utf8');
    const modifiedConfig = JSON.parse(originalConfig); modifiedConfig.variants[0].readiness.width = 900; await fs.writeFile(configPath, JSON.stringify(modifiedConfig));
    const changedConfig = await runCli(['release', '--api-url', origin, '--token', 'test-token'], '0.0.27', { cwd: root });
    expect(changedConfig.exitCode).toBe(1); expect(changedConfig.stderr).toContain('CONFIG_CHANGED');
    await fs.writeFile(configPath, originalConfig);
    await fs.appendFile(path.join(output.bundleDir, pkg.tarball.path), 'tamper');
    const tampered = await runCli(['release', '--api-url', origin, '--token', 'test-token'], '0.0.27', { cwd: root });
    expect(tampered.exitCode).toBe(1); expect(tampered.stderr).toContain('DIGEST_MISMATCH'); expect(uploadCreates()).toBe(1);
  }, 180_000);
  it('rejects workspace/source-link consumer dependencies before package build', async () => {
    const { root, origin } = await fixture();
    const consumerPath = path.join(root, 'consumers/vue/package.json');
    const pkg = JSON.parse(await fs.readFile(consumerPath, 'utf8')); pkg.dependencies.vue = 'workspace:*'; await fs.writeFile(consumerPath, JSON.stringify(pkg));
    const result = await runCli(['prepare-release', '--project', root, '--framework', 'all', '--api-url', origin, '--token', 'test-token'], '0.0.27');
    expect(result.exitCode).toBe(1); expect(result.stderr).toContain('CONSUMER_SOURCE_LINK');
    await expect(fs.stat(path.join(root, 'component/build-count'))).rejects.toThrow();
  });
  it('runs a separately packed and installed CLI bin outside the workspace through doctor, preparation and release', async () => {
    const { root, origin, uploaded, uploadCreates } = await fixture();
    const cliRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-publish-cli-installed-')); roots.push(cliRoot);
    const packed = await packPackage({ packageDir: path.resolve('packages/component-cli'), outputDir: path.join(cliRoot, 'freeze') });
    const installRoot = path.join(cliRoot, 'installed'); await fs.mkdir(installRoot);
    await fs.writeFile(path.join(installRoot, 'package.json'), JSON.stringify({ name: 'independent-cli-install', version: '1.0.0', private: true, type: 'module', dependencies: { '@company/component-cli': 'file:' + packed.tarballPath.replace(/\\/g, '/') } }));
    await execute(resolvePnpmExecutable(), ['install', '--ignore-scripts'], { cwd: installRoot, timeout: 120_000, windowsHide: true, env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } });
    const installedRoot = await fs.realpath(path.join(installRoot, 'node_modules/@company/component-cli'));
    expect(path.relative(installRoot, installedRoot).startsWith('..')).toBe(false);
    const installedPkg = JSON.parse(await fs.readFile(path.join(installedRoot, 'package.json'), 'utf8'));
    expect(installedPkg.dependencies['@company/contracts']).toBeUndefined();
    const bin = path.join(installedRoot, 'dist/bin.js');
    const options = { cwd: root, timeout: 180_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } };
    const configPath = path.join(root, 'component.config.json'); const originalConfig = await fs.readFile(configPath, 'utf8'); await fs.rm(configPath);
    const initialized = await execute(process.execPath, [bin, 'init', '--package', 'component', '--component', 'badge', '--export', 'BadgeVue', '--framework', 'vue', '--category', 'general'], options);
    expect(JSON.parse(initialized.stdout).configPath).toBe(configPath);
    const starter = await fs.readFile(configPath, 'utf8');
    await expect(execute(process.execPath, [bin, 'init', '--package', 'component', '--component', 'badge', '--export', 'BadgeVue', '--framework', 'vue', '--category', 'general'], options)).rejects.toMatchObject({ code: 1 });
    expect(await fs.readFile(configPath, 'utf8')).toBe(starter);
    const configured = JSON.parse(originalConfig); configured.dev.react = { program: process.execPath, args: ['-e', "require('fs').writeFileSync('dev-count','dev')"] }; await fs.writeFile(configPath, JSON.stringify(configured));
    const developed = await execute(process.execPath, [bin, 'dev', '--framework', 'react'], options); expect(JSON.parse(developed.stdout).developed).toBe(true); expect(await fs.readFile(path.join(root, 'component/dev-count'), 'utf8')).toBe('dev');
    const doctor = await execute(process.execPath, [bin, 'doctor', '--framework', 'all', '--api-url', origin, '--token', 'test-token'], options);
    expect(JSON.parse(doctor.stdout).ok).toBe(true);
    const prepared = await execute(process.execPath, [bin, 'prepare-release', '--framework', 'all', '--api-url', origin, '--token', 'test-token'], options);
    const material = JSON.parse(prepared.stdout);
    expect(material.manifest.variants).toHaveLength(2); expect(prepared.stderr).toContain('--ignore-scripts'); expect(prepared.stderr).toContain('静态预览与截图完成');
    const release = await execute(process.execPath, [bin, 'release', '--api-url', origin, '--token', 'test-token'], options);
    expect(JSON.parse(release.stdout).state).toBe('READY'); expect(release.stderr).toContain('复用原上传计划');
    const resume = await execute(process.execPath, [bin, 'release', '--api-url', origin, '--token', 'test-token'], options);
    expect(JSON.parse(resume.stdout).jobId).toBe('project-job'); expect(uploadCreates()).toBe(1);
    expect(await fs.readFile(path.join(root, 'component/build-count'), 'utf8')).toBe('build\n');
    expect(await computeFileSha256(packed.tarballPath)).toBe(packed.sha256);
    const packageRef = material.manifest.packages[0];
    expect(await computeFileSha256(path.join(material.bundleDir, packageRef.tarball.path))).toBe(packageRef.tarball.sha256);
    expect(uploaded.get(packageRef.tarball.path)).toEqual(await fs.readFile(path.join(material.bundleDir, packageRef.tarball.path)));
    const evidence = { evidence: 'INDEPENDENT_CLI_REAL_INSTALL', cliVersion: installedPkg.version, cliTarballSha256: packed.sha256, cliTarballPath: packed.tarballPath, installedRoot, commands: ['init', 'dev', 'doctor', 'prepare-release', 'release', 'release (resume)'], componentTarballSha256: packageRef.tarball.sha256, frameworkVariants: material.manifest.variants.map((variant: { framework: string }) => variant.framework), buildCount: 1, uploadCreates: uploadCreates(), state: JSON.parse(release.stdout).state, retainedArtifacts: '' };
    if (process.env.PROJECT_CLI_EVIDENCE) {
      const retained = path.join(path.dirname(process.env.PROJECT_CLI_EVIDENCE), 'task-2-artifacts');
      await fs.mkdir(path.join(retained, 'cli'), { recursive: true }); await fs.copyFile(packed.tarballPath, path.join(retained, 'cli', packed.tarballName));
      for (const ref of material.manifest.files) { const target = path.join(retained, 'component-bundle', ref.path); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(path.join(material.bundleDir, ref.path), target); }
      await fs.writeFile(path.join(retained, 'component-bundle', 'manifest.json'), JSON.stringify(material.manifest, null, 2) + '\n');
      evidence.retainedArtifacts = retained;
      await fs.writeFile(process.env.PROJECT_CLI_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
    }
  }, 240_000);
  it('fails closed on an expired original upload URL and retains its session and frozen bytes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-publish-expired-')); roots.push(root);
    const fixture = makeFixture('cli');
    await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(fixture.manifest));
    for (const [relative, bytes] of fixture.files) { await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true }); await fs.writeFile(path.join(root, relative), bytes); }
    const { saveReleaseSession } = await import('../../packages/component-cli/src/local/release.js');
    const { manifestDigest } = await import('../../packages/component-cli/src/contracts/digests.js');
    let puts = 0;
    const server = createServer((_req, res) => { puts++; res.writeHead(403).end('expired'); }); servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    const uploadPlan = { uploadSessionId: 'expired-original', files: fixture.manifest.files.map(file => ({ path: file.path, uploadUrl: origin + '/objects/' + encodeURIComponent(file.path), expiresAt: '2026-11-23T00:00:00.000Z' })) };
    await saveReleaseSession(root, { manifestDigest: await manifestDigest(fixture.manifest), idempotencyKey: 'original-expired-key', uploadSessionId: 'expired-original', uploadPlan, uploadedFiles: [], uploadComplete: false, updatedAt: '' });
    await expect(executeReleaseCommand({ bundleDir: root, apiUrl: origin, token: 'test-token' })).rejects.toThrow('UPLOAD_PLAN_EXPIRED');
    expect(puts).toBe(0); expect((await loadReleaseSession(root))?.idempotencyKey).toBe('original-expired-key');
    for (const [relative, bytes] of fixture.files) expect(await fs.readFile(path.join(root, relative))).toEqual(Buffer.from(bytes));
  });
  it('rejects source aliases and missing named exports rather than capturing a substitute implementation', async () => {
    const { root, config, origin } = await fixture();
    await fs.writeFile(path.join(root, 'consumers/vue/vite.config.js'), "export default { resolve: { alias: { '@fixture/project-badge/vue': '../../../component/src/vue.mjs' } } };");
    const args = ['prepare-release', '--project', root, '--framework', 'vue', '--api-url', origin, '--token', 'test-token'];
    const linked = await runCli(args, '0.0.27'); expect(linked.exitCode).toBe(1); expect(linked.stderr).toContain('CONSUMER_SOURCE_LINK');
    await fs.rm(path.join(root, 'consumers/vue/vite.config.js'));
    config.variants[0]!.exportName = 'MissingVueExport';
    const apiPath = path.join(root, 'api/vue.json'); const api = JSON.parse(await fs.readFile(apiPath, 'utf8')); api.exportName = 'MissingVueExport'; await fs.writeFile(apiPath, JSON.stringify(api));
    await fs.writeFile(path.join(root, 'component.config.json'), JSON.stringify(config));
    const missing = await runCli(args, '0.0.27'); expect(missing.exitCode).toBe(1); expect(missing.stderr).toContain('EXPORT_MISSING');
  }, 180_000);
  it('prepares a new package version in a new bundle and preserves the previously frozen materials', async () => {
    const { root, origin } = await fixture();
    const args = ['prepare-release', '--framework', 'all', '--api-url', origin, '--token', 'test-token'];
    const first = await runCli(args, '0.0.27', { cwd: root }); expect(first.exitCode, first.stderr).toBe(0);
    const previous = JSON.parse(first.stdout); const previousPackage = previous.manifest.packages[0];
    const pkgPath = path.join(root, 'component/package.json'); const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8')); pkg.version = '0.1.1'; await fs.writeFile(pkgPath, JSON.stringify(pkg));
    const next = await runCli(['release', '--prepare-only', '--framework', 'all', '--api-url', origin, '--token', 'test-token'], '0.0.27', { cwd: root }); expect(next.exitCode, next.stderr).toBe(0);
    const nextMaterial = JSON.parse(next.stdout); expect(nextMaterial.bundleDir).not.toBe(previous.bundleDir); expect(nextMaterial.manifest.packages[0].version).toBe('0.1.1');
    expect(await computeFileSha256(path.join(previous.bundleDir, previousPackage.tarball.path))).toBe(previousPackage.tarball.sha256);
    expect(await fs.readFile(path.join(root, 'component/build-count'), 'utf8')).toBe('build\nbuild\n');
    const pointer = JSON.parse(await fs.readFile(path.join(root, '.component-release.json'), 'utf8')); expect(pointer.packageVersion).toBe('0.1.1');
  }, 180_000);
});
