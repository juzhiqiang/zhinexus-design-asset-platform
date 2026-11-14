import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const markerName = '.c-owned-t10.json';
const equalPath = (a, b) => path.relative(path.resolve(a), path.resolve(b)) === '';

async function plainDirectory(directory) {
  const stat = await lstat(directory);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), `not a plain directory: ${directory}`);
  assert(equalPath(await realpath(directory), directory), `redirected directory: ${directory}`);
}

export async function createOwnedRoot(ownerFile, repoRoot) {
  const temp = await realpath(tmpdir());
  const runId = randomBytes(16).toString('hex');
  const externalBase = path.join(temp, `zhinexus-c-t10-${runId}`);
  await mkdir(externalBase); // Exclusive: never adopt an existing directory.
  const owner = {
    kind: 'c-owned-t10-consumers-v1', runId, externalBase,
    consumerRoot: path.join(externalBase, 'consumers with spaces'),
    repoRoot: await realpath(repoRoot), createdAt: new Date().toISOString(),
  };
  const bytes = `${JSON.stringify(owner, null, 2)}\n`;
  await writeFile(path.join(externalBase, markerName), bytes, { flag: 'wx' });
  await writeFile(ownerFile, bytes, { flag: 'wx' });
  return owner;
}

export async function validateOwnedConsumers(ownerFile, report, repoRoot) {
  const bytes = await readFile(ownerFile);
  const owner = JSON.parse(bytes);
  assert.equal(owner.kind, 'c-owned-t10-consumers-v1');
  assert.match(owner.runId, /^[a-f0-9]{32}$/);
  assert(equalPath(owner.repoRoot, await realpath(repoRoot)), 'ownership belongs to another repository');
  const temp = await realpath(tmpdir());
  assert(equalPath(owner.externalBase, path.join(temp, `zhinexus-c-t10-${owner.runId}`)));
  assert(equalPath(owner.consumerRoot, path.join(owner.externalBase, 'consumers with spaces')));
  await plainDirectory(owner.externalBase);
  assert.deepEqual(await readFile(path.join(owner.externalBase, markerName)), bytes, 'ownership marker differs');
  await plainDirectory(owner.consumerRoot);
  const args = report.probe.command;
  assert(Array.isArray(args));
  assert.equal(args.filter(x => x === '--consumer-root').length, 1);
  assert(equalPath(args[args.indexOf('--consumer-root') + 1], owner.consumerRoot));
  assert(args.includes('--keep'));
  assert.deepEqual(report.combinations.map(x => x.framework).sort(), ['react', 'vue']);
  const stages = new Set();
  const consumers = [];
  for (const combination of report.combinations) {
    const root = path.resolve(combination.consumer.root);
    const staging = path.dirname(root);
    assert.equal(combination.consumer.kept, true);
    assert.equal(path.basename(root), `a-t10-consumer-${combination.framework}`);
    assert.match(path.basename(staging), /^a-t10-staging-[A-Za-z0-9]+$/);
    assert(equalPath(path.dirname(staging), owner.consumerRoot), 'staging outside owned direct parent');
    assert(!stages.has(staging.toLowerCase()), 'duplicate staging');
    stages.add(staging.toLowerCase());
    await plainDirectory(staging);
    await plainDirectory(root);
    const entries = (await readdir(staging)).sort();
    assert.deepEqual(entries, [`a-t10-consumer-${combination.framework}`, 'fixtures'].sort());
    await plainDirectory(path.join(staging, 'fixtures'));
    assert(!(await readdir(root)).includes('.git'), 'consumer is a Git checkout');
    consumers.push({ framework: combination.framework, root, staging });
  }
  assert.deepEqual((await readdir(owner.consumerRoot)).sort(), consumers.map(x => path.basename(x.staging)).sort(), 'unowned entries present');
  return { owner, consumers };
}

export async function cleanupOwnedPair(ownerFile, report, repoRoot) {
  const { owner, consumers } = await validateOwnedConsumers(ownerFile, report, repoRoot);
  // All paths validated as one set; no report-controlled recursive deletion beyond this set.
  for (const item of consumers) {
    await plainDirectory(item.staging);
    await plainDirectory(item.root);
    assert.deepEqual(await readFile(path.join(owner.externalBase, markerName)), await readFile(ownerFile));
    await rm(item.staging, { recursive: true });
  }
  await rmdir(owner.consumerRoot);
}
