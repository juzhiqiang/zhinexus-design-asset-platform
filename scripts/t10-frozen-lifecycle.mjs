import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import tar from 'tar-stream';
import { validateOwnedConsumers } from './t10-consumer-ownership.mjs';
import { readFrozenBundle } from '../tests/acceptance/t10-sdk/bundle.mjs';
import { readBrowserRevision } from '../tests/acceptance/t10-sdk/browser.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const equalPath = (a, b) => path.relative(path.resolve(a), path.resolve(b)) === '';
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
const chartTypes = ['line', 'bar', 'pie', 'scatter', 'trend-card', 'ranking', 'proportion'];
const twoSeries = { series: [
  { id: 'alpha', name: '甲', points: [{ x: 1, y: 10 }, { x: 2, y: 20 }] },
  { id: 'beta', name: '乙', points: [{ x: 1, y: 5 }, { x: 2, y: 15 }] },
] };

export function parseArguments(argv) {
  const names = ['root', 'evidence', 'owner', 'out'];
  const parsed = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i]?.replace(/^--/, '');
    assert(argv[i]?.startsWith('--') && names.includes(name), 'unknown option: ' + argv[i]);
    assert(!Object.hasOwn(parsed, name), 'duplicate option: --' + name);
    assert(argv[i + 1] && !argv[i + 1].startsWith('--'), 'value required: --' + name);
    parsed[name] = argv[i + 1];
  }
  for (const name of names) assert(parsed[name], '--' + name + ' required');
  return parsed;
}

async function plainPath(target) {
  const resolved = path.resolve(target);
  assert(equalPath(await realpath(resolved), resolved), 'redirected path: ' + resolved);
  let current = resolved;
  while (current !== path.dirname(current)) {
    assert(!(await lstat(current)).isSymbolicLink(), 'linked path: ' + current);
    current = path.dirname(current);
  }
  return resolved;
}

async function boundedFile(root, input, directories) {
  const file = path.resolve(input);
  assert(directories.some(directory => inside(path.join(root, directory), file)), 'unrecognized input location: ' + file);
  await plainPath(file);
  assert((await lstat(file)).isFile(), 'input is not a file: ' + file);
  return file;
}

export async function validateLifecycleInputs(options) {
  const root = await plainPath(options.root);
  const ownerInput = await plainPath(options.owner);
  const ownership = JSON.parse(await readFile(ownerInput, 'utf8'));
  const repoRoot = await plainPath(ownership.repoRoot);
  const owner = await boundedFile(repoRoot, ownerInput, ['.tools']);
  const markerFile = await plainPath(path.join(root, '.c-owned-t10-evidence.json'));
  const marker = JSON.parse(await readFile(markerFile, 'utf8'));
  assert.equal(marker.kind, 'c-owned-t10-evidence-v1');
  assert(equalPath(marker.repoRoot, repoRoot), 'evidence belongs to another repository');
  assert.equal(marker.ownerRunId, ownership.runId, 'evidence belongs to another consumer run');
  const evidence = await boundedFile(root, options.evidence, ['.']);
  const out = path.resolve(options.out);
  assert(inside(root, out), 'output must be a new directory below the owned evidence root');
  // Require a plain existing parent. Never create or adopt a user supplied tree.
  await plainPath(path.dirname(out));
  try {
    await lstat(out);
    assert.fail('output already exists');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const bytes = await readFile(evidence);
  const report = JSON.parse(bytes);
  assert.equal(report.kind, 'a-t10-sdk-probe');
  assert.equal(report.probe.packaged, true, 'requires an installed CLI probe');
  assert.equal(report.recommendation, 'hold', 'requires the original kept hold consumers');
  const owned = await validateOwnedConsumers(owner, report, repoRoot);
  for (const protectedRoot of [owned.owner.externalBase, report.bundle?.root].filter(Boolean)) {
    assert(!equalPath(out, protectedRoot) && !inside(protectedRoot, out), 'output overlaps a protected consumer or bundle');
  }
  return { root, repoRoot, evidence, owner, out, report, evidenceSha256: sha(bytes), owned };
}

async function snapshotSource(root) {
  const files = {};
  async function walk(directory) {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['node_modules', 'dist', '.git', '.turbo'].includes(item.name)) continue;
      const file = path.join(directory, item.name);
      assert(!item.isSymbolicLink(), 'linked consumer source: ' + file);
      if (item.isDirectory()) await walk(file);
      else if (item.isFile()) files[path.relative(root, file).replaceAll(path.sep, '/')] = sha(await readFile(file));
    }
  }
  await walk(root);
  return files;
}

export async function verifyInstalledTarball(directory, bytes) {
  const files = {};
  const extract = tar.extract();
  let total = 0;
  const done = new Promise((resolve, reject) => {
    extract.on('error', reject);
    extract.on('finish', resolve);
    extract.on('entry', (header, stream, next) => {
      if (header.type === 'directory') { stream.resume(); next(); return; }
      (async () => {
        assert.equal(header.type, 'file', 'frozen SDK must contain regular files');
        assert(header.name.startsWith('package/'), 'unexpected tarball prefix');
        const logical = header.name.slice('package/'.length);
        assert(logical && !logical.includes('\\') && !path.isAbsolute(logical) && !path.win32.isAbsolute(logical));
        assert(logical.split('/').every(part => part && part !== '.' && part !== '..'), 'unsafe tarball path');
        assert(!Object.hasOwn(files, logical), 'duplicate tarball path');
        total += header.size;
        assert(total <= 200 * 1024 ** 2, 'expanded SDK exceeds artifact limit');
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const expected = Buffer.concat(chunks);
        const installed = await plainPath(path.join(directory, logical));
        assert(inside(directory, installed));
        const actual = await readFile(installed);
        assert.deepEqual(actual, expected, 'installed SDK differs from frozen tarball: ' + logical);
        files[logical] = { bytes: actual.length, sha256: sha(actual) };
      })().then(next, error => extract.destroy(error));
    });
  });
  extract.end(gunzipSync(bytes, { maxOutputLength: 200 * 1024 ** 2 }));
  await done;
  assert(Object.keys(files).length > 0, 'empty SDK tarball');
  return files;
}

async function installedProof(consumer, frozen, combination) {
  const lock = JSON.parse(await readFile(path.join(consumer.root, 'package-lock.json'), 'utf8'));
  const records = [];
  for (const name of ['@company/charts-core', '@company/charts-' + consumer.framework, 'echarts', consumer.framework]) {
    const directory = path.join(consumer.root, 'node_modules', name);
    await plainPath(directory);
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    const locked = lock.packages['node_modules/' + name];
    assert(locked && !locked.link, 'not a real installed package: ' + name);
    assert.equal(locked.version, manifest.version);
    const pkg = frozen.packages.find(item => item.name === name);
    let frozenFiles;
    if (pkg) {
      assert.equal(manifest.version, pkg.version);
      const tarball = await readFile(pkg.tarballFile);
      assert.equal(locked.integrity, 'sha512-' + createHash('sha512').update(tarball).digest('base64'), 'lock not bound to frozen bytes: ' + name);
      const lockedPath = locked.resolved?.replace(/^file:/, '');
      assert(lockedPath && equalPath(path.resolve(consumer.root, lockedPath), pkg.tarballFile), 'lock not bound to frozen tarball: ' + name);
      frozenFiles = await verifyInstalledTarball(directory, tarball);
    } else assert.equal(manifest.version, name === 'echarts' ? combination.echartsVersion : combination.frameworkVersion);
    records.push({ name, version: manifest.version, directory, resolved: locked.resolved, integrity: locked.integrity, frozenFiles });
  }
  return records;
}

// Count native observer lifetimes without changing callbacks or geometry.
function observeLifetimes() {
  const Native = window.ResizeObserver;
  const active = new Set();
  const stats = { constructed: 0, disconnected: 0, callbacks: 0, active: 0 };
  window.__C_T10_OBSERVERS__ = stats;
  window.ResizeObserver = class extends Native {
    constructor(callback) {
      super((entries, observer) => { stats.callbacks++; callback(entries, observer); });
      stats.constructed++;
    }
    observe(...args) { super.observe(...args); active.add(this); stats.active = active.size; }
    disconnect() { super.disconnect(); active.delete(this); stats.disconnected++; stats.active = active.size; }
  };
}

async function startConsumer(consumer, cacheDir) {
  const require = createRequire(path.join(consumer.root, 'package.json'));
  const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
  const pluginName = consumer.framework === 'vue' ? '@vitejs/plugin-vue' : '@vitejs/plugin-react';
  const plugin = (await import(pathToFileURL(require.resolve(pluginName)).href)).default;
  // All generated Vite cache belongs to our exclusive output, never the consumer.
  const server = await createServer({
    configFile: false, root: consumer.root, cacheDir, envDir: cacheDir, mode: 'development',
    plugins: [plugin()], logLevel: 'warn',
    server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [consumer.staging, cacheDir] } },
  });
  await server.listen();
  assert.equal(server.config.isProduction, false, 'requires a real development server');
  const address = server.httpServer.address();
  assert(address && typeof address !== 'string');
  return { server, origin: 'http://127.0.0.1:' + address.port, pluginName };
}

async function runCase(browser, report, framework, name, url, action, out) {
  const record = { framework, name, url, status: 'failed', pageErrors: [], details: null, screenshot: null };
  report.runs.push(record);
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  try {
    await context.addInitScript(observeLifetimes);
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on('pageerror', error => record.pageErrors.push(error.message));
    await page.goto(url);
    record.details = await action(page);
    await page.evaluate(() => document.fonts.ready);
    assert.deepEqual(record.pageErrors, []);
    const file = path.join(out, framework + '-' + name + '.png');
    const bytes = await page.screenshot({ path: file });
    assert.deepEqual(record.pageErrors, []);
    record.screenshot = { file, bytes: bytes.length, sha256: sha(bytes) };
    record.status = 'passed';
  } catch (error) { record.error = String(error.stack ?? error); }
  finally { await context.close(); }
}

async function coreLifecycle(page, chart, out) {
  await page.waitForFunction(() => window.__CORE_HARNESS__ !== undefined);
  const data = ['ranking', 'proportion'].includes(chart) ? { series: [twoSeries.series[0]] } : twoSeries;
  await page.evaluate(({ chart, data }) => {
    const host = document.getElementById('host');
    host.style.width = '0px'; host.style.height = '0px';
    window.__CORE_HARNESS__.create(host, { chart, renderer: 'canvas', theme: 'light', animation: false });
    window.__CORE_HARNESS__.update(data);
  }, { chart, data });
  assert.equal(await page.evaluate(() => window.__CORE_HARNESS__.hasInstance()), false);
  assert.equal(await page.locator('#host canvas').count(), 0);
  await page.evaluate(() => { const host = document.getElementById('host'); host.style.width = '640px'; host.style.height = '320px'; });
  await page.waitForFunction(() => window.__CORE_HARNESS__.hasInstance());
  await page.evaluate(() => window.__CORE_HARNESS__.whenRendered());
  assert.deepEqual(await page.evaluate(() => window.__CORE_HARNESS__.seriesIds()), data.series.map(item => item.id));
  const before = await page.locator('#host canvas').getAttribute('width');
  await page.evaluate(() => { document.getElementById('host').style.width = '480px'; });
  await page.waitForFunction(previous => {
    const width = Number(document.querySelector('#host canvas')?.getAttribute('width'));
    return width > 0 && String(width) !== previous;
  }, before);
  const resized = await page.locator('#host canvas').getAttribute('width');
  await page.evaluate(data => window.__CORE_HARNESS__.update(data), { series: [twoSeries.series[0]] });
  await page.evaluate(() => window.__CORE_HARNESS__.whenRendered());
  assert.deepEqual(await page.evaluate(() => window.__CORE_HARNESS__.seriesIds()), ['alpha']);
  for (const [theme, renderer] of [['dark', 'svg'], ['light', 'canvas']]) {
    await page.evaluate(({ theme, renderer }) => window.__CORE_HARNESS__.setPresentation(theme, renderer), { theme, renderer });
    await page.evaluate(() => window.__CORE_HARNESS__.whenRendered());
    assert.equal(await page.locator('#host ' + renderer).count(), 1);
    assert.equal(await page.locator('#host ' + (renderer === 'canvas' ? 'svg' : 'canvas')).count(), 0);
    assert.deepEqual(await page.evaluate(() => window.__CORE_HARNESS__.seriesIds()), ['alpha']);
  }
  const observers = await page.evaluate(() => ({ ...window.__C_T10_OBSERVERS__ }));
  assert(observers.callbacks > 0 && observers.active === 1, 'ResizeObserver did not observe the actual resize');
  const renderedFile = path.join(out, 'vue-core-' + chart + '-rendered.png');
  const renderedBytes = await page.screenshot({ path: renderedFile });
  await page.evaluate(() => { window.__CORE_HARNESS__.dispose(); window.__CORE_HARNESS__.dispose(); });
  assert.equal(await page.evaluate(() => window.__CORE_HARNESS__.hasInstance()), false);
  assert.equal(await page.locator('#host canvas, #host svg').count(), 0);
  assert.equal(await page.evaluate(() => window.__C_T10_OBSERVERS__.active), 0);
  await page.evaluate(data => window.__CORE_HARNESS__.update(data), twoSeries);
  assert.equal(await page.evaluate(() => window.__CORE_HARNESS__.hasInstance()), false);
  return { chart, zeroSizeDeferred: true, seriesBefore: data.series.map(item => item.id), seriesAfter: ['alpha'], canvasWidths: { before, resized }, observers,
    renderedScreenshot: { file: renderedFile, bytes: renderedBytes.length, sha256: sha(renderedBytes) }, disposed: true };
}

async function openExample(page) {
  await page.waitForFunction(() => window.__COMPONENT_EXAMPLE__ !== undefined);
  await page.evaluate(() => window.__COMPONENT_EXAMPLE__.ready);
  const checks = await page.evaluate(() => window.__COMPONENT_EXAMPLE__.getChecks());
  assert(checks.length > 0 && checks.every(item => item.status === 'passed'), JSON.stringify(checks));
  return checks;
}

async function frameworkLifecycle(page, framework) {
  const checks = await openExample(page);
  assert.equal(await page.locator('.charts-line canvas').count(), 1);
  const observers = await page.evaluate(() => ({ ...window.__C_T10_OBSERVERS__ }));
  if (framework === 'react') {
    assert(observers.constructed >= 2 && observers.disconnected >= 1 && observers.active === 1, 'StrictMode development effects did not mount/clean/remount');
    assert.equal(await page.locator('script[src="/@vite/client"]').count(), 1, 'not a Vite development host');
  }
  await page.evaluate(() => window.__COMPONENT_EXAMPLE__.runState('single'));
  await page.waitForFunction(() => window.__LINE_LIFECYCLE_CONTROLS__.getOption()?.series?.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__LINE_LIFECYCLE_CONTROLS__.getOption().series.map(item => item.id)), ['revenue']);
  await page.evaluate(() => {
    window.__LINE_LIFECYCLE_CONTROLS__.setOptionOverrides({ grid: { left: 96 } });
    window.__LINE_LIFECYCLE_CONTROLS__.setConfig({ theme: 'dark', renderer: 'svg', smooth: true, animation: false });
  });
  await page.waitForFunction(() => document.querySelectorAll('.charts-line svg').length === 1 && window.__LINE_LIFECYCLE_CONTROLS__.getOption()?.series?.[0]?.smooth === true);
  assert.equal(await page.locator('.charts-line canvas').count(), 0);
  assert.equal(await page.evaluate(() => window.__LINE_LIFECYCLE_CONTROLS__.getOption().grid[0].left), 96);
  await page.evaluate(() => window.__LINE_LIFECYCLE_CONTROLS__.setConfig({ animation: false }));
  await page.waitForFunction(() => document.querySelectorAll('.charts-line canvas').length === 1);
  assert.equal(await page.evaluate(() => window.__LINE_LIFECYCLE_CONTROLS__.getOption().grid[0].left), 96);
  return { checks, seriesAfter: ['revenue'], configAppliedDuringRebuild: true, overridesAfterDefaults: 96, observers, strictModeDevelopment: framework === 'react' };
}

async function keepAliveLifecycle(page) {
  await openExample(page);
  const before = await page.locator('canvas').getAttribute('width');
  await page.evaluate(() => { window.__C_T10_FRAME__ = document.querySelector('.chart-frame'); });
  await page.getByRole('button', { name: '占位视图' }).click();
  await page.getByTestId('keepalive-placeholder').waitFor({ state: 'visible' });
  await page.evaluate(() => { window.__C_T10_FRAME__.style.width = '480px'; });
  await page.getByRole('button', { name: '折线图' }).click();
  await page.waitForFunction(previous => {
    const canvas = document.querySelector('.charts-line canvas');
    return canvas && Number(canvas.getAttribute('width')) > 0 && canvas.getAttribute('width') !== previous;
  }, before);
  assert.equal(await page.locator('canvas').count(), 1);
  const checks = await page.evaluate(() => window.__COMPONENT_EXAMPLE__.getChecks());
  assert(checks.every(item => item.status === 'passed'), JSON.stringify(checks));
  return { before, reactivated: await page.locator('canvas').getAttribute('width'), checks };
}

async function strictRemount(page) {
  await openExample(page);
  await page.evaluate(() => {
    window.__C_T10_OLD_INSTANCE__ = window.__A10_ECHARTS__.getInstanceByDom(document.querySelector('.charts-line'));
    delete window.__COMPONENT_EXAMPLE__;
    window.__EXAMPLE_REMOUNT__();
  });
  await page.waitForFunction(() => window.__COMPONENT_EXAMPLE__ !== undefined && document.querySelectorAll('.charts-line canvas').length === 1);
  await page.evaluate(() => window.__COMPONENT_EXAMPLE__.ready);
  assert.equal(await page.evaluate(() => window.__C_T10_OLD_INSTANCE__.isDisposed()), true);
  const observers = await page.evaluate(() => ({ ...window.__C_T10_OBSERVERS__ }));
  assert(observers.constructed >= 4 && observers.disconnected >= 3 && observers.active === 1);
  const position = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__.pointClientPosition(0, 0));
  assert(position);
  await page.mouse.click(position.x, position.y);
  const clicks = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__.getClicks());
  assert.equal(clicks.length, 1, 'duplicate old listeners survived remount');
  return { oldInstanceDisposed: true, observers, clicks };
}

export async function main(argv) {
  const input = await validateLifecycleInputs(parseArguments(argv));
  assert.equal(process.platform, 'win32', 'this evidence runner requires the fixed Windows host');
  assert.equal(process.version, 'v26.13.0');
  assert(equalPath(await realpath(process.execPath), await realpath(path.join(input.repoRoot, '.tools/node-v26.13.0-win-x64/node.exe'))), 'requires repository fixed Node');
  const frozen = await readFrozenBundle(input.report.bundle.root);
  assert.equal(frozen.version, input.report.bundle.version);
  assert.deepEqual(frozen.packages.map(({ name, version, sha256, bytes }) => ({ name, version, sha256, bytes })),
    input.report.bundle.packages.map(({ name, version, sha256, bytes }) => ({ name, version, sha256, bytes })));
  const proofs = [];
  for (const consumer of input.owned.consumers) {
    const combination = input.report.combinations.find(item => item.framework === consumer.framework);
    proofs.push({ framework: consumer.framework, root: consumer.root, before: await snapshotSource(consumer.root),
      installed: await installedProof(consumer, frozen, combination) });
  }
  await mkdir(input.out); // Exclusive creation; existing output is never adopted.
  const report = { kind: 'c-t10-frozen-sdk-lifecycle-v1', generatedAt: new Date().toISOString(), passed: false,
    sourceEvidence: input.evidence, sourceEvidenceSha256: input.evidenceSha256, owner: input.owner,
    node: process.version, nodeExecutable: process.execPath, browser: null,
    bundle: { root: frozen.root, manifestSha256: sha(await readFile(frozen.manifestPath)),
      packages: frozen.packages.map(({ name, version, sha256, bytes }) => ({ name, version, sha256, bytes })) },
    consumers: proofs, runs: [], errors: [] };
  let browser;
  const previousBrowsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(input.repoRoot, '.tools/playwright');
    process.env.NODE_ENV = 'development';
    const require = createRequire(path.join(input.repoRoot, 'package.json'));
    const { chromium } = await import(pathToFileURL(require.resolve('@playwright/test')).href);
    const browserRevision = readBrowserRevision(pathToFileURL(path.join(input.repoRoot, 'package.json')).href);
    assert.equal(browserRevision, input.report.probe.browserRevision);
    browser = await chromium.launch({ headless: true });
    assert.equal(browser.version(), input.report.probe.browserVersion);
    report.browser = { version: browser.version(), revision: browserRevision, executable: chromium.executablePath(), browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH };
    for (const consumer of input.owned.consumers) {
      let host;
      try {
        host = await startConsumer(consumer, path.join(input.out, consumer.framework + '-vite-cache'));
        proofs.find(item => item.framework === consumer.framework).host = { mode: 'development', plugin: host.pluginName, origin: host.origin };
        if (consumer.framework === 'vue') {
          for (const chart of chartTypes) await runCase(browser, report, 'vue', 'core-' + chart, host.origin + '/harness.html', page => coreLifecycle(page, chart, input.out), input.out);
          await runCase(browser, report, 'vue', 'keepalive', host.origin + '/keepalive.html', keepAliveLifecycle, input.out);
        }
        await runCase(browser, report, consumer.framework, 'config-series', host.origin + '/', page => frameworkLifecycle(page, consumer.framework), input.out);
        if (consumer.framework === 'react') await runCase(browser, report, 'react', 'strict-remount', host.origin + '/', strictRemount, input.out);
      } catch (error) { report.errors.push(consumer.framework + ': ' + (error.stack ?? error)); }
      finally { await host?.server.close(); }
    }
  } catch (error) { report.errors.push(String(error.stack ?? error)); }
  finally {
    await browser?.close().catch(error => report.errors.push('browser close: ' + error));
    if (previousBrowsers === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    else process.env.PLAYWRIGHT_BROWSERS_PATH = previousBrowsers;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    for (const proof of proofs) {
      try {
        proof.after = await snapshotSource(proof.root);
        proof.sourceUnchanged = JSON.stringify(proof.before) === JSON.stringify(proof.after);
        if (!proof.sourceUnchanged) report.errors.push(proof.framework + ': original consumer files changed');
        const consumer = input.owned.consumers.find(item => item.framework === proof.framework);
        const combination = input.report.combinations.find(item => item.framework === proof.framework);
        proof.installedAfter = await installedProof(consumer, frozen, combination);
        assert.deepEqual(proof.installedAfter, proof.installed);
      } catch (error) { report.errors.push(proof.framework + ': installed SDK integrity: ' + error); }
    }
    try {
      if (sha(await readFile(input.evidence)) !== input.evidenceSha256) report.errors.push('source evidence changed');
      await validateOwnedConsumers(input.owner, input.report, input.repoRoot);
    } catch (error) { report.errors.push('source evidence or ownership: ' + error); }
    const frozenAfter = await readFrozenBundle(frozen.root).catch(error => { report.errors.push('frozen bundle: ' + error); });
    if (frozenAfter && JSON.stringify(frozenAfter.packages) !== JSON.stringify(frozen.packages)) report.errors.push('frozen bundle changed');
    report.passed = report.errors.length === 0 && report.runs.length === 11 && report.runs.every(item => item.status === 'passed');
    await writeFile(path.join(input.out, 'lifecycle-evidence.json'), JSON.stringify(report, null, 2) + String.fromCharCode(10), { flag: 'wx' });
  }
  process.stdout.write(JSON.stringify({ passed: report.passed, runs: report.runs.length, failures: report.runs.filter(item => item.status !== 'passed').map(item => ({ framework: item.framework, name: item.name, error: item.error })), errors: report.errors, evidence: path.join(input.out, 'lifecycle-evidence.json') }, null, 2) + String.fromCharCode(10));
  return report.passed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(String(error.stack ?? error) + String.fromCharCode(10)); process.exitCode = 1;
  });
}
