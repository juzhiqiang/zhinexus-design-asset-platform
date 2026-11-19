/**
 * P3 (role D) black-box acceptance for `component integrate inspect|plan`. The CLI is only spawned as a
 * child process (dist/bin.js); no CLI module is imported. Loopback HTTP is a protocol stub, not the real stack.
 * Expectations come from P0 contracts and the T15 design, never from CLI output.
 */
import * as path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { validateIntegrationPlan, validateLocalProjectInspection, validateMatchPlan } from '@company/contracts';
import {
  assertCliBuilt, compareTreeBytes, createHostProject, gitCommitAll, initGitRepo, matchPlanFor, parseCliJson,
  runCliProcess, sha256Bytes, snapshotTree, startLoopbackStub, stubApiFor, stubQueryFor, tempRoot, writeJson,
  stubResponseFor, stubTarball, type RunResult,
  type HostProjectOptions, type LoopbackStub, type StubRequest,
} from '../fixtures/phase3-cli-harness.js';

const API_TOKEN = 't15-d-api-secret-7f3c9a';
const REGISTRY_TOKEN = 't15-d-registry-secret-2b8e1d';
type Project = ReturnType<typeof createHostProject>;
type State = { revoked: boolean; apiStatus: number };
type Context = { root: string; project: Project; matchFile: string; stub: LoopbackStub; state: State; requests: StubRequest[] };
const opened: Context[] = [];

async function open(options: HostProjectOptions, mutate?: (matchPlan: Record<string, any>) => void, projectMutate?: (root: string) => void): Promise<Context> {
  assertCliBuilt();
  const root = tempRoot('consumer-');
  const project = createHostProject(root, options);
  initGitRepo(project.root); gitCommitAll(project.root);
  projectMutate?.(project.root);
  const matchPlan = matchPlanFor(project) as Record<string, any>;
  mutate?.(matchPlan);
  const checked = validateMatchPlan(matchPlan);
  if (!checked.ok) throw new Error(`Invalid test MatchPlan: ${JSON.stringify(checked.issues)}`);
  const matchFile = path.join(root, 'inputs', 'match-plan.json');
  writeJson(matchFile, matchPlan);
  const state: State = { revoked: false, apiStatus: 200 };
  const requests: StubRequest[] = [];
  const stub = await startLoopbackStub({
    respond: (request) => {
      requests.push(request);
      if (!request.url.startsWith('/v1/matching/components')) return { status: 404, body: { message: 'not found' } };
      if (state.apiStatus !== 200) return { status: state.apiStatus, body: { error: 'REGISTRY_UNAVAILABLE', message: `synthetic failure ${API_TOKEN} ${REGISTRY_TOKEN}` } };
      const query = stubQueryFor(project.framework, project.versions);
      if (state.revoked) return { status: 200, body: { schemaVersion: 1, query, status: 'gap', exactDependencies: [], gaps: [{ code: 'TARGET_UNAVAILABLE', message: 'revoked' }] } };
      return { status: 200, body: stubResponseFor(project.framework, project.versions, { status: 'matched', target: matchPlan.elements[0].target, api: stubApiFor(project.framework) }) };
    },
    tarball: (name) => (name === `@company/charts-${project.framework}` ? stubTarball() : undefined),
  });
  const context: Context = { root, project, matchFile, stub, state, requests };
  opened.push(context);
  return context;
}

afterAll(async () => { for (const c of opened.splice(0)) await c.stub.close(); });

const env = () => ({ ZHINEXUS_API_TOKEN: API_TOKEN, ZHINEXUS_REGISTRY_TOKEN: REGISTRY_TOKEN });
async function observe(c: Context, args: string[]): Promise<RunResult> {
  const before = snapshotTree(c.project.root);
  const result = await runCliProcess(args, { cwd: c.root, env: env() });
  expect(compareTreeBytes(before, snapshotTree(c.project.root))).toEqual([]);
  for (const secret of [API_TOKEN, REGISTRY_TOKEN]) expect(result.stdout + result.stderr).not.toContain(secret);
  return result;
}
async function inspect(c: Context, args: string[]): Promise<RunResult> {
  const result = await observe(c, ['integrate', 'inspect', ...args]);
  if (result.exitCode === 0 || result.exitCode === 2) {
    const { json } = parseCliJson(result);
    const checked = validateLocalProjectInspection(json);
    expect(checked.ok, checked.ok ? '' : JSON.stringify(checked.issues)).toBe(true);
  }
  return result;
}
const planArgs = (c: Context) => ['integrate', 'plan', '--project', c.project.root, '--match', c.matchFile, '--api-url', c.stub.origin, '--registry', c.stub.origin];
const plan = (c: Context, args = planArgs(c)) => observe(c, args);
const diag = (r: { exitCode: number | null; stdout: string; stderr: string }) => `exit=${r.exitCode} stdout=${JSON.stringify(r.stdout.slice(0, 800))} stderr=${JSON.stringify(r.stderr.slice(0, 800))}`;

function expectPlanJson(r: RunResult, exit: number) {
  expect(r.exitCode, diag(r)).toBe(exit);
  for (const s of [API_TOKEN, REGISTRY_TOKEN]) { expect(r.stdout).not.toContain(s); expect(r.stderr).not.toContain(s); }
  const { json } = parseCliJson(r);
  const check = validateIntegrationPlan(json);
  expect(check.ok, `${diag(r)} issues=${JSON.stringify(check.ok ? [] : check.issues)}`).toBe(true);
  expect(json.status).toBe(exit === 0 ? 'planned' : 'conflicted');
  expect(json.executionAuthorized).toBe(false);
  return json;
}

describe('P3 inspect surface', () => {
  it('root help advertises the two integrate commands', async () => {
    const c = await open({ framework: 'vue', packageManager: 'npm' });
    const result = await runCliProcess(['--help'], { cwd: c.root });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('integrate inspect');
    expect(result.stdout).toContain('integrate plan');
  });
  it('inspect reports Vue npm project as inspected with raw-byte snapshots', async () => {
    const c = await open({ framework: 'vue', packageManager: 'npm' });
    const r = await inspect(c, ['--project', c.project.root]);
    expect(r.exitCode, diag(r)).toBe(0); expect(r.stderr.trim()).toBe('');
    const { json } = parseCliJson(r);
    expect([json.status, json.packageManager, json.lockfile, json.framework]).toEqual(['inspected', 'npm', { path: 'package-lock.json', format: 'npm-v3' }, 'vue']);
    expect(json.fileSnapshots).toEqual(expect.arrayContaining([
      { path: 'package.json', exists: true, sha256: sha256Bytes(readFileSync(path.join(c.project.root, 'package.json'))) },
      { path: 'package-lock.json', exists: true, sha256: sha256Bytes(readFileSync(path.join(c.project.root, 'package-lock.json'))) },
    ]));
    for (const f of json.fileSnapshots) if (f.exists) expect(f.sha256).toBe(sha256Bytes(readFileSync(path.join(c.project.root, f.path))));
  }, 30_000);

  it('inspect reports React pnpm project with react-dom resolved', async () => {
    const c = await open({ framework: 'react', packageManager: 'pnpm' });
    const r = await inspect(c, ['--project', c.project.root]);
    expect(r.exitCode, diag(r)).toBe(0);
    const { json } = parseCliJson(r);
    expect(json.framework).toBe('react');
    expect(json.resolvedDependencies.map((d: any) => d.name)).toEqual(expect.arrayContaining(['react', 'react-dom', 'echarts']));
  });

  it('missing --project, unknown and duplicate options exit 1 with structured stdout', async () => {
    const c = await open({ framework: 'vue', packageManager: 'pnpm' });
    for (const args of [[], ['--project', c.project.root, '--nope'], ['--project', c.project.root, '--project', c.project.root]]) {
      const r = await inspect(c, args);
      expect(r.exitCode, diag(r)).toBe(1); expect(parseCliJson(r).json).toBeTypeOf('object');
    }
  });

  it.each(['LOCKFILE_MULTIPLE', 'FRAMEWORK_AMBIGUOUS'])('%s is reported as a blocking conflict', async code => {
    const c = await open({ framework: 'vue', packageManager: 'pnpm' }, undefined, (root) => {
      if (code === 'LOCKFILE_MULTIPLE') writeJson(path.join(root, 'package-lock.json'), { lockfileVersion: 3, packages: { '': {} } });
      else writeJson(path.join(root, 'package.json'), { ...JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')), dependencies: { vue: '3.5.45', react: '19.3.1' } });
    });
    const r = await inspect(c, ['--project', c.project.root]);
    expect(r.exitCode, diag(r)).toBe(2);
    const { json } = parseCliJson(r);
    expect(json.status).toBe('conflicted');
    expect(json.conflicts.map((x: any) => x.code)).toContain(code);
  });
});

describe('P3 plan: planned results', () => {
  it('Vue npm plan validates against IntegrationPlanV1 with registry digest derived from the served tarball', async () => {
    const c = await open({ framework: 'vue', packageManager: 'npm' });
    const json = expectPlanJson(await plan(c), 0);
    expect(json.packageManager).toBe('npm');
    expect(json.registryEvidence[0]).toMatchObject({ name: '@company/charts-vue', verification: 'platform-sha256', sha256: sha256Bytes(stubTarball()) });
    expect(json.changes.map((x: any) => x.kind)).toEqual(expect.arrayContaining(['package-json', 'lockfile-regeneration', 'generated-component']));
    expect(json.changes.find((x: any) => x.kind === 'generated-component').path).toBe('src/components/zhinexus/component-0001.vue');
  });

  it('React pnpm plan validates and previews only pnpm commands', async () => {
    const c = await open({ framework: 'react', packageManager: 'pnpm' });
    const json = expectPlanJson(await plan(c), 0);
    expect(json.commands.every((x: any) => x.executable === 'pnpm')).toBe(true);
    expect(json.localProject.resolvedDependencies.map((d: any) => d.name)).toContain('react-dom');
  });

  it('tokens stay separated across independent API and registry origins', async () => {
    const c = await open({ framework: 'vue', packageManager: 'pnpm' });
    const registry = await startLoopbackStub({ respond: () => ({ status: 404, body: {} }), tarball: name => name === '@company/charts-vue' ? stubTarball() : undefined });
    try {
      const args = planArgs(c); args[args.indexOf('--registry') + 1] = registry.origin;
      expectPlanJson(await plan(c, args), 0);
      expect(c.stub.requests.length).toBeGreaterThan(0);
      expect(c.stub.requests.every(request => request.url.startsWith('/v1/'))).toBe(true);
      for (const request of c.stub.requests) {
        expect(request.headers.authorization).toBe(`Bearer ${API_TOKEN}`);
        expect(JSON.stringify(request.headers)).not.toContain(REGISTRY_TOKEN);
      }
      expect(registry.requests.some(request => request.url.endsWith('.tgz'))).toBe(true);
      for (const request of registry.requests) {
        expect(request.headers.authorization).toBe(`Bearer ${REGISTRY_TOKEN}`);
        expect(JSON.stringify(request.headers)).not.toContain(API_TOKEN);
      }
    } finally { await registry.close(); }
  });

  it('--output-dir is only an intent: no directory is created and project bytes are unchanged', async () => {
    const c = await open({ framework: 'vue', packageManager: 'pnpm' });
    const before = snapshotTree(c.project.root);
    expectPlanJson(await plan(c, [...planArgs(c), '--output-dir', 'src/out put']), 0);
    expect(existsSync(path.join(c.project.root, 'src', 'out put'))).toBe(false);
    expect(compareTreeBytes(before, snapshotTree(c.project.root))).toEqual([]);
  });
});

describe('P3 plan: conflicts and failures', () => {
  it('refuses a cross-origin tarball redirect without contacting its destination', async () => {
    const c = await open({ framework: 'vue', packageManager: 'npm' });
    const destination = await startLoopbackStub({ respond: () => ({ status: 200, body: {} }) });
    const registry = await startLoopbackStub({ respond: () => ({ status: 404, body: {} }),
      tarball: name => name === '@company/charts-vue' ? stubTarball() : undefined,
      tarballRedirect: `${destination.origin}/escaped.tgz` });
    const before = snapshotTree(c.project.root);
    try {
      const args = planArgs(c); args[args.indexOf('--registry') + 1] = registry.origin;
      const result = await plan(c, args);
      expect(registry.requests.some(request => request.url.endsWith('.tgz'))).toBe(true);
      expect(destination.requests).toEqual([]);
      expect([1, 2]).toContain(result.exitCode);
      const { json } = parseCliJson(result); expect(json).toBeTypeOf('object');
      expect(json.status).not.toBe('planned');
      for (const secret of [API_TOKEN, REGISTRY_TOKEN]) expect(result.stdout + result.stderr).not.toContain(secret);
      expect(compareTreeBytes(before, snapshotTree(c.project.root))).toEqual([]);
    } finally { await registry.close(); await destination.close(); }
  });
  it('missing match, duplicate registry and unknown options are structured errors before requests', async () => {
    const c = await open({ framework: 'vue', packageManager: 'npm' });
    const args = planArgs(c);
    const matchIndex = args.indexOf('--match');
    for (const bad of [args.filter((_, i) => i !== matchIndex && i !== matchIndex + 1), [...args, '--registry', c.stub.origin], [...args, '--unknown', 'x']]) {
      const result = await plan(c, bad);
      expect(result.exitCode, diag(result)).toBe(1);
      expect(parseCliJson(result).json).toBeTypeOf('object');
      expect(c.stub.requests).toEqual([]);
    }
  });
  it('malformed MatchPlan JSON exits 1 with structured JSON stdout and no network request', async () => {
    const c = await open({ framework: 'vue', packageManager: 'pnpm' });
    writeFileSync(c.matchFile, '{ "schemaVersion": 1, ');
    const r = await plan(c);
    expect(r.exitCode, diag(r)).toBe(1);
    const { json } = parseCliJson(r);
    expect(json).toBeTypeOf('object');
    expect(c.requests).toEqual([]);
  });

  it.each(['prop', 'events'])('omitted %s produces API_MISMATCH even though the MatchPlan validates', async omitted => {
    const c = await open({ framework: 'vue', packageManager: 'pnpm' }, (m) => {
      const e = m.elements[0];
      if (omitted === 'prop') e.props = e.props.filter((p: any) => !p.required); else e.events = [];
      expect(validateMatchPlan(m).ok).toBe(true);
    });
    const json = expectPlanJson(await plan(c), 2);
    expect(json.conflicts.some((x: any) => x.code === 'API_MISMATCH' && x.instanceId === 'node-1')).toBe(true);
  });

  it('matched but unverified compatibility stays a blocking conflict, never planned', async () => {
    const c = await open({ framework: 'vue', packageManager: 'pnpm' }, (m) => {
      m.elements[0].target.compatibility = { status: 'unverified', recordIds: [] };
      m.elements[0].gaps = [{ code: 'COMPATIBILITY_UNVERIFIED', message: 'no accepted record' }];
    });
    const json = expectPlanJson(await plan(c), 2);
    expect(json.conflicts.some((x: any) => x.code === 'COMPATIBILITY_UNVERIFIED' && x.blocking)).toBe(true);
  });

  it('an authoritative gap response (revoked target) is conflicted with TARGET_UNAVAILABLE', async () => {
    const c = await open({ framework: 'vue', packageManager: 'pnpm' });
    c.state.revoked = true;
    const json = expectPlanJson(await plan(c), 2);
    expect(json.conflicts.some((x: any) => x.code === 'TARGET_UNAVAILABLE')).toBe(true);
  });

  it('a network/API failure exits 1 with no raw token in stdout or stderr', async () => {
    const c = await open({ framework: 'vue', packageManager: 'pnpm' });
    c.state.apiStatus = 500;
    const r = await plan(c);
    const apiRequests = c.stub.requests.filter(request => request.url.startsWith('/v1/matching/components'));
    expect(apiRequests.length).toBeGreaterThan(0);
    for (const request of apiRequests) {
      expect(request.method).toBe('GET');
      expect(request.headers.authorization).toBe(`Bearer ${API_TOKEN}`);
    }
    expect(r.exitCode, diag(r)).toBe(1);
    expect(parseCliJson(r).json).toBeTypeOf('object');
    for (const s of [API_TOKEN, REGISTRY_TOKEN]) { expect(r.stdout).not.toContain(s); expect(r.stderr).not.toContain(s); }
  });
});
