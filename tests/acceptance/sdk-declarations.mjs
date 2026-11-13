import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateManifest, validateReleaseBundle } from '@company/contracts';

// Read-only acceptance of an already frozen bundle. No build, pack, source alias,
// declaration shim, registry publication or skipLibCheck bypass is allowed here.
const [repoRoot, bundlePath, evidenceFile] = process.argv.slice(2);
if (!repoRoot || !bundlePath || !evidenceFile) throw new Error('Expected repository, frozen bundle, evidence output');
const bundleRoot = await realpath(bundlePath);
const boundedFile = async logical => {
  if (typeof logical !== 'string' || path.isAbsolute(logical) || path.win32.isAbsolute(logical) ||
      logical.includes('\\') || logical.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('SDK_INPUT unsafe bundle path');
  }
  const physical = await realpath(path.join(bundleRoot, logical));
  const relative = path.relative(bundleRoot, physical);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('SDK_INPUT file resolves outside the frozen bundle');
  }
  return physical;
};
const manifest = JSON.parse(await readFile(await boundedFile('manifest.json'), 'utf8'));
// This first pass rejects invalid schema/paths before reading files. Cross-
// references and compatibility evidence are checked with bytes in the second pass.
const shape = validateManifest(manifest);
if (!shape.ok && shape.issues.some(issue => issue.code === 'INVALID_SCHEMA' || issue.code === 'INVALID_PATH')) {
  throw new Error(`SDK_INPUT invalid manifest: ${JSON.stringify(shape.issues)}`);
}
const names = ['@company/charts-core', '@company/charts-vue', '@company/charts-react'];
if (manifest.packages.length !== names.length || names.some(name => manifest.packages.filter(pkg => pkg.name === name).length !== 1)) {
  throw new Error('SDK_INPUT expected exactly the three SDK packages');
}
const version = manifest.packages[0].version;
if (manifest.packages.some(pkg => pkg.version !== version || pkg.name !== names[0] && pkg.dependencies[names[0]] !== version)) {
  throw new Error('SDK_INPUT all three SDK versions and core dependencies must agree');
}
const inventory = new Map();
for (const ref of manifest.files) inventory.set(ref.path, await readFile(await boundedFile(ref.path)));
const bundle = await validateReleaseBundle(manifest, inventory);
if (!bundle.ok) throw new Error(`SDK_INPUT invalid frozen bundle: ${JSON.stringify(bundle.issues)}`);
const consumer = await mkdtemp(path.join(tmpdir(), 'c-sdk-strict-'));
const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const run = (args) => {
  const result = spawnSync(process.execPath, args, { cwd: consumer, encoding: 'utf8', windowsHide: true,
    shell: false, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  return { exitCode: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.replaceAll(consumer, '[consumer]') };
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const dependencies = { echarts: '6.1.0', vue: '3.5.45', react: '19.3.1', 'react-dom': '19.3.1',
    '@types/react': '19.3.0', '@types/react-dom': '19.3.0',
    typescript6: 'npm:typescript@6.0.3', typescript7: 'npm:typescript@7.0.2' };
  for (const pkg of manifest.packages) {
    const file = await boundedFile(pkg.tarball.path);
    if (digest(await readFile(file)) !== pkg.tarball.sha256) throw new Error(`Frozen digest changed: ${pkg.name}`);
    dependencies[pkg.name] = `file:${file.replaceAll('\\', '/')}`;
  }
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ name: 'c-sdk-strict-declarations', private: true,
    version: '1.0.0', type: 'module', dependencies,
    overrides: { '@company/charts-core': dependencies['@company/charts-core'] } }, null, 2));
  const installed = run([npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund']);
  if (installed.exitCode !== 0) throw new Error(`Frozen install failed: ${installed.output}`);
  const imports = [];
  for (const pkg of manifest.packages) {
    const packageDir = path.join(consumer, 'node_modules', ...pkg.name.split('/'));
    const physical = await realpath(packageDir);
    const owned = path.relative(consumer, physical);
    if (owned.startsWith('..') || path.isAbsolute(owned)) throw new Error('Workspace link found');
    const packed = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));
    if (packed.name !== pkg.name || packed.version !== pkg.version) throw new Error('Package identity mismatch');
    const expected = pkg.name === names[0] ? ['.'] : ['.', './line', './bar', './pie', './scatter', './trend-card', './ranking', './proportion', './style.css'];
    const actual = Object.keys(packed.exports ?? {}).sort();
    if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) throw new Error(`SDK_EXPORTS required public entries differ: ${pkg.name}`);
    for (const entry of expected) {
      if (entry === './style.css') {
        const target = packed.exports[entry];
        if (typeof target !== 'string' || !target.startsWith('./') || target.includes('\\') ||
            target.slice(2).split('/').some(part => !part || part === '.' || part === '..')) {
          throw new Error(`SDK_EXPORTS unsafe style target: ${pkg.name}`);
        }
        try {
          const css = await realpath(path.resolve(physical, target));
          const relative = path.relative(physical, css);
          if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Style escapes installed package');
          if (!(await readFile(css)).length) throw new Error('Style is empty');
        } catch (cause) { throw new Error(`SDK_EXPORTS style target is unavailable: ${pkg.name}`, { cause }); }
        continue;
      }
      if (typeof packed.exports[entry]?.types !== 'string' || typeof packed.exports[entry]?.import !== 'string') throw new Error(`SDK_EXPORTS missing declaration or import: ${pkg.name}${entry}`);
      imports.push(`import ${JSON.stringify(pkg.name + entry.slice(1))};`);
    }
  }
  await writeFile(path.join(consumer, 'index.ts'), `${imports.join('\n')}\n` +
    `import type { CombinationResult } from '@company/charts-core';\n` +
    `export const previousPublicShape: CombinationResult = { framework: 'vue', frameworkVersion: '3.5.45', ` +
    `echartsVersion: '6.1.0', typecheck: 'passed', runtime: 'passed', interaction: 'passed', visual: 'passed', differences: [] };\n`);
  const results = [];
  for (const compiler of ['typescript6', 'typescript7']) {
    for (const resolution of ['Bundler', 'NodeNext']) {
      const config = { compilerOptions: { target: 'ES2022', module: resolution === 'Bundler' ? 'ESNext' : 'NodeNext',
        moduleResolution: resolution, strict: true, skipLibCheck: false, noEmit: true,
        lib: ['ES2022', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom'] }, files: ['index.ts'] };
      await writeFile(path.join(consumer, 'tsconfig.json'), JSON.stringify(config));
      const result = run([path.join(consumer, 'node_modules', compiler, 'bin', 'tsc'), '--project', 'tsconfig.json', '--pretty', 'false']);
      results.push({ compiler, resolution, ...result });
    }
  }
  await writeFile(path.join(consumer, 'verify-policy.mjs'), `
import { verifyCandidate, recommend } from '@company/charts-core';
const supported = [{framework:'vue',frameworkVersion:'3.5.45',echartsVersion:'6.1.0'}, {framework:'react',frameworkVersion:'19.3.1',echartsVersion:'6.1.0'}];
const passed = {typecheck:'passed',runtime:'passed',interaction:'passed',visual:'passed',differences:[]};
const candidate = {version:'6.1.0',integrity:'sha512-test',source:'local-test',releaseNotesSource:'local-test'};
const results = [];
const record = (name, actual, expected) => results.push({name,actual,expected,passed:actual===expected});
const report = await verifyCandidate(candidate,supported,async()=>passed);
record('complete dual framework baseline',recommend(report,supported),'adopt');
const altered = structuredClone(report); altered.results[0].echartsVersion='6.0.0';
record('measured version differs from candidate',recommend(altered,supported),'hold');
const rollback = await verifyCandidate({...candidate,version:'6.0.0'},supported,async()=>passed);
rollback.peerSatisfied=true; rollback.baselineEchartsVersion='6.0.0';
record('report cannot rewrite supported baseline',recommend(rollback,supported),'hold');
const vueOnly = await verifyCandidate(candidate,[supported[0]],async()=>passed);
record('Vue only matrix',recommend(vueOnly,[supported[0]]),'hold');
const reactOnly = await verifyCandidate(candidate,[supported[1]],async()=>passed);
record('React only matrix',recommend(reactOnly,[supported[1]]),'hold');
const missing = structuredClone(report); missing.results.pop();
record('missing implementation',recommend(missing,supported),'hold');
console.log(JSON.stringify(results));
`);
  const policyRun = run([path.join(consumer, 'verify-policy.mjs')]);
  if (policyRun.exitCode !== 0) throw new Error(`Public compatibility probe failed: ${policyRun.output}`);
  const policy = JSON.parse(policyRun.output.trim());
  const evidence = { verifiedAt: new Date().toISOString(), os: process.platform, node: process.version,
    bundle: path.relative(repoRoot, bundlePath), packages: manifest.packages.map(p => ({ name: p.name, version: p.version, sha256: p.tarball.sha256 })),
    importCount: imports.length, checksPreviousPublicShape: true,
    installExitCode: installed.exitCode, results, policy };
  for (const pkg of manifest.packages) {
    if (digest(await readFile(await boundedFile(pkg.tarball.path))) !== pkg.tarball.sha256) throw new Error('Digest changed after checks');
  }
  await writeFile(evidenceFile, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
  if (results.some(result => result.exitCode !== 0) || policy.some(result => !result.passed)) process.exitCode = 1;
} finally {
  const owned = path.relative(path.resolve(tmpdir()), path.resolve(consumer));
  if (!/^c-sdk-strict-[^/\\]+$/.test(owned)) throw new Error('Refusing cleanup outside owned temp consumer');
  await rm(consumer, { recursive: true, force: true });
}
