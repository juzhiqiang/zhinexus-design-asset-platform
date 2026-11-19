import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { createOwnedRun, type OwnedRun } from './host.js';
import { scaffoldConsumerProject } from './consumer.js';
import { installDependencies, type FixedToolchain, type FrozenCliInstallation } from './runtime.js';
import { installFrozenCli } from './host.js';

export type InspectFramework = 'vue' | 'react';
export type InspectAcceptance = { framework: InspectFramework; status: 'inspected'; packageManager: 'npm'; fileSnapshotCount: number; exitCode: 0; stdoutBytes: number; stderrBytes: number; stdoutSha256: string; stderrSha256: string; stdoutEvidence: string; stderrEvidence: string };
export type InspectRunnerInputs = { cliTarball: string; cliSha256: string; cliVersion: string; repositoryRoot: string; npmRegistry?: string; timeoutMs?: number };
export type InspectRunnerResult = { runId: string; evidenceRoot: string; result: 'passed'; receiptEvidencePath: string; sealPath: string; sealSha256: string; cli: FrozenCliInstallation & { tarballSha256: string; tarballBytes: number; manifestSha256: string }; inspections: InspectAcceptance[] };
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(object[key])).join(',') + '}';
};

export async function preserveFailedInspectEvidence(run: OwnedRun): Promise<{ evidenceRoot: string; projectCleanupFailed: boolean }> {
  await run.stopOwnedProcesses().catch(() => undefined);
  try {
    await run.abortForTest({ preserveEvidence: true });
    return { evidenceRoot: run.evidenceRoot, projectCleanupFailed: false };
  } catch {
    return { evidenceRoot: run.evidenceRoot, projectCleanupFailed: true };
  }
}

export function parseInspectReport(stdout: string, framework: InspectFramework): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(stdout); } catch { throw new Error('Frozen CLI inspect stdout is not valid JSON.'); }
  if (!record(value) || value.schemaVersion !== 1 || value.status !== 'inspected') throw new Error('Frozen CLI inspect report must be a successful schemaVersion 1 inspected result.');
  if (value.framework !== framework) throw new Error('Frozen CLI inspect report framework does not match the owned consumer project.');
  if (!Array.isArray(value.conflicts)) throw new Error('Frozen CLI inspect report must contain a conflicts array.');
  if (value.conflicts.length !== 0) throw new Error('Frozen CLI inspect report contains conflicts.');
  if (!Array.isArray(value.fileSnapshots) || value.fileSnapshots.length === 0) throw new Error('Frozen CLI inspect report must contain non-empty fileSnapshots.');
  if (value.packageManager !== 'npm') throw new Error('Frozen CLI inspect report did not detect the expected npm package manager.');
  if (!record(value.lockfile) || value.lockfile.path !== 'package-lock.json' || value.lockfile.format !== 'npm-v3') throw new Error('Frozen CLI inspect report did not detect the npm lockfile.');
  const snapshots: { path: string; exists: true; sha256: string }[] = [];
  const paths = new Set<string>();
  for (const item of value.fileSnapshots) {
    if (!record(item) || typeof item.path !== 'string' || !item.path || item.path.length > 4096 || item.exists !== true ||
        typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256) ||
        item.path.startsWith('/') || /^[A-Za-z]:/.test(item.path) || item.path.includes('\\') ||
        /[<>:"|?*\u0000-\u001f\u007f]/.test(item.path) || item.path.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('Frozen CLI inspect report contains an invalid file snapshot.');
    }
    const key = item.path.normalize('NFC').toLowerCase();
    if (paths.has(key)) throw new Error('Frozen CLI inspect report contains duplicate file snapshots.');
    paths.add(key);
    snapshots.push(item as { path: string; exists: true; sha256: string });
  }
  for (const required of ['package.json', 'package-lock.json']) {
    if (!snapshots.some(snapshot => snapshot.path === required)) throw new Error('Frozen CLI inspect report is missing required manifest or lock snapshots.');
  }
  return value;
}

/** Re-open the caller-facing receipt after project cleanup and bind its retained evidence to the seal. */
export async function verifyInspectReceiptEvidence(receipt: InspectRunnerResult): Promise<void> {
  const evidenceRoot = resolve(receipt.evidenceRoot);
  const rootStat = await lstat(evidenceRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || await realpath(evidenceRoot) !== evidenceRoot) throw new Error('Inspect receipt evidence root is not a retained real directory.');
  const sealPath = resolve(receipt.sealPath), sealRelative = relative(evidenceRoot, sealPath);
  if (!isAbsolute(sealPath) || sealRelative !== 'run-seal.json') throw new Error('Inspect receipt seal escapes its retained evidence root.');
  const sealStat = await lstat(sealPath);
  if (!sealStat.isFile() || sealStat.isSymbolicLink() || sealStat.nlink > 1) throw new Error('Inspect receipt seal is not a retained ordinary file.');
  const sealBytes = await readFile(sealPath);
  if (sha(sealBytes) !== receipt.sealSha256) throw new Error('Inspect receipt seal digest does not match.');
  const seal = JSON.parse(sealBytes.toString('utf8')) as { schemaVersion?: unknown; runId?: unknown; evidenceRoot?: unknown; files?: unknown; payload?: unknown };
  if (seal.schemaVersion !== 1 || seal.runId !== receipt.runId || seal.evidenceRoot !== evidenceRoot || !Array.isArray(seal.files) || !record(seal.payload)) throw new Error('Inspect receipt seal identity or file inventory is invalid.');
  if (receipt.result !== 'passed' || canonicalJson(seal.payload) !== canonicalJson({ result: receipt.result, cli: receipt.cli, inspections: receipt.inspections, receiptEvidencePath: 'files/inspect-acceptance.json' })) {
    throw new Error('Inspect receipt claims differ from the sealed acceptance result.');
  }
  const expectedReceiptPath = resolve(evidenceRoot, 'files', 'inspect-acceptance.json');
  const receiptPath = resolve(receipt.receiptEvidencePath), receiptRelative = relative(evidenceRoot, receiptPath);
  if (receiptPath !== expectedReceiptPath || receiptRelative !== 'files' + sep + 'inspect-acceptance.json') throw new Error('Persisted inspect receipt escapes its retained evidence root.');
  const receiptStat = await lstat(receiptPath);
  if (!receiptStat.isFile() || receiptStat.isSymbolicLink() || receiptStat.nlink > 1) throw new Error('Persisted inspect receipt is not an ordinary retained file.');
  const persistedBytes = await readFile(receiptPath), persistedEntry = seal.files.find((entry: unknown) => record(entry) && entry.name === 'inspect-acceptance.json');
  if (!record(persistedEntry) || persistedEntry.bytes !== persistedBytes.length || persistedEntry.sha256 !== sha(persistedBytes)) throw new Error('Persisted inspect receipt differs from its retained seal.');
  let persisted: unknown;
  try { persisted = JSON.parse(persistedBytes.toString('utf8')); } catch { throw new Error('Persisted inspect receipt is not valid JSON.'); }
  if (!record(persisted) || persisted.schemaVersion !== 1 || persisted.runId !== receipt.runId || persisted.evidenceRoot !== evidenceRoot ||
      persisted.result !== receipt.result || persisted.receiptEvidencePath !== receipt.receiptEvidencePath || persisted.sealPath !== '' || persisted.sealSha256 !== '' ||
      canonicalJson(persisted.cli) !== canonicalJson(receipt.cli) || canonicalJson(persisted.inspections) !== canonicalJson(receipt.inspections)) {
    throw new Error('Caller-facing inspect receipt differs from its persisted evidence.');
  }
  if (receipt.inspections.length !== 2 || new Set(receipt.inspections.map(item => item.framework)).size !== 2 ||
      !receipt.inspections.some(item => item.framework === 'vue') || !receipt.inspections.some(item => item.framework === 'react')) {
    throw new Error('Inspect receipt must contain exactly one Vue and one React inspection.');
  }
  for (const inspection of receipt.inspections) {
    if (inspection.status !== 'inspected' || inspection.packageManager !== 'npm' || inspection.exitCode !== 0 || !Number.isInteger(inspection.fileSnapshotCount) || inspection.fileSnapshotCount < 2) {
      throw new Error('Inspect receipt metadata does not describe a successful npm inspection.');
    }
    for (const [field, path, expectedBytes, expectedDigest] of [
      ['stdout', inspection.stdoutEvidence, inspection.stdoutBytes, inspection.stdoutSha256],
      ['stderr', inspection.stderrEvidence, inspection.stderrBytes, inspection.stderrSha256],
    ] as const) {
      const evidencePath = resolve(path), rel = relative(evidenceRoot, evidencePath);
      if (!isAbsolute(evidencePath) || !rel.startsWith('files' + sep) || rel.split(sep).length !== 2) throw new Error('Inspect receipt ' + field + ' evidence escapes the retained files directory.');
      const stat = await lstat(evidencePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw new Error('Inspect receipt ' + field + ' evidence is not an ordinary retained file.');
      const bytes = await readFile(evidencePath), name = rel.slice(('files' + sep).length).replaceAll(sep, '/');
      const sealed = seal.files.find((entry: unknown) => record(entry) && entry.name === name);
      if (bytes.length !== expectedBytes || sha(bytes) !== expectedDigest || !record(sealed) || sealed.bytes !== bytes.length || sealed.sha256 !== expectedDigest) {
        throw new Error('Inspect receipt ' + field + ' evidence differs from its retained seal.');
      }
      if (field === 'stdout') {
        const report = parseInspectReport(bytes.toString('utf8'), inspection.framework);
        if (report.packageManager !== inspection.packageManager || (report.fileSnapshots as unknown[]).length !== inspection.fileSnapshotCount) {
          throw new Error('Inspect receipt metadata differs from the actual CLI report.');
        }
      }
    }
  }
}

function fixedToolchain(repositoryRoot: string): FixedToolchain {
  const root = resolve(repositoryRoot), nodeExecutable = resolve(root, '.tools/node-v26.13.0-win-x64/node.exe');
  return { nodeExecutable, npmCliPath: resolve(root, '.tools/node-v26.13.0-win-x64/node_modules/npm/bin/npm-cli.js'), pnpmWrapper: resolve(root, 'scripts/pnpm.ps1'), repositoryRoot: root };
}

async function registerConsumer(run: Awaited<ReturnType<typeof createOwnedRun>>, framework: InspectFramework) {
  const root = run.projectRoots[framework];
  const paths = ['package.json', '.t17-hook.cjs', 'index.html', 'tsconfig.json', 'src/vite-env.d.ts', 'src/components/zhinexus', '.t17-install', 'node_modules', 'package-lock.json'];
  const existing: string[] = [];
  for (const path of paths) if (await lstat(resolve(root, path)).then(() => true).catch(() => false)) existing.push(path);
  await run.registerOwnedPath(root, existing);
}

/** Installs a caller-frozen CLI tarball and invokes its installed bin against owned Vue and React npm projects. */
export async function runFrozenInspectAcceptance(inputs: InspectRunnerInputs): Promise<InspectRunnerResult> {
  if (process.platform !== 'win32') throw new Error('T17 frozen host acceptance requires Windows.');
  if (!/^[0-9a-f]{64}$/.test(inputs.cliSha256)) throw new Error('Frozen CLI SHA-256 must be a lowercase digest.');
  const repositoryRoot = resolve(inputs.repositoryRoot), toolchain = fixedToolchain(repositoryRoot);
  if (process.version !== 'v26.13.0' || resolve(process.execPath).toLowerCase() !== toolchain.nodeExecutable.toLowerCase()) throw new Error('T17 frozen host acceptance requires repository-local Node 26.13.0.');
  const npmVersion = execFileSync(toolchain.nodeExecutable, [toolchain.npmCliPath, '--version'], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true }).trim();
  if (npmVersion !== '11.20.0') throw new Error('T17 frozen host acceptance requires npm 11.20.0.');
  const tarball = resolve(inputs.cliTarball), stat = await lstat(tarball);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || sha(await readFile(tarball)) !== inputs.cliSha256) throw new Error('Frozen CLI tarball is missing, linked, or has a digest mismatch.');
  const run = await createOwnedRun({ baseDirectory: tmpdir() });
  let sealed = false;
  try {
    const installed = await installFrozenCli({ run, tarballPath: tarball, nodeExecutable: toolchain.nodeExecutable, npmCliPath: toolchain.npmCliPath, expectedVersion: inputs.cliVersion, expectedTarballSha256: inputs.cliSha256, registry: inputs.npmRegistry });
    const installation = { root: installed.root, entry: installed.entry, entrySha256: installed.entrySha256, version: installed.version };
    const inspections: InspectAcceptance[] = [];
    for (const framework of ['vue', 'react'] as const) {
      const project = await scaffoldConsumerProject(run, framework, 'npm');
      let install: Awaited<ReturnType<typeof installDependencies>>;
      try { install = await installDependencies(run, { projectRoot: project.root, manager: 'npm', toolchain, registry: inputs.npmRegistry }); }
      finally { await registerConsumer(run, framework); }
      if (install.exitCode !== 0) throw new Error('Temporary ' + framework + ' project dependency installation failed.');
      const args = ['integrate', 'inspect', '--project', project.root];
      const { runFrozenCli } = await import('./runtime.js');
      const result = await runFrozenCli(run, { installation, projectRoot: project.root, args, toolchain, timeoutMs: inputs.timeoutMs });
      if (result.exitCode !== 0 || result.timedOut) throw new Error('Frozen CLI inspect failed for ' + framework + ' with exit ' + result.exitCode + '.');
      const stdout = await readFile(result.stdoutEvidence, 'utf8');
      const report = parseInspectReport(stdout, framework);
      inspections.push({ framework, status: 'inspected', packageManager: 'npm', fileSnapshotCount: (report.fileSnapshots as unknown[]).length, exitCode: 0,
        stdoutBytes: result.stdoutBytes, stderrBytes: result.stderrBytes, stdoutSha256: result.stdoutSha256, stderrSha256: result.stderrSha256, stdoutEvidence: result.stdoutEvidence, stderrEvidence: result.stderrEvidence });
    }
    const receiptPath = resolve(run.evidenceRoot, 'files', 'inspect-acceptance.json');
    const receipt: InspectRunnerResult = { runId: run.runId, evidenceRoot: run.evidenceRoot, result: 'passed', receiptEvidencePath: receiptPath, sealPath: '', sealSha256: '',
      cli: { root: installed.root, entry: installed.entry, entrySha256: installed.entrySha256, version: installed.version, tarballSha256: installed.tarballSha256, tarballBytes: installed.tarballBytes, manifestSha256: installed.manifestSha256 }, inspections };
    await run.writeEvidence('inspect-acceptance.json', Buffer.from(JSON.stringify({ schemaVersion: 1, ...receipt }, null, 2) + '\n'));
    await run.stopOwnedProcesses();
    receipt.sealPath = await run.sealEvidence({ result: receipt.result, cli: receipt.cli, inspections, receiptEvidencePath: 'files/inspect-acceptance.json' }); sealed = true;
    receipt.sealSha256 = sha(await readFile(receipt.sealPath));
    await run.cleanup();
    await verifyInspectReceiptEvidence(receipt);
    return receipt;
  } catch (error) {
    if (sealed) throw error;
    const retained = await preserveFailedInspectEvidence(run);
    const errorName = error instanceof Error ? error.name : 'Error';
    const cleanup = retained.projectCleanupFailed ? ' Temporary project cleanup also failed; inspect owned root ' + run.parentRoot + '.' : '';
    throw new Error('Frozen CLI host acceptance failed (' + errorName + '). Failure evidence retained at ' + retained.evidenceRoot + '.' + cleanup);
  }
}
