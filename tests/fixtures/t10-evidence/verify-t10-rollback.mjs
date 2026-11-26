import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { npm, readResolvedVersions, runBuild, runSsrImport, runTypechecks, PUBLIC_SUBPATHS } from '../../acceptance/t10-sdk/consumer.mjs';
import { validateOwnedConsumers, cleanupOwnedPair } from './t10-consumer-ownership.mjs';
import { readFrozenBundle } from '../../acceptance/t10-sdk/bundle.mjs';

const [input, output, ownerFile] = process.argv.slice(2);
assert(input && output && ownerFile, 'baseline evidence, output directory and C ownership file required');
const baseline = JSON.parse(await readFile(input, 'utf8'));
assert.equal(baseline.candidate.version, '6.1.0');
assert.equal(baseline.recommendation, 'hold');
assert.deepEqual(baseline.combinations.map(x => x.framework).sort(), ['react', 'vue']);
const repo = path.resolve('.');
const owned = await validateOwnedConsumers(ownerFile, baseline, repo);
const out = path.resolve(output);
await mkdir(out, { recursive: true });
const sha = value => createHash('sha256').update(value).digest('hex');
const frozen = await readFrozenBundle(baseline.bundle?.root);
assert.equal(baseline.bundle.version, frozen.version, 'baseline bundle version differs from frozen bundle');
assert.equal(baseline.bundle.packages.length, frozen.packages.length, 'baseline package count differs from frozen bundle');
for (const pkg of frozen.packages) {
  const matches = baseline.bundle.packages.filter(item => item.name === pkg.name);
  assert.equal(matches.length, 1, 'baseline package differs from frozen bundle');
  assert.deepEqual({ version: matches[0].version, sha256: matches[0].sha256, bytes: matches[0].bytes },
    { version: pkg.version, sha256: pkg.sha256, bytes: pkg.bytes }, 'baseline package differs from frozen bundle');
}
const sdkVersion = name => frozen.packages.find(pkg => pkg.name === name).version;
const report = { kind: 'c-t10-two-consumer-lock-rollback', generatedAt: new Date().toISOString(), baselineEvidence: path.resolve(input),
  baselineEvidenceSha256: sha(await readFile(input)),
  bundle: { root: frozen.root, version: frozen.version, manifestSha256: sha(await readFile(frozen.manifestPath)),
    packages: frozen.packages.map(({ name, version, sha256, bytes }) => ({ name, version, sha256, bytes })) },
  baseline: '6.1.0', candidate: '6.0.0', candidateAdopted: false, passed: false, runs: [] };
let failed = false;
for (const combination of baseline.combinations) {
  const framework = combination.framework;
  const { root, staging } = owned.consumers.find(x => x.framework === framework);
  const before = await readResolvedVersions(root, ['echarts']);
  assert.equal(before.echarts, report.baseline);
  const manifestFile = path.join(root, 'package.json');
  const lockFile = path.join(root, 'package-lock.json');
  const manifestBytes = await readFile(manifestFile);
  const lockBytes = await readFile(lockFile);
  await writeFile(path.join(out, `${framework}-baseline-package.json`), manifestBytes);
  await writeFile(path.join(out, `${framework}-baseline-package-lock.json`), lockBytes);
  const record = { framework, root, staging, baselineManifestSha256: sha(manifestBytes), baselineLockSha256: sha(lockBytes), candidate: null, restored: null, cleaned: false, errors: [] };
  report.runs.push(record);
  try {
    try {
      const manifest = JSON.parse(manifestBytes.toString('utf8'));
      manifest.dependencies.echarts = report.candidate;
      await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
      const install = npm(['install', '--legacy-peer-deps', '--no-audit', '--no-fund', '--loglevel=error'], root);
      const resolved = await readResolvedVersions(root, ['echarts', '@company/charts-core', `@company/charts-${framework}`]);
      const build = runBuild({ root });
      const candidateLockSha256 = sha(await readFile(lockFile));
      record.candidate = { peerMode: 'legacy', install, resolved, build, lockSha256: candidateLockSha256, adoption: 'forbidden-peer-mismatch' };
      assert.equal(install.status, 0, install.output);
      assert.equal(resolved.echarts, report.candidate);
      assert.equal(resolved['@company/charts-core'], sdkVersion('@company/charts-core'));
      assert.equal(resolved[`@company/charts-${framework}`], sdkVersion(`@company/charts-${framework}`));
      assert.equal(build.status, 0, build.output);
      assert.notEqual(candidateLockSha256, record.baselineLockSha256);
    } catch (error) {
      record.errors.push(`candidate: ${error.stack ?? error}`);
      failed = true;
    } finally {
      // 原始清单与锁文件逐字节恢复；npm ci 严格安装，不复制既有 node_modules。
      await writeFile(manifestFile, manifestBytes);
      await writeFile(lockFile, lockBytes);
      const install = npm(['ci', '--no-audit', '--no-fund', '--loglevel=error'], root);
      const resolved = await readResolvedVersions(root, ['echarts', '@company/charts-core', `@company/charts-${framework}`, framework]);
      const consumer = { root, framework };
      const sdk = { packageName: `@company/charts-${framework}`, subpaths: PUBLIC_SUBPATHS };
      const typecheck = await runTypechecks(consumer, sdk);
      const build = runBuild(consumer);
      const ssr = await runSsrImport(consumer, sdk);
      const manifestSha256 = sha(await readFile(manifestFile));
      const lockSha256 = sha(await readFile(lockFile));
      record.restored = { install, resolved, typecheck, build, ssr, manifestSha256, lockSha256 };
      assert.equal(install.status, 0, install.output);
      assert.equal(resolved.echarts, report.baseline);
      assert.equal(resolved['@company/charts-core'], sdkVersion('@company/charts-core'));
      assert.equal(resolved[`@company/charts-${framework}`], sdkVersion(`@company/charts-${framework}`));
      assert.equal(resolved[framework], combination.frameworkVersion);
      assert.equal(manifestSha256, record.baselineManifestSha256);
      assert.equal(lockSha256, record.baselineLockSha256);
      assert.equal(typecheck.length, 2);
      for (const check of typecheck) assert.equal(check.status, 0, check.output);
      assert.equal(build.status, 0, build.output);
      assert.equal(ssr.status, 0, ssr.output);
      assert.equal(ssr.payload.windowDefined, false);
      assert.equal(ssr.payload.documentDefined, false);
    }
  } catch (error) {
    record.errors.push(`restore: ${error.stack ?? error}`);
    failed = true;
  } finally {
    console.log(JSON.stringify({ framework, candidateEcharts: record.candidate?.resolved?.echarts, restoredEcharts: record.restored?.resolved?.echarts, lockRestored: record.restored?.lockSha256 === record.baselineLockSha256, errors: record.errors }));
    await writeFile(path.join(out, 'rollback-evidence.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
}
if (!failed) {
  await cleanupOwnedPair(ownerFile, baseline, repo);
  for (const record of report.runs) {
    record.cleaned = !existsSync(record.staging);
    assert.equal(record.cleaned, true);
  }
}
report.passed = !failed && report.runs.length === 2 && report.runs.every(x => x.errors.length === 0 && x.cleaned);
await writeFile(path.join(out, 'rollback-evidence.json'), `${JSON.stringify(report, null, 2)}\n`);
assert.equal(report.passed, true, 'rollback evidence contains failures');
