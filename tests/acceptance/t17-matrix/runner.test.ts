import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { frozenCliIdentityFromInstall, sealT17MatrixRun, type FrozenCliIdentity, type T17ReceiptHost, type T17ScenarioExecutor } from './runner.js';
import type { T17CellReceipt, T17RefusalReceipt } from './score.js';

const roots: string[] = [];
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
};

async function makeHost(): Promise<{ host: T17ReceiptHost; root: string; payloads: Record<string, unknown>[]; stopped: () => boolean }> {
  const evidenceRoot = await mkdtemp(join(tmpdir(), 't17-runner-'));
  roots.push(evidenceRoot);
  await mkdir(join(evidenceRoot, 'files'));
  const entries: { name: string; sha256: string; bytes: number }[] = [];
  const payloads: Record<string, unknown>[] = [];
  let isStopped = false;
  const host: T17ReceiptHost = {
    evidenceRoot,
    runId: 'test-run',
    async writeEvidence(name, bytes) {
      const path = join(evidenceRoot, 'files', name);
      await writeFile(path, bytes, { flag: 'wx' });
      const entry = { name, sha256: sha(bytes), bytes: bytes.length };
      entries.push(entry);
      return { path, sha256: entry.sha256, bytes: entry.bytes };
    },
    async stopOwnedProcesses() { isStopped = true; },
    async sealEvidence(payload) {
      expect(isStopped).toBe(true);
      payloads.push(payload);
      await writeFile(join(evidenceRoot, 'run-seal.json'), JSON.stringify({
        schemaVersion: 1,
        runId: 'test-run',
        parentRoot: join(evidenceRoot, 'projects'),
        evidenceRoot,
        payload,
        projects: {},
        files: entries,
      }), { flag: 'wx' });
      return join(evidenceRoot, 'run-seal.json');
    },
  };
  return { host, root: evidenceRoot, payloads, stopped: () => isStopped };
}

async function makeFrozenCli(root: string, version = '0.0.15'): Promise<FrozenCliIdentity> {
  const tarballPath = join(root, 'component-cli.tgz');
  const tarballBytes = Buffer.from('frozen CLI tarball bytes');
  await writeFile(tarballPath, tarballBytes, { flag: 'wx' });
  const installRoot = join(root, 'consumer');
  const packageRoot = join(installRoot, 'node_modules', '@company', 'component-cli');
  const dist = join(packageRoot, 'dist');
  await mkdir(dist, { recursive: true });
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: '@company/component-cli', version, bin: { component: './dist/bin.js' } }), { flag: 'wx' });
  const binPath = join(dist, 'bin.js');
  await writeFile(binPath, 'process.exit(0);', { flag: 'wx' });
  return { version, tarballSha256: sha(tarballBytes), tarballPath, installRoot, packageRoot, binPath };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('T17 receipt seal runner', () => {
  it('maps the owned-host install result into the frozen CLI identity', async () => {
    const run = await makeHost();
    const frozenCli = await makeFrozenCli(run.root);
    const identity = frozenCliIdentityFromInstall({
      root: frozenCli.installRoot,
      entry: frozenCli.binPath,
      version: frozenCli.version,
      tarballSha256: frozenCli.tarballSha256,
    }, frozenCli.tarballPath);
    expect(identity).toEqual(frozenCli);
  });

  it('writes canonical receipt evidence and seals the host receipt index with frozen identities', async () => {
    const run = await makeHost();
    const frozenCli = await makeFrozenCli(run.root);
    const calls: string[] = [];
    const executorIdentities: { cliTarballSha256: string; frozenBundleSha256: string }[] = [];
    const refusal = (caseId: string): T17RefusalReceipt => ({
      caseId, receiptEvidencePath: caseId + '-receipt.json', expectedOutcome: 'refuse', actualOutcome: 'refused',
      beforeProjectSha256: '5'.repeat(64), afterProjectSha256: '5'.repeat(64),
      reportPath: caseId + '-report.json', reportSha256: '6'.repeat(64), outOfScopeWrites: 0,
    });
    const executor: T17ScenarioExecutor = {
      async positive(scenario, identity) {
        calls.push(scenario.caseId);
        executorIdentities.push({ cliTarballSha256: identity.cliTarballSha256, frozenBundleSha256: identity.frozenBundleSha256 });
        return { caseId: scenario.caseId, expectedOutcome: 'pass', actualOutcome: 'blocked', sourceKind: 'temporary-host' } as T17CellReceipt;
      },
      async refusal(scenario, identity) {
        calls.push(scenario.caseId);
        executorIdentities.push({ cliTarballSha256: identity.cliTarballSha256, frozenBundleSha256: identity.frozenBundleSha256 });
        return refusal(scenario.caseId);
      },
    };

    const result = await sealT17MatrixRun({
      host: run.host,
      frozenCli,
      expectedCliVersion: '0.0.15',
      expectedCliTarballSha256: frozenCli.tarballSha256,
      frozenBundleSha256: 'b'.repeat(64),
      executor,
    });

    expect(run.stopped()).toBe(true);
    expect(result.sealPath).toBe(join(run.root, 'run-seal.json'));
    expect(run.payloads).toHaveLength(1);
    const sealedPayload = run.payloads[0]!;
    expect(sealedPayload).toMatchObject({
      cliTarballSha256: frozenCli.tarballSha256,
      frozenBundleSha256: 'b'.repeat(64),
      sourceKind: 'temporary/synthetic',
    });
    const references = sealedPayload.receipts as { caseId: string; kind: string; evidencePath: string }[];
    expect(references).toHaveLength(33);
    expect(references).toContainEqual({ caseId: 'V01', kind: 'positive', evidencePath: 'V01-receipt.json' });
    expect(references).toContainEqual({ caseId: 'N01', kind: 'refusal', evidencePath: 'N01-receipt.json' });
    const bytes = await readFile(join(run.root, 'files', 'N01-receipt.json'));
    expect(bytes.toString()).toBe(canonical({ ...refusal('N01'), receiptEvidencePath: 'N01-receipt.json' }));
    expect(sha(bytes)).toBe(result.receiptEvidence.find((item) => item.name === 'N01-receipt.json')?.sha256);
    expect(calls).toContain('V01');
    expect(calls).toContain('R10');
    expect(executorIdentities).toHaveLength(33);
    expect(executorIdentities.every((item) => item.cliTarballSha256 === frozenCli.tarballSha256 && item.frozenBundleSha256 === 'b'.repeat(64))).toBe(true);
    expect(await readdir(join(run.root, 'files'))).toContain('N01-receipt.json');
    expect(result.matrix.matrixAccepted).toBe(false);
    expect(result.matrix.errors.length).toBeGreaterThan(0);
  });

  it('records executor failures as nonpassing evidence and keeps the denominator fixed', async () => {
    const run = await makeHost();
    const frozenCli = await makeFrozenCli(run.root);
    const executor: T17ScenarioExecutor = {
      async positive() { throw new Error('scenario unavailable'); },
      async refusal() { throw new Error('scenario unavailable'); },
    };
    const result = await sealT17MatrixRun({
      host: run.host,
      frozenCli,
      expectedCliVersion: '0.0.15',
      expectedCliTarballSha256: frozenCli.tarballSha256,
      frozenBundleSha256: 'b'.repeat(64),
      executor,
    });
    expect(run.stopped()).toBe(true);
    expect(result.matrix.positive.total).toBe(20);
    expect(result.matrix.positive.passed).toBe(0);
    expect(result.matrix.refusals.total).toBeGreaterThan(0);
    expect(result.executionErrors.length).toBe(20 + result.matrix.refusals.total);
    expect(run.payloads[0]).toMatchObject({ sourceKind: 'temporary/synthetic' });
    expect(run.payloads[0]?.receipts).toEqual([]);
  });

  it('rejects a CLI version or tarball digest that differs from the requested frozen identity before execution', async () => {
    const run = await makeHost();
    const frozenCli = await makeFrozenCli(run.root, '0.0.14');
    let called = false;
    const executor: T17ScenarioExecutor = {
      async positive() { called = true; throw new Error('must not run'); },
      async refusal() { called = true; throw new Error('must not run'); },
    };
    await expect(sealT17MatrixRun({
      host: run.host,
      frozenCli,
      expectedCliVersion: '0.0.15',
      expectedCliTarballSha256: frozenCli.tarballSha256,
      frozenBundleSha256: 'b'.repeat(64),
      executor,
    })).rejects.toThrow(/identity/i);
    expect(called).toBe(false);
    expect(run.payloads).toEqual([]);
  });

  it('refuses to seal if the frozen CLI tarball changes while scenarios are running', async () => {
    const run = await makeHost();
    const frozenCli = await makeFrozenCli(run.root);
    let changed = false;
    const executor: T17ScenarioExecutor = {
      async positive(scenario) {
        if (!changed) {
          changed = true;
          await writeFile(frozenCli.tarballPath, 'replaced tarball bytes');
        }
        throw new Error('synthetic scenario failure');
      },
      async refusal() { throw new Error('synthetic scenario failure'); },
    };

    await expect(sealT17MatrixRun({
      host: run.host,
      frozenCli,
      expectedCliVersion: '0.0.15',
      expectedCliTarballSha256: frozenCli.tarballSha256,
      frozenBundleSha256: 'b'.repeat(64),
      executor,
    })).rejects.toThrow(/digest/i);
    expect(run.stopped()).toBe(true);
    expect(run.payloads).toEqual([]);
    expect(await readdir(join(run.root, 'files'))).toContain('V01-runner-error.txt');
  });
});
