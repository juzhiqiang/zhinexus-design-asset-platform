import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import tar from 'tar-stream';
import { createOwnedRoot } from '../../scripts/t10-consumer-ownership.mjs';
import { loadPlaywright, parseArguments, validateLifecycleInputs, verifyInstalledTarball } from '../../scripts/t10-frozen-lifecycle.mjs';

test('loads a usable Chromium launcher from the repository Playwright installation', async () => {
  const { chromium } = await loadPlaywright(path.resolve(import.meta.dirname, '../..'));
  assert.equal(typeof chromium?.launch, 'function');
});

async function fixture(t) {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 't10-lifecycle-unit-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const repoRoot = path.join(temporaryRoot, 'repo');
  const root = path.join(temporaryRoot, 'external evidence');
  await mkdir(path.join(repoRoot, '.tools'), { recursive: true });
  await mkdir(root);
  const ownerFile = path.join(repoRoot, '.tools', 'owner.json');
  const owner = await createOwnedRoot(ownerFile, repoRoot);
  await writeFile(path.join(root, '.c-owned-t10-evidence.json'), JSON.stringify({
    kind: 'c-owned-t10-evidence-v1', repoRoot, ownerRunId: owner.runId,
  }));
  t.after(() => rm(owner.externalBase, { recursive: true, force: true }));
  const report = { kind: 'a-t10-sdk-probe', recommendation: 'hold', probe: { packaged: true,
    command: ['--consumer-root', owner.consumerRoot, '--keep'] }, combinations: [] };
  for (const framework of ['vue', 'react']) {
    const staging = path.join(owner.consumerRoot, `a-t10-staging-${framework}`);
    const consumerRoot = path.join(staging, `a-t10-consumer-${framework}`);
    await mkdir(consumerRoot, { recursive: true });
    await mkdir(path.join(staging, 'fixtures'));
    report.combinations.push({ framework, consumer: { root: consumerRoot, kept: true } });
  }
  const evidence = path.join(root, 'hold.json');
  await writeFile(evidence, JSON.stringify(report));
  return { root, repoRoot, evidence, owner: ownerFile, out: path.join(root, 'lifecycle'), report };
}

test('requires four named arguments and rejects ambiguous or unknown options', () => {
  assert.deepEqual(parseArguments(['--root', 'r', '--evidence', 'e', '--owner', 'o', '--out', 'x']),
    { root: 'r', evidence: 'e', owner: 'o', out: 'x' });
  for (const args of [[], ['--root', 'r'], ['--root', 'r', '--root', 's'], ['--unknown', 'x'], ['--root']]) {
    assert.throws(() => parseArguments(args));
  }
});

test('accepts only an owned kept pair and leaves input bytes unchanged', async t => {
  const input = await fixture(t);
  const before = await readFile(input.evidence);
  const result = await validateLifecycleInputs(input);
  assert.deepEqual(result.owned.consumers.map(item => item.framework).sort(), ['react', 'vue']);
  assert.equal(result.out, input.out);
  assert.deepEqual(await readFile(input.evidence), before);
});

for (const [name, change] of [
  ['output outside owned evidence root', input => { input.out = path.join(input.repoRoot, 'user-data'); }],
  ['output at evidence root', input => { input.out = input.root; }],
  ['ownership outside tools', input => { input.owner = input.evidence; }],
  ['evidence outside owned evidence root', input => { input.evidence = input.owner; }],
  ['report containing an arbitrary consumer', input => { input.report.combinations[0].consumer.root = input.root; }],
  ['report without packaged proof', input => { input.report.probe.packaged = false; }],
  ['adopt report instead of original kept hold', input => { input.report.recommendation = 'adopt'; }],
]) {
  test(`rejects ${name} before creating output`, async t => {
    const input = await fixture(t);
    change(input);
    await writeFile(path.join(input.root, 'hold.json'), JSON.stringify(input.report));
    await assert.rejects(validateLifecycleInputs(input));
    await assert.rejects(readFile(path.join(input.out, 'lifecycle-evidence.json')));
  });
}

test('rejects an existing output directory instead of adopting user files', async t => {
  const input = await fixture(t);
  await mkdir(input.out);
  await writeFile(path.join(input.out, 'sentinel'), 'preserve');
  await assert.rejects(validateLifecycleInputs(input));
  assert.equal(await readFile(path.join(input.out, 'sentinel'), 'utf8'), 'preserve');
});

test('rejects output through a redirected parent', async t => {
  const input = await fixture(t);
  const target = path.join(input.repoRoot, '.tools', 'user-data');
  await mkdir(target);
  const link = path.join(input.root, 'redirect');
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  input.out = path.join(link, 'lifecycle');
  await assert.rejects(validateLifecycleInputs(input));
});

test('rejects an evidence marker bound to another owned consumer run', async t => {
  const input = await fixture(t);
  await writeFile(path.join(input.root, '.c-owned-t10-evidence.json'), JSON.stringify({
    kind: 'c-owned-t10-evidence-v1', repoRoot: input.repoRoot, ownerRunId: '0'.repeat(32),
  }));
  await assert.rejects(validateLifecycleInputs(input));
});

async function archive(entries) {
  const pack = tar.pack();
  const chunks = [];
  pack.on('data', chunk => chunks.push(chunk));
  const end = new Promise(resolve => pack.on('end', resolve));
  for (const [name, bytes] of entries) pack.entry({ name, type: 'file' }, bytes);
  pack.finalize();
  await end;
  return gzipSync(Buffer.concat(chunks));
}

test('binds installed SDK file bytes to the frozen tarball rather than trusting versions', async t => {
  const input = await fixture(t);
  const installed = path.join(input.repoRoot, 'installed');
  await mkdir(installed);
  await writeFile(path.join(installed, 'index.js'), 'frozen bytes');
  const tarball = await archive([['package/index.js', 'frozen bytes']]);
  const proof = await verifyInstalledTarball(installed, tarball);
  assert.deepEqual(Object.keys(proof), ['index.js']);
  await writeFile(path.join(installed, 'index.js'), 'tampered bytes');
  await assert.rejects(verifyInstalledTarball(installed, tarball));
});

test('rejects unsafe archive paths without extracting or following them', async t => {
  const input = await fixture(t);
  const tarball = await archive([['package/../user-file', 'must not be written']]);
  await assert.rejects(verifyInstalledTarball(input.root, tarball));
  await assert.rejects(readFile(path.join(input.root, 'user-file')));
});
