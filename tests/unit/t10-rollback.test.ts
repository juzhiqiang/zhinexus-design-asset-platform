import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createOwnedRoot } from '../../scripts/t10-consumer-ownership.mjs';

const state = vi.hoisted(() => ({ fail: '', calls: [] as string[] }));
vi.mock('../../tests/acceptance/t10-sdk/consumer.mjs', () => ({
  PUBLIC_SUBPATHS: ['line'],
  npm: (args: string[], root: string) => {
    const phase = args[0] === 'ci' ? 'restore' : 'candidate';
    state.calls.push(phase);
    if (phase === 'candidate') writeFileSync(path.join(root, 'package-lock.json'), 'candidate-lock');
    return { status: state.fail === phase ? 1 : 0, output: state.fail === phase ? 'injected installation failure' : '' };
  },
  readResolvedVersions: async (root: string) => JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies,
  runBuild: () => ({ status: 0, output: '' }),
  runTypechecks: async () => ['Bundler', 'NodeNext'].map(resolution => ({ resolution, status: 0, output: '' })),
  runSsrImport: async () => ({ status: 0, payload: { windowDefined: false, documentDefined: false } }),
}));

const directories: string[] = [];
const argv = [...process.argv];
afterEach(async () => {
  process.argv = argv;
  vi.resetModules();
  state.fail = ''; state.calls = [];
  // Only test-created roots are disposed here; production failure retention is asserted first.
  for (const root of directories.splice(0)) await rm(root, { recursive: true, force: true });
});
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'rollback-unit-')); directories.push(root);
  const ownerFile = path.join(root, 'owner.json');
  const owner = await createOwnedRoot(ownerFile, process.cwd()); directories.push(owner.externalBase);
  const bundleRoot = path.join(root, 'bundle'); await mkdir(bundleRoot);
  const packages = [];
  for (const framework of ['core', 'vue', 'react']) {
    const name = `@company/charts-${framework}`;
    const version = framework === 'core' ? '0.0.10' : '0.0.11';
    const bytes = Buffer.from(`${name}@${version}`); const file = `${framework}.tgz`;
    await writeFile(path.join(bundleRoot, file), bytes);
    packages.push({ name, version, tarball: { path: file, sha256: sha(bytes), bytes: bytes.length },
      dependencies: framework === 'core' ? {} : { '@company/charts-core': '0.0.10' } });
  }
  await writeFile(path.join(bundleRoot, 'manifest.json'), JSON.stringify({ packages }));
  const combinations = [];
  for (const framework of ['vue', 'react']) {
    const staging = path.join(owner.consumerRoot, `a-t10-staging-${framework}`);
    const consumer = path.join(staging, `a-t10-consumer-${framework}`);
    await mkdir(consumer, { recursive: true }); await mkdir(path.join(staging, 'fixtures'));
    const frameworkVersion = framework === 'vue' ? '3.5.45' : '19.3.1';
    await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ dependencies: {
      echarts: '6.1.0', '@company/charts-core': '0.0.10', [`@company/charts-${framework}`]: '0.0.11', [framework]: frameworkVersion,
    } }));
    await writeFile(path.join(consumer, 'package-lock.json'), 'original-lock');
    combinations.push({ framework, frameworkVersion, consumer: { root: consumer, kept: true } });
  }
  const report = { candidate: { version: '6.1.0' }, recommendation: 'hold',
    bundle: { root: bundleRoot, version: packages.map(pkg => `${pkg.name}@${pkg.version}`).join(', '),
      packages: packages.map(pkg => ({ name: pkg.name, version: pkg.version, sha256: pkg.tarball.sha256, bytes: pkg.tarball.bytes })) },
    probe: { command: ['--consumer-root', owner.consumerRoot, '--keep'] }, combinations };
  const input = path.join(root, 'baseline.json'); await writeFile(input, JSON.stringify(report));
  const output = path.join(root, 'output');
  process.argv = [process.execPath, 'verify-t10-rollback.mjs', input, output, ownerFile];
  return { input, output, report };
}

it('回退按冻结 manifest 的独立包版本复原两消费者，并保持原锁文件字节', async () => {
  const f = await fixture();
  await expect(import('../../scripts/verify-t10-rollback.mjs')).resolves.toBeDefined();
  const evidence = JSON.parse(await readFile(path.join(f.output, 'rollback-evidence.json'), 'utf8'));
  expect(evidence.passed).toBe(true);
  expect(evidence.bundle.manifestSha256).toBe(sha(await readFile(path.join(f.report.bundle.root, 'manifest.json'))));
  for (const run of evidence.runs) {
    expect(run.restored.resolved[`@company/charts-${run.framework}`]).toBe('0.0.11');
    expect(run.restored.lockSha256).toBe(run.baselineLockSha256);
    expect(run.cleaned).toBe(true);
  }
});

it.each(['candidate', 'restore'])('%s 失败时仍尝试恢复两消费者，保留目录及失败证据', async fail => {
  const f = await fixture(); state.fail = fail;
  await expect(import('../../scripts/verify-t10-rollback.mjs')).rejects.toThrow('rollback evidence contains failures');
  const evidence = JSON.parse(await readFile(path.join(f.output, 'rollback-evidence.json'), 'utf8'));
  expect(evidence.passed).toBe(false);
  expect(state.calls.filter(call => call === 'restore')).toHaveLength(2);
  for (const run of evidence.runs) {
    expect(run.cleaned).toBe(false); expect(existsSync(run.root)).toBe(true);
    expect(run.errors.join('\n')).toContain('injected installation failure');
    expect(await readFile(path.join(run.root, 'package-lock.json'), 'utf8')).toBe('original-lock');
  }
});

it('基线报告包版本与冻结清单不符时，在安装和清理前拒绝', async () => {
  const f = await fixture(); f.report.bundle.packages[0]!.version = '0.0.99';
  await writeFile(f.input, JSON.stringify(f.report));
  await expect(import('../../scripts/verify-t10-rollback.mjs')).rejects.toThrow('baseline package differs from frozen bundle');
  expect(state.calls).toEqual([]);
  for (const combo of f.report.combinations) expect(existsSync(combo.consumer.root)).toBe(true);
});
