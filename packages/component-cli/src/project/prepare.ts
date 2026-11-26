import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createServer } from 'node:http';
import { freezePackageRelease, verifyFrozenTarball, type FrozenArtifact } from '../local/freeze.js';
import { computeSourceDigest, createArtifactRef } from '../local/digest.js';
import { captureExample } from '../local/capture.js';
import { buildCheckReport } from '../local/report.js';
import { validateReleaseBundle } from '../contracts/bundle.js';
import type { ArtifactRef, ReleaseManifestV1 } from '../contracts/release-manifest.js';
import { inside, projectPath, readVariantApi, type LoadedProject, type ProjectVariant } from './config.js';
import { installProjectConsumer } from './consumer.js';
import { buildProjectConsumer } from './vite-consumer.js';
import { runLocal } from './process.js';
import { inputFingerprint } from '../workbench/state.js';
import { readPlayground, validateExample } from '../workbench/examples.js';

export async function loadProjectBundle(bundleDir: string) {
  const root = await fs.realpath(bundleDir);
  const input: unknown = JSON.parse(await fs.readFile(await projectPath(root, 'manifest.json'), 'utf8'));
  const filesMap = new Map<string, Uint8Array>();
  // Shape is validated before any untrusted inventory path is read.
  const { validateSchema } = await import('../contracts/schema.js');
  const { manifestSchema } = await import('../contracts/schemas.js');
  const shape = validateSchema<ReleaseManifestV1>(manifestSchema, input);
  if (!shape.ok) throw new Error('BUNDLE_INVALID: ' + JSON.stringify(shape.issues));
  for (const ref of shape.value.files) filesMap.set(ref.path, await fs.readFile(await projectPath(root, ref.path)));
  const checked = await validateReleaseBundle(input, filesMap);
  if (!checked.ok) throw new Error('BUNDLE_INVALID: ' + JSON.stringify(checked.issues));
  for (const variant of checked.value.variants) {
    const { validateComponentApi } = await import('../contracts/component-api.js');
    const api = validateComponentApi(JSON.parse(Buffer.from(filesMap.get(variant.api.path)!).toString('utf8')));
    if (!api.ok || ['componentId', 'framework', 'exportName', 'exportPath'].some(key => api.value[key as keyof typeof api.value] !== variant[key as keyof typeof variant])) throw new Error('API_IDENTITY_MISMATCH: frozen bundle');
  }
  return { manifest: checked.value, filesMap, bundleDir: root };
}
async function verify(frozen: FrozenArtifact) {
  const checked = await verifyFrozenTarball(frozen);
  if (!checked.ok) throw new Error('TARBALL_MUTATION_DETECTED: ' + checked.message);
}
async function previewFiles(root: string, target: string) {
  const files: string[] = [];
  async function walk(directory: string) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('PREVIEW_SYMLINK');
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        const relative = path.relative(root, absolute);
        if (!inside(root, await fs.realpath(absolute))) throw new Error('PREVIEW_PATH_INVALID');
        await fs.mkdir(path.dirname(path.join(target, relative)), { recursive: true });
        await fs.copyFile(absolute, path.join(target, relative)); files.push(relative);
      }
    }
  }
  await walk(root); return files;
}
async function staticPreview(root: string) {
  const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
  const server = createServer(async (request, response) => {
    try {
      const relative = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname).slice(1) || 'index.html';
      const absolute = await projectPath(root, relative);
      const bytes = await fs.readFile(absolute);
      response.writeHead(200, { 'content-type': mime[path.extname(absolute)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff' }).end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: 'http://127.0.0.1:' + (server.address() as { port: number }).port, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
/** Build once, pack once, and only consume the frozen bytes after that point. */
export async function prepareProject(project: LoadedProject, variants: ProjectVariant[], bundleDir: string, version: string, log: (message: string) => void, timeoutMs: number) {
  for (const variant of variants) { await readVariantApi(project,variant); if(variant.playground) await validateExample(project,variant,(await readPlayground(project,variant)).value); }
  try { await fs.access(bundleDir); throw new Error('BUNDLE_EXISTS: 请恢复原材料或选择新的 --bundle-dir'); } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
  await fs.mkdir(bundleDir, { recursive: true });
  log('本地构建组件包'); await runLocal(project.config.build, project.packageDir, log, timeoutMs);
  const inputDigest=await inputFingerprint(project);
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'component-project-frozen-'));
  const consumers: string[] = [];
  try {
    log('pnpm pack 冻结候选 tarball');
    const packed = await freezePackageRelease({ packageDir: project.packageDir, stagingDir: staging });
    const tarballRelative = 'packages/' + packed.tarballName;
    await fs.mkdir(path.join(bundleDir, 'packages'));
    await fs.copyFile(packed.tarballPath, path.join(bundleDir, tarballRelative));
    const frozen = { ...packed, tarballPath: path.join(bundleDir, tarballRelative) };
    await verify(frozen);
    const artifacts: ArtifactRef[] = [await createArtifactRef(frozen.tarballPath, tarballRelative)];
    const manifest: ReleaseManifestV1 = { schemaVersion: 1, channel: 'cli', packages: [{ name: frozen.packageName, version: frozen.version, tarball: artifacts[0]!, sourceDigest: frozen.sourceDigest, dependencies: project.pkg.dependencies ?? {}, peerDependencies: project.pkg.peerDependencies ?? {} }], variants: [], files: artifacts, reports: [] };
    for (const variant of variants) {
      const variantId = variant.componentId + '-' + variant.framework; const exampleId = 'example-' + variantId;
      const consumer = await fs.mkdtemp(path.join(os.tmpdir(), 'component-project-consumer-')); consumers.push(consumer);
      if (inside(project.root, consumer) || inside(process.cwd(), consumer)) throw new Error('CONSUMER_INSIDE_WORKSPACE');
      const installed = await installProjectConsumer(project, variant, frozen, consumer, log, timeoutMs, variants); await verify(frozen);
      log('实际安装解析: ' + JSON.stringify({ variantId, packageSha256: frozen.sha256, ...installed }));
      const provenance = await buildProjectConsumer(consumer, variant, installed.installedEntry, frozen.packageName + variant.exportPath.slice(1), log, timeoutMs);
      const built = await projectPath(consumer, variant.consumer.previewDir);
      if (variant.playground) {
        await fs.copyFile(path.join(consumer, 'playground.json'), path.join(built, 'playground.json'));
      }
      const previewRelative = 'preview/' + variantId;
      const previewRoot = path.join(bundleDir, previewRelative);
      const copied = await previewFiles(built, previewRoot);
      const previewEntry = previewRelative + '/' + variant.consumer.previewEntry.replace(/\\/g, '/');
      await projectPath(previewRoot, variant.consumer.previewEntry);
      const previewArtifacts = await Promise.all(copied.map(relative => createArtifactRef(path.join(previewRoot, relative), previewRelative + '/' + relative.replace(/\\/g, '/'))));
      const server = await staticPreview(previewRoot);
      let capture;
      try {
        capture = await captureExample({ url: server.origin + '/' + variant.consumer.previewEntry.replace(/\\/g, '/'), states: variant.readiness.states, outputDir: path.join(bundleDir, 'screenshots'), baseDir: bundleDir, framework: variant.framework, frameworkVersion: installed.frameworkVersion, echartsVersion: installed.echartsVersion, variantId, exampleId, packageSha256: frozen.sha256, packageVersion: frozen.version, timeoutMs, viewport: { width: variant.readiness.width, height: variant.readiness.height }, readySelector: variant.readiness.selector, implementationBinding: provenance.binding, renderer: variant.readiness.renderer, theme: variant.readiness.theme });
      } finally { await server.close(); }
      await verify(frozen);
      const reportId = 'report-' + variantId; const screenshots = capture.screenshots.map(s => ({ ...s, id: s.id + '-' + variantId, reportId }));
      const report = buildCheckReport({ id: reportId, toolVersion: version, variantId, exampleId, packageSha256: frozen.sha256, environment: capture.environment, environmentKey: capture.environmentKey, checks: [{ name: 'frozen-package-import', status: 'passed' }, { name: 'consumer-build', status: 'passed' }, { name: 'frozen-export-render', status: 'passed' }, ...capture.checks], screenshots });
      for (const dir of ['api', 'docs', 'reports']) await fs.mkdir(path.join(bundleDir, dir), { recursive: true });
      const apiRelative = 'api/' + variantId + '.json'; const docsRelative = 'docs/' + variantId + '.md'; const reportRelative = 'reports/' + variantId + '.json';
      await fs.writeFile(path.join(bundleDir, apiRelative), JSON.stringify(await readVariantApi(project, variant), null, 2) + '\n');
      await fs.copyFile(await projectPath(project.root, variant.docs), path.join(bundleDir, docsRelative));
      await fs.writeFile(path.join(bundleDir, reportRelative), JSON.stringify(report, null, 2) + '\n');
      const api = await createArtifactRef(path.join(bundleDir, apiRelative), apiRelative); const docs = await createArtifactRef(path.join(bundleDir, docsRelative), docsRelative); const reportRef = await createArtifactRef(path.join(bundleDir, reportRelative), reportRelative);
      artifacts.push(api, docs, reportRef, ...previewArtifacts, ...screenshots.map(s => s.image)); manifest.reports.push(reportRef);
      manifest.variants.push({ componentId: variant.componentId, variantId, framework: variant.framework, category: variant.category, packageName: frozen.packageName, packageVersion: frozen.version, exportPath: variant.exportPath, exportName: variant.exportName, api, docs, examples: [{ id: exampleId, previewEntry, previewFiles: previewArtifacts, fixtureDigest: await computeSourceDigest(consumer, { ignore: ['.verify-export.mjs', '.installed-export.json'] }), renderer: variant.readiness.renderer, theme: variant.readiness.theme, width: variant.readiness.width, height: variant.readiness.height, requiredStates: variant.readiness.states }], screenshots, compatibility: [] });
      log('静态预览与截图完成: ' + variantId);
    }
    await verify(frozen);
    manifest.files.sort((a, b) => a.path.localeCompare(b.path));
    if(await inputFingerprint(project)!==inputDigest)throw new Error('INPUTS_CHANGED_DURING_PREPARE: 输入在验证时发生变化，请重新准备候选材料');
    await fs.writeFile(path.join(bundleDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    return {...await loadProjectBundle(bundleDir),inputDigest};
  } finally {
    for (const directory of [...consumers, staging]) {
      if (!inside(await fs.realpath(os.tmpdir()), directory) || !/^component-project-(consumer|frozen)-/.test(path.basename(directory))) throw new Error('REFUSING_UNOWNED_CLEANUP');
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
}
