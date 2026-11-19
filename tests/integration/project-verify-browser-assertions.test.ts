/** Real Chromium regressions for bounded asynchronous public verifyIntegration assertions. */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { canonicalJson } from '../../packages/component-cli/src/contracts/schema.js';
import { canonicalProjectRoot } from '../../packages/component-cli/src/integration/apply.js';
import type { IntegrationPlanV1 } from '../../packages/component-cli/src/contracts/integration-plan.js';
import type { IntegrationApplyResultV1 } from '../../packages/component-cli/src/contracts/integration-apply.js';
import type { IntegrationExecutionAuthorizationV1, IntegrationVerificationReportV1, IntegrationVerificationSpecV1 } from '../../packages/component-cli/src/contracts/integration-verification.js';
import { validIntegrationPlanFixture } from '../fixtures/integration-plan.js';
import { applyResultFixture } from '../fixtures/integration-apply.js';
import { loadT17CliExports, type T17CliExports } from './t17-support/verify-namespace.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const digest = (value: unknown) => hash(canonicalJson(value));
type BrowserSpec = NonNullable<IntegrationVerificationSpecV1['browser']>;
type HostCase = { body: string; update?: string; delayMs?: number; cancelAfterMs?: number };
const tempRoots: string[] = [];
let cli: T17CliExports;

beforeAll(async () => {
  cli = await loadT17CliExports();
  expect(typeof cli.verifyIntegration, cli.loadError).toBe('function');
});
afterEach(() => {
  if (!process.env.T17_ASSERTION_EVIDENCE_ROOT) {
    for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  }
});

/** Synthetic dependency metadata isolates browser behavior; this is not frozen-package acceptance. */
function createProject() {
  const evidenceRoot = process.env.T17_ASSERTION_EVIDENCE_ROOT ?? os.tmpdir();
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(evidenceRoot, 'zhinexus-assertions-'));
  tempRoots.push(tempRoot);
  const root = path.join(tempRoot, 'project');
  const artifactRoot = path.join(tempRoot, 'artifacts');
  fs.mkdirSync(root);
  fs.mkdirSync(artifactRoot);
  const plan = structuredClone(validIntegrationPlanFixture()) as unknown as IntegrationPlanV1;
  const applyResult = structuredClone(applyResultFixture()) as unknown as IntegrationApplyResultV1;
  const manifest = JSON.stringify({ name: 'synthetic-assertion-host', version: '1.0.0' });
  const lock = [
    "lockfileVersion: '9.0'", 'importers:', '  .:', '    dependencies:',
    ...plan.exactDependencies.flatMap(dep => [
      '      ' + JSON.stringify(dep.name) + ':', '        specifier: ' + dep.version, '        version: ' + dep.version,
    ]),
    'packages:',
    ...plan.exactDependencies.flatMap(dep => [
      '  ' + JSON.stringify(dep.name + '@' + dep.version) + ':',
      '    resolution: {integrity: sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==}',
    ]), '',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'package.json'), manifest);
  fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), lock);
  for (const dep of plan.exactDependencies) {
    const target = path.join(root, 'node_modules', ...dep.name.split('/'), 'package.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ name: dep.name, version: dep.version }));
  }
  const snapshots: IntegrationPlanV1['baseFileHashes'] = [
    { path: 'package.json', exists: true, sha256: hash(manifest) },
    { path: 'pnpm-lock.yaml', exists: true, sha256: hash(lock) },
  ];
  plan.localProject.workspace = '.';
  plan.localProject.fileSnapshots = snapshots;
  plan.baseFileHashes = [...snapshots, { path: 'src/components/zhinexus/component-0001.vue', exists: false }];
  const generatedPath = 'src/components/zhinexus/component-0001.vue';
  const generated = '<template><div>synthetic assertion host</div></template>\n';
  fs.mkdirSync(path.dirname(path.join(root, generatedPath)), { recursive: true });
  fs.writeFileSync(path.join(root, generatedPath), generated);
  applyResult.projectRoot = canonicalProjectRoot(root);
  applyResult.planDigest = digest(plan);
  applyResult.afterHashes = [...snapshots, { path: generatedPath, exists: true, sha256: hash(generated) }];
  applyResult.installedVersions = [];
  return { root, artifactRoot, plan, applyResult, tempRoot };
}

async function runBrowserCase(
  fixture: HostCase,
  assertions: BrowserSpec['assertions'],
  timeoutMs = 1_500,
) {
  const project = createProject();
  const controller = new AbortController();
  let actionAt = 0;
  let abortedAt = 0;
  let cancelTimer: ReturnType<typeof setTimeout> | undefined;
  const server = http.createServer((request, response) => {
    if (request.url === '/action') {
      actionAt = Date.now();
      if (fixture.cancelAfterMs !== undefined) {
        cancelTimer = setTimeout(() => { abortedAt = Date.now(); controller.abort(); }, fixture.cancelAfterMs);
      }
      response.writeHead(204).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><body style="font-family:sans-serif">
      <main id="ready">ready</main><button id="act">update</button>${fixture.body}
      <script>document.querySelector('#act').addEventListener('click', () => {
        fetch('/action');
        // This delay is the behavior under test, not a test-side readiness sleep.
        ${fixture.update ? `setTimeout(() => { ${fixture.update} }, ${fixture.delayMs ?? 250});` : ''}
      });</script></body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as import('node:net').AddressInfo;
  const spec: IntegrationVerificationSpecV1 = {
    schemaVersion: 1, projectRoot: project.applyResult.projectRoot, planDigest: digest(project.plan),
    applyResultDigest: digest(project.applyResult), commands: [], businessGaps: [],
    browser: {
      url: `http://127.0.0.1:${address.port}/`, readySelector: '#ready', timeoutMs,
      viewport: { width: 640, height: 480 }, renderer: 'canvas', theme: 'light',
      actions: [{ kind: 'click', selector: '#act' }], assertions,
    },
  };
  const authorization: IntegrationExecutionAuthorizationV1 = {
    schemaVersion: 1, projectRoot: spec.projectRoot, planDigest: spec.planDigest, applyResultDigest: spec.applyResultDigest,
    operation: 'verify', specDigest: digest(spec), allowProjectScripts: false, allowBrowser: true,
    scriptNames: [], allowedRepairPaths: [], maxAttempts: 0,
  };
  try {
    const report = await cli.verifyIntegration!(project.root, project.plan, {
      applyResult: project.applyResult, spec, authorization, artifactRoot: project.artifactRoot, signal: controller.signal,
    });
    const completedAt = Date.now();
    fs.writeFileSync(path.join(project.tempRoot, 'result.json'), JSON.stringify({
      assertions, timeoutMs, actionAt, abortedAt, completedAt, report,
    }, null, 2));
    expect(report.checks.find(check => check.id === 'dependency-guard')?.status).toBe('passed');
    expect(report.changedFiles).toEqual([]);
    expect(actionAt).toBeGreaterThan(0);
    const behavior = report.artifacts.find(artifact => artifact.path.endsWith('behavior.json'));
    return {
      report, actionAt, abortedAt, completedAt,
      behavior: behavior ? JSON.parse(fs.readFileSync(path.join(project.artifactRoot, behavior.path), 'utf8')) as { behaviorFailures: string[]; runtimeErrors: string[] } : undefined,
    };
  } finally {
    if (cancelTimer) clearTimeout(cancelTimer);
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

function expectBrowserPassed(report: IntegrationVerificationReportV1) {
  expect(report.checks.find(check => check.id === 'browser')).toMatchObject({ status: 'passed', issues: [] });
  // These focused cases supply no baseline; browser success must not manufacture visual PASS.
  expect(report.visualResult).toBe('NEW');
  expect(report.status).toBe('failed');
}

describe('verifyIntegration asynchronous DOM assertion conditions (real Chromium)', () => {
  it('waits for delayed exact first textContent while preserving trim and Playwright selectors', async () => {
    const result = await runBrowserCase({
      body: '<div class="status">pending</div><div class="status">unused</div>',
      update: `document.querySelector('.status').innerHTML = '  done<span hidden> hidden</span>  ';`,
    }, [
      { kind: 'text', selector: '.status', value: ' done hidden ' },
      { kind: 'text', selector: '.status >> nth=0', value: ' done hidden ' },
    ]);
    expectBrowserPassed(result.report);
    expect(result.behavior?.behaviorFailures).toEqual([]);
  });

  it.each([
    { name: 'insertion', body: '<i class="item"></i>', update: `document.body.insertAdjacentHTML('beforeend', '<i class="item"></i>');`, count: 2 },
    { name: 'removal to zero', body: '<i class="item"></i>', update: `document.querySelector('.item').remove();`, count: 0 },
  ])('waits for delayed exact count after $name', async fixture => {
    const result = await runBrowserCase(fixture, [{ kind: 'count', selector: '.item', count: fixture.count }]);
    expectBrowserPassed(result.report);
  });

  it.each([
    { name: 'missing element', body: '', update: `document.body.insertAdjacentHTML('beforeend', '<div class="target" style="width:40px;height:40px">done</div>');` },
    { name: 'hidden element', body: '<div class="target" style="display:none;width:40px;height:40px">done</div>', update: `document.querySelector('.target').style.display = 'block';` },
    { name: 'zero-size element', body: '<div class="target" style="width:0;height:0"></div>', update: `Object.assign(document.querySelector('.target').style, {width:'40px',height:'40px'});` },
  ])('waits for delayed nonzero visibility of $name', async fixture => {
    const result = await runBrowserCase(fixture, [{ kind: 'visible', selector: '.target' }]);
    expectBrowserPassed(result.report);
  });

  it('keeps one bounded timeout for permanent mismatches and retains all failure classifications', async () => {
    const result = await runBrowserCase({ body: '<div id="status">pending</div><i class="item"></i>' }, [
      { kind: 'text', selector: '#status', value: 'done' },
      { kind: 'visible', selector: '#missing' },
      { kind: 'count', selector: '.item', count: 2 },
    ], 600);
    expect(result.report.checks.find(check => check.id === 'browser')).toMatchObject({
      status: 'failed', issues: [{ code: 'BEHAVIOR_FAILED' }],
    });
    expect(result.behavior?.behaviorFailures).toEqual(['text_mismatch:#status', 'visible_missing:#missing', 'count_mismatch:.item:1!=2']);
    expect(result.completedAt - result.actionAt).toBeGreaterThanOrEqual(500);
    expect(result.completedAt - result.actionAt).toBeLessThan(1_600);
  });

  it('cancels promptly while waiting for an assertion condition', async () => {
    const result = await runBrowserCase({ body: '<div id="status">pending</div>', cancelAfterMs: 250 }, [
      { kind: 'text', selector: '#status', value: 'done' },
    ], 10_000);
    expect(result.abortedAt).toBeGreaterThan(0);
    expect(result.completedAt - result.abortedAt).toBeLessThan(1_500);
    expect(result.report.checks.find(check => check.id === 'browser')).toMatchObject({
      status: 'failed', issues: [{ code: 'CANCELLED' }],
    });
    expect(result.report.checks.find(check => check.id === 'visual')?.status).toBe('not-run');
  });

  it.each([
    { name: 'first text match', body: '<div class="status">wrong</div><div class="status">done</div>', assertion: { kind: 'text', selector: '.status', value: 'done' } as const },
    { name: 'internal text whitespace', body: '<div id="status">one  two</div>', assertion: { kind: 'text', selector: '#status', value: 'one two' } as const },
    { name: 'exact count', body: '<i class="item"></i><i class="item"></i><i class="item"></i>', assertion: { kind: 'count', selector: '.item', count: 2 } as const },
    { name: 'first visible match', body: '<div class="target" hidden>hidden</div><div class="target">shown</div>', assertion: { kind: 'visible', selector: '.target' } as const },
  ])('does not weaken existing $name semantics', async fixture => {
    const result = await runBrowserCase(fixture, [fixture.assertion], 300);
    expect(result.report.checks.find(check => check.id === 'browser')).toMatchObject({
      status: 'failed', issues: [{ code: 'BEHAVIOR_FAILED' }],
    });
    expect(result.behavior?.behaviorFailures).toHaveLength(1);
  });
});
