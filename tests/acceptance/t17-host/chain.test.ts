/**
 * T17 owned-host 临时消费者真实 CLI 验收链（支架测试，与产品级验收分离）。
 *
 * 覆盖：
 * - 缺失冻结 tarball / 服务凭据 / SDK bundle / 变体映射时 fail-closed；
 * - 严禁把 T16 inspect 结果冒充 T17 验收通过；
 * - plan / apply / verify / repair 输出均须通过 @company/contracts 校验并严格绑定 root/plan/apply/spec 摘要；
 * - repair 严格限制修复预算（maxAttempts 仅接受 0|1|2，attempts.length <= maxAttempts）；
 * - 子进程清理验证（stopOwnedProcesses 确保退出后无残留子进程，且凭据不进入 argv）。
 */
import { createHash } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { canonicalJson } from '@company/contracts';
import { validateIntegrationApplyResult, validateIntegrationPlan, validateIntegrationRepairResult, validateIntegrationVerificationReport, validateIntegrationVerificationSpec } from '@company/contracts';
import type { ArtifactRef, IntegrationApplyResultV1, IntegrationPlanV1, IntegrationRepairResultV1, IntegrationVerificationReportV1, IntegrationVerificationSpecV1, MatchPlanV1 } from '@company/contracts';
import { validIntegrationPlanFixture, validInspectionFixture } from '../../fixtures/integration-plan.js';
import { applyResultFixture } from '../../fixtures/integration-apply.js';
import { verificationReportFixture, verificationSpecFixture } from '../../fixtures/integration-verification.js';
import { repairResultFixture, repairSourceReportFixture } from '../../fixtures/integration-repair.js';
import { componentMatchResponseFixture } from '../../fixtures/component-match.js';
import { matchPlanFixture } from '../../fixtures/match-plan.js';
import { buildMatchPlanForHost, buildVerificationSpecForHost, normalizeVueHostGeneratedImport } from './chain.js';
import type { T17HostChainReceipt } from './chain.js';
import type { T17HostInputs } from './e2e-config.js';
import * as host from './host.js';
import * as runtime from './runtime.js';
import * as hostConfig from './e2e-config.js';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const digest = (value: unknown) => sha(canonicalJson(value));

function makeValidStageEvidence(framework: 'vue' | 'react', projectRoot: string, options: { baseline?: ArtifactRef; generatedSha256?: string } = {}) {
  const response = componentMatchResponseFixture(framework);
  response.gaps = [];
  response.target!.compatibility = { status: 'verified', recordIds: [`compat-${framework}-line`] };
  const frameworkVersion = framework === 'vue' ? '3.5.45' : '19.3.1';
  const inspection = validInspectionFixture();
  const generatedPath = `src/components/zhinexus/component-0001.${framework === 'vue' ? 'vue' : 'tsx'}`;
  const localProject = { ...inspection, packageManager: 'npm' as const, lockfile: { path: 'package-lock.json', format: 'npm-v3' as const }, framework,
    resolvedDependencies: [
      { name: framework, version: frameworkVersion, specifier: frameworkVersion },
      ...(framework === 'react' ? [{ name: 'react-dom', version: '19.3.1', specifier: '19.3.1' }] : []),
      { name: 'echarts', version: '6.1.0', specifier: '6.1.0' },
    ],
    fileSnapshots: inspection.fileSnapshots.map(file => file.path === 'pnpm-lock.yaml' ? { ...file, path: 'package-lock.json' } : file),
  };
  const sourceFixture = matchPlanFixture() as MatchPlanV1;
  const source: MatchPlanV1 = {
    ...sourceFixture,
    context: { framework, frameworkVersion, echartsVersion: '6.1.0', packageManager: 'npm', requirements: [] },
    elements: [{ ...sourceFixture.elements[0]!, target: response.target!,
      props: response.api!.props.map(prop => ({ ...prop, ...(prop.required ? { source: 'revenue' } : {}) })),
      events: response.api!.events.map(event => ({ ...event, handler: 'onChartClick' })), gaps: [] }],
    exactDependencies: response.exactDependencies,
    gaps: [],
  };
  const plan: IntegrationPlanV1 = {
    ...validIntegrationPlanFixture(),
    localProject,
    sourceMatchPlan: source,
    matchPlanDigest: digest(source),
    exactDependencies: response.exactDependencies,
    baseFileHashes: [...localProject.fileSnapshots.map(file => ({ ...file })), { path: generatedPath, exists: false }],
    allowedPaths: ['package.json', 'package-lock.json', generatedPath],
    changes: [
    { kind: 'package-json', path: 'package.json', dependencies: [{ name: response.target!.packageName, version: response.target!.packageVersion }] },
    { kind: 'lockfile-regeneration', path: 'package-lock.json' },
    { kind: 'generated-component', path: generatedPath, instanceId: 'node-1', framework },
    ],
    publicationEvidence: [{ response, checkedAt: '2026-11-18T12:00:00Z' }],
    registryEvidence: [{ name: response.target!.packageName, version: response.target!.packageVersion, sha256: response.target!.packageSha256,
      integrity: 'sha512-' + 'A'.repeat(86) + '==', verification: 'platform-sha256' }],
    commands: [{ executable: 'npm', args: ['install', '--ignore-scripts'], cwd: '.', purpose: 'install' }],
    packageManager: 'npm',
  };
  const planResult = validateIntegrationPlan(plan);
  if (!planResult.ok) throw new Error('Test plan fixture is invalid: ' + JSON.stringify(planResult.issues));
  const planDigest = digest(planResult.value);
  const applyFixture = applyResultFixture() as unknown as IntegrationApplyResultV1;
  const afterHashes = plan.allowedPaths.map(path => ({ path, exists: true as const, sha256: path === generatedPath ? options.generatedSha256 ?? 'e'.repeat(64) : 'e'.repeat(64) }));
  const applyRaw: IntegrationApplyResultV1 = { ...applyFixture, projectRoot, planDigest,
    changedFiles: [...plan.allowedPaths], beforeHashes: plan.baseFileHashes, afterHashes,
    installedVersions: plan.exactDependencies.map(dep => ({ ...dep })) } as unknown as IntegrationApplyResultV1;
  const applyResult = validateIntegrationApplyResult(applyRaw, { plan: planResult.value, planDigest, projectRoot });
  if (!applyResult.ok) throw new Error('Test apply fixture is invalid: ' + JSON.stringify(applyResult.issues));
  const applyDigest = digest(applyResult.value);
  const specFixture = verificationSpecFixture() as unknown as IntegrationVerificationSpecV1;
  const spec = { ...specFixture, projectRoot, planDigest, applyResultDigest: applyDigest,
    commands: specFixture.commands.map(command => ({ ...command, manifestSha256: 'e'.repeat(64) })),
    browser: { ...specFixture.browser!, visual: { ...specFixture.browser!.visual!, baseline: { ...specFixture.browser!.visual!.baseline,
      image: options.baseline ?? specFixture.browser!.visual!.baseline.image,
      environment: { ...specFixture.browser!.visual!.baseline.environment, frameworkVersion } } } } } as unknown as IntegrationVerificationSpecV1;
  const specResult = validateIntegrationVerificationSpec(spec, { plan: planResult.value, applyResult: applyResult.value, projectRoot, planDigest, applyResultDigest: applyDigest });
  if (!specResult.ok) throw new Error('Test spec fixture is invalid: ' + JSON.stringify(specResult.issues));
  const specDigest = digest(specResult.value);
  const reportFixture = verificationReportFixture() as unknown as IntegrationVerificationReportV1;
  const reportRaw: IntegrationVerificationReportV1 = { ...reportFixture, projectRoot, planDigest, applyResultDigest: applyDigest, specDigest,
    snapshots: { before: afterHashes, after: afterHashes },
    installedVersions: plan.exactDependencies.map(dep => ({ ...dep, manifestSha256: 'a'.repeat(64) })),
    environment: { ...reportFixture.environment!, frameworkVersion } } as unknown as IntegrationVerificationReportV1;
  const reportResult = validateIntegrationVerificationReport(reportRaw, { plan: planResult.value, applyResult: applyResult.value, spec: specResult.value,
    projectRoot, planDigest, applyResultDigest: applyDigest, specDigest });
  if (!reportResult.ok) throw new Error('Test verify fixture is invalid: ' + JSON.stringify(reportResult.issues));
  return { plan: planResult.value, apply: applyResult.value, spec: specResult.value, report: reportResult.value, planDigest, applyDigest, specDigest };
}

async function captureFixtureInventory(root: string): Promise<Record<string, unknown>> {
  const capture = async (path: string, name?: string): Promise<Record<string, unknown>> => {
    const stat = await lstat(path, { bigint: true });
    const identity = { dev: String(stat.dev), ino: String(stat.ino) };
    if (stat.isFile()) {
      const bytes = await readFile(path);
      return { name, identity, kind: 'file', bytes: bytes.length, sha256: sha(bytes) };
    }
    const children = await Promise.all((await readdir(path)).sort().map(child => capture(join(path, child), child)));
    return name === undefined ? { identity, children, recursive: true } : { name, identity, kind: 'directory', bytes: 0, children };
  };
  return capture(root);
}

async function makeRetainedChainFixture(root: string, options: { repair?: boolean; backupMismatch?: 'reference' | 'original' | 'path'; baselineMismatch?: boolean } = {}) {
  const filesDir = join(root, 'files');
  await mkdir(filesDir);
  const chains: T17HostChainReceipt['chains'] = [];
  const sealedFiles: { name: string; sha256: string; bytes: number }[] = [];
  const inventories: Record<string, unknown> = {};
  const retained = {} as Record<'vue' | 'react', { artifactRoot: string; baselinePath: string; backupPath?: string }>;
  const writeStage = async (name: string, value: unknown) => {
    const bytes = Buffer.from(JSON.stringify(value) + '\n');
    const path = join(filesDir, name);
    await writeFile(path, bytes);
    sealedFiles.push({ name, bytes: bytes.length, sha256: sha(bytes) });
    return path;
  };
  for (const framework of ['vue', 'react'] as const) {
    const projectRoot = 'C:/owned/' + framework;
    const areaName = 't17-' + framework + '-verify-out';
    const artifactRoot = join(root, areaName);
    const baseline = Buffer.from('synthetic retained baseline for ' + framework);
    const baselineRef = { path: 'baselines/' + framework + '.png', sha256: sha(baseline), bytes: baseline.length };
    await mkdir(join(artifactRoot, 'baselines'), { recursive: true });
    await mkdir(join(artifactRoot, 'run'));
    const baselinePath = join(artifactRoot, baselineRef.path);
    await writeFile(baselinePath, baseline);
    const original = Buffer.from('synthetic generated original for ' + framework);
    const stages = makeValidStageEvidence(framework, projectRoot, { baseline: options.baselineMismatch && framework === 'vue' ? { ...baselineRef, sha256: sha('wrong baseline reference') } : baselineRef, generatedSha256: sha(original) });
    for (const artifact of stages.report.artifacts) {
      const bytes = Buffer.from('synthetic retained artifact: ' + artifact.path);
      artifact.bytes = bytes.length;
      artifact.sha256 = sha(bytes);
      await writeFile(join(artifactRoot, artifact.path), bytes);
    }
    for (const check of stages.report.checks) check.evidence = check.evidence.map(ref => stages.report.artifacts.find(artifact => artifact.path === ref.path) ?? ref);
    let repair: IntegrationRepairResultV1 | undefined;
    let backupPath: string | undefined;
    if (options.repair && framework === 'vue') {
      const finalReport = structuredClone(stages.report);
      const issue = { code: 'TYPE_FAILED', message: 'Project type verification failed.' } as const;
      stages.report.status = 'failed';
      stages.report.checks[0]!.status = 'failed';
      stages.report.checks[0]!.issues = [issue];
      stages.report.pendingItems = [issue];
      const generatedPath = stages.plan.changes.find(change => change.kind === 'generated-component')!.path;
      const repairedHash = sha(Buffer.from('synthetic repaired generated bytes'));
      for (const values of [finalReport.snapshots.before, finalReport.snapshots.after]) values.find(snapshot => snapshot.path === generatedPath)!.sha256 = repairedHash;
      const backupOriginal = options.backupMismatch === 'original' ? Buffer.from('unrelated original bytes') : original;
      const backupId = 'repair-backup-1';
      const backupBytes = Buffer.from(JSON.stringify({ id: backupId, path: options.backupMismatch === 'path' ? 'src/unrelated.vue' : generatedPath, sha256: sha(backupOriginal), originalBase64: backupOriginal.toString('base64') }));
      await mkdir(join(artifactRoot, 'repair'));
      backupPath = join(artifactRoot, 'repair', backupId + '.json');
      await writeFile(backupPath, backupBytes);
      repair = { schemaVersion: 1, projectRoot, planDigest: stages.planDigest, applyResultDigest: stages.applyDigest, specDigest: stages.specDigest, operation: 'repair', id: 'repair-retained-fixture',
        sourceReportDigest: digest(stages.report), maxAttempts: 2, status: 'repaired', stopReason: 'passed', finalReport, changedFiles: [generatedPath], pendingItems: [],
        attempts: [{ attempt: 1, recipeId: 'regenerate-generated-component', beforeReportDigest: digest(stages.report), afterReportDigest: digest(finalReport), changedFiles: [generatedPath],
          beforeHashes: [{ path: generatedPath, exists: true, sha256: sha(original) }], afterHashes: [{ path: generatedPath, exists: true, sha256: repairedHash }],
          backupRef: { id: backupId, sha256: options.backupMismatch === 'reference' ? sha('wrong backup reference') : sha(backupBytes) } }] };
      const checked = validateIntegrationRepairResult(repair, { projectRoot, planDigest: stages.planDigest, applyResultDigest: stages.applyDigest, specDigest: stages.specDigest, plan: stages.plan, applyResult: stages.apply, spec: stages.spec, reportDigest: digest(stages.report), sourceReport: stages.report });
      if (!checked.ok) throw Error('Retained repair test fixture is invalid: ' + JSON.stringify(checked.issues));
    }
    const planEvidence = await writeStage(framework + '-plan.json', stages.plan);
    const applyEvidence = await writeStage(framework + '-apply.json', stages.apply);
    const specEvidence = await writeStage(framework + '-spec.json', stages.spec);
    const verifyEvidence = await writeStage(framework + '-verify.json', stages.report);
    const repairEvidence = repair ? await writeStage(framework + '-repair.json', repair) : undefined;
    chains.push({ framework, packageManager: 'npm', planStatus: 'planned', applyStatus: 'applied', verifyStatus: stages.report.status, repairStatus: repair ? 'repaired' : 'not-needed', repairMaxAttempts: 2, repairAttempts: repair ? 1 : 0, projectRoot,
      planDigest: stages.planDigest, applyResultDigest: stages.applyDigest, specDigest: stages.specDigest, verifyReportDigest: digest(stages.report), planEvidence, applyEvidence, specEvidence, verifyEvidence,
      ...(repair ? { repairEvidence: repairEvidence!, repairResultDigest: digest(repair) } : {}), childProcessesCleaned: true });
    inventories[areaName] = await captureFixtureInventory(artifactRoot);
    retained[framework] = { artifactRoot, baselinePath, ...(backupPath ? { backupPath } : {}) };
  }
  const receipt: T17HostChainReceipt = { schemaVersion: 1, acceptanceKind: 't17-owned-host-chain', productionAcceptance: false, runId: 'retained-chain-fixture', evidenceRoot: root, result: 'passed',
    receiptEvidencePath: join(filesDir, 't17-host-acceptance.json'), sealPath: '', sealSha256: '', projectRoots: { vue: 'C:/owned/vue', react: 'C:/owned/react' }, chains, childProcessesCleaned: true,
    cli: { root: 'cli-root', entry: 'cli-entry', entrySha256: 'c'.repeat(64), version: '0.0.19', tarballSha256: 'a'.repeat(64), tarballBytes: 128, manifestSha256: 'b'.repeat(64) } };
  await writeStage('t17-host-acceptance.json', receipt);
  const sealBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, runId: receipt.runId, evidenceRoot: root, files: sealedFiles, inventories: { evidenceAreas: inventories },
    payload: { acceptanceKind: receipt.acceptanceKind, productionAcceptance: false, result: receipt.result, cli: receipt.cli, chains: receipt.chains, projectRoots: receipt.projectRoots, childProcessesCleaned: true, receiptEvidencePath: 'files/t17-host-acceptance.json' } }));
  receipt.sealPath = join(root, 'run-seal.json');
  receipt.sealSha256 = sha(sealBytes);
  await writeFile(receipt.sealPath, sealBytes);
  return { receipt, retained };
}

async function loadChainModule(): Promise<Record<string, unknown>> {
  try {
    return (await import('./chain.js')) as unknown as Record<string, unknown>;
  } catch {
    return {};
  }
}

describe('T17 owned-host CLI 验收链（plan → apply → verify/repair）', () => {
  it.each([false, true])('keeps private script cache inventoried and rejects overlong browser TEMP (%s)', async overlong => {
    const originalTemp = tmpdir();
    const longBase = overlong ? await mkdtemp(join(originalTemp, 't17-long-' + 'x'.repeat(90))) : undefined;
    if (longBase) { vi.stubEnv('TEMP', longBase); vi.stubEnv('TMP', longBase); vi.stubEnv('TMPDIR', longBase); }
    let owned: host.OwnedRun | undefined;
    let scriptTemp: string | undefined;
    let browserCache: string | undefined;
    const response = componentMatchResponseFixture('vue');
    const target = response.target!;
    vi.spyOn(hostConfig, 'loadT17HostInputs').mockResolvedValue({
      cliTarball: 'fixture.tgz', cliSha256: 'a'.repeat(64), cliVersion: '0.0.20',
      sdkBundle: 'fixture-sdk', sdkManifestSha256: 'b'.repeat(64),
      apiUrl: 'http://127.0.0.1:4300', registryUrl: 'http://127.0.0.1:4873',
      variantsFile: 'fixture-variants.json', variantsSha256: 'c'.repeat(64),
      apiToken: 'fixture-api-token', registryToken: 'fixture-registry-token',
      variants: { schemaVersion: 1, variants: [{ componentId: target.componentId, framework: 'vue', variantReleaseId: target.variantReleaseId }] },
      validatedCompatibility: {},
      sdkManifest: { schemaVersion: 1, files: [], packages: [{ name: target.packageName, version: target.packageVersion, tarball: { sha256: target.packageSha256 } }],
        variants: [{ componentId: target.componentId, framework: 'vue', packageName: target.packageName, packageVersion: target.packageVersion, exportName: target.exportName, exportPath: target.exportPath }] },
    } as T17HostInputs);
    vi.spyOn(host, 'installFrozenCli').mockImplementation(async options => {
      owned = options.run;
      const root = await owned.makeOwnedProject('fixture-cli');
      return { root, entry: join(root, 'index.js'), entrySha256: 'd'.repeat(64), version: options.expectedVersion, tarballSha256: options.expectedTarballSha256!, tarballBytes: 1, manifestSha256: 'e'.repeat(64), installOutputBytes: 0 };
    });
    vi.spyOn(runtime, 'installDependencies').mockResolvedValue({ manager: 'npm', executable: process.execPath, args: [], cwd: '.', exitCode: 0, stdoutSha256: 'f'.repeat(64), stderrSha256: 'f'.repeat(64), stdoutBytes: 0, stderrBytes: 0 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response), { status: 200 })));
    vi.spyOn(runtime, 'runFrozenCli').mockImplementation(async (run, options) => {
      scriptTemp = options.extraEnv!.TEMP!;
      browserCache = options.extraEnv!.PLAYWRIGHT_BROWSERS_PATH;
      expect(options.extraEnv!.TMP).toBe(scriptTemp);
      const cache = join(scriptTemp, 'node-compile-cache', 'nested');
      await mkdir(cache, { recursive: true });
      await writeFile(join(cache, 'entry'), 'actual child temporary output');
      const out = await run.writeEvidence('plan.stdout', Buffer.from(''));
      const err = await run.writeEvidence('plan.stderr', Buffer.from('controlled plan failure after cache output'));
      return { executable: process.execPath, args: options.args!, cwd: options.projectRoot, exitCode: 1, timedOut: false, stdoutBytes: out.bytes, stderrBytes: err.bytes, stdoutSha256: out.sha256, stderrSha256: err.sha256, stdoutEvidence: out.path, stderrEvidence: err.path };
    });
    try {
      const { runT17HostAcceptanceChain } = await import('./chain.js');
      await expect(runT17HostAcceptanceChain({ env: {}, repositoryRoot: process.cwd(), allowBrowser: true })).rejects.toThrow(
        overlong ? /short.*TEMP.*TMP/i : /integrate plan failed/);
      expect(owned).toBeDefined();
      if (overlong) {
        expect(runtime.runFrozenCli).not.toHaveBeenCalled();
      } else {
        expect(scriptTemp).toBe(join(owned!.evidenceRoot, 't17-vue-script-temp'));
        expect(browserCache).toBe(join(process.cwd(), '.tools', 'playwright'));
        await expect(readFile(join(scriptTemp!, 'node-compile-cache', 'nested', 'entry'), 'utf8')).resolves.toBe('actual child temporary output');
        await expect(readFile(join(owned!.evidenceRoot, 'files', 'plan.stderr'), 'utf8')).resolves.toContain('controlled plan failure');
      }
      await expect(lstat(owned!.parentRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      if (owned) {
        await owned.abortForTest({ preserveEvidence: true });
        await rm(owned.evidenceRoot, { recursive: true, force: true });
      }
      if (longBase) await rm(longBase, { recursive: true, force: true });
    }
  });

  it('拒绝从不完整冻结 SDK manifest 推断 package、variant 或摘要身份', () => {
    const makeInputs = (overrides: {
      packageEntry?: Record<string, unknown> | null;
      variantEntry?: Record<string, unknown> | null;
      compatibilityEntry?: Record<string, unknown> | null;
    } = {}): T17HostInputs => ({
      cliTarball: 'C:/frozen/cli.tgz', cliSha256: 'a'.repeat(64), cliVersion: '0.0.17',
      sdkBundle: 'C:/frozen/sdk', sdkManifestSha256: 'b'.repeat(64),
      apiUrl: 'http://127.0.0.1:4300', registryUrl: 'http://127.0.0.1:4873',
      variantsFile: 'C:/frozen/variants.json', variantsSha256: 'c'.repeat(64),
      apiToken: 'api-token', registryToken: 'registry-token',
      variants: { schemaVersion: 1, variants: [{ componentId: 'line', framework: 'vue', variantReleaseId: 'variant-line-vue-1' }] },
      validatedCompatibility: { 'line:vue': ['report-vue-line-1'] },
      sdkManifest: {
        schemaVersion: 1, files: [],
        packages: overrides.packageEntry === null ? [] : [overrides.packageEntry ?? {
          name: '@company/charts-vue', version: '0.0.12', tarball: { sha256: 'd'.repeat(64) },
        }],
        variants: overrides.variantEntry === null ? [] : [overrides.variantEntry ?? {
          componentId: 'line', framework: 'vue', packageName: '@company/charts-vue', packageVersion: '0.0.12', exportName: 'LineChart', exportPath: './line',
          compatibility: overrides.compatibilityEntry === null ? [] : [overrides.compatibilityEntry ?? {
            framework: 'vue', frameworkVersion: '3.5.45', echartsVersion: '6.1.0', status: 'passed',
            reportId: 'report-vue-line-1', verifiedAt: '2026-11-18T12:00:00Z',
          }],
        }],
      },
    } as T17HostInputs);

    expect(() => buildMatchPlanForHost('vue', makeInputs({ packageEntry: null }))).toThrow(/package.*manifest|manifest.*package/i);
    expect(() => buildMatchPlanForHost('vue', makeInputs({ packageEntry: { name: '@company/charts-vue', tarball: { sha256: 'd'.repeat(64) } } }))).toThrow(/version/i);
    expect(() => buildMatchPlanForHost('vue', makeInputs({ packageEntry: { name: '@company/charts-vue', version: '^0.0.12', tarball: { sha256: 'd'.repeat(64) } } }))).toThrow(/version/i);
    expect(() => buildMatchPlanForHost('vue', makeInputs({ packageEntry: { name: '@company/charts-vue', version: '0.0.12', tarball: {} } }))).toThrow(/sha|digest/i);
    expect(() => buildMatchPlanForHost('vue', makeInputs({ packageEntry: { name: '@company/charts-vue', version: '0.0.12', tarball: { sha256: 'not-a-sha' } } }))).toThrow(/sha|digest/i);
    expect(() => buildMatchPlanForHost('vue', makeInputs({ variantEntry: null }))).toThrow(/variant.*manifest|manifest.*variant/i);
    expect(() => buildMatchPlanForHost('vue', makeInputs({ variantEntry: { componentId: 'line', framework: 'vue', packageName: '@company/charts-vue', packageVersion: '0.0.12' } }))).toThrow(/export/i);
    expect(() => buildMatchPlanForHost('vue', makeInputs({ variantEntry: { componentId: 'line', framework: 'vue', packageName: '@company/charts-vue', packageVersion: '0.0.12', exportName: 'LineChart' } }))).toThrow(/export/i);
    expect(() => buildMatchPlanForHost('vue', makeInputs({ variantEntry: { componentId: 'line', framework: 'vue', packageName: '@company/charts-vue', packageVersion: '0.0.12', exportPath: './line' } }))).toThrow(/export/i);
    expect(buildMatchPlanForHost('vue', makeInputs()).elements[0]?.target?.compatibility).toEqual({
      status: 'verified', recordIds: ['report-vue-line-1'],
    });
    expect(buildMatchPlanForHost('vue', makeInputs({ compatibilityEntry: null })).elements[0]?.target?.compatibility).toEqual({
      status: 'unverified', recordIds: [],
    });
    expect(buildMatchPlanForHost('vue', makeInputs({ compatibilityEntry: {
      compatibilityId: 'compat-wrong-framework-version', packageName: '@company/charts-vue', packageVersion: '0.0.12',
      packageSha256: 'd'.repeat(64), framework: 'vue', frameworkVersion: '3.5.44', echartsVersion: '6.1.0', status: 'passed',
    } })).elements[0]?.target?.compatibility).toEqual({ status: 'unverified', recordIds: [] });
    expect(buildMatchPlanForHost('vue', makeInputs({ compatibilityEntry: {
      framework: 'vue', frameworkVersion: '3.5.44', echartsVersion: '6.1.0', status: 'passed',
      reportId: 'report-wrong-framework-version', verifiedAt: '2026-11-18T12:00:00Z',
    } })).elements[0]?.target?.compatibility).toEqual({ status: 'unverified', recordIds: [] });
    expect(buildMatchPlanForHost('vue', makeInputs({ compatibilityEntry: {
      framework: 'vue', frameworkVersion: '3.5.45', echartsVersion: '6.1.0', status: 'candidate',
      reportId: 'report-candidate',
    } })).elements[0]?.target?.compatibility).toEqual({ status: 'unverified', recordIds: [] });

    const complete = buildMatchPlanForHost('vue', makeInputs());
    expect(complete.elements[0]?.target).toMatchObject({
      packageName: '@company/charts-vue',
      packageVersion: '0.0.12',
      packageSha256: 'd'.repeat(64),
      exportName: 'LineChart',
      exportPath: './line',
    });
  });

  it('缺失冻结 tarball、服务凭据、SDK bundle 或变体映射时 fail-closed', async () => {
    const mod = await loadChainModule();
    expect(typeof mod.runT17HostAcceptanceChain).toBe('function');
    const runChain = mod.runT17HostAcceptanceChain as (opts: {
      env: Record<string, string | undefined>;
      repositoryRoot: string;
    }) => Promise<unknown>;

    await expect(
      runChain({ env: {}, repositoryRoot: process.cwd() }),
    ).rejects.toThrow(/Missing required T17 host inputs/i);
  });

  it('拒绝把 T16 inspect 结果冒充 T17 验收通过，并校验 Vue 与 React 双框架完整链', async () => {
    const mod = await loadChainModule();
    expect(typeof mod.verifyHostChainReceipt).toBe('function');
    const verifyReceipt = mod.verifyHostChainReceipt as (receipt: unknown) => Promise<void>;

    const root = await mkdtemp(join(tmpdir(), 'zhinexus-t17-chain-receipt-'));
    try {
      await mkdir(join(root, 'files'));
      // 伪造仅含 T16 inspect 的回执，必须被拒绝
      const inspectOnly = {
        runId: 'run-inspect-only',
        evidenceRoot: root,
        result: 'passed',
        inspections: [
          { framework: 'vue', status: 'inspected' },
          { framework: 'react', status: 'inspected' },
        ],
      };
      await expect(verifyReceipt(inspectOnly)).rejects.toThrow(/plan|apply|verify|chain|frameworks|seal/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('严格用 contracts 校验 plan / apply / verify / repair 并绑定摘要与修复预算上限', async () => {
    const mod = await loadChainModule();
    expect(typeof mod.parsePlanOutput).toBe('function');
    expect(typeof mod.parseApplyOutput).toBe('function');
    expect(typeof mod.parseVerifyOutput).toBe('function');
    expect(typeof mod.parseRepairOutput).toBe('function');

    const parsePlan = mod.parsePlanOutput as (stdout: string, framework: 'vue' | 'react') => unknown;
    const parseApply = mod.parseApplyOutput as (stdout: string, root: string, planDigest: string) => unknown;
    const parseVerify = mod.parseVerifyOutput as (
      stdout: string,
      root: string,
      planDigest: string,
      applyDigest: string,
      specDigest: string,
    ) => unknown;
    const parseRepair = mod.parseRepairOutput as (
      stdout: string,
      root: string,
      planDigest: string,
      applyDigest: string,
      specDigest: string,
      sourceReportDigest: string,
      maxAttempts: number,
    ) => unknown;

    const plan = validIntegrationPlanFixture();
    const planDigest = digest(plan);
    expect(parsePlan(JSON.stringify(plan), 'vue')).toBeDefined();
    expect(() => parsePlan(JSON.stringify({ ...plan, status: 'conflicted' }), 'vue')).toThrow(/plan/i);
    expect(() => parsePlan(JSON.stringify(plan), 'react')).toThrow(/framework/i);

    const apply = { ...applyResultFixture(), planDigest };
    const applyDigest = digest(apply);
    expect(parseApply(JSON.stringify(apply), apply.projectRoot, planDigest)).toBeDefined();
    expect(() => parseApply(JSON.stringify(apply), apply.projectRoot, '0'.repeat(64))).toThrow(/planDigest|digest/i);
    const blockedApply = {
      ...apply,
      status: 'blocked' as const,
      installState: 'not-run' as const,
      changedFiles: [],
      beforeHashes: [],
      afterHashes: [],
      installedVersions: [],
      issues: [{ code: 'AUTHORIZATION_REQUIRED' as const, message: 'Explicit apply authorization is required.' }],
    };
    delete (blockedApply as Record<string, unknown>).backupRef;
    expect(() => parseApply(JSON.stringify(blockedApply), apply.projectRoot, planDigest)).toThrow(/applied/i);

    const spec = { ...verificationSpecFixture(), projectRoot: apply.projectRoot, planDigest, applyResultDigest: applyDigest };
    const specDigest = digest(spec);
    const report = {
      ...verificationReportFixture(),
      projectRoot: apply.projectRoot,
      planDigest,
      applyResultDigest: applyDigest,
      specDigest,
    };
    expect(parseVerify(JSON.stringify(report), apply.projectRoot, planDigest, applyDigest, specDigest)).toBeDefined();
    expect(() =>
      parseVerify(JSON.stringify(report), apply.projectRoot, planDigest, applyDigest, 'f'.repeat(64)),
    ).toThrow(/specDigest|digest/i);

    const sourceReport = {
      ...repairSourceReportFixture(),
      projectRoot: apply.projectRoot,
      planDigest,
      applyResultDigest: applyDigest,
      specDigest,
    };
    const sourceReportDigest = digest(sourceReport);
    const baseRepair = repairResultFixture();
    const repair = {
      ...baseRepair,
      projectRoot: apply.projectRoot,
      planDigest,
      applyResultDigest: applyDigest,
      specDigest,
      sourceReportDigest,
      attempts: baseRepair.attempts.map(a => ({ ...a, beforeReportDigest: sourceReportDigest })),
      finalReport: {
        ...baseRepair.finalReport,
        projectRoot: apply.projectRoot,
        planDigest,
        applyResultDigest: applyDigest,
        specDigest,
      },
    };
    expect(
      parseRepair(JSON.stringify(repair), apply.projectRoot, planDigest, applyDigest, specDigest, sourceReportDigest, 2),
    ).toBeDefined();
    // 超过修复预算上限（3 或 attempts > maxAttempts）必须拒绝
    expect(() =>
      parseRepair(JSON.stringify(repair), apply.projectRoot, planDigest, applyDigest, specDigest, sourceReportDigest, 3),
    ).toThrow(/maxAttempts|budget|上限/i);
    expect(() =>
      parseRepair(JSON.stringify(repair), apply.projectRoot, planDigest, applyDigest, specDigest, sourceReportDigest, 0),
    ).toThrow(/attempts|budget|maxAttempts/i);
  });

  it('构建双框架 MatchPlan 与 VerificationSpec，且拒绝非法修复预算', async () => {
    const mod = await loadChainModule();
    expect(typeof mod.assertBoundedRepairBudget).toBe('function');
    const assertBudget = mod.assertBoundedRepairBudget as (value: number) => 0 | 1 | 2;
    expect(assertBudget(0)).toBe(0);
    expect(assertBudget(1)).toBe(1);
    expect(assertBudget(2)).toBe(2);
    expect(() => assertBudget(3)).toThrow(/maxAttempts|budget/i);
    expect(() => assertBudget(-1)).toThrow(/maxAttempts|budget/i);
  });

  it('验证真实保留回执与子进程已清空标记，篡改任一阶段证据均拒绝', async () => {
    const mod = await loadChainModule();
    const verifyReceipt = mod.verifyHostChainReceipt as (receipt: unknown) => Promise<void>;
    const root = await mkdtemp(join(tmpdir(), 'zhinexus-t17-chain-valid-'));
    try {
      const { receipt, retained } = await makeRetainedChainFixture(root);
      await expect(verifyReceipt(receipt)).resolves.toBeUndefined();
      const screenshot = join(retained.vue.artifactRoot, 'run/screenshot.png');
      const screenshotBytes = await readFile(screenshot);
      await writeFile(screenshot, 'tampered retained screenshot');
      await expect(verifyReceipt(receipt)).rejects.toThrow(/artifact|retained|seal|digest/i);
      await writeFile(screenshot, screenshotBytes);
      await rm(screenshot);
      await expect(verifyReceipt(receipt)).rejects.toThrow();
      await writeFile(screenshot, screenshotBytes);
      const persistedBeforeTamper = await readFile(receipt.receiptEvidencePath);
      await writeFile(receipt.receiptEvidencePath, Buffer.from('{"tampered":true}\n'));
      await expect(verifyReceipt(receipt)).rejects.toThrow(/receipt|seal|inventory|digest/i);
      await writeFile(receipt.receiptEvidencePath, persistedBeforeTamper);
      await expect(verifyReceipt({ ...receipt, childProcessesCleaned: false })).rejects.toThrow(/process|clean|seal/i);
      await expect(verifyReceipt({ ...receipt, chains: [receipt.chains[0]] })).rejects.toThrow(/vue|react|framework|seal/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    'baseline-missing', 'baseline-tampered', 'baseline-junction',
    'backup-missing', 'backup-tampered', 'backup-hardlink', 'backup-directory', 'unlisted-file',
  ] as const)('完整回读封存 verify-out 并拒绝真实文件系统变更：%s', async defect => {
    const mod = await loadChainModule();
    const verifyReceipt = mod.verifyHostChainReceipt as (receipt: unknown) => Promise<void>;
    const root = await mkdtemp(join(tmpdir(), 'zhinexus-t17-chain-retained-'));
    try {
      const { receipt, retained } = await makeRetainedChainFixture(root, { repair: true });
      await expect(verifyReceipt(receipt)).resolves.toBeUndefined();
      const { artifactRoot, baselinePath, backupPath } = retained.vue;
      if (defect === 'baseline-missing') await rm(baselinePath);
      if (defect === 'baseline-tampered') await writeFile(baselinePath, 'tampered baseline');
      if (defect === 'baseline-junction') {
        const original = join(artifactRoot, 'baselines');
        const saved = join(root, 'baselines-saved');
        await rename(original, saved);
        await symlink(saved, original, 'junction');
      }
      if (defect === 'backup-missing') await rm(backupPath!);
      if (defect === 'backup-tampered') await writeFile(backupPath!, 'tampered repair backup');
      if (defect === 'backup-hardlink') {
        const saved = join(root, 'backup-original.saved');
        await rename(backupPath!, saved);
        await link(saved, backupPath!);
      }
      if (defect === 'backup-directory') {
        await rm(backupPath!);
        await mkdir(backupPath!);
      }
      if (defect === 'unlisted-file') await writeFile(join(artifactRoot, 'unlisted.txt'), 'unsealed evidence');
      await expect(verifyReceipt(receipt)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['reference', 'original', 'path'] as const)('封存完整且契约有效仍须绑定 repair backupRef 与 beforeHashes：%s', async backupMismatch => {
    const mod = await loadChainModule();
    const verifyReceipt = mod.verifyHostChainReceipt as (receipt: unknown) => Promise<void>;
    const root = await mkdtemp(join(tmpdir(), 'zhinexus-t17-chain-backup-'));
    try {
      const { receipt } = await makeRetainedChainFixture(root, { repair: true, backupMismatch });
      await expect(verifyReceipt(receipt)).rejects.toThrow(/backup|before|retained|digest/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('封存完整且契约有效仍须将 spec baseline 引用绑定到保留字节', async () => {
    const mod = await loadChainModule();
    const verifyReceipt = mod.verifyHostChainReceipt as (receipt: unknown) => Promise<void>;
    const root = await mkdtemp(join(tmpdir(), 'zhinexus-t17-chain-baseline-'));
    try {
      const { receipt } = await makeRetainedChainFixture(root, { baselineMismatch: true });
      await expect(verifyReceipt(receipt)).rejects.toThrow(/baseline|retained|digest/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('buildVerificationSpecForHost 支持透传 browser 与独立视觉基线并通过契约校验', () => {
    const spec = buildVerificationSpecForHost({
      canonicalProjectRoot: 'C:/owned/vue',
      planDigest: '1'.repeat(64),
      applyResultDigest: '2'.repeat(64),
      manifestSha256: '3'.repeat(64),
      browser: {
        url: 'http://127.0.0.1:4173/',
        readySelector: '[data-testid="ready"]',
        timeoutMs: 30_000,
        viewport: { width: 800, height: 400 },
        renderer: 'canvas',
        theme: 'light',
        actions: [{ kind: 'click', selector: 'canvas' }],
        assertions: [
          { kind: 'visible', selector: '[data-testid="ready"]' },
          { kind: 'visible', selector: 'canvas' },
        ],
        visual: {
          baseline: {
            image: { path: 'baselines/vue-baseline.png', sha256: '4'.repeat(64), bytes: 128 },
            environment: {
              os: 'windows',
              arch: 'x64',
              browserVersion: '158.0.0.0',
              browserRevision: '1254',
              fontDigest: '5'.repeat(64),
              locale: 'zh-CN',
              timezone: 'Asia/Shanghai',
              deviceScaleFactor: 1,
              renderer: 'canvas',
              width: 800,
              height: 400,
              theme: 'light',
              frameworkVersion: '3.5.45',
              echartsVersion: '6.1.0',
            },
          },
          pixelThreshold: 0.1,
          maxDiffPixelRatio: 0.001,
        },
      },
    } as Parameters<typeof buildVerificationSpecForHost>[0] & { browser: unknown });

    expect(spec.browser?.url).toBe('http://127.0.0.1:4173/');
    expect(spec.browser?.visual?.baseline.image.path).toBe('baselines/vue-baseline.png');
  });

  it('buildMatchPlanForHost 绑定权威 API target 原样保留 evidence/compatibility/notes 并拒绝与冻结 SDK 身份漂移', () => {
    const response = componentMatchResponseFixture('vue');
    response.gaps = [];
    response.target!.compatibility = { status: 'verified', recordIds: ['api-compat-vue-1'] };
    response.target!.notes = ['authoritative-api-note'];

    const inputs: T17HostInputs = {
      cliTarball: 'C:/frozen/cli.tgz', cliSha256: 'a'.repeat(64), cliVersion: '0.0.18',
      sdkBundle: 'C:/frozen/sdk', sdkManifestSha256: 'b'.repeat(64),
      apiUrl: 'http://127.0.0.1:4300', registryUrl: 'http://127.0.0.1:4873',
      variantsFile: 'C:/frozen/variants.json', variantsSha256: 'c'.repeat(64),
      apiToken: 'api-token', registryToken: 'registry-token',
      variants: {
        schemaVersion: 1,
        variants: [{
          componentId: response.target!.componentId,
          framework: 'vue',
          variantReleaseId: response.target!.variantReleaseId,
        }],
      },
      validatedCompatibility: {},
      sdkManifest: {
        schemaVersion: 1,
        files: [],
        packages: [{
          name: response.target!.packageName,
          version: response.target!.packageVersion,
          tarball: { sha256: response.target!.packageSha256 },
        }],
        variants: [{
          componentId: response.target!.componentId,
          framework: 'vue',
          packageName: response.target!.packageName,
          packageVersion: response.target!.packageVersion,
          exportName: response.target!.exportName,
          exportPath: response.target!.exportPath,
          compatibility: [],
        }],
      },
    } as T17HostInputs;

    const plan = buildMatchPlanForHost('vue', inputs, { authoritativeMatch: response });
    expect(plan.elements[0]?.target).toEqual(response.target);
    expect(plan.exactDependencies).toEqual(response.exactDependencies);

    // 权威 API 返回 unverified 时不得硬编码为 verified，且必须保留 COMPATIBILITY_UNVERIFIED gap
    const unverifiedResponse = componentMatchResponseFixture('vue');
    const unverifiedPlan = buildMatchPlanForHost('vue', inputs, { authoritativeMatch: unverifiedResponse });
    expect(unverifiedPlan.elements[0]?.target?.compatibility).toEqual({ status: 'unverified', recordIds: [] });
    expect(unverifiedPlan.elements[0]?.gaps.some(g => g.code === 'COMPATIBILITY_UNVERIFIED')).toBe(true);

    // 冻结 SDK 与权威 API target 的 sha256 或 variantReleaseId 不一致时必须拒绝
    const driftedSha = structuredClone(response);
    driftedSha.target!.packageSha256 = '9'.repeat(64);
    expect(() => buildMatchPlanForHost('vue', inputs, { authoritativeMatch: driftedSha })).toThrow(/sha|digest|match|identity/i);

    const driftedVariant = structuredClone(response);
    driftedVariant.target!.variantReleaseId = 'variant-other';
    expect(() => buildMatchPlanForHost('vue', inputs, { authoritativeMatch: driftedVariant })).toThrow(/variant|match|identity/i);
  });

  it('normalizeVueHostGeneratedImport 仅为宿主对生成 SFC 的无扩展名导入补 .vue，且拒绝缺失或多处导入', () => {
    const src = '<script setup lang="ts">\nimport{ref}from"vue";import Chart from "./components/zhinexus/component-0001";const n=ref(0);\n</script>\n';
    const fixed = normalizeVueHostGeneratedImport(src, 'src/components/zhinexus/component-0001.vue');
    expect(fixed).toContain('import Chart from "./components/zhinexus/component-0001.vue"');
    expect(fixed.replace('./components/zhinexus/component-0001.vue', '')).not.toContain('component-0001');
    // 已带扩展名时幂等
    expect(normalizeVueHostGeneratedImport(fixed, 'src/components/zhinexus/component-0001.vue')).toBe(fixed);
    // 宿主未导入生成模块时必须拒绝，而不是静默通过
    expect(() => normalizeVueHostGeneratedImport('<script setup lang="ts"></script>', 'src/components/zhinexus/component-0001.vue')).toThrow(/generated/i);
    expect(() => normalizeVueHostGeneratedImport(src + src, 'src/components/zhinexus/component-0001.vue')).toThrow(/generated/i);
    // 非 .vue 生成路径拒绝
    expect(() => normalizeVueHostGeneratedImport(src, 'src/components/zhinexus/component-0001.tsx')).toThrow(/\.vue/i);
  });
});
