/**
 * P3 (role D) read-only and security boundary acceptance for `component integrate inspect|plan`.
 *
 * Black box only: the built CLI is spawned as a child process; nothing from the CLI implementation is imported.
 * Every project tree lives under the OS temp directory. Snapshots compare the full recursive entry set and
 * the raw bytes of every file, not `git diff`.
 *
 * Expected harness API (see tests/fixtures/phase3-cli-harness.ts):
 * - CLI_BIN, HOST_TEMP_ROOT, REPO_ROOT
 * - runCliProcess(args, { cwd, env, timeoutMs }) => { exitCode, signal, stdout, stderr, timedOut }
 * - snapshotTree(root): Map<relPath, { type, sha256?, link?, mtimeMs, size }> including directory entries
 * - compareTreeBytes(before, after): string[] (entry set + file bytes; directory content)
 * - addedEntries(before, after): string[]
 * - createHostProject(root, options), initGitRepo(root), gitCommitAll(root)
 * - installMaliciousScripts(projectRoot, markerDir) => { marker, helperDir, projectRoot }
 * - proveMarkerMechanism(projectRoot, marker) (control: plain `git status` DOES write the marker)
 * - matchPlanFor(project), stubApiFor, stubQueryFor, stubResponseFor, stubTarball, sha256Bytes
 * - startLoopbackStub({ respond, tarball, metadata }) => { origin, requests, matchRequests(), waitForTarballRequest(count, timeoutMs), barrier: { hold, releaseAll() }, close() }
 * - tempRoot(prefix), writeJson, writeFile, parseCliJson
 */
import { existsSync, mkdirSync, readFileSync, symlinkSync, lstatSync } from 'node:fs';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { canonicalJson, validateMatchPlan } from '@company/contracts';
import {
  HOST_TEMP_ROOT,
  addedEntries,
  assertCliBuilt,
  compareTreeBytes,
  createHostProject,
  gitCommitAll,
  initGitRepo,
  installMaliciousScripts,
  markerExists,
  matchPlanFor,
  parseCliJson,
  proveMarkerMechanism,
  runCliProcess,
  sha256Bytes,
  snapshotTree,
  startLoopbackStub,
  stubApiFor,
  stubQueryFor,
  stubResponseFor,
  stubTarball,
  tempRoot,
  writeFile,
  writeJson,
  type HostProjectOptions,
  type LoopbackStub,
  type StubRequest,
} from '../fixtures/phase3-cli-harness.js';

const API_TOKEN = 't15-d-api-secret-0c41';
const REGISTRY_TOKEN = 't15-d-registry-secret-9ab2';

type Project = ReturnType<typeof createHostProject>;
type State = { revoked: boolean; deprecated: boolean };

type Context = {
  root: string;
  project: Project;
  matchPlan: Record<string, any>;
  matchFile: string;
  stub: LoopbackStub;
  state: State;
  clientSockets: Set<import('node:net').Socket>;
};

const opened: Context[] = [];

async function open(options: HostProjectOptions = { framework: 'vue', packageManager: 'pnpm' }): Promise<Context> {
  assertCliBuilt();
  const root = tempRoot('readonly-');
  const project = createHostProject(root, options);
  initGitRepo(project.root);
  gitCommitAll(project.root);
  const matchPlan = matchPlanFor(project);
  const check = validateMatchPlan(matchPlan);
  if (!check.ok) throw new Error(`Harness error: synthetic MatchPlan is not contract-valid: ${JSON.stringify(check.issues)}`);
  const matchFile = path.join(root, 'inputs', 'match-plan.json');
  writeJson(matchFile, matchPlan);
  const state: State = { revoked: false, deprecated: false };
  const clientSockets = new Set<import('node:net').Socket>();
  const stub = await startLoopbackStub({
    respond: (request: StubRequest) => {
      if (!request.url.startsWith('/v1/matching/components')) return { status: 404, body: { message: 'not found' } };
      if (state.revoked || state.deprecated) {
        return { status: 200, body: { schemaVersion: 1, query: stubQueryFor(project.framework, project.versions), status: 'gap', exactDependencies: [],
          gaps: [{ code: 'TARGET_UNAVAILABLE', message: 'synthetic target revoked while downloading' }] } };
      }
      return { status: 200, body: stubResponseFor(project.framework, project.versions) };
    },
    tarball: (packageName: string) => (packageName === `@company/charts-${project.framework}` ? stubTarball() : undefined),
  });
  const context: Context = { root, project, matchPlan, matchFile, stub, state, clientSockets };
  opened.push(context);
  return context;
}

afterAll(async () => {
  for (const context of opened.splice(0)) {
    for (const socket of context.clientSockets) socket.destroy();
    await context.stub.close();
  }
});

function env(): Record<string, string | undefined> {
  return { ZHINEXUS_API_TOKEN: API_TOKEN, ZHINEXUS_REGISTRY_TOKEN: REGISTRY_TOKEN };
}

function planArgs(context: Context, extra: string[] = []): string[] {
  return ['integrate', 'plan', '--project', context.project.root, '--match', context.matchFile,
    '--api-url', context.stub.origin, '--registry', context.stub.origin, ...extra];
}

function report(result: { exitCode: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }): string {
  return `exit=${result.exitCode} signal=${result.signal} timedOut=${result.timedOut} stdout=${JSON.stringify(result.stdout.slice(0, 1000))} stderr=${JSON.stringify(result.stderr.slice(0, 1000))}`;
}

/**
 * Run the CLI while a tarball response is held by the stub. The barrier is raced against process exit so an
 * unimplemented (P0) CLI fails with a descriptive error instead of hanging the suite.
 */
async function waitForHeldTarball(context: Context, running: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }>, label: string): Promise<void> {
  const exited = running.then((result) => ({ exited: true as const, result }));
  const requested = context.stub.waitForTarballRequest(1, 60_000).then(() => ({ exited: false as const }));
  const outcome = await Promise.race([exited, requested]);
  if (outcome.exited) throw new Error(`${label}: CLI exited before any tarball request was observed (${report(outcome.result)})`);
}

function expectNoSecrets(result: { stdout: string; stderr: string }): void {
  for (const secret of [API_TOKEN, REGISTRY_TOKEN]) {
    expect(result.stdout).not.toContain(secret);
    expect(result.stderr).not.toContain(secret);
  }
}

function expectUnchanged(context: Context, before: ReturnType<typeof snapshotTree>): void {
  const after = snapshotTree(context.project.root);
  expect(compareTreeBytes(before, after)).toEqual([]);
  expect(addedEntries(before, after)).toEqual([]);
}

describe('P3 read-only: target project bytes', () => {
  it('inspect leaves the complete project entry set and every file byte unchanged', async () => {
    const context = await open();
    const before = snapshotTree(context.project.root);
    const result = await runCliProcess(['integrate', 'inspect', '--project', context.project.root], { cwd: context.root, env: env() });
    expect(result.exitCode, report(result)).toBe(0);
    expectUnchanged(context, before);
    await context.stub.close();
  });

  it('plan with a successful loopback response makes no write, no new file and no directory mutation in the project', async () => {
    const context = await open();
    const before = snapshotTree(context.project.root);
    const result = await runCliProcess(planArgs(context), { cwd: context.root, env: env() });
    expect(result.exitCode, report(result)).toBe(0);
    const { json } = parseCliJson(result);
    expect(json.stage).toBe('plan');
    expect(json.executionAuthorized).toBe(false);
    expect(json.status).toBe('planned');
    expect(json.localProject.status).toBe('inspected');
    const inspection = validateMatchPlan(json.sourceMatchPlan);
    expect(inspection.ok, JSON.stringify(inspection)).toBe(true);
    expect(json.matchPlanDigest).toBe(sha256Bytes(new TextEncoder().encode(canonicalMatchPlanDigestInput(json.sourceMatchPlan))));
    expectNoSecrets(result);
    expectUnchanged(context, before);
    await context.stub.close();
  });

  it('plan --output-dir does not create the directory and still leaves the project unchanged', async () => {
    const context = await open();
    const before = snapshotTree(context.project.root);
    const result = await runCliProcess(planArgs(context, ['--output-dir', path.join('src', 'generated by cli')]), { cwd: context.root, env: env() });
    expect(result.exitCode, report(result)).toBe(0);
    expect(existsSync(path.join(context.project.root, 'src', 'generated by cli'))).toBe(false);
    expectUnchanged(context, before);
    await context.stub.close();
  });

  it('a project path containing spaces and Chinese characters is inspected read-only', async () => {
    const root = tempRoot('readonly-unicode-');
    const project = createHostProject(path.join(root, '业务 应用'), { framework: 'react', packageManager: 'npm' });
    initGitRepo(project.root);
    gitCommitAll(project.root);
    const before = snapshotTree(project.root);
    const result = await runCliProcess(['integrate', 'inspect', '--project', project.root], { cwd: root, env: env() });
    expect(result.exitCode, report(result)).toBe(0);
    const { json } = parseCliJson(result);
    expect(json.framework).toBe('react');
    expect(json.packageManager).toBe('npm');
    expect(validateMatchPlan(matchPlanFor(project)).ok).toBe(true);
    expect(compareTreeBytes(before, snapshotTree(project.root))).toEqual([]);
  });

  it('an unrelated uncommitted file is preserved and reported as dirty, not modified', async () => {
    const context = await open();
    const notes = path.join(context.project.root, 'NOTES.md');
    writeFile(notes, '# user notes before plan\n');
    const before = snapshotTree(context.project.root);
    const result = await runCliProcess(['integrate', 'inspect', '--project', context.project.root], { cwd: context.root, env: env() });
    expect(result.exitCode, report(result)).toBe(0);
    const { json } = parseCliJson(result);
    expect(json.git.status).toBe('dirty');
    expect(json.git.dirtyPaths.map((p: string) => p.toLowerCase())).toContain('notes.md');
    expect(compareTreeBytes(before, snapshotTree(context.project.root))).toEqual([]);
    expect(readFileSync(notes, 'utf8')).toBe('# user notes before plan\n');
    await context.stub.close();
  });
});

// The canonical MatchPlan digest is SHA-256 of UTF-8 canonicalJson bytes; recompute it independently.
function canonicalMatchPlanDigestInput(matchPlan: unknown): string {
  return canonicalJson(matchPlan);
}

describe('P3 read-only: project scripts and Git hooks are never executed', () => {
  it('malicious npm lifecycle scripts, config files and a marker-writing Git fsmonitor hook never run, and the control proves the marker mechanism', async () => {
    const context = await open();
    const marker = installMaliciousScripts(context.project.root, path.join(context.root, 'marker'));
    // Control: prove the marker helper really writes when Git runs it. Then remove the marker.
    proveMarkerMechanism(context.project.root, marker.marker);
    expect(markerExists(marker.marker)).toBe(true);
    const { rmSync } = await import('node:fs');
    rmSync(marker.marker, { force: true });
    const { chmodSync } = await import('node:fs');
    void chmodSync;
    const before = snapshotTree(context.project.root);
    const inspect = await runCliProcess(['integrate', 'inspect', '--project', context.project.root], { cwd: context.root, env: env() });
    expect(inspect.exitCode, report(inspect)).toBe(0);
    expect(markerExists(marker.marker), 'a project script or Git hook executed during inspect').toBe(false);
    const plan = await runCliProcess(planArgs(context), { cwd: context.root, env: env() });
    expect(plan.exitCode, report(plan)).toBe(2);
    expect(parseCliJson(plan).json.conflicts.some((c: { code: string }) => c.code === 'DIRTY_TARGET')).toBe(true);
    expect(markerExists(marker.marker), 'a project script or Git hook executed during plan').toBe(false);
    // The uncommitted modifications are user data, so only compare what existed before.
    expectUnchanged(context, before);
    await context.stub.close();
  });

  it('hostile Git environment overrides cannot redirect the inspection to another repository', async () => {
    const context = await open();
    const decoy = tempRoot('decoy-repo-');
    const decoyProject = createHostProject(decoy, { framework: 'vue', packageManager: 'pnpm' });
    initGitRepo(decoyProject.root);
    gitCommitAll(decoyProject.root);
    const decoyIndex = path.join(decoy, 'decoy-index');
    writeFile(decoyIndex, '');
    writeFile(path.join(context.project.root, 'real-only.txt'), 'requested project');
    writeFile(path.join(decoyProject.root, 'decoy-only.txt'), 'other project');
    const before = snapshotTree(context.project.root);
    const decoyBefore = snapshotTree(decoyProject.root);
    const result = await runCliProcess(['integrate', 'inspect', '--project', context.project.root], {
      cwd: context.root,
      env: {
        ...env(),
        GIT_DIR: path.join(decoyProject.root, '.git'),
        GIT_WORK_TREE: decoyProject.root,
        GIT_INDEX_FILE: decoyIndex,
        GIT_OBJECT_DIRECTORY: path.join(decoyProject.root, '.git', 'objects'),
        GIT_COMMON_DIR: path.join(decoyProject.root, '.git'),
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.fsmonitor',
        GIT_CONFIG_VALUE_0: path.join(decoy, 'should-not-run'),
      },
    });
    expect(result.exitCode, report(result)).toBe(0);
    const { json } = parseCliJson(result);
    // A redirected repository would report the decoy's workspace-relative data or change status; the inspected root
    // must still be the requested project (its own lock and manifest bytes).
    const snapshotPaths = (json.fileSnapshots as any[]).map((f) => f.path);
    expect(snapshotPaths).toEqual(expect.arrayContaining(['package.json', 'pnpm-lock.yaml']));
    expect(json.git.dirtyPaths).toContain('real-only.txt');
    expect(json.git.dirtyPaths).not.toContain('decoy-only.txt');
    expect(compareTreeBytes(decoyBefore, snapshotTree(decoyProject.root))).toEqual([]);
    expect(compareTreeBytes(before, snapshotTree(context.project.root))).toEqual([]);
    await context.stub.close();
  });
});

describe('P3 read-only: Windows junction escape', () => {
  it('a junction in the planned output path is rejected and outside bytes stay unchanged', async () => {
    const context = await open();
    const outside = tempRoot('outside-secret-');
    writeFile(path.join(outside, 'secret.txt'), 'OUTSIDE SECRET\n');
    const link = path.join(context.project.root, 'src', 'linked');
    mkdirSync(path.dirname(link), { recursive: true });
    let created = false;
    try {
      symlinkSync(outside, link, 'junction');
      created = lstatSync(link).isSymbolicLink();
    } catch (error) {
      throw new Error(`Environment error: could not create a Windows junction for the escape case: ${(error as Error).message}`);
    }
    if (!created) throw new Error('Environment error: junction was not created as a symbolic link; the escape case was not exercised');
    const before = snapshotTree(context.project.root);
    const outsideBefore = snapshotTree(outside);
    // Valid inspection may either be conflicted with PATH_UNSAFE, or succeed while never reading outside; a refused
    // non-zero execution error is also acceptable. It must never report content from outside the project.
    const inspect = await runCliProcess(planArgs(context, ['--output-dir', 'src/linked']), { cwd: context.root, env: env() });
    expect(inspect.exitCode, report(inspect)).toBe(2);
    expect(inspect.stdout).not.toContain('OUTSIDE SECRET');
    const { json } = parseCliJson(inspect);
    expect((json.conflicts as any[]).some((c) => c.code === 'PATH_UNSAFE')).toBe(true);
    expect(compareTreeBytes(outsideBefore, snapshotTree(outside))).toEqual([]);
    expect(compareTreeBytes(before, snapshotTree(context.project.root))).toEqual([]);
    await context.stub.close();
  });

});

describe('P3 race: local files changed while the plan is running', () => {
  it('a key file edited while a tarball download is held yields PROJECT_CHANGED and preserves the user edit', async () => {
    const context = await open();
    // Hold every tarball response until the test releases it.
    context.stub.barrier.hold = true;
    const manifest = path.join(context.project.root, 'package.json');
    const before = snapshotTree(context.project.root);
    const running = runCliProcess(planArgs(context), { cwd: context.root, env: env(), timeoutMs: 120_000 });
    try {
      await waitForHeldTarball(context, running, 'PROJECT_CHANGED barrier');
      // User edits the manifest while the CLI is waiting on the network.
      const edited = JSON.parse(readFileSync(manifest, 'utf8'));
      edited.description = 'user edit while CLI is planning';
      writeJson(manifest, edited);
      const expectedAfterUserEdit = snapshotTree(context.project.root);
      context.stub.barrier.releaseAll();
      const result = await running;
      expect(result.exitCode, report(result)).toBe(2);
      const { json } = parseCliJson(result);
      expect(json.status).toBe('conflicted');
      expect((json.conflicts as any[]).some((c) => c.code === 'PROJECT_CHANGED')).toBe(true);
      expect(JSON.parse(readFileSync(manifest, 'utf8')).description).toBe('user edit while CLI is planning');
      expect(compareTreeBytes(expectedAfterUserEdit, snapshotTree(context.project.root))).toEqual([]);
      expect(compareTreeBytes(before, snapshotTree(context.project.root))).toEqual(['content changed: package.json']);
      expectNoSecrets(result);
    } finally {
      context.stub.barrier.releaseAll();
      await running.catch(() => undefined);
      await context.stub.close();
    }
  });

  it('an authoritative target revoked during the tarball download is re-fetched and the plan is conflicted, not planned', async () => {
    const context = await open();
    context.stub.barrier.hold = true;
    const before = snapshotTree(context.project.root);
    const running = runCliProcess(planArgs(context), { cwd: context.root, env: env(), timeoutMs: 120_000 });
    try {
      await waitForHeldTarball(context, running, 'revocation barrier');
      context.state.revoked = true;
      context.stub.barrier.releaseAll();
      const result = await running;
      expect(result.exitCode, report(result)).toBe(2);
      const { json } = parseCliJson(result);
      expect(json.status).toBe('conflicted');
      expect(json.executionAuthorized).toBe(false);
      expect((json.conflicts as any[]).some((c) => c.code === 'TARGET_UNAVAILABLE')).toBe(true);
      // The revoked target must not be presented as the final published material.
      expect(context.stub.matchRequests()).toBeGreaterThanOrEqual(2);
      expectUnchanged(context, before);
      expectNoSecrets(result);
    } finally {
      context.stub.barrier.releaseAll();
      await running.catch(() => undefined);
      await context.stub.close();
    }
  });

  it('a target deprecated during the tarball download yields a blocking TARGET_UNAVAILABLE conflict', async () => {
    const context = await open();
    context.stub.barrier.hold = true;
    const before = snapshotTree(context.project.root);
    const running = runCliProcess(planArgs(context), { cwd: context.root, env: env(), timeoutMs: 120_000 });
    try {
      await waitForHeldTarball(context, running, 'deprecation barrier');
      context.state.deprecated = true;
      context.stub.barrier.releaseAll();
      const result = await running;
      expect(result.exitCode, report(result)).toBe(2);
      const { json } = parseCliJson(result);
      expect(json.status).toBe('conflicted');
      expect((json.conflicts as any[]).some((c) => c.code === 'TARGET_UNAVAILABLE' && c.blocking === true)).toBe(true);
      expect(context.stub.matchRequests()).toBeGreaterThanOrEqual(2);
      expectUnchanged(context, before);
      expectNoSecrets(result);
    } finally {
      context.stub.barrier.releaseAll();
      await running.catch(() => undefined);
      await context.stub.close();
    }
  });
});

describe('P3 read-only: output path safety', () => {
  it('refuses an --output-dir that escapes the target package while leaving the project untouched', async () => {
    const context = await open();
    const outside = path.resolve(context.project.root, '../escaped');
    const wholeTreeBefore = snapshotTree(context.root);
    const before = snapshotTree(context.project.root);
    const result = await runCliProcess(planArgs(context, ['--output-dir', '../escaped']), { cwd: context.root, env: env() });
    // Either a structured conflict (exit 2) or a refused argument (exit 1); never a silent planned success.
    expect([1, 2]).toContain(result.exitCode);
    expect(parseCliJson(result).json).toBeTypeOf('object');
    expect(existsSync(outside)).toBe(false);
    expect(compareTreeBytes(wholeTreeBefore, snapshotTree(context.root))).toEqual([]);
    expectUnchanged(context, before);
    await context.stub.close();
  });

  it('an existing target component file is reported as an OUTPUT_EXISTS conflict without overwriting it', async () => {
    const context = await open();
    const target = path.join(context.project.root, 'src', 'components', 'zhinexus', 'component-0001.vue');
    writeFile(target, '<template>user file</template>\n');
    const before = snapshotTree(context.project.root);
    const result = await runCliProcess(planArgs(context), { cwd: context.root, env: env() });
    expect(result.exitCode, report(result)).toBe(2);
    const { json } = parseCliJson(result);
    expect(json.status).toBe('conflicted');
    expect((json.conflicts as any[]).some((c) => c.code === 'OUTPUT_EXISTS')).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('<template>user file</template>\n');
    expectUnchanged(context, before);
    await context.stub.close();
  });
});

// Keep lstatSync/symlinkSync imports referenced for non-Windows compilation paths.
void lstatSync;

import {
  dirtyTrackedFileWithSameLength,
  installGitFilterExperiment,
  proveGitFilterExecutes,
  safeGit,
} from '../fixtures/phase3-cli-harness.js';
import { validateIntegrationPlan, validateLocalProjectInspection } from '@company/contracts';

// ---------------------------------------------------------------------------------------------
// P3 read-only (prepared, not yet run): Git user-defined clean / process filters must never execute
// during integrate inspect / plan, even when a same-length dirty tracked file forces Git to re-check
// content. The positive control runs first and a setup failure throws; it is never skipped.
// ---------------------------------------------------------------------------------------------

describe.each(['clean', 'process'] as const)('P3 read-only: Git %s filter is never executed', (kind) => {
  it(`a same-length dirty tracked file forces a re-check while the ${kind} helper marker stays absent`, async () => {
    const context = await open({ framework: 'vue', packageManager: 'pnpm' });
    try {
      const experiment = installGitFilterExperiment(context.project.root, path.join(context.root, 'git-filter-marker'), kind);
      proveGitFilterExecutes(context.project.root, experiment, kind, '1234567890');
      const status = safeGit(context.project.root, ['status', '--porcelain', '--untracked-files=all']);
      expect(status.status, `control status failed: ${status.stderr.slice(0, 500)}`).toBe(0);
      const { rmSync } = await import('node:fs');
      rmSync(experiment.marker, { force: true });
      dirtyTrackedFileWithSameLength(context.project.root, experiment.payload, 'abcdefghij');
      const before = snapshotTree(context.project.root);
      const inspect = await runCliProcess(['integrate', 'inspect', '--project', context.project.root], { cwd: context.root, env: env() });
      expect(inspect.exitCode, report(inspect)).toBe(0);
      const inspectJson = parseCliJson(inspect).json;
      expect(inspectJson.status).toBe('inspected');
      const inspectChecked = validateLocalProjectInspection(inspectJson);
      expect(inspectChecked.ok, inspectChecked.ok ? '' : JSON.stringify(inspectChecked.issues.slice(0, 5))).toBe(true);
      expect(inspectJson.git.status).toBe('dirty');
      expect(inspectJson.git.dirtyPaths).toEqual([experiment.payload]);
      expect(markerExists(experiment.marker), `inspect executed the Git ${kind} helper`).toBe(false);
      expectUnchanged(context, before);
      const plan = await runCliProcess(planArgs(context), { cwd: context.root, env: env() });
      expect(plan.exitCode, report(plan)).toBe(0);
      const planJson = parseCliJson(plan).json;
      expect(planJson.status).toBe('planned');
      expect(planJson.executionAuthorized).toBe(false);
      const planChecked = validateIntegrationPlan(planJson);
      expect(planChecked.ok, planChecked.ok ? '' : JSON.stringify(planChecked.issues.slice(0, 5))).toBe(true);
      expect(planJson.localProject.git).toEqual({ status: 'dirty', dirtyPaths: [experiment.payload] });
      expect(markerExists(experiment.marker), `plan executed the Git ${kind} helper`).toBe(false);
      expectNoSecrets(plan);
      expectUnchanged(context, before);
    } finally {
      await context.stub.close();
    }
  });
});

import { installTransformingManifestFilter } from '../fixtures/phase3-cli-harness.js';

// P3 read-only (prepared, not yet run): a transforming clean filter on the tracked package.json must
// not hide the user's manifest edit from inspect (dirty) or from plan (DIRTY_TARGET conflict).

describe.each([
  { framework: 'vue', packageManager: 'pnpm' },
  { framework: 'react', packageManager: 'npm' },
] as const)('P3 read-only: transforming manifest filter ($framework/$packageManager)', (variant) => {
  it('reports package.json dirty and blocks the plan while the helper marker stays absent', async () => {
    const context = await open({ framework: variant.framework, packageManager: variant.packageManager });
    try {
      const { rmSync } = await import('node:fs');
      const manifestPath = path.join(context.project.root, 'package.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: string };
      manifest.version = '1.0.0';
      writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
      const experiment = installTransformingManifestFilter(context.project.root, path.join(context.root, 'git-filter-marker'));
      rmSync(experiment.marker, { force: true });
      const add = safeGit(context.project.root, ['add', '--all']);
      if (add.status !== 0) throw new Error(`Environment error: git add --all failed (status=${add.status} timedOut=${add.timedOut}) stderr=${add.stderr.slice(0, 500)}`);
      if (!markerExists(experiment.marker)) throw new Error('Environment error: git add did not run the transforming clean helper');
      const commit = safeGit(context.project.root, ['-c', 'user.name=t15-d', '-c', 'user.email=t15-d@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'synthetic transforming manifest']);
      if (commit.status !== 0) throw new Error(`Environment error: control commit failed (status=${commit.status} timedOut=${commit.timedOut}) stderr=${commit.stderr.slice(0, 500)}`);
      const shown = safeGit(context.project.root, ['show', ':package.json']);
      if (shown.status !== 0) throw new Error(`Environment error: git show :package.json failed (status=${shown.status}) stderr=${shown.stderr.slice(0, 500)}`);
      const staged = JSON.parse(shown.stdout) as { version?: string };
      if (staged.version !== '2.0.0') throw new Error(`Environment error: expected transformed index version 2.0.0, got ${String(staged.version)}`);
      writeFile(manifestPath, shown.stdout);
      dirtyTrackedFileWithSameLength(context.project.root, 'package.json', shown.stdout);
      rmSync(experiment.marker, { force: true });
      const controlBefore = snapshotTree(context.root);
      const native = safeGit(context.project.root, ['--no-optional-locks', 'status', '--porcelain', '-z']);
      if (native.status !== 0) throw new Error(`Environment error: control git status failed (status=${native.status}) stderr=${native.stderr.slice(0, 500)}`);
      if (native.stdout !== ' M package.json\0') throw new Error(`Environment error: control status expected ' M package.json', got ${JSON.stringify(native.stdout)}`);
      if (!markerExists(experiment.marker)) throw new Error('Environment error: control status did not run the transforming helper');
      rmSync(experiment.marker, { force: true });
      const disabled = safeGit(context.project.root, ['-c', 'filter.t15transform.clean=', '-c', 'filter.t15transform.process=', '-c', 'filter.t15transform.smudge=', '-c', 'filter.t15transform.required=false', '--no-optional-locks', 'status', '--porcelain', '-z']);
      if (disabled.status !== 0) throw new Error(`Environment error: filter-disabled control status failed (status=${disabled.status}) stderr=${disabled.stderr.slice(0, 500)}`);
      if (disabled.stdout !== '') throw new Error(`Environment error: filter-disabled control must look clean, got ${JSON.stringify(disabled.stdout)}`);
      if (markerExists(experiment.marker)) throw new Error('Environment error: disabled control unexpectedly ran the helper');
      expect(compareTreeBytes(controlBefore, snapshotTree(context.root)), 'both status controls preserve all bytes').toEqual([]);
      const beforeWhole = snapshotTree(context.root);
      const before = snapshotTree(context.project.root);
      const inspect = await runCliProcess(['integrate', 'inspect', '--project', context.project.root], { cwd: context.root, env: env() });
      expect(inspect.exitCode, report(inspect)).toBe(0);
      const inspectJson = parseCliJson(inspect).json;
      const inspected = validateLocalProjectInspection(inspectJson);
      expect(inspected.ok, inspected.ok ? '' : JSON.stringify(inspected.issues.slice(0, 5))).toBe(true);
      expect(inspectJson.status).toBe('inspected');
      expectNoSecrets(inspect);
      expect(canonicalJson(inspectJson.git), 'exact git block').toBe(canonicalJson({ status: 'dirty', dirtyPaths: ['package.json'] }));
      expect(markerExists(experiment.marker), 'inspect executed the transforming helper').toBe(false);
      expect(compareTreeBytes(beforeWhole, snapshotTree(context.root)), 'inspect must not change project bytes (incl. .git)').toEqual([]);
      expectUnchanged(context, before);
      const plan = await runCliProcess(planArgs(context), { cwd: context.root, env: env() });
      expect(plan.exitCode, report(plan)).toBe(2);
      const planJson = parseCliJson(plan).json;
      const planned = validateIntegrationPlan(planJson);
      expect(planned.ok, planned.ok ? '' : JSON.stringify(planned.issues.slice(0, 5))).toBe(true);
      expect(planJson.status).toBe('conflicted');
      expect(planJson.executionAuthorized).toBe(false);
      expect(planJson.conflicts).toContainEqual(expect.objectContaining({ code: 'DIRTY_TARGET', blocking: true, path: 'package.json' }));
      expect(canonicalJson(planJson.localProject.git), 'plan keeps exact git block').toBe(canonicalJson({ status: 'dirty', dirtyPaths: ['package.json'] }));
      expect(markerExists(experiment.marker), 'plan executed the transforming helper').toBe(false);
      expectNoSecrets(plan);
      expect(compareTreeBytes(beforeWhole, snapshotTree(context.root)), 'plan must not change project bytes (incl. .git)').toEqual([]);
      expectUnchanged(context, before);
    } finally {
      await context.stub.close();
    }
  });
});
