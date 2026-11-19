import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseInspectReport, preserveFailedInspectEvidence, runFrozenInspectAcceptance, verifyInspectReceiptEvidence } from './runner.js';
import { createOwnedRun } from './host.js';
import * as host from './host.js';
import * as runtime from './runtime.js';

describe('T17 frozen CLI inspect evidence', () => {
  it('builds, seals and verifies the actual runner receipt using local CLI boundary fixtures', async () => {
    const root = await mkdtemp(join(tmpdir(), 't17-inspect-builder-test-'));
    const tarball = join(root, 'cli.tgz'), tarballBytes = Buffer.from('local CLI boundary fixture');
    const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    let owned: Awaited<ReturnType<typeof createOwnedRun>> | undefined;
    await writeFile(tarball, tarballBytes);
    vi.spyOn(host, 'installFrozenCli').mockImplementation(async (options) => {
      owned = options.run;
      const installRoot = await owned.makeOwnedProject('cli-consumer');
      return { root: installRoot, entry: join(installRoot, 'fixture-bin.js'), entrySha256: digest(Buffer.from('fixture bin')), version: options.expectedVersion,
        tarballSha256: digest(tarballBytes), tarballBytes: tarballBytes.length, manifestSha256: digest(Buffer.from('fixture manifest')), installOutputBytes: 0 };
    });
    vi.spyOn(runtime, 'installDependencies').mockImplementation(async (_run, options) => {
      await writeFile(join(options.projectRoot, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {} }) + '\n', { flag: 'wx' });
      return { manager: 'npm' as const, executable: process.execPath, args: [], cwd: options.projectRoot, exitCode: 0, stdoutSha256: digest(Buffer.alloc(0)), stderrSha256: digest(Buffer.alloc(0)), stdoutBytes: 0, stderrBytes: 0 };
    });
    vi.spyOn(runtime, 'runFrozenCli').mockImplementation(async (run, options) => {
      const framework = options.projectRoot === run.projectRoots.vue ? 'vue' : 'react';
      const fileSnapshots = await Promise.all(['package.json', 'package-lock.json'].map(async path => ({ path, exists: true, sha256: digest(await readFile(join(options.projectRoot, path))) })));
      const stdout = Buffer.from(JSON.stringify({ schemaVersion: 1, status: 'inspected', framework, packageManager: 'npm', lockfile: { path: 'package-lock.json', format: 'npm-v3' }, conflicts: [], fileSnapshots }) + '\n');
      const stderr = Buffer.alloc(0), out = await run.writeEvidence(framework + '.stdout', stdout), err = await run.writeEvidence(framework + '.stderr', stderr);
      return { executable: process.execPath, args: options.args ?? [], cwd: options.projectRoot, exitCode: 0, timedOut: false, stdoutBytes: out.bytes, stderrBytes: err.bytes,
        stdoutSha256: out.sha256, stderrSha256: err.sha256, stdoutEvidence: out.path, stderrEvidence: err.path };
    });
    try {
      // Only the external install/CLI boundaries are fixtures; receipt construction, native
      // owned directories, output hashes, seal, cleanup and verification use the real runner.
      const receipt = await runFrozenInspectAcceptance({ cliTarball: tarball, cliSha256: digest(tarballBytes), cliVersion: '0.0.19', repositoryRoot: process.cwd() });
      const persisted = JSON.parse(await readFile(receipt.receiptEvidencePath, 'utf8')) as { schemaVersion?: number };
      expect(persisted.schemaVersion).toBe(1);
      expect(receipt.inspections.map(item => item.framework)).toEqual(['vue', 'react']);
      await expect(verifyInspectReceiptEvidence(receipt)).resolves.toBeUndefined();
      await expect(lstat(owned!.parentRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      vi.restoreAllMocks();
      if (owned) { await owned.abortForTest(); await rm(owned.evidenceRoot, { recursive: true, force: true }); }
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts only a clean, successful inspection for the requested framework', () => {
    const report = { schemaVersion: 1, status: 'inspected', framework: 'vue', packageManager: 'npm', lockfile: { path: 'package-lock.json', format: 'npm-v3' }, conflicts: [], fileSnapshots: [
      { path: 'package.json', exists: true, sha256: 'a'.repeat(64) },
      { path: 'package-lock.json', exists: true, sha256: 'b'.repeat(64) },
    ] };
    expect(parseInspectReport(JSON.stringify(report), 'vue')).toEqual(report);
    expect(() => parseInspectReport(JSON.stringify({ ...report, status: 'conflicted' }), 'vue')).toThrow(/inspected/i);
    expect(() => parseInspectReport(JSON.stringify({ ...report, framework: 'react' }), 'vue')).toThrow(/framework/i);
    expect(() => parseInspectReport(JSON.stringify({ ...report, conflicts: [{ code: 'UNKNOWN' }] }), 'vue')).toThrow(/conflict/i);
  });

  it('rejects empty, malformed, duplicate, or incomplete file snapshots', () => {
    const report = { schemaVersion: 1, status: 'inspected', framework: 'react', packageManager: 'npm', lockfile: { path: 'package-lock.json', format: 'npm-v3' }, conflicts: [], fileSnapshots: [
      { path: 'package.json', exists: true, sha256: 'a'.repeat(64) },
      { path: 'package-lock.json', exists: true, sha256: 'b'.repeat(64) },
    ] };
    expect(() => parseInspectReport(JSON.stringify({ ...report, fileSnapshots: [] }), 'react')).toThrow(/snapshot/i);
    expect(() => parseInspectReport(JSON.stringify({ ...report, fileSnapshots: [{ path: 'package.json', exists: true, sha256: 'not-a-digest' }, report.fileSnapshots[1]] }), 'react')).toThrow(/snapshot/i);
    expect(() => parseInspectReport(JSON.stringify({ ...report, fileSnapshots: [report.fileSnapshots[0], { ...report.fileSnapshots[1], path: '../package-lock.json' }] }), 'react')).toThrow(/snapshot/i);
    expect(() => parseInspectReport(JSON.stringify({ ...report, fileSnapshots: [report.fileSnapshots[0], report.fileSnapshots[0]] }), 'react')).toThrow(/snapshot/i);
    expect(() => parseInspectReport(JSON.stringify({ ...report, fileSnapshots: [report.fileSnapshots[0]] }), 'react')).toThrow(/snapshot/i);
  });

  it('rejects CLI diagnostics or malformed stdout instead of sealing an empty inspection', () => {
    expect(() => parseInspectReport('not json', 'react')).toThrow(/JSON/i);
    expect(() => parseInspectReport(JSON.stringify({ schemaVersion: 1, status: 'inspected', framework: 'react' }), 'react')).toThrow(/conflicts/i);
  });

  it('retains captured failure evidence while cleaning only the owned project roots', async () => {
    const run = await createOwnedRun({ baseDirectory: tmpdir() });
    const evidence = await run.writeEvidence('failure.stderr', Buffer.from('install failed'));
    const result = await preserveFailedInspectEvidence(run);
    expect(result).toEqual({ evidenceRoot: run.evidenceRoot, projectCleanupFailed: false });
    await expect(readFile(evidence.path, 'utf8')).resolves.toBe('install failed');
    await expect(lstat(run.parentRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(run.evidenceRoot, { recursive: true, force: true });
  });

  it('verifies receipt metadata is backed by CLI stdout and sealed persisted JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhinexus-t17-receipt-test-'));
    try {
      const files = join(root, 'files');
      const stdout = Buffer.from(JSON.stringify({ schemaVersion: 1, status: 'inspected', framework: 'vue', packageManager: 'npm',
        lockfile: { path: 'package-lock.json', format: 'npm-v3' }, conflicts: [], fileSnapshots: [
          { path: 'package.json', exists: true, sha256: 'a'.repeat(64) },
          { path: 'package-lock.json', exists: true, sha256: 'b'.repeat(64) },
        ] }) + '\n');
      const reactStdout = Buffer.from(JSON.stringify({ ...JSON.parse(stdout.toString('utf8')), framework: 'react' }) + '\n');
      const stderr = Buffer.alloc(0);
      await mkdir(files);
      await writeFile(join(files, 'vue.stdout'), stdout);
      await writeFile(join(files, 'vue.stderr'), stderr);
      await writeFile(join(files, 'react.stdout'), reactStdout);
      await writeFile(join(files, 'react.stderr'), stderr);
      const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
      const cli = { root: 'cli-root', entry: 'cli-entry', entrySha256: 'c'.repeat(64), version: '0.0.17', tarballSha256: 'a'.repeat(64), tarballBytes: 1, manifestSha256: 'b'.repeat(64) };
      const inspection = { framework: 'vue' as const, status: 'inspected' as const, packageManager: 'npm' as const, fileSnapshotCount: 2, exitCode: 0 as const,
        stdoutBytes: stdout.length, stderrBytes: stderr.length, stdoutSha256: digest(stdout), stderrSha256: digest(stderr), stdoutEvidence: join(files, 'vue.stdout'), stderrEvidence: join(files, 'vue.stderr') };
      const reactInspection = { ...inspection, framework: 'react' as const, stdoutBytes: reactStdout.length, stdoutSha256: digest(reactStdout), stdoutEvidence: join(files, 'react.stdout'), stderrEvidence: join(files, 'react.stderr') };
      const inspections = [inspection, reactInspection];
      const receiptEvidencePath = join(files, 'inspect-acceptance.json');
      const persisted = Buffer.from(JSON.stringify({ schemaVersion: 1, runId: 'run-1', evidenceRoot: root, result: 'passed', receiptEvidencePath, sealPath: '', sealSha256: '', cli, inspections }) + '\n');
      await writeFile(join(files, 'inspect-acceptance.json'), persisted);
      const sealBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, runId: 'run-1', evidenceRoot: root, payload: { result: 'passed', cli, inspections, receiptEvidencePath: 'files/inspect-acceptance.json' }, files: [
        { name: 'vue.stdout', bytes: stdout.length, sha256: digest(stdout) },
        { name: 'vue.stderr', bytes: stderr.length, sha256: digest(stderr) },
        { name: 'react.stdout', bytes: reactStdout.length, sha256: digest(reactStdout) },
        { name: 'react.stderr', bytes: stderr.length, sha256: digest(stderr) },
        { name: 'inspect-acceptance.json', bytes: persisted.length, sha256: digest(persisted) },
      ] }));
      const sealPath = join(root, 'run-seal.json');
      await writeFile(sealPath, sealBytes);
      const receipt = { runId: 'run-1', evidenceRoot: root, result: 'passed' as const, receiptEvidencePath, sealPath, sealSha256: digest(sealBytes), cli, inspections };
      await expect(verifyInspectReceiptEvidence(receipt)).resolves.toBeUndefined();
      expect(await readFile(sealPath)).toEqual(sealBytes);
      await expect(verifyInspectReceiptEvidence({ ...receipt, inspections: [{ ...receipt.inspections[0]!, stdoutSha256: 'c'.repeat(64) }, reactInspection] })).rejects.toThrow(/seal|evidence/i);
      await expect(verifyInspectReceiptEvidence({ ...receipt, inspections: [{ ...inspection, framework: 'react' }, reactInspection] })).rejects.toThrow(/seal|evidence|framework/i);
      await expect(verifyInspectReceiptEvidence({ ...receipt, inspections: [{ ...inspection, fileSnapshotCount: 3 }, reactInspection] })).rejects.toThrow(/seal|evidence|snapshot/i);
      await writeFile(receiptEvidencePath, Buffer.from(JSON.stringify({ schemaVersion: 1, runId: 'run-1', evidenceRoot: root, result: 'passed', receiptEvidencePath, sealPath: '', sealSha256: '', cli, inspections: [{ ...inspection, exitCode: 1 }, reactInspection] }) + '\n'));
      await expect(verifyInspectReceiptEvidence(receipt)).rejects.toThrow(/seal|evidence/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
