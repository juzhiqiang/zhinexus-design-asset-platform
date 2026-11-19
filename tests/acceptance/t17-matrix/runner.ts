import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { T17_POSITIVE_SCENARIOS, T17_REFUSAL_SCENARIOS, type T17PositiveScenario, type T17RefusalScenario } from '../../fixtures/t17-matrix/scenarios.js';
import { assertFrozenCliEntry } from './executor.js';
import { evaluateT17Matrix, loadT17MatrixInput, type T17CellReceipt, type T17RefusalReceipt, type T17MatrixResult } from './score.js';

type EvidenceRef = { path: string; name: string; sha256: string; bytes: number };
export type T17ReceiptHost = {
  runId: string;
  evidenceRoot: string;
  writeEvidence(name: string, bytes: Uint8Array): Promise<Omit<EvidenceRef, 'name'>>;
  stopOwnedProcesses(): Promise<void>;
  sealEvidence(payload: Record<string, unknown>): Promise<string>;
};
export type FrozenCliIdentity = {
  version: string;
  tarballSha256: string;
  tarballPath: string;
  installRoot: string;
  packageRoot: string;
  binPath: string;
};
export type T17ScenarioExecutor = {
  positive(scenario: T17PositiveScenario, identity: { cli: FrozenCliIdentity; cliTarballSha256: string; frozenBundleSha256: string }): Promise<T17CellReceipt>;
  refusal(scenario: T17RefusalScenario, identity: { cli: FrozenCliIdentity; cliTarballSha256: string; frozenBundleSha256: string }): Promise<T17RefusalReceipt>;
};
export type T17MatrixRunResult = {
  sealPath: string;
  receiptEvidence: EvidenceRef[];
  matrix: T17MatrixResult;
  executionErrors: { caseId: string; message: string; evidencePath: string }[];
};

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(record[key])).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}
function assertSha(value: string, label: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(label + ' must be a lowercase SHA-256 digest.');
}
export function frozenCliIdentityFromInstall(installation: { version: string; tarballSha256: string; root: string; entry: string }, tarballPath: string): FrozenCliIdentity {
  const installRoot = resolve(installation.root);
  const packageRoot = resolve(installRoot, 'node_modules', '@company', 'component-cli');
  return { version: installation.version, tarballSha256: installation.tarballSha256, tarballPath: resolve(tarballPath), installRoot, packageRoot, binPath: resolve(installation.entry) };
}
function within(root: string, target: string) {
  const rel = relative(root, target);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep));
}
async function assertFrozenCli(options: { frozenCli: FrozenCliIdentity; expectedVersion: string; expectedSha256: string }) {
  const tarballPath = resolve(options.frozenCli.tarballPath);
  const tarballStat = await lstat(tarballPath);
  if (!tarballStat.isFile() || tarballStat.isSymbolicLink() || tarballStat.nlink > 1 || await realpath(tarballPath) !== tarballPath) throw new Error('Frozen CLI tarball path must be an ordinary file.');
  if (sha256(await readFile(tarballPath)) !== options.expectedSha256 || options.frozenCli.tarballSha256 !== options.expectedSha256) throw new Error('Frozen CLI tarball digest does not match the expected identity.');
  const installRoot = await realpath(resolve(options.frozenCli.installRoot));
  const packageRoot = await realpath(resolve(options.frozenCli.packageRoot));
  const binPath = await realpath(resolve(options.frozenCli.binPath));
  if (installRoot !== resolve(options.frozenCli.installRoot) || packageRoot !== resolve(options.frozenCli.packageRoot) || binPath !== resolve(options.frozenCli.binPath)) throw new Error('Installed CLI paths cannot contain symbolic links or aliases.');
  if (!within(installRoot, packageRoot) || !within(packageRoot, binPath) || basename(binPath) !== 'bin.js') throw new Error('Installed CLI entry must be contained by its package and install roots.');
  for (const path of [installRoot, packageRoot, binPath]) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || (path === binPath ? !stat.isFile() : !stat.isDirectory())) throw new Error('Installed CLI identity contains an unsafe path.');
  }
  const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8')) as { name?: string; version?: string; bin?: string | Record<string, string> };
  if (manifest.name !== '@company/component-cli' || manifest.version !== options.expectedVersion || options.frozenCli.version !== options.expectedVersion) throw new Error('Installed CLI package name or version differs from the frozen identity.');
  const declaredBin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.component;
  if (declaredBin !== './dist/bin.js') throw new Error('Installed CLI package does not declare the expected component entry.');
  if (!within(packageRoot, resolve(packageRoot, 'dist', 'bin.js')) || resolve(packageRoot, 'dist', 'bin.js') !== binPath) throw new Error('Installed CLI bin does not match the package entry.');
  await assertFrozenCliEntry(options.frozenCli, options.expectedVersion, options.expectedSha256);
}

export async function sealT17MatrixRun(options: {
  host: T17ReceiptHost;
  frozenCli: FrozenCliIdentity;
  expectedCliVersion: string;
  expectedCliTarballSha256: string;
  frozenBundleSha256: string;
  executor: T17ScenarioExecutor;
}): Promise<T17MatrixRunResult> {
  const { host } = options;
  assertSha(options.expectedCliTarballSha256, 'Expected CLI tarball identity');
  assertSha(options.frozenBundleSha256, 'Frozen SDK bundle identity');
  await assertFrozenCli({ frozenCli: options.frozenCli, expectedVersion: options.expectedCliVersion, expectedSha256: options.expectedCliTarballSha256 });

  const identity = { cli: options.frozenCli, cliTarballSha256: options.expectedCliTarballSha256, frozenBundleSha256: options.frozenBundleSha256 };
  const receiptEvidence: EvidenceRef[] = [];
  const executionErrors: T17MatrixRunResult['executionErrors'] = [];
  const positiveReceipts: T17CellReceipt[] = [];
  const refusalReceipts: T17RefusalReceipt[] = [];
  const seen = new Set<string>();

  const saveReceipt = async (kind: 'positive' | 'refusal', expectedCaseId: string, receipt: T17CellReceipt | T17RefusalReceipt) => {
    if (receipt.caseId !== expectedCaseId) throw new Error('Executor returned a receipt for a different caseId: ' + expectedCaseId);
    if (kind === 'positive' && receipt.expectedOutcome !== 'pass' || kind === 'refusal' && receipt.expectedOutcome !== 'refuse') throw new Error('Executor returned a receipt with the wrong scenario kind: ' + expectedCaseId);
    if (kind === 'positive' && (receipt as T17CellReceipt).sourceKind !== 'temporary-host') throw new Error('Synthetic matrix cells must be labeled temporary-host: ' + expectedCaseId);
    if (!receipt.caseId || seen.has(receipt.caseId)) throw new Error('Duplicate matrix receipt caseId: ' + receipt.caseId);
    seen.add(receipt.caseId);
    const evidencePath = receipt.caseId + '-receipt.json';
    const value = { ...receipt, receiptEvidencePath: evidencePath };
    const bytes = Buffer.from(canonicalJson(value));
    const stored = await host.writeEvidence(evidencePath, bytes);
    if (stored.sha256 !== sha256(bytes) || stored.bytes !== bytes.length || basename(stored.path) !== evidencePath) {
      throw new Error('Host returned a mismatched receipt evidence reference: ' + receipt.caseId);
    }
    receiptEvidence.push({ name: evidencePath, ...stored });
    if (kind === 'positive') positiveReceipts.push(value as T17CellReceipt);
    else refusalReceipts.push(value as T17RefusalReceipt);
  };

  const execute = async (kind: 'positive' | 'refusal', caseId: string, action: () => Promise<T17CellReceipt | T17RefusalReceipt>) => {
    try {
      await saveReceipt(kind, caseId, await action());
    } catch (error) {
      const errorName = error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name) ? error.name : 'Error';
      const message = 'Scenario execution failed (' + errorName + '). Raw diagnostics are intentionally omitted.';
      const evidencePath = caseId + '-runner-error.txt';
      const bytes = Buffer.from(message, 'utf8');
      const stored = await host.writeEvidence(evidencePath, bytes);
      executionErrors.push({ caseId, message, evidencePath: basename(stored.path) });
    }
  };

  for (const scenario of T17_POSITIVE_SCENARIOS) {
    await execute('positive', scenario.caseId, () => options.executor.positive(scenario, identity));
  }
  for (const scenario of T17_REFUSAL_SCENARIOS) {
    await execute('refusal', scenario.caseId, () => options.executor.refusal(scenario, identity));
  }

  await host.stopOwnedProcesses();
  await assertFrozenCli({ frozenCli: options.frozenCli, expectedVersion: options.expectedCliVersion, expectedSha256: options.expectedCliTarballSha256 });
  const payload = {
    schemaVersion: 1,
    runId: host.runId,
    sourceKind: 'temporary/synthetic',
    cliVersion: options.frozenCli.version,
    cliTarballSha256: options.expectedCliTarballSha256,
    frozenBundleSha256: options.frozenBundleSha256,
    receipts: receiptEvidence.map((receipt) => ({
      caseId: basename(receipt.name).replace(/-receipt\.json$/, ''),
      kind: positiveReceipts.some((item) => item.receiptEvidencePath === receipt.name) ? 'positive' : 'refusal',
      evidencePath: receipt.name,
    })),
    executionErrors,
  };
  const sealPath = await host.sealEvidence(payload);
  const matrixInput = await loadT17MatrixInput(host.evidenceRoot, options.expectedCliTarballSha256, options.frozenBundleSha256);
  const matrix = evaluateT17Matrix(matrixInput);
  return { sealPath, receiptEvidence, matrix, executionErrors };
}
