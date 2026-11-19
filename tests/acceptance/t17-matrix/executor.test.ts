import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import tar from 'tar-stream';
import { T17_POSITIVE_SCENARIOS, T17_REFUSAL_SCENARIOS } from '../../fixtures/t17-matrix/scenarios.js';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const roots: string[] = [];
const validReport = {
  schemaVersion: 1, projectRoot: 'C:/project', planDigest: 'a'.repeat(64), applyResultDigest: 'b'.repeat(64),
  specDigest: 'c'.repeat(64), operation: 'verify', id: 'verify-1', toolVersion: '1.2.3', verifiedAt: '2026-11-19T00:00:00.000Z',
  status: 'passed', checks: [], changedFiles: [], snapshots: { before: [], after: [] }, installedVersions: [],
  visualResult: 'not-run', artifacts: [], pendingItems: [],
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeFrozenCli(workspace = '.') {
  const root = await mkdtemp(join(tmpdir(), 't17-executor-'));
  roots.push(root);
  const installRoot = join(root, 'consumer');
  const packageRoot = join(installRoot, 'node_modules', '@company', 'component-cli');
  const dist = join(packageRoot, 'dist');
  await mkdir(dist, { recursive: true });
  const tarballPath = join(root, 'cli.tgz');
  const manifest = JSON.stringify({
    name: '@company/component-cli', version: '1.2.3', bin: { component: './dist/bin.js' },
  });
  await writeFile(join(packageRoot, 'package.json'), manifest);
  const binPath = join(dist, 'bin.js');
  await writeFile(binPath, `const args=process.argv.slice(2); const project=args[args.indexOf('--project')+1]; if(require('node:path').resolve(project)!==process.cwd()) process.exit(41); process.stdout.write(JSON.stringify(${JSON.stringify(validReport)})+String.fromCharCode(10));`);
  const binBytes = await (await import('node:fs/promises')).readFile(binPath);
  const archive = tar.pack();
  archive.entry({ name: 'package/package.json', size: Buffer.byteLength(manifest) }, manifest);
  archive.entry({ name: 'package/dist/bin.js', size: binBytes.length }, binBytes);
  archive.finalize();
  await pipeline(archive, createGzip(), createWriteStream(tarballPath));
  const tarball = await (await import('node:fs/promises')).readFile(tarballPath);
  const projectRoot = join(root, 'project');
  await mkdir(projectRoot);
  const artifactRoot = join(root, 'artifacts');
  await mkdir(artifactRoot);
  const planPath = join(root, 'plan.json');
  await writeFile(planPath, JSON.stringify({ localProject: { workspace } }));
  return { cli: { version: '1.2.3', tarballSha256: sha(tarball), tarballPath, installRoot, packageRoot, binPath }, projectRoot, artifactRoot, planPath };
}

async function updateFrozenBinEntry(cli: Awaited<ReturnType<typeof makeFrozenCli>>['cli'], bytes: Buffer): Promise<void> {
  await writeFile(cli.binPath, bytes);
  const manifest = await (await import('node:fs/promises')).readFile(join(cli.packageRoot, 'package.json'));
  const archive = tar.pack();
  archive.entry({ name: 'package/package.json', size: manifest.length }, manifest);
  archive.entry({ name: 'package/dist/bin.js', size: bytes.length }, bytes);
  archive.finalize();
  await pipeline(archive, createGzip(), createWriteStream(cli.tarballPath));
  cli.tarballSha256 = sha(await (await import('node:fs/promises')).readFile(cli.tarballPath));
}

describe('T17 real CLI scenario executor', () => {
  it('provides an explicit verify invocation for the frozen CLI and scoped scenario project', async () => {
    const loaded = await import('./executor.js').catch(() => null);
    expect(loaded && typeof loaded.verifyArgsFor).toBe('function');
    const args = loaded!.verifyArgsFor({
      projectRoot: 'C:/acceptance/V01',
      workspace: '.',
      planPath: 'C:/evidence/V01-plan.json',
      applyResultPath: 'C:/evidence/V01-apply.json',
      specPath: 'C:/evidence/V01-spec.json',
      artifactRoot: 'C:/evidence/V01-artifacts',
      allowProjectScripts: true,
      allowBrowser: true,
    });
    expect(args).toEqual([
      'integrate', 'verify',
      '--project', 'C:\\acceptance\\V01',
      '--plan', 'C:\\evidence\\V01-plan.json',
      '--apply-result', 'C:\\evidence\\V01-apply.json',
      '--spec', 'C:\\evidence\\V01-spec.json',
      '--out', 'C:\\evidence\\V01-artifacts',
      '--allow-project-scripts', 'true',
      '--allow-browser', 'true',
    ]);
  });

  it('rejects a workspace path that escapes the scenario project before building CLI arguments', async () => {
    const loaded = await import('./executor.js').catch(() => null);
    expect(loaded && typeof loaded.verifyArgsFor).toBe('function');
    expect(() => loaded!.verifyArgsFor({
      projectRoot: 'C:/acceptance/V01', workspace: '../outside',
      planPath: 'C:/evidence/plan.json', applyResultPath: 'C:/evidence/apply.json',
      specPath: 'C:/evidence/spec.json', artifactRoot: 'C:/evidence/artifacts',
      allowProjectScripts: true, allowBrowser: true,
    })).toThrow(/workspace/i);
  });

  it('keeps the fixed positive and refusal denominators before executing any case', async () => {
    const loaded = await import('./executor.js').catch(() => null);
    expect(loaded && typeof loaded.validateScenarioManifest).toBe('function');
    expect(() => loaded!.validateScenarioManifest()).not.toThrow();
    expect(() => loaded!.validateScenarioManifest(T17_POSITIVE_SCENARIOS.slice(0, 19), T17_REFUSAL_SCENARIOS)).toThrow(/20|denominator|分母/i);
  });

  it('rejects a scenario whose declared host differs from the requested host', async () => {
    const loaded = await import('./executor.js').catch(() => null);
    expect(loaded && typeof loaded.assertScenarioHost).toBe('function');
    expect(() => loaded!.assertScenarioHost(T17_POSITIVE_SCENARIOS[0]!, 'next-app-router')).toThrow(/宿主|host/i);
  });

  it('builds repair argv using the repair command and bounded attempt flag', async () => {
    const loaded = await import('./executor.js').catch(() => null);
    expect(loaded && typeof loaded.repairArgsFor).toBe('function');
    expect(loaded!.repairArgsFor({
      projectRoot: 'C:/acceptance/V01', workspace: 'packages/demo',
      planPath: 'C:/evidence/plan.json', applyResultPath: 'C:/evidence/apply.json',
      specPath: 'C:/evidence/spec.json', artifactRoot: 'C:/evidence/artifacts',
      reportPath: 'C:/evidence/report.json', allowProjectScripts: true, allowBrowser: false, maxAttempts: 2,
    })).toEqual([
      'integrate', 'repair', '--project', 'C:\\acceptance\\V01',
      '--plan', 'C:\\evidence\\plan.json', '--apply-result', 'C:\\evidence\\apply.json',
      '--spec', 'C:\\evidence\\spec.json', '--out', 'C:\\evidence\\artifacts',
      '--allow-project-scripts', 'true', '--allow-browser', 'false',
      '--report', 'C:\\evidence\\report.json', '--max-attempts', '2',
    ]);
    expect(() => loaded!.repairArgsFor({
      projectRoot: 'C:/acceptance/V01', workspace: '.', planPath: 'C:/evidence/plan.json',
      applyResultPath: 'C:/evidence/apply.json', specPath: 'C:/evidence/spec.json',
      artifactRoot: 'C:/evidence/artifacts', reportPath: 'C:/evidence/report.json',
      allowProjectScripts: true, allowBrowser: false, maxAttempts: 3 as never,
    })).toThrow(/maxAttempts/);
  });

  it('passes workspace through plan and apply CLI arguments', async () => {
    const loaded = await import('./executor.js').catch(() => null);
    expect(loaded && typeof loaded.planArgsFor).toBe('function');
    expect(loaded && typeof loaded.applyArgsFor).toBe('function');
    const planArgs = loaded!.planArgsFor({ projectRoot: 'C:/project', workspace: 'packages/demo', matchPath: 'C:/evidence/match.json', apiUrl: 'http://127.0.0.1:4100', registryUrl: 'http://127.0.0.1:4873' });
    const applyArgs = loaded!.applyArgsFor({ projectRoot: 'C:/project', workspace: 'packages/demo', planPath: 'C:/evidence/plan.json', apiUrl: 'http://127.0.0.1:4100', registryUrl: 'http://127.0.0.1:4873', backupRoot: 'C:/evidence/backups', allowInstall: false });
    expect(planArgs.slice(planArgs.indexOf('--workspace'), planArgs.indexOf('--workspace') + 2)).toEqual(['--workspace', 'packages/demo']);
    expect(applyArgs.slice(applyArgs.indexOf('--workspace'), applyArgs.indexOf('--workspace') + 2)).toEqual(['--workspace', 'packages/demo']);
  });

  it('binds verify workspace to the CLI plan instead of adding an unsupported verify flag', async () => {
    const loaded = await import('./executor.js').catch(() => null);
    const scenario = T17_POSITIVE_SCENARIOS.find((item) => item.topology === 'workspace')!;
    const { cli, projectRoot, artifactRoot, planPath } = await makeFrozenCli(scenario.workspace);
    const result = await loaded!.runFrozenVerify({
      scenario, actualHost: scenario.host, cli, expectedVersion: cli.version, expectedTarballSha256: cli.tarballSha256,
      projectRoot, workspace: scenario.workspace, planPath, applyResultPath: 'C:/evidence/apply.json',
      specPath: 'C:/evidence/spec.json', artifactRoot, tokens: {},
      host: { async writeEvidence(name, bytes) { return { path: name, sha256: sha(bytes), bytes: bytes.length }; } },
    });
    expect(result.args).not.toContain('--workspace');
  });

  it('rejects a verify plan whose workspace differs from the matrix scenario before process launch', async () => {
    const loaded = await import('./executor.js').catch(() => null);
    const { cli, projectRoot, artifactRoot, planPath } = await makeFrozenCli('packages/other');
    await expect(loaded!.runFrozenVerify({
      scenario: T17_POSITIVE_SCENARIOS[0]!, actualHost: 'vite', cli, expectedVersion: cli.version, expectedTarballSha256: cli.tarballSha256,
      projectRoot, workspace: '.', planPath, applyResultPath: 'C:/evidence/apply.json',
      specPath: 'C:/evidence/spec.json', artifactRoot, tokens: {},
      host: { async writeEvidence() { throw new Error('must not launch/store'); } },
    })).rejects.toThrow(/workspace/);
  });

  it('rejects a frozen CLI package name mismatch before running its entry point', async () => {
    const loaded = await import('./executor.js').catch(() => null);
    expect(loaded && typeof loaded.runFrozenVerify).toBe('function');
    const { cli, projectRoot, artifactRoot, planPath } = await makeFrozenCli();
    await writeFile(join(cli.packageRoot, 'package.json'), JSON.stringify({ name: '@company/other-cli', version: cli.version, bin: { component: './dist/bin.js' } }));
    await expect(loaded!.runFrozenVerify({
      scenario: T17_POSITIVE_SCENARIOS[0]!, actualHost: 'vite', cli, expectedVersion: cli.version, expectedTarballSha256: cli.tarballSha256,
      projectRoot, workspace: '.', planPath, applyResultPath: 'C:/evidence/apply.json',
      specPath: 'C:/evidence/spec.json', artifactRoot, tokens: {},
      host: { async writeEvidence() { throw new Error('must not run'); } },
    })).rejects.toThrow(/package name/i);
  });

  it('rejects an installed CLI entry whose bytes differ from package/dist/bin.js in the frozen tarball', async () => {
    const loaded = await import('./executor.js');
    const { cli } = await makeFrozenCli();
    await writeFile(cli.binPath, Buffer.from('tampered entry'));
    await expect(loaded.assertFrozenCliEntry(cli, cli.version, cli.tarballSha256)).rejects.toThrow(/tarball|入口|摘要/);
  });

  it('invokes the frozen CLI as a controlled subprocess and persists its report bytes', async () => {
    const loaded = await import('./executor.js').catch(() => null);
    expect(loaded && typeof loaded.runFrozenVerify).toBe('function');
    const { cli, projectRoot, artifactRoot, planPath } = await makeFrozenCli();
    const evidence = new Map<string, Buffer>();
    const result = await loaded!.runFrozenVerify({
      scenario: T17_POSITIVE_SCENARIOS[0]!, actualHost: 'vite', cli, expectedVersion: cli.version, expectedTarballSha256: cli.tarballSha256,
      projectRoot, workspace: '.', planPath, applyResultPath: 'C:/evidence/apply.json',
      specPath: 'C:/evidence/spec.json', artifactRoot, tokens: { apiToken: 'secret-api', registryToken: 'secret-registry' },
      host: { async writeEvidence(name, bytes) { evidence.set(name, Buffer.from(bytes)); return { path: 'C:/evidence/files/' + name, sha256: sha(bytes), bytes: bytes.length }; } },
    });
    expect(result.exitCode).toBe(0);
    expect(result.reportPath).toBe('V01-verify-report.json');
    expect(evidence.get(result.reportPath)?.toString('utf8')).toContain('"operation":"verify"');
    expect(evidence.get(result.reportPath)?.toString('utf8')).not.toContain('secret-api');
    expect(evidence.get(result.reportPath)?.toString('utf8')).not.toContain('secret-registry');
  });

  it('checks tarball bytes and rejects stdout that is not a verification report without storing it', async () => {
    const loaded = await import('./executor.js').catch(() => null);
    expect(loaded && typeof loaded.runFrozenVerify).toBe('function');
    const { cli, projectRoot, artifactRoot, planPath } = await makeFrozenCli();
    await writeFile(cli.tarballPath, 'changed bytes');
    const evidence: string[] = [];
    await expect(loaded!.runFrozenVerify({
      scenario: T17_POSITIVE_SCENARIOS[0]!, actualHost: 'vite', cli, expectedVersion: cli.version, expectedTarballSha256: cli.tarballSha256,
      projectRoot, workspace: '.', planPath, applyResultPath: 'C:/evidence/apply.json',
      specPath: 'C:/evidence/spec.json', artifactRoot, tokens: {},
      host: { async writeEvidence(name) { evidence.push(name); return { path: name, sha256: 'a'.repeat(64), bytes: 1 }; } },
    })).rejects.toThrow(/摘要/);
    expect(evidence).toEqual([]);
  });

  it('rejects non-JSON stdout without storing the subprocess text', async () => {
    const loaded = await import('./executor.js').catch(() => null);
    expect(loaded && typeof loaded.runFrozenVerify).toBe('function');
    const { cli, projectRoot, artifactRoot, planPath } = await makeFrozenCli();
    await updateFrozenBinEntry(cli, Buffer.from("process.stdout.write('SECRET diagnostic output');"));
    const evidence: string[] = [];
    let failure = '';
    try {
      await loaded!.runFrozenVerify({
        scenario: T17_POSITIVE_SCENARIOS[0]!, actualHost: 'vite', cli, expectedVersion: cli.version, expectedTarballSha256: cli.tarballSha256,
        projectRoot, workspace: '.', planPath, applyResultPath: 'C:/evidence/apply.json',
        specPath: 'C:/evidence/spec.json', artifactRoot, tokens: {},
        host: { async writeEvidence(name) { evidence.push(name); return { path: name, sha256: 'a'.repeat(64), bytes: 1 }; } },
      });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    expect(failure).toMatch(/JSON|报告/);
    expect(failure).not.toContain('SECRET');
    expect(evidence).toEqual([]);
  });

  it('redacts token diagnostics from subprocess output', async () => {
    const loaded = await import('./executor.js').catch(() => null);
    expect(loaded && typeof loaded.runFrozenVerify).toBe('function');
    const { cli, projectRoot, artifactRoot, planPath } = await makeFrozenCli();
    await updateFrozenBinEntry(cli, Buffer.from(`process.stderr.write('diagnostic secret-api secret-registry'); process.stdout.write(JSON.stringify(${JSON.stringify(validReport)})+String.fromCharCode(10));`));
    const result = await loaded!.runFrozenVerify({
      scenario: T17_POSITIVE_SCENARIOS[0]!, actualHost: 'vite', cli, expectedVersion: cli.version, expectedTarballSha256: cli.tarballSha256,
      projectRoot, workspace: '.', planPath, applyResultPath: 'C:/evidence/apply.json',
      specPath: 'C:/evidence/spec.json', artifactRoot, tokens: { apiToken: 'secret-api', registryToken: 'secret-registry' },
      host: { async writeEvidence(name, bytes) { return { path: name, sha256: sha(bytes), bytes: bytes.length }; } },
    });
    expect(result.stderr).not.toContain('secret-api');
    expect(result.stderr).not.toContain('secret-registry');
    expect(result.stderr).toContain('[REDACTED]');
  });

  it('does not inherit unrelated parent environment secrets into the CLI process', async () => {
    const loaded = await import('./executor.js').catch(() => null);
    expect(loaded && typeof loaded.runFrozenVerify).toBe('function');
    const { cli, projectRoot, artifactRoot, planPath } = await makeFrozenCli();
    const reportOutput = JSON.stringify(validReport) + String.fromCharCode(10);
    await updateFrozenBinEntry(cli, Buffer.from("process.stderr.write(process.env.T17_EXECUTOR_TEST_SECRET ?? 'absent'); process.stdout.write(" + JSON.stringify(reportOutput) + ");"));
    const previous = process.env.T17_EXECUTOR_TEST_SECRET;
    process.env.T17_EXECUTOR_TEST_SECRET = 'parent-env-secret';
    try {
      const result = await loaded!.runFrozenVerify({
        scenario: T17_POSITIVE_SCENARIOS[0]!, actualHost: 'vite', cli, expectedVersion: cli.version, expectedTarballSha256: cli.tarballSha256,
        projectRoot, workspace: '.', planPath, applyResultPath: 'C:/evidence/apply.json',
        specPath: 'C:/evidence/spec.json', artifactRoot, tokens: {},
        host: { async writeEvidence(name, bytes) { return { path: name, sha256: sha(bytes), bytes: bytes.length }; } },
      });
      expect(result.stderr).toContain('absent');
      expect(result.stderr).not.toContain('parent-env-secret');
    } finally {
      if (previous === undefined) delete process.env.T17_EXECUTOR_TEST_SECRET;
      else process.env.T17_EXECUTOR_TEST_SECRET = previous;
    }
  });

  it('derives a stable scenario identity from case and frozen artifact identities', async () => {
    const loaded = await import('./executor.js').catch(() => null);
    expect(loaded && typeof loaded.stableScenarioIdentity).toBe('function');
    const input = { scenario: T17_POSITIVE_SCENARIOS[0]!, cliVersion: '1.2.3', cliTarballSha256: 'a'.repeat(64), frozenBundleSha256: 'b'.repeat(64) };
    expect(loaded!.stableScenarioIdentity(input)).toEqual(loaded!.stableScenarioIdentity(input));
    expect(loaded!.stableScenarioIdentity(input).sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(loaded!.stableScenarioIdentity({ ...input, cliTarballSha256: 'c'.repeat(64) }).sha256).not.toBe(loaded!.stableScenarioIdentity(input).sha256);
  });
});
