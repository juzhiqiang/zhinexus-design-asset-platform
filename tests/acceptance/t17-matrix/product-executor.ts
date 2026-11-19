/** Concrete, locally executed T17 matrix. No result is inferred from fixture labels. */
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, readlink, realpath, rename, rmdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { canonicalJson, validateIntegrationApplyResult, validateIntegrationPlan, validateIntegrationRepairResult, validateIntegrationVerificationReport, validateIntegrationVerificationSpec, type ComponentApiV1, type EnvironmentV1, type IntegrationApplyResultV1, type IntegrationPlanV1, type IntegrationVerificationReportV1, type IntegrationVerificationSpecV1, type MatchPlanV1, type PackageRef } from '@company/contracts';
import { createOwnedRun, installFrozenCli, type OwnedRun } from '../t17-host/host.js';
import { createProductPnpmCache, type ProductPnpmCache } from './product-cache.js';
import { observeProductInstallLogs } from './product-install-observer.js';
import { materializeProject, type FixtureProject } from '../../fixtures/t17-matrix/generate.js';
import { T17_POSITIVE_SCENARIOS, T17_REFUSAL_SCENARIOS, T17_TOOLCHAIN, T17_VISUAL, type T17PositiveScenario, type T17RefusalScenario } from '../../fixtures/t17-matrix/scenarios.js';
import type { MatrixEnv } from './env.js';
import { loadT17HostInputs, resolveT17FixedToolchain, type T17HostInputs } from '../t17-host/e2e-config.js';
import type { FixedToolchain } from '../t17-host/runtime.js';
import { applyArgsFor, assertFrozenCliEntry, inspectArgsFor, planArgsFor, repairArgsFor, verifyArgsFor } from './executor.js';
import { buildMatchPlan, loadBundle, type LoadedBundle } from './platform.js';
import { frozenCliIdentityFromInstall, sealT17MatrixRun, type FrozenCliIdentity, type T17MatrixRunResult, type T17ReceiptHost, type T17ScenarioExecutor } from './runner.js';
import type { T17BudgetRepairEvidence, T17CellReceipt, T17RefusalReceipt } from './score.js';
import { runBrowserScenario, startStaticServer } from './browser.js';
import { authorIndependentReference } from './product-reference.js';
import { captureIndependentProductBaseline } from './product-browser.js';
import { proveGeneratedProductImports } from './product-import-proof.js';
import { correctProductHostFixture } from './product-fixture.js';
import { productProcessEnvironment, runProductProcess, sanitizeProductOutput, type ProductProcessResult } from './product-process.js';
import { PNG } from 'pngjs';

export const productSha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export const productCanonicalBytes = (value: unknown) => Buffer.from(canonicalJson(value));

/** The staging directory remains inside the owned project and is emptied by rename. */
export async function materializeOwnedProductProject(run: OwnedRun, scenario: T17PositiveScenario, manifest: { packages: PackageRef[] }, apis: Map<string, ComponentApiV1>, options: { independentReference?: boolean } = {}): Promise<FixtureProject> {
  if (scenario.host !== 'vite') throw new Error('Next host declarations require a real Next implementation; Vite substitution is forbidden.');
  const root = run.projectRoots[scenario.framework];
  await run.assertOwnedProject(root);
  if ((await readdir(root)).some(name => name !== '.t17-owner.json')) throw new Error('Product project must be empty apart from its ownership marker.');
  const stage = join(root, '.t17-fixture-stage');
  await mkdir(stage);
  const fixture = await materializeProject({ workRoot: stage } as MatrixEnv, scenario, manifest, apis);
  for (const name of await readdir(fixture.root)) await rename(join(fixture.root, name), join(root, name));
  await rmdir(fixture.root); await rmdir(join(stage, 'cases')); await rmdir(stage);
  const rebase = (path: string) => join(root, relative(fixture.root, path));
  const project = { ...fixture, root, workspaceDir: rebase(fixture.workspaceDir), distDir: rebase(fixture.distDir), packageJsonPath: rebase(fixture.packageJsonPath) };
  for (const manifestPath of new Set([join(root, 'package.json'), project.packageJsonPath])) {
    const pkg = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown> & { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    if (!options.independentReference && pkg.dependencies) for (const name of Object.keys(pkg.dependencies)) if (name.startsWith('@company/charts-')) delete pkg.dependencies[name];
    pkg.packageManager = scenario.packageManager + '@' + (scenario.packageManager === 'npm' ? '11.20.0' : '12.18.0');
    if (pkg.scripts?.build) pkg.scripts.build = 'vite build --sourcemap --manifest';
    // Vite 8.3.8 resolves rolldown 1.2.18 in this fixed Windows x64 acceptance toolchain.
    // A required native dependency must not disappear as a silently failed optional download.
    if (manifestPath === project.packageJsonPath) pkg.devDependencies = { ...pkg.devDependencies, rolldown: '1.2.18', '@rolldown/binding-win32-x64-msvc': '1.2.18' };
    await writeFile(manifestPath, JSON.stringify(pkg, null, 2) + '\n');
  }
  await correctProductHostFixture(project, scenario);
  const centerLine = scenario.components.some(component => component.componentId === 'line' && component.dataState === 'center');
  const centerBar = scenario.hostMode === 'basic' && scenario.components.length === 1 && scenario.components[0]?.componentId === 'bar'
    && scenario.browser.actions.some(action => action.kind === 'click' && action.selector === '[data-testid="chart-host"]');
  if (centerLine || centerBar) {
    const appPath = join(project.workspaceDir, 'src/App.' + (scenario.framework === 'vue' ? 'vue' : 'tsx'));
    const app = await readFile(appPath, 'utf8');
    const from = '"matrix.optionOverrides": {}';
    if (!app.includes(from)) throw new Error('Center-point fixture must bind the public optionOverrides registry.');
    // The frozen browser action clicks the center of the host. B=50 must be a real
    // point at (50%, 50%), independent of ECharts label-dependent auto grid sizing.
    const options = centerBar
      ? "const matrixCenterOptions = { grid: { left: 24, right: 192, top: 24, bottom: 24, containLabel: false, outerBoundsMode: 'none' as const } };\n"
      : "const matrixCenterOptions = { grid: { left: 24, right: 24, top: 24, bottom: 24, containLabel: false, outerBoundsMode: 'none' as const }, yAxis: { min: 0, max: 100 } };\n";
    await writeFile(appPath, app.replace('const config', options + 'const config').replaceAll(from, '"matrix.optionOverrides": matrixCenterOptions'));
  }
  // The public SDK requires explicit non-zero dimensions through every wrapper level.
  const htmlPath = join(project.workspaceDir, 'index.html');
  await writeFile(htmlPath, (await readFile(htmlPath, 'utf8')).replace('</head>', '<style>body{font-family:system-ui,sans-serif;margin:24px}.zhinexus-chart-host{width:100%;height:100%}.chart-frame{width:720px;height:360px;border:1px solid #e2e8f0}.multi{display:flex;gap:16px;flex-wrap:wrap}.multi>.zhinexus-chart-host{width:300px;height:240px}.placeholder{width:720px;height:120px}</style></head>'));
  return project;
}

export type ProductBaseline = { bytes: Uint8Array; environment: EnvironmentV1; path?: string };
export function buildProductSpec(input: { scenario: T17PositiveScenario; projectRoot: string; manifestBytes: Uint8Array; plan: IntegrationPlanV1; applyResult: IntegrationApplyResultV1; url: string; baseline?: ProductBaseline }): IntegrationVerificationSpecV1 {
  const prefix = input.scenario.workspace === '.' ? '' : input.scenario.workspace + '/';
  const spec: IntegrationVerificationSpecV1 = {
    schemaVersion: 1, projectRoot: input.projectRoot.replaceAll('\\', '/'),
    planDigest: productSha256(productCanonicalBytes(input.plan)), applyResultDigest: productSha256(productCanonicalBytes(input.applyResult)),
    commands: [
      { kind: 'type', script: 'typecheck', manifestPath: prefix + 'package.json', manifestSha256: productSha256(input.manifestBytes), timeoutMs: 120000, outputDirectories: [] },
      { kind: 'build', script: 'build', manifestPath: prefix + 'package.json', manifestSha256: productSha256(input.manifestBytes), timeoutMs: 120000, outputDirectories: [prefix + 'dist'] },
    ],
    browser: { url: input.url, readySelector: input.scenario.browser.readySelector, timeoutMs: 30000, viewport: { ...T17_VISUAL.viewport },
      renderer: input.scenario.visual.renderer, theme: input.scenario.visual.theme,
      actions: structuredClone(input.scenario.browser.actions), assertions: structuredClone(input.scenario.browser.assertions),
      ...(input.baseline ? { visual: { baseline: { image: { path: input.baseline.path ?? 'independent-baseline.png', sha256: productSha256(input.baseline.bytes), bytes: input.baseline.bytes.length }, environment: input.baseline.environment },
        pixelThreshold: T17_VISUAL.pixelThreshold, maxDiffPixelRatio: T17_VISUAL.maxDiffPixelRatio } } : {}),
    }, businessGaps: [],
  };
  const checked = validateIntegrationVerificationSpec(spec);
  if (!checked.ok) throw new Error('Product verification specification is invalid: ' + JSON.stringify(checked.issues));
  return checked.value;
}

export type ProductRefusalObservation = { exitCode: number; issueCodes: string[]; status?: string; visualResult?: string; detection?: string; repairStatus?: string; repairWrites?: number; repairAttempts?: number; sentinelAbsent?: boolean };
export function productRefusalReportObservation(observation: ProductRefusalObservation): Omit<ProductRefusalObservation, 'repairAttempts'> {
  const { repairAttempts: _internalAttempts, ...report } = observation;
  return report;
}
export function classifyProductRefusal(scenario: T17RefusalScenario, actual: ProductRefusalObservation): boolean {
  if (scenario.setup === 'budget' && (actual.repairWrites !== 2 || actual.repairAttempts !== 2)) return false;
  if (!actual.detection && !actual.visualResult && !actual.repairStatus && !actual.issueCodes.some(code => !['EXECUTION_FAILED', 'TIMEOUT', 'CANCELLED'].includes(code))) return false;
  return (!scenario.expectedCodes?.length || scenario.expectedCodes.some(code => actual.issueCodes.includes(code)))
    && (!scenario.expectedExit?.length || scenario.expectedExit.includes(actual.exitCode))
    && (!scenario.expectedStatus?.length || scenario.expectedStatus.includes(actual.status ?? ''))
    && (!scenario.expectedVisual || actual.visualResult === scenario.expectedVisual)
    && (!scenario.expectedDetection || actual.detection === scenario.expectedDetection)
    && (!scenario.expectedRepair || actual.repairStatus === scenario.expectedRepair)
    && (!scenario.assertNoRepairWrite || actual.repairWrites === 0)
    && (!scenario.assertNoSentinel || actual.sentinelAbsent === true);
}

type SourceSnapshot = Map<string, string>;
async function productSourceSnapshot(root: string): Promise<SourceSnapshot> {
  const result: SourceSnapshot = new Map();
  const walk = async (directory: string, prefix: string) => {
    for (const name of (await readdir(directory)).sort()) {
      if (['node_modules', '.git', 'dist', 'build', '.next', 'out', '.turbo'].includes(name)) continue;
      const path = join(directory, name), key = prefix ? prefix + '/' + name : name, stat = await lstat(path);
      if (stat.isSymbolicLink()) result.set(key, productSha256('link:' + await readlink(path)));
      else if (stat.isDirectory()) await walk(path, key);
      else if (stat.isFile() && stat.nlink === 1) result.set(key, productSha256(await readFile(path)));
      else throw new Error('Unexpected product project source entry.');
    }
  };
  await walk(root, ''); return result;
}
const snapshotDigest = (snapshot: SourceSnapshot) => productSha256(productCanonicalBytes([...snapshot]));
const changedSources = (before: SourceSnapshot, after: SourceSnapshot) => [...new Set([...before.keys(), ...after.keys()])].filter(path => before.get(path) !== after.get(path));

/** Workspace package links may point outside node_modules. Remove only verified owned links after execution. */
export async function removeFinishedWorkspaceLinks(run: OwnedRun, root: string, retain?: (records: { path: string; target: string; rawTarget: string; identity: { dev: string; ino: string } }[]) => Promise<void>): Promise<{ path: string; target: string; rawTarget: string; identity: { dev: string; ino: string } }[]> {
  await run.assertOwnedProject(root);
  const removed: { path: string; target: string; rawTarget: string; identity: { dev: string; ino: string } }[] = [];
  const directories = new Map<string, { dev: string; ino: string }>();
  const walk = async (path: string) => {
    const dirInfo = await lstat(path, { bigint: true });
    if (!dirInfo.isDirectory() || dirInfo.isSymbolicLink()) throw new Error('Workspace reference parent is unsafe.');
    directories.set(path, { dev: String(dirInfo.dev), ino: String(dirInfo.ino) });
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name), stat = await lstat(child, { bigint: true });
      if (stat.isSymbolicLink()) {
        const target = await realpath(child).catch(() => undefined);
        const rel = target ? relative(root, target) : undefined;
        if (rel !== undefined && (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep))) throw new Error('Installed workspace link escaped the owned project.');
        if (!target) throw new Error('Installed workspace link target is unavailable.');
        const record = { path: child, target, rawTarget: await readlink(child), identity: { dev: String(stat.dev), ino: String(stat.ino) } };
        const before = await lstat(child, { bigint: true }), targetBefore = await realpath(child);
        if (!before.isSymbolicLink() || String(before.dev) !== record.identity.dev || String(before.ino) !== record.identity.ino || targetBefore !== target) throw new Error('Workspace link identity changed before unlink.');
        removed.push(record);
      } else if (stat.isDirectory()) await walk(child);
    }
  };
  await walk(root);
  if (retain) await retain(structuredClone(removed));
  await run.assertOwnedProject(root);
  for (const [path, identity] of directories) {
    const info = await lstat(path, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink() || String(info.dev) !== identity.dev || String(info.ino) !== identity.ino) throw new Error('Workspace reference parent identity changed.');
  }
  for (const record of removed) {
    const info = await lstat(record.path, { bigint: true });
    if (!info.isSymbolicLink() || String(info.dev) !== record.identity.dev || String(info.ino) !== record.identity.ino
      || await realpath(record.path) !== record.target || await readlink(record.path) !== record.rawTarget) throw new Error('Workspace link identity changed before unlink.');
    await unlink(record.path);
  }
  return removed;
}
async function finishProductCase(run: OwnedRun, areas: string[], caseId: string, pnpmCache?: ProductPnpmCache): Promise<boolean> {
  await run.stopOwnedProcesses();
  if (pnpmCache) {
    await pnpmCache.retireReferences(async record => { await run.writeEvidence('native-pnpm-project-references.json', productCanonicalBytes(record)); });
    await pnpmCache.registerOwnedContents();
  }
  for (const root of Object.values(run.projectRoots)) {
    await removeFinishedWorkspaceLinks(run, root);
    const names = (await readdir(root)).filter(name => name !== '.t17-owner.json');
    if (names.length) await run.registerOwnedPath(root, names);
  }
  for (const area of areas) {
    const names = await readdir(area); if (names.length) await run.registerEvidenceAreaContents(area, names);
  }
  await run.sealEvidence({ schemaVersion: 1, kind: 't17-product-case', caseId });
  await run.cleanup();
  return !(await lstat(run.parentRoot).catch(() => undefined));
}

export type T17ProductExecutorOptions = {
  host: T17ReceiptHost; inputs: T17HostInputs; toolchain: FixedToolchain; bundle: LoadedBundle; cacheRoot: string;
};
type ProductCase = {
  owner: OwnedRun; areas: string[]; project: FixtureProject; scenario: T17PositiveScenario; apis: Map<string, ComponentApiV1>;
  match: MatchPlanV1; area: string; backup: string; config: string; env: NodeJS.ProcessEnv; before: SourceSnapshot; pnpmCache?: ProductPnpmCache;
  plan?: IntegrationPlanV1; apply?: IntegrationApplyResultV1; spec?: IntegrationVerificationSpecV1; report?: IntegrationVerificationReportV1;
  planPath: string; applyPath: string; specPath: string; reportPath: string; sequence: number;
};
function matrixEnvironment(options: T17ProductExecutorOptions): MatrixEnv {
  return { workRoot: options.host.evidenceRoot, evidenceRoot: options.host.evidenceRoot, baselineRoot: options.host.evidenceRoot,
    apiBase: options.inputs.apiUrl, registryBase: options.inputs.registryUrl, variantsPath: options.inputs.variantsFile,
    frozenBundleDir: options.inputs.sdkBundle, cliTarball: options.inputs.cliTarball, apiToken: options.inputs.apiToken, registryToken: options.inputs.registryToken,
    pnpmBin: resolve(dirname(options.toolchain.nodeExecutable), '../pnpm-native-12.18.0/package/pnpm.exe'), npmCli: options.toolchain.npmCliPath,
    acceptBaselines: false, keepCases: false };
}
async function saveProductJson(host: T17ReceiptHost, name: string, value: unknown) {
  return host.writeEvidence(name, productCanonicalBytes(value));
}
async function saveProductFixturePolicy(host: T17ReceiptHost) {
  return saveProductJson(host, 'product-fixture-policy.json', {
    schemaVersion: 1,
    kind: 'predeclared-host-fixture-corrections',
    appliedTo: ['independent-reference', 'cli-generated-target'],
    source: 'tests/fixtures/t17-matrix/scenarios.json',
    browserActionsAndAssertions: 'unchanged',
    callbacks: 'real-public-sdk-events-only',
    dimensions: { chartHost: '100% x 100%', basicHost: '720px x 360px', multiHost: '300px x 240px' },
    centerLine: { dataState: 'center', publicProp: 'optionOverrides', grid: { left: 24, right: 24, top: 24, bottom: 24, containLabel: false, outerBoundsMode: 'none' }, yAxis: { min: 0, max: 100 }, reason: 'The declared host-center click must intersect the real center datum B=50; ECharts automatic outer-label bounds otherwise move it.' },
    centerBar: { hostMode: 'basic', publicProp: 'optionOverrides', grid: { left: 24, right: 192, top: 24, bottom: 24, containLabel: false, outerBoundsMode: 'none' }, reason: 'The unchanged host-center click must intersect an actual grouped bar instead of the empty interval between two categories.' },
    budgetRepair: { setup: 'budget', generatedInstances: 3, maxAttempts: 2, failure: 'The third real canvas remains hidden by the pre-existing fault selector after exactly two generated layout repairs.', sourceGuards: 'Full before/after snapshots retain two authorized generated writes and zero user-file changes.' },
    directWindowsBuildDependencies: { rolldown: '1.2.18', '@rolldown/binding-win32-x64-msvc': '1.2.18' },
    dependencyResolution: 'Exact direct dependencies; no project overrides or project npmrc; public consumer install settings exist only in isolated userconfig; product apply retains its fixed authoritative registry.',
    dependencySetup: { candidate: 'SDK dependencies are absent until real product apply installs the planned versions.', independentReference: 'Installs the exact frozen public SDK package versions directly.' },
    implementationBindings: { config: 'Bind every instance to its declared public config.chart componentId.', optionOverrides: 'Use its own registry; never bind chart config or data.', className: '', ref: null, style: {} },
    eventBindings: 'Use an existing React on-prefixed public event name exactly once; translate only non-prefixed event names.',
    keepAlive: 'The first activation initializes the chart; count only subsequent reactivation for the frozen 0-to-1 assertion.',
    nativePnpmInstall: { nodeLinker: 'hoisted', packageImportMethod: 'copy', enableGlobalVirtualStore: false, store: 'private per-case cache', minimumReleaseAge: 0, reason: 'Install freshly published frozen SDK versions only in disposable consumers without project release-age rewrites. Independently retain exact new store project-reference identities before unlinking only references to this case root.' },
    nativePnpmScripts: { verifyDepsBeforeRun: false, pmOnFail: 'ignore', scope: 'Explicit public flags on harness-owned native commands prevent implicit dependency installs and package-manager bootstrapping; product verify receives no overriding environment configuration.' },
    entryCorrections: ['Remove an unmatched trailing Vue script close tag.', 'Import the self-mounting React App once from main.tsx.', 'Use extensionless React adapter imports accepted by the native noEmit TypeScript host.', 'Use the actual generated component public props type across the KeepAlive pane.'],
  });
}
async function saveProductProcess(options: T17ProductExecutorOptions, caseId: string, label: string, result: ProductProcessResult) {
  const stdout = await options.host.writeEvidence(caseId + '-' + label + '.stdout', Buffer.from(result.stdout));
  const stderr = await options.host.writeEvidence(caseId + '-' + label + '.stderr', Buffer.from(result.stderr));
  const record = await saveProductJson(options.host, caseId + '-' + label + '.json', { exitCode: result.exitCode, timedOut: result.timedOut, durationMs: result.durationMs,
    outputLimited: result.outputLimited, stdoutSha256: stdout.sha256, stderrSha256: stderr.sha256 });
  return { kind: label === 'typecheck' ? 'typecheck' as const : 'build' as const, exitCode: result.exitCode,
    evidencePath: basename(record.path), sha256: record.sha256, stdoutEvidencePath: basename(stdout.path), stdoutSha256: stdout.sha256,
    stderrEvidencePath: basename(stderr.path), stderrSha256: stderr.sha256 };
}
async function createProductCase(options: T17ProductExecutorOptions, scenario: T17PositiveScenario, expectedOnly = false): Promise<ProductCase> {
  const built = await buildMatchPlan(matrixEnvironment(options), options.bundle, scenario, T17_TOOLCHAIN);
  const owner = await createOwnedRun();
  const project = await materializeOwnedProductProject(owner, scenario, options.bundle.manifest, built.apis, { independentReference: expectedOnly });
  const area = await owner.createEvidenceArea('product-artifacts'), backup = await owner.createEvidenceArea('product-backups'), config = await owner.createEvidenceArea('product-process');
  const pnpmCache = scenario.packageManager === 'pnpm' ? await createProductPnpmCache(owner, project.root) : undefined;
  await writeFile(join(config, 'npm-globalconfig'), ''); await writeFile(join(config, 'npm-userconfig'), '');
  const registry = new URL(options.inputs.registryUrl);
  // npm expands this placeholder only inside the authorized installer process.
  const npmrc = 'registry=https://registry.npmjs.org/\n@company:registry=' + registry.origin + '/\nstrict-peer-dependencies=true\nauto-install-peers=false\nnode-linker=hoisted\npackage-import-method=copy\n';
  // Consumer installation settings live only in its isolated userconfig. The
  // frozen product correctly rejects resolution-affecting project configuration.
  await writeFile(join(config, 'npm-authconfig'), npmrc + '//' + registry.host + '/:_authToken=$' + '{ZHINEXUS_REGISTRY_TOKEN}\n');
  const env = productProcessEnvironment(options.toolchain, config, { npm_config_userconfig: join(config, 'npm-userconfig'), npm_config_globalconfig: join(config, 'npm-globalconfig'),
    npm_config_cache: join(options.cacheRoot, 'npm'), ...(pnpmCache ? { npm_config_store_dir: join(pnpmCache.root, 'pnpm'), npm_config_package_import_method: 'copy' } : {}) });
  if (scenario.requiresRepairFault && !expectedOnly) {
    for (const element of built.plan.elements) element.layout = 'synthetic-template-fault:t17-' + scenario.caseId;
    // This is pre-existing host CSS, so only the generated layout value is repaired.
    const html = join(project.workspaceDir, 'index.html');
    await writeFile(html, (await readFile(html, 'utf8')).replace('</head>', '<style>[data-layout^="synthetic-template-fault:"] canvas,[data-layout^="synthetic-template-fault:"] svg{pointer-events:none;visibility:hidden}</style></head>'));
  }
  return { owner, areas: [area, backup, config], project, scenario, apis: built.apis, match: built.plan, area, backup, config, env, ...(pnpmCache ? { pnpmCache } : {}),
    before: await productSourceSnapshot(project.root), planPath: join(area, 'plan.json'), applyPath: join(area, 'apply.json'), specPath: join(area, 'spec.json'), reportPath: join(area, 'report.json'), sequence: 0 };
}
export function nativeProductCommandArguments(packageManager: 'npm' | 'pnpm', purpose: 'install' | 'typecheck' | 'build', cacheRoot: string): string[] {
  const npm = packageManager === 'npm';
  return purpose === 'install' ? [...(!npm ? ['--pm-on-fail=ignore'] : []), 'install', '--ignore-scripts', ...(npm ? ['--no-audit', '--no-fund'] : ['--ignore-pnpmfile', '--package-import-method=copy', '--node-linker=hoisted', '--store-dir', join(cacheRoot, 'pnpm'), '--config.minimumReleaseAge=0', '--config.enableGlobalVirtualStore=false'])] : ['--ignore-scripts', ...(!npm ? ['--config.verifyDepsBeforeRun=false', '--pm-on-fail=ignore'] : []), 'run', purpose];
}
async function nativeProductCommand(options: T17ProductExecutorOptions, state: ProductCase, purpose: 'install' | 'typecheck' | 'build', label?: string) {
  const npm = state.scenario.packageManager === 'npm', executable = npm ? options.toolchain.nodeExecutable : matrixEnvironment(options).pnpmBin;
  const args = nativeProductCommandArguments(state.scenario.packageManager, purpose, state.pnpmCache?.root ?? options.cacheRoot);
  const result = await runProductProcess({ run: state.owner, executable, args: [...(npm ? [options.toolchain.npmCliPath] : []), ...args], cwd: purpose === 'install' ? state.project.root : state.project.workspaceDir,
    timeoutMs: purpose === 'install' ? 600000 : 120000, secrets: [options.inputs.apiToken, options.inputs.registryToken],
    env: purpose === 'install' ? { ...state.env, npm_config_userconfig: join(state.config, 'npm-authconfig'), ZHINEXUS_REGISTRY_TOKEN: options.inputs.registryToken } : state.env });
  const evidence = await saveProductProcess(options, state.scenario.caseId, label ?? purpose, result);
  if (purpose === 'install' && result.exitCode === 0) {
    await removeFinishedWorkspaceLinks(state.owner, state.project.root, async removed => {
      await saveProductJson(options.host, state.scenario.caseId + '-native-install-workspace-links.json', { kind: 'owned-native-workspace-reference-removal', projectRoot: state.project.root, removed });
    });
  }
  if (purpose === 'install' && npm) {
    const directory = join(options.cacheRoot, 'npm/_logs');
    const logs = (await readdir(directory).catch(() => [] as string[])).filter(name => name.endsWith('-debug-0.log')).sort().slice(-1);
    for (const name of logs) await options.host.writeEvidence(state.scenario.caseId + '-' + (label ?? purpose) + '-npm-debug.log', Buffer.from(sanitizeProductOutput(await readFile(join(directory, name), 'utf8'), [options.inputs.apiToken, options.inputs.registryToken])));
  }
  return { result, evidence };
}
async function productCli(options: T17ProductExecutorOptions, state: ProductCase, cli: FrozenCliIdentity, args: string[], label: string) {
  await state.owner.assertOwnedProject(state.project.root);
  await assertFrozenCliEntry(cli, options.inputs.cliVersion, options.inputs.cliSha256);
  const stopLogs = label === 'apply' ? await observeProductInstallLogs(state.owner.parentRoot, [options.inputs.apiToken, options.inputs.registryToken]) : undefined;
  const result = await runProductProcess({ run: state.owner, executable: options.toolchain.nodeExecutable, args: [cli.binPath, ...args], cwd: state.project.root, timeoutMs: 900000,
    env: { ...state.env, ZHINEXUS_API_TOKEN: options.inputs.apiToken, ZHINEXUS_REGISTRY_TOKEN: options.inputs.registryToken }, secrets: [options.inputs.apiToken, options.inputs.registryToken] });
  await saveProductProcess(options, state.scenario.caseId, 'cli-' + label + '-' + state.sequence++, result);
  let json: unknown; try { json = JSON.parse(result.stdout); } catch { json = undefined; }
  if (stopLogs) {
    const operationId = json && typeof json === 'object' && 'operationId' in json && typeof json.operationId === 'string' ? json.operationId : undefined;
    await saveProductJson(options.host, state.scenario.caseId + '-apply-install-log-observation.json', await stopLogs(operationId));
  }
  return { result, json };
}
export async function withProductInstallDelivery<T extends { json: unknown }>(input: { run: OwnedRun; projectRoot: string; backupRoot: string; plan: IntegrationPlanV1; invoke(): Promise<T> }): Promise<T> {
  const hasInstall = input.plan.changes.some(change => change.kind === 'lockfile-regeneration');
  const guard = hasInstall ? await input.run.prepareInstallDelivery({ projectRoot: input.projectRoot, backupRoot: input.backupRoot, planDigest: productSha256(productCanonicalBytes(input.plan)) }) : undefined;
  const result = await input.invoke();
  const apply = validateIntegrationApplyResult(result.json);
  if (guard && apply.ok && await lstat(join(input.backupRoot, apply.value.operationId, 'install-delivery.json')).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error;
  })) await guard.register(apply.value.operationId);
  return result;
}
async function planAndApplyProduct(options: T17ProductExecutorOptions, state: ProductCase, cli: FrozenCliIdentity) {
  const matchPath = join(state.area, 'match.json'); await writeFile(matchPath, productCanonicalBytes(state.match));
  const inspect = await productCli(options, state, cli, inspectArgsFor({ projectRoot: state.project.root, workspace: state.scenario.workspace }), 'inspect');
  if (inspect.result.exitCode !== 0) throw new Error('Product inspect failed.');
  const planned = await productCli(options, state, cli, planArgsFor({ projectRoot: state.project.root, workspace: state.scenario.workspace, matchPath, apiUrl: options.inputs.apiUrl, registryUrl: options.inputs.registryUrl }), 'plan');
  const plan = validateIntegrationPlan(planned.json);
  if (planned.result.exitCode !== 0 || !plan.ok || plan.value.status !== 'planned') throw new Error('Product plan did not reach a valid planned state.');
  state.plan = plan.value; await writeFile(state.planPath, productCanonicalBytes(plan.value));
  const applied = await withProductInstallDelivery({ run: state.owner, projectRoot: state.project.root, backupRoot: state.backup, plan: plan.value,
    invoke: () => productCli(options, state, cli, applyArgsFor({ projectRoot: state.project.root, workspace: state.scenario.workspace, planPath: state.planPath,
      apiUrl: options.inputs.apiUrl, registryUrl: options.inputs.registryUrl, backupRoot: state.backup, allowInstall: true }), 'apply') });
  const apply = validateIntegrationApplyResult(applied.json);
  if (applied.result.exitCode !== 0 || !apply.ok || apply.value.status !== 'applied') throw new Error('Product apply did not reach a valid applied state.');
  state.apply = apply.value; await writeFile(state.applyPath, productCanonicalBytes(apply.value));
}

async function independentBaselines(options: T17ProductExecutorOptions, scenario: T17PositiveScenario) {
  const referenceScenario = { ...scenario, caseId: scenario.caseId + '-reference', requiresRepairFault: false };
  const reference = await createProductCase(options, referenceScenario, true);
  try {
    await authorIndependentReference(reference.project, reference.scenario, reference.apis);
    const sourceFiles = [];
    for (const [index, [path, sha256]] of [...await productSourceSnapshot(reference.project.root)].entries()) {
      const saved = await options.host.writeEvidence(scenario.caseId + '-reference-source-' + index + '-' + basename(path), await readFile(join(reference.project.root, path)));
      sourceFiles.push({ path, sha256, evidencePath: basename(saved.path), bytes: saved.bytes });
    }
    await saveProductJson(options.host, scenario.caseId + '-reference-source.json', { kind: 'predetermined-independent-sdk-host',
      projectRoot: reference.project.root.replaceAll('\\', '/'), files: sourceFiles });
    const installed = await nativeProductCommand(options, reference, 'install'); if (installed.result.exitCode) throw new Error('Independent reference install failed.');
    const built = await nativeProductCommand(options, reference, 'build'); if (built.result.exitCode) throw new Error('Independent reference build failed.');
    const matrix = await runBrowserScenario({ distDir: reference.project.distDir, scenario: reference.scenario, viewport: T17_VISUAL.viewport });
    await saveProductJson(options.host, scenario.caseId + '-reference-browser.json', { status: matrix.status, pageErrors: matrix.pageErrors, actions: matrix.actions, assertions: matrix.assertions,
      interaction: matrix.interaction, observations: matrix.observations, visual: matrix.visual, browser: matrix.browser });
    await options.host.writeEvidence(scenario.caseId + '-reference-matrix.png', matrix.screenshot.bytes);
    if (matrix.pageErrors.length || matrix.actions.some(action => action.status !== 'passed') || matrix.assertions.some(assertion => assertion.status !== 'passed') || !matrix.interaction?.observed) throw new Error('Independent matrix reference behavior failed.');
    const server = await startStaticServer(reference.project.distDir), unregister = reference.owner.trackOwnedProcess(server.close);
    let product; try { product = await captureIndependentProductBaseline(server.origin + '/', reference.scenario); } finally { await server.close(); unregister(); }
    await options.host.writeEvidence(scenario.caseId + '-reference-product.png', product.bytes);
    await saveProductJson(options.host, scenario.caseId + '-reference-environment.json', product.audit);
    return { matrix: { bytes: matrix.screenshot.bytes, environmentKey: matrix.browser.environmentKey }, product: { bytes: product.bytes, environment: product.environment } };
  } finally {
    await finishProductCase(reference.owner, reference.areas, reference.scenario.caseId, reference.pnpmCache);
    await saveProductJson(options.host, scenario.caseId + '-reference-seal.json', { evidenceRoot: reference.owner.evidenceRoot,
      sealPath: join(reference.owner.evidenceRoot, 'run-seal.json'), sealSha256: productSha256(await readFile(join(reference.owner.evidenceRoot, 'run-seal.json'))) });
  }
}

async function executePositiveProduct(options: T17ProductExecutorOptions, scenario: T17PositiveScenario, cli: FrozenCliIdentity): Promise<T17CellReceipt> {
  // Reference is independently built before any target CLI inspect/plan/apply runs.
  const baselines = await independentBaselines(options, scenario);
  const state = await createProductCase(options, scenario);
  let cleaned = false, finalizationStarted = false;
  try {
    const installed = await nativeProductCommand(options, state, 'install'); if (installed.result.exitCode) throw new Error('Target dependency install failed.');
    await planAndApplyProduct(options, state, cli);
    const plan = state.plan!, apply = state.apply!;
    const typed = await nativeProductCommand(options, state, 'typecheck');
    const built = await nativeProductCommand(options, state, 'build');
    if (typed.result.exitCode || built.result.exitCode) throw new Error('Target native commands failed.');
    const server = await startStaticServer(state.project.distDir), unregister = state.owner.trackOwnedProcess(server.close);
    const spec = buildProductSpec({ scenario, projectRoot: state.project.root, manifestBytes: await readFile(state.project.packageJsonPath), plan, applyResult: apply, url: server.origin + '/', baseline: baselines.product });
    state.spec = spec; await writeFile(join(state.area, 'independent-baseline.png'), baselines.product.bytes); await writeFile(state.specPath, productCanonicalBytes(spec));
    const verificationInput = { projectRoot: state.project.root, workspace: scenario.workspace, planPath: state.planPath, applyResultPath: state.applyPath, specPath: state.specPath,
      artifactRoot: state.area, allowProjectScripts: true, allowBrowser: true };
    let verified = await productCli(options, state, cli, verifyArgsFor(verificationInput), 'verify');
    let report = validateIntegrationVerificationReport(verified.json);
    let repair: T17CellReceipt['repair'];
    if (scenario.requiresRepairFault) {
      if (!report.ok || report.value.status !== 'failed') throw new Error('Repair scenario did not expose its real initial template failure.');
      const initial = await saveProductJson(options.host, scenario.caseId + '-initial-report.json', report.value);
      await writeFile(state.reportPath, productCanonicalBytes(report.value));
      const repaired = await productCli(options, state, cli, repairArgsFor({ ...verificationInput, reportPath: state.reportPath, maxAttempts: 1 }), 'repair');
      const checked = validateIntegrationRepairResult(repaired.json);
      if (repaired.result.exitCode !== 0 || !checked.ok || checked.value.status !== 'repaired' || checked.value.attempts.length !== 1 || !checked.value.finalReport) throw new Error('Product bounded template repair failed.');
      const result = await saveProductJson(options.host, scenario.caseId + '-repair-result.json', checked.value);
      repair = { initialReportPath: basename(initial.path), initialReportSha256: initial.sha256, resultPath: basename(result.path), resultSha256: result.sha256 };
      report = validateIntegrationVerificationReport(checked.value.finalReport);
      verified = { ...verified, result: { ...verified.result, exitCode: repaired.result.exitCode }, json: checked.value.finalReport };
    }
    if (!report.ok) throw new Error('Product verification output failed its actual contract.');
    state.report = report.value;
    const matrixBrowser = await runBrowserScenario({ distDir: state.project.distDir, scenario, viewport: T17_VISUAL.viewport, baseline: baselines.matrix });
    await server.close(); unregister();
    const refs = {
      plan: await saveProductJson(options.host, scenario.caseId + '-plan.json', plan), apply: await saveProductJson(options.host, scenario.caseId + '-apply.json', apply),
      spec: await saveProductJson(options.host, scenario.caseId + '-spec.json', spec), report: await saveProductJson(options.host, scenario.caseId + '-report.json', report.value),
    };
    const generatedPath = state.project.generatedPaths[0]!, generated = await options.host.writeEvidence(scenario.caseId + '-generated.' + (scenario.framework === 'vue' ? 'vue' : 'tsx'), await readFile(join(state.project.root, generatedPath)));
    const imports = await proveGeneratedProductImports({ projectRoot: state.project.root, distDir: state.project.distDir, generatedPaths: state.project.generatedPaths, loaded: matrixBrowser.scriptDigests });
    for (const [index, proof] of imports.entries()) {
      await options.host.writeEvidence(scenario.caseId + '-generated-' + index + '.' + (scenario.framework === 'vue' ? 'vue' : 'tsx'), await readFile(join(state.project.root, proof.generatedPath)));
      await options.host.writeEvidence(scenario.caseId + '-source-map-' + index + '.json', await readFile(proof.sourceMapPath));
    }
    await saveProductJson(options.host, scenario.caseId + '-generated-import-proof.json', imports);
    const interactionDeclaration = scenario.browser.interaction!;
    const interaction = matrixBrowser.interaction!;
    const interactionRef = await saveProductJson(options.host, scenario.caseId + '-interaction.json', { schemaVersion: 1, caseId: scenario.caseId, framework: scenario.framework,
      host: scenario.host, projectRoot: state.project.root.replaceAll('\\', '/'), actions: matrixBrowser.actions.map(({ action, status, observed }) => ({ action, status, observed })),
      interaction: { selector: interactionDeclaration.selector, pattern: interactionDeclaration.pattern, expected: { from: interactionDeclaration.from, to: interactionDeclaration.to },
        before: interaction.before, after: interaction.after, status: interaction.observed ? 'passed' : 'failed' } });
    const browserAssets: T17CellReceipt['browserAssets'] = [];
    for (const [index, asset] of matrixBrowser.scriptDigests.entries()) {
      const assetPath = new URL(asset.url).pathname, bytes = await readFile(join(state.project.distDir, assetPath));
      if (productSha256(bytes) !== asset.sha256 || bytes.length !== asset.bytes) throw new Error('Browser-loaded JS bytes differ from the built asset.');
      const ref = await options.host.writeEvidence(scenario.caseId + '-loaded-' + index + '.js', bytes);
      browserAssets.push({ path: assetPath, evidencePath: basename(ref.path), url: asset.url, sha256: ref.sha256, bytes: ref.bytes, status: 'loaded' });
    }
    const screenshot = await options.host.writeEvidence(scenario.caseId + '-screenshot.png', matrixBrowser.screenshot.bytes);
    const baseline = await options.host.writeEvidence(scenario.caseId + '-baseline.png', baselines.matrix.bytes);
    const after = await productSourceSnapshot(state.project.root), allowed = new Set(plan.changes.map(change => change.path));
    const outOfScopeWrites = changedSources(state.before, after).filter(path => !allowed.has(path) && !['package-lock.json', 'pnpm-lock.yaml'].includes(path)).length;
    const lostUserEdits = [...state.before].filter(([path, hash]) => !allowed.has(path) && !['package-lock.json', 'pnpm-lock.yaml'].includes(path) && after.get(path) !== hash).length;
    finalizationStarted = true; cleaned = await finishProductCase(state.owner, state.areas, scenario.caseId, state.pnpmCache);
    await saveProductJson(options.host, scenario.caseId + '-case-seal.json', { evidenceRoot: state.owner.evidenceRoot, sealPath: join(state.owner.evidenceRoot, 'run-seal.json'),
      sealSha256: productSha256(await readFile(join(state.owner.evidenceRoot, 'run-seal.json'))) });
    return { caseId: scenario.caseId, framework: scenario.framework, packageManager: scenario.packageManager, host: scenario.host, projectRoot: state.project.root.replaceAll('\\', '/'),
      scenarioIdentity: { topology: scenario.topology, workspace: scenario.workspace, hostMode: scenario.hostMode, components: structuredClone(scenario.components) }, expectedOutcome: 'pass',
      actualOutcome: report.value.status === 'passed' && verified.result.exitCode === 0 && matrixBrowser.status === 'passed' && !outOfScopeWrites && !lostUserEdits ? 'pass' : 'failed', sourceKind: 'temporary-host',
      receiptEvidencePath: scenario.caseId + '-receipt.json', cliTarballSha256: options.inputs.cliSha256, frozenBundleSha256: options.inputs.sdkManifestSha256,
      planSha256: refs.plan.sha256, applyResultSha256: refs.apply.sha256, verificationSpecSha256: refs.spec.sha256, reportSha256: refs.report.sha256, reportPath: basename(refs.report.path),
      planEvidencePath: basename(refs.plan.path), applyResultEvidencePath: basename(refs.apply.path), verificationSpecEvidencePath: basename(refs.spec.path), generatedEvidencePath: basename(generated.path),
      ...(repair ? { repair } : {}), commands: [typed.evidence, built.evidence], generatedPath, generatedSha256: generated.sha256, browserAssets,
      interaction: { ...interaction, evidencePath: basename(interactionRef.path), sha256: interactionRef.sha256 },
      visualCheck: { status: matrixBrowser.visual.status === 'PASS' ? 'passed' : 'failed', screenshotPath: basename(screenshot.path), screenshotSha256: screenshot.sha256, baselinePath: basename(baseline.path), baselineSha256: baseline.sha256 },
      outOfScopeWrites, lostUserEdits, cleanup: { projectRootRemoved: cleaned, evidenceRetained: true, userProjectPreserved: true } };
  } catch (error) {
    await options.host.writeEvidence(scenario.caseId + '-product-error.txt', Buffer.from(sanitizeProductOutput(error instanceof Error ? error.message : 'Product scenario error.', [options.inputs.apiToken, options.inputs.registryToken])));
    throw error;
  } finally { if (!finalizationStarted) { finalizationStarted = true; await finishProductCase(state.owner, state.areas, scenario.caseId, state.pnpmCache); } }
}

function productIssueCodes(value: unknown): string[] {
  const codes = new Set<string>();
  const walk = (current: unknown, depth: number) => {
    if (depth > 16 || !current || typeof current !== 'object') return;
    if (Array.isArray(current)) { for (const child of current) walk(child, depth + 1); return; }
    for (const [key, child] of Object.entries(current)) {
      if (key === 'code' && typeof child === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(child)) codes.add(child);
      else walk(child, depth + 1);
    }
  };
  walk(value, 0); return [...codes].sort();
}
export function positiveScenarioForRefusal(scenario: T17RefusalScenario): T17PositiveScenario {
  const base = T17_POSITIVE_SCENARIOS.find(item => item.framework === scenario.framework && (scenario.setup === 'budget' ? item.hostMode === 'multi' : item.caseId.endsWith('01')))!;
  const positive = { ...structuredClone(base), caseId: scenario.caseId, packageManager: scenario.packageManager };
  if (scenario.setup === 'budget') {
    positive.components = Array.from({ length: 3 }, (_, index) => ({ componentId: 'line', instanceId: 'budget-' + (index + 1), dataState: 'default' }));
    positive.requiresRepairFault = true;
    positive.browser.assertions.push(...positive.components.map((_, index) => ({ kind: 'visible' as const, selector: '[data-testid="multi-host"]>.zhinexus-chart-host:nth-child(' + (index + 1) + ') canvas' })));
  }
  return positive;
}
function refusalObservation(exitCode: number, raw: unknown): ProductRefusalObservation {
  const object = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return { exitCode, issueCodes: productIssueCodes(raw), ...(typeof object.status === 'string' ? { status: object.status } : {}),
    ...(typeof object.visualResult === 'string' ? { visualResult: object.visualResult } : {}) };
}
async function executeRefusalProduct(options: T17ProductExecutorOptions, scenario: T17RefusalScenario, cli: FrozenCliIdentity): Promise<T17RefusalReceipt> {
  const positive = positiveScenarioForRefusal(scenario);
  const needsBaseline = ['handler-suppressed', 'tamper-version', 'diff-baseline', 'env-baseline', 'budget'].includes(scenario.setup);
  const baselines = needsBaseline ? await independentBaselines(options, positive) : undefined;
  const state = await createProductCase(options, positive);
  let cleaned = false, finalizationStarted = false, deliberateLink: string | undefined, before: SourceSnapshot | undefined;
  let budgetRepair: T17BudgetRepairEvidence | undefined;
  const allowedRefusalChanges = new Set<string>();
  const guard = async () => {
    const snapshot = await productSourceSnapshot(state.project.root);
    if (scenario.setup === 'tamper-version') snapshot.set('installed-package-manifest', productSha256(await readFile(join(state.project.root, 'node_modules/@company/charts-react/package.json'))));
    return snapshot;
  };
  let observation: ProductRefusalObservation = { exitCode: 1, issueCodes: [] }, raw: unknown;
  try {
    if (scenario.setup === 'echarts-conflict') {
      const manifest = JSON.parse(await readFile(state.project.packageJsonPath, 'utf8')) as { dependencies: Record<string, string> };
      manifest.dependencies.echarts = '5.6.0'; await writeFile(state.project.packageJsonPath, JSON.stringify(manifest, null, 2) + '\n');
    }
    if (scenario.setup === 'handler-suppressed') {
      const app = join(state.project.workspaceDir, 'src/App.tsx');
      const source = await readFile(app, 'utf8');
      const changed = source.replace('const onPointClick = () => setClicks((value) => value + 1);', 'const onPointClick = () => {};');
      if (changed === source) throw new Error('Handler suppression did not target the declared host handler.');
      await writeFile(app, changed);
    }
    if (scenario.setup === 'sentinel') {
      const manifest = JSON.parse(await readFile(state.project.packageJsonPath, 'utf8')) as { scripts: Record<string, string> };
      manifest.scripts.typecheck = "node -e \"process.stdout.write(process.env.ZHINEXUS_API_TOKEN||'isolated');process.exitCode=1\"";
      await writeFile(state.project.packageJsonPath, JSON.stringify(manifest, null, 2) + '\n');
    }
    if (['echarts-conflict', 'bogus-variant', 'symlink-parent'].includes(scenario.setup)) {
      if (scenario.setup === 'echarts-conflict') {
        // React planning must inspect a real ReactDOM lock entry before testing
        // the declared ECharts 5.6.0 versus MatchPlan 6.1.0 conflict.
        const installed = await nativeProductCommand(options, state, 'install');
        if (installed.result.exitCode) throw new Error('Peer-conflict setup dependency install failed.');
      }
      if (scenario.setup === 'bogus-variant') {
        const target = state.match.elements[0]?.target; if (!target) throw new Error('Bogus target setup is absent.'); target.variantReleaseId = 't17-deliberately-nonexistent-variant';
      }
      if (scenario.setup === 'symlink-parent') {
        const otherRoot = state.owner.projectRoots[scenario.framework === 'vue' ? 'react' : 'vue'], target = join(otherRoot, 'link-target'); await mkdir(target);
        deliberateLink = join(state.project.workspaceDir, 'src/components/zhinexus'); await rmdir(deliberateLink); await symlink(target, deliberateLink, 'junction');
      }
      const matchPath = join(state.area, 'match.json'); await writeFile(matchPath, productCanonicalBytes(state.match)); before = await guard();
      const outcome = await productCli(options, state, cli, planArgsFor({ projectRoot: state.project.root, workspace: positive.workspace, matchPath,
        apiUrl: options.inputs.apiUrl, registryUrl: options.inputs.registryUrl }), 'refusal-plan');
      raw = outcome.json; observation = refusalObservation(outcome.result.exitCode, raw);
    } else {
      const installed = await nativeProductCommand(options, state, 'install'); if (installed.result.exitCode) throw new Error('Refusal setup dependency install failed.');
      await planAndApplyProduct(options, state, cli);
      const plan = state.plan!, apply = state.apply!;
      const budgetSources = new Map<string, Buffer>();
      if (scenario.setup === 'budget') {
        const generated = plan.changes.filter(change => change.kind === 'generated-component');
        if (generated.length !== 3) throw new Error('Budget exhaustion requires three originally planned real generated instances.');
        for (const change of generated) {
          const bytes = await readFile(join(state.project.root, change.path));
          const guard = apply.afterHashes.find(snapshot => snapshot.path === change.path);
          if (!guard?.exists || guard.sha256 !== productSha256(bytes) || !bytes.toString('utf8').includes("const layout = 'synthetic-template-fault:t17-N10';")) throw new Error('Budget generated fault must be exactly bound to the original successful apply.');
          budgetSources.set(change.path, bytes);
        }
      }
      if (scenario.setup === 'static-standin') {
        await writeFile(join(state.project.workspaceDir, 'src/App.vue'), '<template><main class="zhinexus-chart-host"><canvas width="720" height="360" /></main></template>\n');
        before = await guard();
        const built = await nativeProductCommand(options, state, 'build'); if (built.result.exitCode) throw new Error('Static stand-in build failed instead of reaching import detection.');
        const maps = (await readdir(join(state.project.distDir, 'assets'))).filter(name => name.endsWith('.map'));
        const sources: string[] = [];
        for (const name of maps) {
          const map = JSON.parse(await readFile(join(state.project.distDir, 'assets', name), 'utf8')) as { sources?: string[] };
          sources.push(...(map.sources ?? []));
        }
        if (!maps.length) throw new Error('Static stand-in detection requires real source-map evidence.');
        const imported = state.project.generatedPaths.some(path => sources.some(source => source.replaceAll('\\', '/').endsWith('/' + basename(path))));
        raw = { sourceMaps: maps, sources, generatedPaths: state.project.generatedPaths, generatedModuleImported: imported };
        observation = { exitCode: 0, issueCodes: [], ...(imported ? {} : { detection: 'entry-import-missing' }) };
      } else {
        if (scenario.setup === 'apply-then-edit') await writeFile(join(state.project.root, state.project.generatedPaths[0]!), '\n<!-- deliberate user edit -->\n', { flag: 'a' });
        if (scenario.setup === 'tamper-version') {
          const installedPath = join(state.project.root, 'node_modules/@company/charts-react/package.json');
          const manifest = JSON.parse(await readFile(installedPath, 'utf8')) as { version: string }; manifest.version = '0.0.0'; await writeFile(installedPath, JSON.stringify(manifest, null, 2) + '\n');
        }
        const built = await nativeProductCommand(options, state, 'build'); if (built.result.exitCode) throw new Error('Refusal setup build failed.');
        const server = await startStaticServer(state.project.distDir), unregister = state.owner.trackOwnedProcess(server.close);
        let baseline = baselines?.product;
        if (scenario.setup === 'diff-baseline' && baseline) {
          const image = PNG.sync.read(Buffer.from(baseline.bytes)); image.data.fill(255); baseline = { ...baseline, bytes: PNG.sync.write(image) };
        }
        if (scenario.setup === 'env-baseline' && baseline) baseline = { ...baseline, environment: { ...baseline.environment, browserRevision: '@' + '0'.repeat(40) } };
        const spec = buildProductSpec({ scenario: positive, projectRoot: state.project.root, manifestBytes: await readFile(state.project.packageJsonPath), plan, applyResult: apply, url: server.origin + '/', ...(baseline ? { baseline } : {}) });
        if (scenario.setup === 'business-gap') spec.businessGaps = ['data-source'];
        if (baseline) await writeFile(join(state.area, 'independent-baseline.png'), baseline.bytes);
        await writeFile(state.specPath, productCanonicalBytes(spec));
        before = await guard();
        const input = { projectRoot: state.project.root, workspace: positive.workspace, planPath: state.planPath, applyResultPath: state.applyPath, specPath: state.specPath,
          artifactRoot: state.area, allowProjectScripts: true, allowBrowser: true };
        const outcome = await productCli(options, state, cli, verifyArgsFor(input), 'refusal-verify');
        raw = outcome.json; const checked = validateIntegrationVerificationReport(raw); if (!checked.ok) throw new Error('Refusal verify did not return a real contract-valid product report.');
        observation = refusalObservation(outcome.result.exitCode, raw);
        if (scenario.setup === 'handler-suppressed' && !checked.value.checks.some(check => check.category === 'type' && check.status === 'passed')) throw new Error('Handler refusal did not prove successful real typechecking.');
        if (scenario.setup === 'apply-then-edit' || scenario.setup === 'budget') {
          await writeFile(state.reportPath, productCanonicalBytes(checked.value));
          const repaired = await productCli(options, state, cli, repairArgsFor({ ...input, reportPath: state.reportPath, maxAttempts: scenario.setup === 'budget' ? 2 : 1 }), 'refusal-repair');
          const repair = validateIntegrationRepairResult(repaired.json, { plan, applyResult: apply, spec, reportDigest: productSha256(productCanonicalBytes(checked.value)), sourceReport: checked.value });
          if (!repair.ok) throw new Error('Refusal repair result was not contract-valid.');
          await saveProductJson(options.host, scenario.caseId + '-raw-repair.json', repair.value);
          observation.repairWrites = repair.value.changedFiles.length;
          if (scenario.setup === 'budget') {
            const result = repair.value;
            if (result.status !== 'stopped' || result.stopReason !== 'max-attempts-reached' || result.maxAttempts !== 2 || result.attempts.length !== 2 || result.changedFiles.length !== 2
              || result.attempts.some(attempt => attempt.changedFiles.length !== 1) || new Set(result.attempts.flatMap(attempt => attempt.changedFiles)).size !== 2
              || result.finalReport.status !== 'failed' || !result.finalReport.checks.some(check => check.category === 'behavior' && check.id !== 'dependency-guard' && check.status === 'failed')
              || !result.finalReport.checks.some(check => check.id === 'dependency-guard' && check.status === 'passed')
              || ['type', 'build'].some(category => !result.finalReport.checks.some(check => check.category === category && check.status === 'passed'))) throw new Error('Two real authorized repair writes and the remaining real behavior failure were not observed.');
            for (const path of result.changedFiles) {
              if (!budgetSources.has(path)) throw new Error('Budget repair changed an unplanned generated instance.');
              allowedRefusalChanges.add(path);
            }
            const afterRepair = await guard();
            const changed = changedSources(before!, afterRepair);
            if (changed.length !== 2 || changed.some(path => !allowedRefusalChanges.has(path))) throw new Error('Budget repair changed a user source or failed to perform two distinct writes.');
            const jsonRef = async (name: string, value: unknown) => { const saved = await saveProductJson(options.host, scenario.caseId + '-budget-' + name + '.json', value); return { evidencePath: basename(saved.path), sha256: saved.sha256 }; };
            const sourceRef = async (name: string, bytes: Buffer) => { const saved = await options.host.writeEvidence(scenario.caseId + '-budget-' + name, bytes); return { evidencePath: basename(saved.path), sha256: saved.sha256 }; };
            const generatedSources = [];
            for (const [index, [path, bytes]] of [...budgetSources].entries()) {
              const afterBytes = await readFile(join(state.project.root, path));
              const repairedSource = result.changedFiles.includes(path);
              if (repairedSource ? !afterBytes.toString('utf8').includes("const layout = 'grid cell 1';") || afterBytes.equals(bytes) : !afterBytes.equals(bytes)) throw new Error('The third generated fault did not remain byte-identical after the two repairs.');
              generatedSources.push({ path, before: await sourceRef('generated-' + index + '-before.vue', bytes), after: await sourceRef('generated-' + index + '-after.vue', afterBytes) });
            }
            const backups = [];
            const runsRoot = join(state.area, 'runs');
            const artifactRuns = await readdir(runsRoot, { withFileTypes: true });
            for (const attempt of result.attempts) {
              const matches = [];
              for (const directory of artifactRuns) {
                if (!directory.isDirectory() || directory.isSymbolicLink()) continue;
                const path = join(runsRoot, directory.name, attempt.backupRef.id + '.json');
                const info = await lstat(path).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; });
                if (info?.isFile() && !info.isSymbolicLink() && info.nlink === 1) matches.push(path);
              }
              if (matches.length !== 1) throw new Error('Budget repair backup must resolve to one real ordinary artifact file.');
              const bytes = await readFile(matches[0]!);
              if (productSha256(bytes) !== attempt.backupRef.sha256) throw new Error('Budget repair backup bytes differ from the actual repair reference.');
              backups.push(await sourceRef('backup-' + attempt.attempt + '.json', bytes));
            }
            budgetRepair = { plan: await jsonRef('plan', plan), applyResult: await jsonRef('apply', apply), spec: await jsonRef('spec', spec), initialReport: await jsonRef('initial-report', checked.value), result: await jsonRef('repair-result', result),
              sourceBefore: await jsonRef('source-before', [...before!]), sourceAfter: await jsonRef('source-after', [...afterRepair]), backups, generatedSources };
            observation.repairAttempts = result.attempts.length;
            observation.exitCode = repaired.result.exitCode; observation.repairStatus = 'stopped-or-rejected';
          }
        }
        if (scenario.setup === 'sentinel') {
          let found = false;
          const scan = async (path: string) => {
            for (const entry of await readdir(path, { withFileTypes: true })) {
              const next = join(path, entry.name); if (entry.isDirectory()) await scan(next); else if (entry.isFile() && (await readFile(next)).includes(Buffer.from(options.inputs.apiToken))) found = true;
            }
          };
          await scan(state.area); observation.sentinelAbsent = !found && !outcome.result.stdout.includes(options.inputs.apiToken) && !outcome.result.stderr.includes(options.inputs.apiToken);
        }
        await server.close(); unregister();
      }
    }
    if (!before) throw new Error('Refusal source guard was not captured before the product operation.');
    const after = await guard(), differences = changedSources(before, after).filter(path => !allowedRefusalChanges.has(path));
    const refused = classifyProductRefusal(scenario, observation) && !differences.length;
    await saveProductJson(options.host, scenario.caseId + '-raw-product.json', raw ?? { unavailable: true });
    const report = await saveProductJson(options.host, scenario.caseId + '-refusal.json', { schemaVersion: 1, caseId: scenario.caseId, kind: scenario.kind, focus: scenario.focus, reason: scenario.reason,
      setup: scenario.setup, framework: scenario.framework, packageManager: scenario.packageManager, expectedOutcome: 'refuse', actualOutcome: refused ? 'refused' : 'error', ...productRefusalReportObservation(observation), ...(budgetRepair ? { budgetRepair } : {}) });
    if (deliberateLink) { await unlink(deliberateLink); deliberateLink = undefined; }
    finalizationStarted = true; cleaned = await finishProductCase(state.owner, state.areas, scenario.caseId, state.pnpmCache);
    await saveProductJson(options.host, scenario.caseId + '-case-seal.json', { evidenceRoot: state.owner.evidenceRoot, sealPath: join(state.owner.evidenceRoot, 'run-seal.json'),
      sealSha256: productSha256(await readFile(join(state.owner.evidenceRoot, 'run-seal.json'))), projectRootRemoved: cleaned });
    return { caseId: scenario.caseId, framework: scenario.framework, packageManager: scenario.packageManager,
      scenarioIdentity: { kind: scenario.kind, focus: scenario.focus, reason: scenario.reason, setup: scenario.setup }, receiptEvidencePath: scenario.caseId + '-receipt.json',
      expectedOutcome: 'refuse', actualOutcome: refused ? 'refused' : 'error', beforeProjectSha256: snapshotDigest(before), afterProjectSha256: snapshotDigest(after),
      reportPath: basename(report.path), reportSha256: report.sha256, outOfScopeWrites: differences.length };
  } catch (error) {
    await options.host.writeEvidence(scenario.caseId + '-product-error.txt', Buffer.from(sanitizeProductOutput(error instanceof Error ? error.message : 'Product refusal error.', [options.inputs.apiToken, options.inputs.registryToken])));
    throw error;
  } finally {
    if (deliberateLink && (await lstat(deliberateLink).catch(() => undefined))?.isSymbolicLink()) await unlink(deliberateLink);
    if (!finalizationStarted) { finalizationStarted = true; await finishProductCase(state.owner, state.areas, scenario.caseId, state.pnpmCache); }
  }
}

/** All fixed declarations run through a concrete implementation; errors retain the fixed denominator. */
export function createT17ProductExecutor(options: T17ProductExecutorOptions): T17ScenarioExecutor {
  return { positive: (scenario, identity) => executePositiveProduct(options, scenario, identity.cli), refusal: (scenario, identity) => executeRefusalProduct(options, scenario, identity.cli) };
}

export async function runT17ProductMatrix(options: { env: Record<string, string | undefined>; repositoryRoot: string }): Promise<T17MatrixRunResult & { evidenceRoot: string }> {
  const inputs = await loadT17HostInputs(options.env), toolchain = resolveT17FixedToolchain(options.repositoryRoot), host = await createOwnedRun();
  let sealed = false;
  const cacheRoot = await host.makeOwnedProject('product-cache');
  try {
    await saveProductFixturePolicy(host);
    const installation = await installFrozenCli({ run: host, tarballPath: inputs.cliTarball, nodeExecutable: toolchain.nodeExecutable, npmCliPath: toolchain.npmCliPath,
      expectedVersion: inputs.cliVersion, expectedTarballSha256: inputs.cliSha256 });
    const executorOptions = { host, inputs, toolchain, cacheRoot };
    const bundle = await loadBundle(matrixEnvironment({ ...executorOptions, bundle: undefined as unknown as LoadedBundle }));
    if (bundle.manifestSha256 !== inputs.sdkManifestSha256) throw new Error('Product matrix SDK bundle identity differs from the validated frozen input.');
    const executor = createT17ProductExecutor({ ...executorOptions, bundle });
    // Register the final cache inventory at the actual seal boundary, including error runs.
    const receiptHost: T17ReceiptHost = { runId: host.runId, evidenceRoot: host.evidenceRoot, writeEvidence: host.writeEvidence, stopOwnedProcesses: host.stopOwnedProcesses,
      sealEvidence: async payload => { const names = (await readdir(cacheRoot)).filter(name => name !== '.t17-owner.json'); if (names.length) await host.registerOwnedPath(cacheRoot, names);
        const path = await host.sealEvidence(payload); sealed = true; return path; } };
    const result = await sealT17MatrixRun({ host: receiptHost, frozenCli: frozenCliIdentityFromInstall(installation, inputs.cliTarball), expectedCliVersion: inputs.cliVersion,
      expectedCliTarballSha256: inputs.cliSha256, frozenBundleSha256: inputs.sdkManifestSha256, executor });
    await host.cleanup(); return { ...result, evidenceRoot: host.evidenceRoot };
  } finally {
    if (!sealed) {
      await host.stopOwnedProcesses();
      const names = (await readdir(cacheRoot)).filter(name => name !== '.t17-owner.json'); if (names.length) await host.registerOwnedPath(cacheRoot, names);
      await host.abortForTest({ preserveEvidence: true });
    }
  }
}

/** Explicit diagnostic subset. It never reports the fixed 20+13 acceptance gate as satisfied. */
export async function runT17ProductPnpmLockDiagnostic(options: { env: Record<string, string | undefined>; repositoryRoot: string }) {
  const inputs = await loadT17HostInputs(options.env), toolchain = resolveT17FixedToolchain(options.repositoryRoot), host = await createOwnedRun();
  const cacheRoot = await host.makeOwnedProject('product-cache');
  let state: ProductCase | undefined, finished = false, sealed = false;
  try {
    const installation = await installFrozenCli({ run: host, tarballPath: inputs.cliTarball, nodeExecutable: toolchain.nodeExecutable, npmCliPath: toolchain.npmCliPath, expectedVersion: inputs.cliVersion, expectedTarballSha256: inputs.cliSha256 });
    const partial = { host, inputs, toolchain, cacheRoot }, bundle = await loadBundle(matrixEnvironment({ ...partial, bundle: undefined as unknown as LoadedBundle }));
    const executorOptions = { ...partial, bundle }, cli = frozenCliIdentityFromInstall(installation, inputs.cliTarball);
    const scenario = { ...structuredClone(T17_POSITIVE_SCENARIOS.find(item => item.caseId === 'V04')!), caseId: 'pnpm-direct-verify' };
    state = await createProductCase(executorOptions, scenario);
    const installed = await nativeProductCommand(executorOptions, state, 'install');
    if (installed.result.exitCode) throw new Error('Direct verify diagnostic dependency setup failed.');
    await planAndApplyProduct(executorOptions, state, cli);
    const before = await productSourceSnapshot(state.project.root), lockBefore = await readFile(join(state.project.root, 'pnpm-lock.yaml'));
    await host.writeEvidence('direct-verify-lock-before.yaml', lockBefore);
    // Empty ordinary dist exists only to host the files that the product build will create.
    await mkdir(state.project.distDir);
    const server = await startStaticServer(state.project.distDir), unregister = state.owner.trackOwnedProcess(server.close);
    const spec = buildProductSpec({ scenario, projectRoot: state.project.root, manifestBytes: await readFile(state.project.packageJsonPath), plan: state.plan!, applyResult: state.apply!, url: server.origin + '/' });
    await writeFile(state.specPath, productCanonicalBytes(spec));
    const args = verifyArgsFor({ projectRoot: state.project.root, workspace: scenario.workspace, planPath: state.planPath, applyResultPath: state.applyPath, specPath: state.specPath, artifactRoot: state.area, allowProjectScripts: true, allowBrowser: true });
    await saveProductJson(host, 'direct-verify-argv.json', { executable: toolchain.nodeExecutable, argv: [cli.binPath, ...args], nativePrecheck: 'skipped only for this diagnostic', packageManager: JSON.parse(await readFile(state.project.packageJsonPath, 'utf8')).packageManager, cliVersion: inputs.cliVersion, cliTarballSha256: inputs.cliSha256 });
    const outcome = await productCli(executorOptions, state, cli, args, 'direct-verify');
    const report = validateIntegrationVerificationReport(outcome.json); if (!report.ok) throw new Error('Direct verify diagnostic returned no real valid report.');
    const lockAfter = await readFile(join(state.project.root, 'pnpm-lock.yaml')), after = await productSourceSnapshot(state.project.root);
    await host.writeEvidence('direct-verify-lock-after.yaml', lockAfter);
    await saveProductJson(host, 'direct-verify-report.json', report.value);
    await server.close(); unregister();
    const observation = { kind: 't17-pnpm-direct-verify-diagnostic', productionAcceptance: false, fixedDenominatorEvaluated: false, cliVersion: inputs.cliVersion, cliTarballSha256: inputs.cliSha256,
      applyLockSha256: state.apply!.afterHashes.find(snapshot => snapshot.path === 'pnpm-lock.yaml')?.sha256, lockBeforeSha256: productSha256(lockBefore), lockAfterSha256: productSha256(lockAfter),
      lockChangedDuringProductVerify: !lockBefore.equals(lockAfter), sourceChanges: changedSources(before, after), exitCode: outcome.result.exitCode, reportStatus: report.value.status, checks: report.value.checks.map(check => ({ id: check.id, status: check.status })), issueCodes: productIssueCodes(report.value) };
    await saveProductJson(host, 'direct-verify-observation.json', observation);
    finished = true; await finishProductCase(state.owner, state.areas, scenario.caseId, state.pnpmCache);
    await saveProductJson(host, 'direct-verify-case-seal.json', { evidenceRoot: state.owner.evidenceRoot, sealPath: join(state.owner.evidenceRoot, 'run-seal.json'), sealSha256: productSha256(await readFile(join(state.owner.evidenceRoot, 'run-seal.json'))) });
    const cacheNames = (await readdir(cacheRoot)).filter(name => name !== '.t17-owner.json'); if (cacheNames.length) await host.registerOwnedPath(cacheRoot, cacheNames);
    const sealPath = await host.sealEvidence(observation); sealed = true; await host.cleanup();
    return { ...observation, evidenceRoot: host.evidenceRoot, sealPath };
  } finally {
    if (state && !finished) { finished = true; await finishProductCase(state.owner, state.areas, state.scenario.caseId, state.pnpmCache); }
    if (!sealed) { const cacheNames = (await readdir(cacheRoot)).filter(name => name !== '.t17-owner.json'); if (cacheNames.length) await host.registerOwnedPath(cacheRoot, cacheNames); await host.abortForTest({ preserveEvidence: true }); }
  }
}

/** Explicit diagnostic subset. It never reports the fixed 20+13 acceptance gate as satisfied. */
export async function runT17ProductDiagnostic(options: { env: Record<string, string | undefined>; repositoryRoot: string; caseIds: string[] }) {
  if (!options.caseIds.length || new Set(options.caseIds).size !== options.caseIds.length || options.caseIds.some(id => ![...T17_POSITIVE_SCENARIOS, ...T17_REFUSAL_SCENARIOS].some(item => item.caseId === id))) throw new Error('Diagnostic case IDs must be unique known declarations.');
  const inputs = await loadT17HostInputs(options.env), toolchain = resolveT17FixedToolchain(options.repositoryRoot), host = await createOwnedRun();
  const cacheRoot = await host.makeOwnedProject('product-cache');
  let sealed = false;
  try {
    await saveProductFixturePolicy(host);
    const installation = await installFrozenCli({ run: host, tarballPath: inputs.cliTarball, nodeExecutable: toolchain.nodeExecutable, npmCliPath: toolchain.npmCliPath, expectedVersion: inputs.cliVersion, expectedTarballSha256: inputs.cliSha256 });
    const partial = { host, inputs, toolchain, cacheRoot }, bundle = await loadBundle(matrixEnvironment({ ...partial, bundle: undefined as unknown as LoadedBundle }));
    const executor = createT17ProductExecutor({ ...partial, bundle }), cli = frozenCliIdentityFromInstall(installation, inputs.cliTarball);
    const identity = { cli, cliTarballSha256: inputs.cliSha256, frozenBundleSha256: inputs.sdkManifestSha256 };
    const results: { caseId: string; outcome: string; evidencePath: string }[] = [];
    for (const caseId of options.caseIds) {
      try {
        const positive = T17_POSITIVE_SCENARIOS.find(item => item.caseId === caseId), refusal = T17_REFUSAL_SCENARIOS.find(item => item.caseId === caseId);
        const receipt = positive ? await executor.positive(positive, identity) : await executor.refusal(refusal!, identity);
        const ref = await saveProductJson(host, caseId + '-receipt.json', receipt); results.push({ caseId, outcome: receipt.actualOutcome, evidencePath: basename(ref.path) });
      } catch (error) {
        const ref = await host.writeEvidence(caseId + '-diagnostic-error.txt', Buffer.from(sanitizeProductOutput(error instanceof Error ? error.message : 'Product diagnostic error.', [inputs.apiToken, inputs.registryToken])));
        results.push({ caseId, outcome: 'error', evidencePath: basename(ref.path) });
      }
    }
    await host.stopOwnedProcesses();
    const names = (await readdir(cacheRoot)).filter(name => name !== '.t17-owner.json'); if (names.length) await host.registerOwnedPath(cacheRoot, names);
    const sealPath = await host.sealEvidence({ schemaVersion: 1, kind: 't17-product-diagnostic-subset', productionAcceptance: false, fixedDenominatorEvaluated: false,
      cliVersion: inputs.cliVersion, cliTarballSha256: inputs.cliSha256, frozenBundleSha256: inputs.sdkManifestSha256, results });
    sealed = true; await host.cleanup(); return { kind: 't17-product-diagnostic-subset', productionAcceptance: false, fixedDenominatorEvaluated: false, evidenceRoot: host.evidenceRoot, sealPath, results };
  } finally {
    if (!sealed) { await host.stopOwnedProcesses(); const names = (await readdir(cacheRoot)).filter(name => name !== '.t17-owner.json'); if (names.length) await host.registerOwnedPath(cacheRoot, names); await host.abortForTest({ preserveEvidence: true }); }
  }
}
