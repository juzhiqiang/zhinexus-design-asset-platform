/**
 * T17-D independent live acceptance: only executes an externally installed, SHA-pinned CLI tarball.
 * The temporary applications and locally signed OIDC identity are synthetic; the SDK, npm install,
 * PostgreSQL/Verdaccio/MinIO publication, HTTP, Chromium, native scripts and MCP stdio are real.
 * Required inputs are mandatory. This suite never promotes local evidence to production acceptance.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateIntegrationApplyResult, validateIntegrationPlan, validateIntegrationRepairResult,
  validateIntegrationVerificationReport, validateIntegrationVerificationSpec, validateMatchPlan,
  type IntegrationApplyResultV1, type IntegrationPlanV1, type IntegrationVerificationReportV1, type IntegrationVerificationSpecV1,
} from '@company/contracts';
import { prepareT17LocalServices, type T17LocalServices } from '../t17-host/local-services.js';
import { cleanEnvironment, digestOf, evidenceArea, installFrozenCli, recordCaseEvidence, required, requiredDirectory, requiredFile, sha256, singleJson, snapshotTree } from './support.mjs';
import { declaredLineApi, EXPECTED_SDK_MANIFEST_SHA256, makeLiveMatch, scaffoldLiveProject, SDK_PACKAGE_SHA256, type LiveFramework, type LiveProject } from './live-support.js';
import { LIVE_POINT, LIVE_READY, LIVE_VIEWPORT, observeLivePage } from './live-browser.js';
import { observeLiveInstallLogs, openLiveMcp, processAlive, runLive, terminateOwnedTree, until } from './live-process.js';

type Frozen = Awaited<ReturnType<typeof installFrozenCli>>;
type Session = Awaited<ReturnType<typeof openLiveMcp>>;
let frozen: Frozen | undefined, services: T17LocalServices | undefined, area: string | undefined;
let npmCli: string, env: Record<string, string>, owner: string;
const secrets = () => services ? [services.apiToken, services.registryToken] : [];
const summaries = new Map<string, { plan: IntegrationPlanV1; apply: IntegrationApplyResultV1; report: IntegrationVerificationReportV1; generatedSha256: string }>();
const receipts: Array<{ caseId: string; evidencePath: string; sha256: string }> = [];
const sessions = new Set<Session>();
const hosts = new Set<{ close(): Promise<void> }>();
const activeProjectPids = new Set<number>();

async function jsonFile(directory: string, name: string, value: unknown) {
  const text = JSON.stringify(value, null, 2) + '\n';
  if (secrets().some(secret => text.includes(secret))) throw new Error('Sensitive credential found in independent evidence.');
  const file = join(directory, name); await writeFile(file, text); return file;
}
async function save(caseId: string, kind: 'positive' | 'refusal', value: Record<string, unknown>) {
  const receipt = await recordCaseEvidence({ area: area!, caseId, kind, value: { ...value, productionAcceptance: false,
    frozenCli: { version: frozen!.version, sha256: frozen!.sha256 }, sdkManifestSha256: EXPECTED_SDK_MANIFEST_SHA256 }, secrets: secrets() });
  receipts.push(receipt); await frozen!.assertUnchanged();
  await jsonFile(area!, 'live-receipts.json', { receipts, productionAcceptance: false, caseKinds: 'independently asserted real local success and refusal', complete: false });
}
async function cli(project: LiveProject, args: string[], expectedCode = 0) {
  const stopObservation = args[0] === 'apply' ? observeLiveInstallLogs(dirname(project.root), secrets()) : undefined;
  const result = await runLive(process.execPath, [frozen!.bin, 'integrate', ...args], { cwd: project.root, env, timeoutMs: 600_000 }).finally(async () => {
    if (stopObservation) await jsonFile(project.artifactRoot, 'independent-install-logs.json', await stopObservation());
  });
  const redact = (value: string) => secrets().reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), value);
  await jsonFile(project.artifactRoot, 'cli-' + args[0] + '-' + randomUUID() + '.json', { argv: ['integrate', ...args], cwd: project.root, code: result.code, timedOut: result.timedOut, stdout: redact(result.stdout), stderr: redact(result.stderr) });
  expect(secrets().some(secret => result.stdout.includes(secret) || result.stderr.includes(secret)), 'frozen CLI output must never expose credentials').toBe(false);
  const parsed = singleJson(result);
  expect(result.timedOut, 'frozen CLI timed out').toBe(false);
  expect(result.code, 'frozen CLI output: ' + redact(result.stdout) + '\n' + redact(result.stderr)).toBe(expectedCode);
  await frozen!.assertUnchanged(); return parsed;
}
async function session(project: LiveProject, stage: string, grants: Record<string, unknown> = {}) {
  const config = await jsonFile(project.artifactRoot, 'mcp-' + stage + '.json', { schemaVersion: 1, projectRoot: project.root.replaceAll('\\', '/'),
    artifactRoot: project.artifactRoot, allowedApiOrigins: [services!.apiUrl], allowedRegistryOrigins: [services!.registryUrl], ...grants });
  const connected = await openLiveMcp({ node: process.execPath, bin: frozen!.bin, config, cwd: project.root, env, sensitiveValues: secrets() });
  sessions.add(connected);
  expect((await connected.client.listTools()).tools.map(tool => tool.name).sort()).toEqual(['apply_integration', 'inspect_project', 'plan_integration', 'verify_integration']);
  return connected;
}
async function closeSession(connected: Session) { const result = await connected.close(); sessions.delete(connected); return result; }
function verificationSpec(project: LiveProject, plan: IntegrationPlanV1, apply: IntegrationApplyResultV1, manifestSha256: string,
  browser?: IntegrationVerificationSpecV1['browser']): IntegrationVerificationSpecV1 {
  return { schemaVersion: 1, projectRoot: project.root.replaceAll('\\', '/'), planDigest: digestOf(plan), applyResultDigest: digestOf(apply),
    commands: [{ kind: 'type', script: 'typecheck', manifestPath: 'package.json', manifestSha256, timeoutMs: 120_000, outputDirectories: [] },
      { kind: 'build', script: 'build', manifestPath: 'package.json', manifestSha256, timeoutMs: 120_000, outputDirectories: ['dist'] }], businessGaps: [], ...(browser ? { browser } : {}) };
}
function verifyGrant(spec: IntegrationVerificationSpecV1) {
  return { schemaVersion: 1, operation: 'verify', projectRoot: spec.projectRoot, planDigest: spec.planDigest, applyResultDigest: spec.applyResultDigest,
    specDigest: digestOf(spec), allowProjectScripts: true, allowBrowser: Boolean(spec.browser), scriptNames: [...new Set(spec.commands.map(command => command.script))], allowedRepairPaths: [], maxAttempts: 0 };
}
function assertReport(plan: IntegrationPlanV1, apply: IntegrationApplyResultV1, spec: IntegrationVerificationSpecV1, report: IntegrationVerificationReportV1) {
  const checked = validateIntegrationVerificationReport(report, { plan, applyResult: apply, spec, projectRoot: spec.projectRoot, planDigest: digestOf(plan), applyResultDigest: digestOf(apply), specDigest: digestOf(spec) });
  expect(checked, 'verification report must satisfy the public contract and independently hashed inputs').toMatchObject({ ok: true });
  expect(report.status).toBe('passed'); expect(report.visualResult).toBe('PASS'); expect(report.pendingItems).toEqual([]); expect(report.changedFiles).toEqual([]);
  expect(report.checks.every(check => check.status === 'passed')).toBe(true);
  expect(new Set(report.checks.map(check => check.category))).toEqual(new Set(['type', 'build', 'behavior', 'visual', 'missing-business-info']));
  expect(report.checks.find(check => check.id === 'dependency-guard')?.status).toBe('passed');
  expect(report.installedVersions.map(({ name, version }) => ({ name, version })).sort((a, b) => a.name.localeCompare(b.name)))
    .toEqual([...plan.exactDependencies].sort((a, b) => a.name.localeCompare(b.name)));
}
async function assertHooksAbsent(project: LiveProject) { await expect(lstat(join(project.root, 'live-hook-executed.txt'))).rejects.toMatchObject({ code: 'ENOENT' }); }

describe('frozen installed CLI independent real local success', () => {
  beforeAll(async () => {
    // All external evidence is explicit, including this separate frozen SDK (no repack or reconstruction).
    const tarball = await requiredFile('T17_D_CLI_TARBALL'), sdkBundle = await requiredDirectory('T17_D_SDK_BUNDLE');
    npmCli = await requiredFile('T17_D_NPM_CLI');
    const expectedVersion = required('T17_D_CLI_VERSION');
    expect(sha256(await readFile(tarball))).toBe(required('T17_D_CLI_SHA256'));
    expect(sha256(await readFile(join(sdkBundle, 'manifest.json')))).toBe(EXPECTED_SDK_MANIFEST_SHA256);
    area = await evidenceArea('t17-d-live-'); owner = JSON.stringify({ runId: randomUUID(), realRoot: area, purpose: 'owned-independent-live-acceptance' });
    await mkdir(join(area, 'projects')); await writeFile(join(area, 'projects', '.live-owner.json'), owner, { flag: 'wx' });
    frozen = await installFrozenCli({ area, tarball, node: process.execPath, npmCli, expectedVersion });
    await writeFile(join(frozen.root, '.live-owner.json'), owner, { flag: 'wx' });
    services = await prepareT17LocalServices({ sdkBundle, evidenceDirectory: join(area, 'services'), compatibilityEvidence: {
      file: await requiredFile('T17_D_COMPATIBILITY_EVIDENCE'), sha256: required('T17_D_COMPATIBILITY_SHA256'),
    } });
    expect(services.sdkManifestSha256).toBe(EXPECTED_SDK_MANIFEST_SHA256);
    env = await cleanEnvironment(area, 'live-command', { dirs: [dirname(process.execPath), join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')] });
    // Browser lookup is a toolchain path, while all npm caches/configs and credentials remain isolated.
    env.PLAYWRIGHT_BROWSERS_PATH = await requiredDirectory('PLAYWRIGHT_BROWSERS_PATH');
    env.ZHINEXUS_API_TOKEN = services.apiToken; env.ZHINEXUS_REGISTRY_TOKEN = services.registryToken;
    await jsonFile(area, 'live-boundary.json', { productionAcceptance: false, localOidc: 'locally signed test identity', businessData: 'temporary independent synthetic application',
      frozenCli: { version: frozen.version, sha256: frozen.sha256, tarball }, frozenSdk: { root: sdkBundle, sha256: EXPECTED_SDK_MANIFEST_SHA256 }, commandWorkingDirectory: 'the external target project', evidenceDirectory: area });
  }, 600_000);

  afterAll(async () => {
    const cleanupErrors: unknown[] = [];
    for (const pid of activeProjectPids) try { await terminateOwnedTree(pid); } catch (error) { cleanupErrors.push(error); }
    for (const connected of sessions) try { await connected.close(); } catch (error) { cleanupErrors.push(error); }
    for (const host of hosts) try { await host.close(); } catch (error) { cleanupErrors.push(error); }
    if (frozen) try { await frozen.assertUnchanged(); } catch (error) { cleanupErrors.push(error); }
    if (services) try { await services.close(); } catch (error) { cleanupErrors.push(error); }
    if (area) for (const directory of [join(area, 'projects'), ...(frozen ? [frozen.root] : [])]) try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== resolve(directory) || await readFile(join(directory, '.live-owner.json'), 'utf8') !== owner) throw new Error('Independent temporary root ownership changed.');
      await rm(directory, { recursive: true, force: false });
    } catch (error) { cleanupErrors.push(error); }
    const passed = cleanupErrors.length === 0 && summaries.size === 4 && receipts.some(receipt => receipt.caseId === 'D-live-mcp-cancel') && receipts.some(receipt => receipt.caseId === 'D-live-cli-mcp-equivalence');
    if (area) await jsonFile(area, 'live-receipts.json', { receipts, productionAcceptance: false, caseKinds: 'independently asserted real local success and refusal', complete: passed });
    if (area) await jsonFile(area, 'live-final-cleanup.json', { productionAcceptance: false, ownedProcessTreesCleaned: activeProjectPids.size === 0,
      servicesClosed: Boolean(services) && cleanupErrors.length === 0, completedChains: [...summaries.keys()], expectedChains: ['vue-cli', 'vue-mcp', 'react-cli', 'react-mcp'], cleanupFailures: cleanupErrors.length,
      passed });
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Independent live acceptance cleanup failed.');
  }, 120_000);

  for (const framework of ['vue', 'react'] as const) for (const mode of ['cli', 'mcp'] as const) {
    it(framework + ' ' + mode + ' inspects, plans, actually applies, builds, clicks and passes the independent direct-SDK visual baseline', async () => {
      const project = await scaffoldLiveProject(area!, framework, mode);
      const installed = await runLive(process.execPath, [npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/'], { cwd: project.root, env, timeoutMs: 600_000 });
      expect(installed.code, installed.stdout + installed.stderr).toBe(0); expect(installed.timedOut).toBe(false); await assertHooksAbsent(project);
      const variants = JSON.parse(await readFile(services!.variantsFile, 'utf8')) as { variants: Array<{ componentId: string; framework: string; variantReleaseId: string }> };
      const variant = variants.variants.find(value => value.componentId === 'line' && value.framework === framework);
      if (!variant) throw new Error('Real locally published line variant is missing.');
      // Check real authoritative API against independent literals, rather than accepting arbitrary product declarations.
      const detailResponse = await fetch(services!.apiUrl + '/v1/me/variant-releases/' + variant.variantReleaseId, { headers: { authorization: 'Bearer ' + services!.apiToken } });
      expect(detailResponse.status).toBe(200);
      const detail = await detailResponse.json() as { variant: { api: { path: string; sha256: string; bytes: number } } };
      const apiResponse = await fetch(services!.apiUrl + '/v1/me/variant-releases/' + variant.variantReleaseId + '/artifacts?path=' + encodeURIComponent(detail.variant.api.path), { headers: { authorization: 'Bearer ' + services!.apiToken } });
      expect(apiResponse.status).toBe(200);
      const apiBytes = Buffer.from(await apiResponse.arrayBuffer()); expect(sha256(apiBytes)).toBe(detail.variant.api.sha256); expect(apiBytes.length).toBe(detail.variant.api.bytes);
      const api = JSON.parse(apiBytes.toString('utf8')) as { props: unknown; events: unknown };
      expect(api.props).toEqual(declaredLineApi(framework).props); expect(api.events).toEqual(declaredLineApi(framework).events);
      if (!services!.acceptedCompatibilityFile) throw new Error('Independent success requires real API-accepted historical compatibility evidence.');
      const accepted = JSON.parse(await readFile(services!.acceptedCompatibilityFile, 'utf8')) as { records: Array<{ variantReleaseId: string; compatibilityId: string }> };
      const compatibilityIds = accepted.records.filter(record => record.variantReleaseId === variant.variantReleaseId).map(record => record.compatibilityId);
      expect(compatibilityIds).toHaveLength(1);
      const match = makeLiveMatch(framework, variant.variantReleaseId, compatibilityIds);
      expect(validateMatchPlan(match)).toMatchObject({ ok: true });
      const matchFile = await jsonFile(project.artifactRoot, 'independent-match.json', match);
      const beforeReadOnly = await snapshotTree(project.root);
      const cliInspect = await cli(project, ['inspect', '--project', project.root]);
      const cliPlan = await cli(project, ['plan', '--project', project.root, '--match', matchFile, '--api-url', services!.apiUrl, '--registry', services!.registryUrl]);
      let plan = cliPlan as IntegrationPlanV1;
      if (mode === 'mcp') {
        const connected = await session(project, 'read-only');
        try {
          const mcpInspect = await connected.tool('inspect_project', {});
          expect(mcpInspect).toEqual(cliInspect);
          const mcpPlan = await connected.tool('plan_integration', { matchPlan: match, apiUrl: services!.apiUrl, registryUrl: services!.registryUrl }) as IntegrationPlanV1;
          const stablePlan = (value: IntegrationPlanV1) => ({ ...value, publicationEvidence: value.publicationEvidence.map(({ response }) => ({ response })) });
          expect(stablePlan(mcpPlan)).toEqual(stablePlan(plan)); plan = mcpPlan;
          await expect(connected.tool('apply_integration', { plan, apiUrl: services!.apiUrl, registryUrl: services!.registryUrl })).rejects.toThrow('AUTHORIZATION_REQUIRED');
          expect(await snapshotTree(project.root)).toEqual(beforeReadOnly);
          await save('D-live-' + framework + '-mcp-apply-no-grant', 'refusal', { framework, tool: 'apply_integration', validActualPlan: true, errorCode: 'AUTHORIZATION_REQUIRED', sourcePreserved: true });
        } finally { await jsonFile(project.artifactRoot, 'mcp-read-only-protocol.json', await closeSession(connected)); }
      }
      expect(await snapshotTree(project.root)).toEqual(beforeReadOnly);
      expect(validateIntegrationPlan(plan)).toMatchObject({ ok: true }); expect(plan.status).toBe('planned'); expect(plan.conflicts).toEqual([]);
      expect(plan.sourceMatchPlan).toEqual(match); expect(plan.exactDependencies).toEqual(match.exactDependencies);
      expect(plan.changes).toContainEqual({ kind: 'generated-component', path: project.generatedPath, instanceId: 'node-1', framework });
      expect(plan.registryEvidence).toContainEqual(expect.objectContaining({ name: '@company/charts-' + framework, version: '0.0.12', sha256: SDK_PACKAGE_SHA256[framework], verification: 'platform-sha256' }));
      const planFile = await jsonFile(project.artifactRoot, 'plan.json', plan);
      let apply: IntegrationApplyResultV1;
      if (mode === 'cli') apply = await cli(project, ['apply', '--project', project.root, '--plan', planFile, '--api-url', services!.apiUrl, '--registry', services!.registryUrl,
        '--backup-root', join(project.artifactRoot, 'cli-backups'), '--allow-install', 'true']) as IntegrationApplyResultV1;
      else {
        const connected = await session(project, 'apply', { applyGrant: { schemaVersion: 1, operation: 'apply', projectRoot: project.root.replaceAll('\\', '/'), planDigest: digestOf(plan), allowedPaths: plan.allowedPaths, allowInstall: true } });
        const stopObservation = observeLiveInstallLogs(dirname(project.root), secrets());
        try { apply = await connected.tool('apply_integration', { plan, apiUrl: services!.apiUrl, registryUrl: services!.registryUrl }) as IntegrationApplyResultV1; }
        finally { await jsonFile(project.artifactRoot, 'independent-install-logs.json', await stopObservation()); await jsonFile(project.artifactRoot, 'mcp-apply-protocol.json', await closeSession(connected)); }
      }
      expect(validateIntegrationApplyResult(apply, { plan, planDigest: digestOf(plan), projectRoot: project.root.replaceAll('\\', '/') })).toMatchObject({ ok: true });
      expect(apply.status).toBe('applied'); expect(apply.installState).toBe('succeeded'); expect(apply.issues).toEqual([]); expect(apply.changedFiles).toContain(project.generatedPath);
      await assertHooksAbsent(project);
      const generated = await readFile(join(project.root, project.generatedPath));
      expect(generated.toString()).toContain('@company/charts-' + framework + '/line');
      expect(generated.toString()).toContain('independentRevenue'); expect(generated.toString()).toContain('observeRevenuePoint');
      const applyFile = await jsonFile(project.artifactRoot, 'apply.json', apply);
      const build = await runLive(process.execPath, [npmCli, '--ignore-scripts', 'run', 'build'], { cwd: project.root, env, timeoutMs: 120_000 });
      expect(build.code, build.stdout + build.stderr).toBe(0); await assertHooksAbsent(project);
      const graph = JSON.parse(await readFile(project.graphPath, 'utf8')) as Array<{ modules: string[] }>;
      expect(graph.some(chunk => chunk.modules.some(source => source.replaceAll('\\', '/').endsWith(project.generatedPath)))).toBe(true);
      const { serveStatic } = await import('./support.mjs');
      const host = await serveStatic(join(project.root, 'dist')); hosts.add(host);
      try {
        const baseline = await observeLivePage(project, host.origin, 'reference');
        const generatedObservation = await observeLivePage(project, host.origin, 'generated');
        expect(generatedObservation.environment).toEqual(baseline.environment);
        const browser: NonNullable<IntegrationVerificationSpecV1['browser']> = { url: host.origin + '/', readySelector: LIVE_READY, timeoutMs: 30_000, viewport: LIVE_VIEWPORT, renderer: 'svg', theme: 'light',
          actions: [{ kind: 'click', selector: LIVE_POINT }], assertions: [{ kind: 'visible', selector: '.charts-line svg' }, { kind: 'text', selector: '[data-live-count]', value: '1' }],
          visual: { baseline: { image: baseline.image, environment: baseline.environment }, pixelThreshold: 0.1, maxDiffPixelRatio: 0.001 } };
        const manifestSha256 = sha256(await readFile(join(project.root, 'package.json'))), spec = verificationSpec(project, plan, apply, manifestSha256, browser);
        expect(validateIntegrationVerificationSpec(spec, { plan, applyResult: apply })).toMatchObject({ ok: true });
        const specFile = await jsonFile(project.artifactRoot, 'spec.json', spec), sourceBeforeVerify = await snapshotTree(project.root, ['dist']);
        let report: IntegrationVerificationReportV1;
        if (mode === 'cli') report = await cli(project, ['verify', '--project', project.root, '--plan', planFile, '--apply-result', applyFile, '--spec', specFile, '--out', project.artifactRoot,
          '--allow-project-scripts', 'true', '--allow-browser', 'true']) as IntegrationVerificationReportV1;
        else {
          const ungranted = await session(project, 'verify-no-grant');
          try {
            await expect(ungranted.tool('verify_integration', { plan, applyResult: apply, spec })).rejects.toThrow('AUTHORIZATION_REQUIRED');
            expect(await snapshotTree(project.root, ['dist'])).toEqual(sourceBeforeVerify);
            await save('D-live-' + framework + '-mcp-verify-no-grant', 'refusal', { framework, tool: 'verify_integration', validActualApplyAndSpec: true, errorCode: 'AUTHORIZATION_REQUIRED', sourcePreserved: true });
          } finally { await jsonFile(project.artifactRoot, 'mcp-verify-no-grant-protocol.json', await closeSession(ungranted)); }
          const connected = await session(project, 'verify', { verificationGrant: verifyGrant(spec) });
          try { report = await connected.tool('verify_integration', { plan, applyResult: apply, spec }) as IntegrationVerificationReportV1; }
          finally { await jsonFile(project.artifactRoot, 'mcp-verify-protocol.json', await closeSession(connected)); }
        }
        await jsonFile(project.artifactRoot, 'verify.json', report);
        assertReport(plan, apply, spec, report);
        expect(report.environment).toEqual(baseline.environment);
        expect(await snapshotTree(project.root, ['dist'])).toEqual(sourceBeforeVerify); await assertHooksAbsent(project);
        for (const artifact of report.artifacts) { const bytes = await readFile(join(project.artifactRoot, artifact.path)); expect(sha256(bytes)).toBe(artifact.sha256); expect(bytes.length).toBe(artifact.bytes); }
        await save('D-live-' + framework + '-' + mode, 'positive', { framework, mode, projectRoot: project.root, planDigest: digestOf(plan), applyResultDigest: digestOf(apply), specDigest: digestOf(spec), reportDigest: digestOf(report),
          reportStatus: report.status, visualResult: report.visualResult, baseline, generatedObservation, generatedSha256: sha256(generated), generatedPath: project.generatedPath, realInstall: true, nativeTypecheckAndBuild: true, hooksAbsent: true });
        if (mode === 'cli') await exerciseUnrepairableBusinessFailure(project, plan, apply, spec, planFile, applyFile);
        if (mode === 'mcp' && framework === 'react') await exerciseCancellation(project, plan, apply, spec, manifestSha256);
        summaries.set(framework + '-' + mode, { plan, apply, report, generatedSha256: sha256(generated) });
      } finally { await host.close(); hosts.delete(host); }
    });
  }

  it('compares all four real CLI/MCP outcomes using independent expected semantics', async () => {
    expect([...summaries.keys()].sort()).toEqual(['react-cli', 'react-mcp', 'vue-cli', 'vue-mcp']);
    for (const framework of ['vue', 'react']) {
      const a = summaries.get(framework + '-cli')!, b = summaries.get(framework + '-mcp')!;
      expect(a.generatedSha256).toBe(b.generatedSha256);
      expect(a.apply.changedFiles).toEqual(b.apply.changedFiles); expect(a.apply.installedVersions).toEqual(b.apply.installedVersions);
      expect(a.plan.exactDependencies).toEqual(b.plan.exactDependencies);
      expect(a.report.checks.map(({ category, status }) => ({ category, status }))).toEqual(b.report.checks.map(({ category, status }) => ({ category, status })));
      expect(a.report.environment).toEqual(b.report.environment);
    }
    await save('D-live-cli-mcp-equivalence', 'positive', { frameworks: ['vue', 'react'], tools: ['inspect_project', 'plan_integration', 'apply_integration', 'verify_integration'], generatedBytesIdentical: true, realBuildBehaviorVisualEquivalence: true });
  });
});

async function exerciseUnrepairableBusinessFailure(project: LiveProject, plan: IntegrationPlanV1, apply: IntegrationApplyResultV1, spec: IntegrationVerificationSpecV1, planFile: string, applyFile: string) {
  const badSpec = structuredClone(spec);
  badSpec.browser!.assertions.push({ kind: 'text', selector: '[data-live-count]', value: '2' }); // Independent unmet expectation; generated files remain correct.
  const specFile = await jsonFile(project.artifactRoot, 'unmet-business-spec.json', badSpec), before = await snapshotTree(project.root, ['dist']);
  const report = await cli(project, ['verify', '--project', project.root, '--plan', planFile, '--apply-result', applyFile, '--spec', specFile, '--out', project.artifactRoot, '--allow-project-scripts', 'true', '--allow-browser', 'true'], 2) as IntegrationVerificationReportV1;
  expect(report.status).toBe('failed'); expect(report.pendingItems.some(issue => issue.code === 'BEHAVIOR_FAILED')).toBe(true);
  const reportFile = await jsonFile(project.artifactRoot, 'unmet-business-report.json', report);
  const repaired = await cli(project, ['repair', '--project', project.root, '--plan', planFile, '--apply-result', applyFile, '--spec', specFile, '--out', project.artifactRoot, '--allow-project-scripts', 'true', '--allow-browser', 'true', '--report', reportFile, '--max-attempts', '1'], 2);
  expect(validateIntegrationRepairResult(repaired, { plan, applyResult: apply, spec: badSpec, projectRoot: badSpec.projectRoot, planDigest: digestOf(plan), applyResultDigest: digestOf(apply), specDigest: digestOf(badSpec), sourceReport: report, reportDigest: digestOf(report) })).toMatchObject({ ok: true });
  expect(repaired.status).toBe('stopped'); expect(repaired.stopReason).toBe('verification-failed'); expect(repaired.attempts).toEqual([]); expect(repaired.changedFiles).toEqual([]);
  expect(await snapshotTree(project.root, ['dist'])).toEqual(before);
  await save('D-live-' + project.framework + '-unrepairable', 'refusal', { framework: project.framework, reportStatus: report.status, issueCodes: report.pendingItems.map(issue => issue.code), repair: repaired, preservedSource: true });
}

async function exerciseCancellation(project: LiveProject, plan: IntegrationPlanV1, apply: IntegrationApplyResultV1, passedSpec: IntegrationVerificationSpecV1, manifestSha256: string) {
  const { browser: _passedBrowser, ...withoutBrowser } = passedSpec;
  const spec: IntegrationVerificationSpecV1 = { ...withoutBrowser, commands: [{ kind: 'type', script: 'slowcheck', manifestPath: 'package.json', manifestSha256, timeoutMs: 120_000, outputDirectories: ['dist'] }] };
  const connected = await session(project, 'cancel', { verificationGrant: verifyGrant(spec) });
  const controller = new AbortController(), before = await snapshotTree(project.root, ['dist']);
  const pending = connected.tool('verify_integration', { plan, applyResult: apply, spec }, { signal: controller.signal }).then(value => ({ value }), error => ({ error }));
  const observed: Array<{ pid: number; parentPid: number; role: string }> = [];
  try {
    for (const role of ['parent', 'child', 'grandchild']) {
      const file = join(project.cancellationDirectory, role + '.json');
      await until(async () => { try { await readFile(file); return true; } catch { return false; } }, 30_000);
      const value = JSON.parse(await readFile(file, 'utf8')) as { pid: number; parentPid: number; role: string };
      expect(value.role).toBe(role); expect(Number.isInteger(value.pid) && value.pid > 0).toBe(true); expect(processAlive(value.pid)).toBe(true);
      observed.push(value); activeProjectPids.add(value.pid);
    }
    expect(new Set(observed.map(value => value.pid)).size).toBe(3);
    expect(observed[1]!.parentPid).toBe(observed[0]!.pid); expect(observed[2]!.parentPid).toBe(observed[1]!.pid);
    controller.abort();
    const result = await pending;
    expect('error' in result).toBe(true);
    await until(() => observed.every(value => !processAlive(value.pid)), 15_000);
    observed.forEach(value => activeProjectPids.delete(value.pid));
    expect(connected.sentMethods).toContain('notifications/cancelled');
    expect((await connected.client.listTools()).tools).toHaveLength(4);
    expect((await connected.tool('inspect_project', {})).status).toBe('inspected');
    expect(await snapshotTree(project.root, ['dist'])).toEqual(before);
    const protocol = await closeSession(connected);
    await save('D-live-mcp-cancel', 'positive', { realMcpSdk: true, cancellationNotificationSent: true, ownedProcesses: observed, exitedBeforeClosingServer: true, serverRemainedResponsive: true, sourcePreserved: true, protocol });
  } finally {
    controller.abort();
    for (const value of observed) { if (processAlive(value.pid)) await terminateOwnedTree(value.pid); activeProjectPids.delete(value.pid); }
    if (sessions.has(connected)) await closeSession(connected);
    await pending;
  }
}
