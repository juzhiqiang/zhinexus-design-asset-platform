import { afterEach, describe, expect, it } from 'vitest';
import { lstat, mkdir, readFile, readdir, realpath, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { ComponentApiV1, IntegrationApplyResultV1, IntegrationPlanV1, PackageRef } from '@company/contracts';
import { createOwnedRun } from '../t17-host/host.js';
import { validIntegrationPlanFixture } from '../../fixtures/integration-plan.js';
import { applyResultFixture } from '../../fixtures/integration-apply.js';
import { T17_POSITIVE_SCENARIOS, T17_REFUSAL_SCENARIOS } from '../../fixtures/t17-matrix/scenarios.js';
import { buildProductSpec, classifyProductRefusal, materializeOwnedProductProject, nativeProductCommandArguments, positiveScenarioForRefusal, productRefusalReportObservation, removeFinishedWorkspaceLinks, withProductInstallDelivery } from './product-executor.js';
import { productProcessEnvironment, runProductProcess } from './product-process.js';
import { resolveT17FixedToolchain } from '../t17-host/e2e-config.js';
import { createProductPnpmCache } from './product-cache.js';
import { independentReferenceComponent } from './product-reference.js';
import { proveGeneratedProductImports } from './product-import-proof.js';
import { captureIndependentProductBaseline } from './product-browser.js';
import { startStaticServer } from './browser.js';

const runs: Awaited<ReturnType<typeof createOwnedRun>>[] = [];
afterEach(async () => {
  for (const run of runs.splice(0)) {
    for (const root of Object.values(run.projectRoots)) {
      const names = (await readdir(root)).filter(name => name !== '.t17-owner.json');
      if (names.length) await run.registerOwnedPath(root, names);
    }
    await run.abortForTest();
  }
});
const api: ComponentApiV1 = { schemaVersion: 1, componentId: 'line', framework: 'vue', exportName: 'LineChart', exportPath: './line',
  props: [{ name: 'data', type: 'ChartData', required: true }, { name: 'config', type: 'LineChartConfig', required: false }],
  events: [{ name: 'point-click', payload: 'ChartEvent' }], styleExport: './style.css', readyMethod: 'whenRendered', notes: [] };
const packages = [{ name: '@company/charts-vue', version: '0.0.12' }, { name: '@company/charts-react', version: '0.0.12' }, { name: '@company/charts-core', version: '0.0.11' }] as PackageRef[];

describe('T17 concrete product executor boundaries', () => {
  it('materializes the declared workspace inside an exact owned project and leaves CLI output absent', async () => {
    const run = await createOwnedRun(); runs.push(run);
    const scenario = T17_POSITIVE_SCENARIOS.find(item => item.caseId === 'V03')!;
    const project = await materializeOwnedProductProject(run, scenario, { packages }, new Map([['instance-1', { ...api, componentId: 'pie' }]]));
    expect(project.root).toBe(run.projectRoots.vue);
    expect(project.workspaceDir).toBe(join(run.projectRoots.vue, 'apps/web'));
    expect(await readFile(join(project.workspaceDir, 'src/App.vue'), 'utf8')).toContain('./components/zhinexus/component-0001.vue');
    expect(await readdir(join(project.workspaceDir, 'src/components/zhinexus'))).toEqual([]);
    expect(JSON.parse(await readFile(join(project.root, '.t17-owner.json'), 'utf8')).runId).toBe(run.runId);
    expect(JSON.parse(await readFile(project.packageJsonPath, 'utf8')).devDependencies['@rolldown/binding-win32-x64-msvc']).toBe('1.2.18');
    expect(JSON.parse(await readFile(project.packageJsonPath, 'utf8')).devDependencies.rolldown).toBe('1.2.18');
    expect(JSON.parse(await readFile(join(project.root, 'package.json'), 'utf8')).overrides).toBeUndefined();
    expect(await readFile(join(project.root, 'pnpm-workspace.yaml'), 'utf8').catch(() => '')).not.toContain('overrides:');
  });

  it('rejects Next declarations before materializing any Vite stand-in', async () => {
    const run = await createOwnedRun(); runs.push(run);
    const scenario = { ...T17_POSITIVE_SCENARIOS[0]!, host: 'next-app-router' as const };
    await expect(materializeOwnedProductProject(run, scenario, { packages }, new Map([['instance-1', api]]))).rejects.toThrow(/Next|host/i);
    expect(await readdir(run.projectRoots.vue)).toEqual(['.t17-owner.json']);
  });

  it('starts the candidate without SDK dependencies while installing them in the independent reference', async () => {
    const scenario = T17_POSITIVE_SCENARIOS.find(item => item.caseId === 'V02')!;
    const barApi = { ...api, componentId: 'bar', props: [...api.props, { name: 'optionOverrides', type: 'SupportedOptionOverrides', required: false }] };
    const targetRun = await createOwnedRun(); runs.push(targetRun);
    const target = await materializeOwnedProductProject(targetRun, scenario, { packages }, new Map([['instance-1', barApi]]));
    const targetManifest = JSON.parse(await readFile(target.packageJsonPath, 'utf8'));
    expect(Object.keys(targetManifest.dependencies).filter(name => name.startsWith('@company/charts-'))).toEqual([]);
    expect(targetManifest.dependencies.vue).toBe('3.5.45');
    expect(targetManifest.dependencies.echarts).toBe('6.1.0');
    const referenceRun = await createOwnedRun(); runs.push(referenceRun);
    const reference = await materializeOwnedProductProject(referenceRun, scenario, { packages }, new Map([['instance-1', barApi]]), { independentReference: true });
    const referenceManifest = JSON.parse(await readFile(reference.packageJsonPath, 'utf8'));
    expect(referenceManifest.dependencies['@company/charts-core']).toBe('0.0.11');
    expect(referenceManifest.dependencies['@company/charts-vue']).toBe('0.0.12');
  });

  it.each(['vue', 'react'] as const)('binds each %s multi-instance config to its own chart and keeps config out of data and options', async framework => {
    const run = await createOwnedRun(); runs.push(run);
    const scenario = T17_POSITIVE_SCENARIOS.find(item => item.framework === framework && item.hostMode === 'multi')!;
    const apis = new Map(scenario.components.map(component => [component.instanceId, { ...api, framework, componentId: component.componentId,
      props: [...api.props, { name: 'optionOverrides', type: 'SupportedOptionOverrides', required: false }] }]));
    const project = await materializeOwnedProductProject(run, scenario, { packages }, apis);
    const source = await readFile(join(project.workspaceDir, 'src/App.' + (framework === 'vue' ? 'vue' : 'tsx')), 'utf8');
    for (const component of scenario.components) expect(source).toContain("chart: '" + component.componentId + "'");
    expect(source).not.toMatch(/"matrix\.config": data\d/);
    expect(source).not.toMatch(/"matrix\.optionOverrides": (?:data\d|config)/);
  });

  it('counts only KeepAlive reactivations after the first real activation', async () => {
    const run = await createOwnedRun(); runs.push(run);
    const scenario = T17_POSITIVE_SCENARIOS.find(item => item.caseId === 'V08')!;
    const project = await materializeOwnedProductProject(run, scenario, { packages }, new Map([['instance-1', api]]));
    const pane = await readFile(join(project.workspaceDir, 'src/ChartPane.vue'), 'utf8');
    expect(pane).toContain('let hasActivated = false');
    expect(pane).toContain("if (hasActivated) emit('activated')");
    expect(pane).not.toContain("onActivated(() => emit('activated'))");
    expect(pane).toContain("chartProps: InstanceType<typeof Chart1>['$props']");
    expect(pane).not.toContain('chartProps: Record<string, unknown>');
  });

  it('keeps React host imports and optional SDK bindings valid for the native typecheck', async () => {
    const run = await createOwnedRun(); runs.push(run);
    const scenario = T17_POSITIVE_SCENARIOS.find(item => item.caseId === 'R01')!;
    const props = [...api.props, { name: 'optionOverrides', type: 'SupportedOptionOverrides', required: false }, { name: 'className', type: 'string', required: false }, { name: 'ref', type: 'Ref<LineChartHandle | null>', required: false }];
    const project = await materializeOwnedProductProject(run, scenario, { packages }, new Map([['instance-1', { ...api, framework: 'react', props }]]));
    const source = await readFile(join(project.workspaceDir, 'src/App.tsx'), 'utf8');
    expect(source).not.toMatch(/from ['"][^'"]+\.tsx['"]/);
    expect(source).toContain('"matrix.className": \"\"');
    expect(source).toContain('"matrix.ref": null');
  });

  it('captures the real delivery guard before invoking apply and preserves a no-delivery failure', async () => {
    const run = await createOwnedRun(); runs.push(run);
    const backupRoot = await run.createEvidenceArea('apply-backup'), calls: string[] = [];
    const observedRun = { ...run, prepareInstallDelivery: async (...args: Parameters<typeof run.prepareInstallDelivery>) => {
      calls.push('capture'); const guard = await run.prepareInstallDelivery(...args);
      return { register: async (operationId: string) => { calls.push('register'); await guard.register(operationId); } };
    } };
    const failure = { result: { exitCode: 2 }, json: { ...applyResultFixture(), status: 'rolled-back', installState: 'not-run', installedVersions: [], issues: [{ code: 'INSTALL_FAILED', message: 'original install failure' }] } };
    const result = await withProductInstallDelivery({ run: observedRun, projectRoot: run.projectRoots.vue, backupRoot, plan: validIntegrationPlanFixture(),
      invoke: async () => { calls.push('apply'); return failure; } });
    expect(calls).toEqual(['capture', 'apply']);
    expect(result).toBe(failure);
    expect(result.json.issues[0]?.message).toBe('original install failure');
  });

  it('retains the exact owned workspace link before removing only its reference', async () => {
    const run = await createOwnedRun(); runs.push(run);
    const root = run.projectRoots.vue, target = join(root, 'apps/web'), link = join(root, 'workspace-link');
    await mkdir(target, { recursive: true }); await writeFile(join(target, 'sentinel'), 'retained-workspace'); await symlink(target, link, 'junction');
    const records = await removeFinishedWorkspaceLinks(run, root, async entries => {
      expect(entries).toMatchObject([{ path: link, target, rawTarget: expect.any(String), identity: { dev: expect.any(String), ino: expect.any(String) } }]);
      expect((await lstat(link)).isSymbolicLink()).toBe(true);
    });
    expect(records).toHaveLength(1);
    expect(await lstat(link).catch(() => undefined)).toBeUndefined();
    expect(await readFile(join(target, 'sentinel'), 'utf8')).toBe('retained-workspace');
  });

  it('runs a native pnpm script without a dependency reinstall or registry access', async () => {
    const run = await createOwnedRun(); runs.push(run);
    const root = run.projectRoots.vue, tools = resolveT17FixedToolchain(process.cwd());
    await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, packageManager: 'pnpm@12.18.0',
      dependencies: { '@company/t17-intentionally-unavailable': '1.0.0' }, scripts: { build: 'node build.cjs' } }));
    const frozenLock = "lockfileVersion: '9.0'\nimporters:\n  .: {}\n";
    await writeFile(join(root, 'pnpm-lock.yaml'), frozenLock);
    await writeFile(join(root, 'build.cjs'), "process.stdout.write('native-build-only');\n");
    await writeFile(join(root, 'isolated.npmrc'), 'registry=http://127.0.0.1:9/\nfetch-retries=0\nfetch-timeout=1000\n');
    const result = await runProductProcess({ run, executable: resolve(dirname(tools.nodeExecutable), '../pnpm-native-12.18.0/package/pnpm.exe'),
      args: nativeProductCommandArguments('pnpm', 'build', root), cwd: root, timeoutMs: 15000,
      env: productProcessEnvironment(tools, root, { npm_config_userconfig: join(root, 'isolated.npmrc'), npm_config_store_dir: join(root, 'store') }) });
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('native-build-only');
    expect(result.stderr).not.toMatch(/install that runs before|Failed to fetch|Verifying lockfile/);
    expect(await readdir(root)).not.toContain('node_modules');
    expect(await readFile(join(root, 'pnpm-lock.yaml'), 'utf8')).toBe(frozenLock);
  }, 20000);

  it('safely retires actual native pnpm store project junctions after retaining their exact identity', async () => {
    const run = await createOwnedRun(); runs.push(run);
    const root = run.projectRoots.vue, ownedCache = await createProductPnpmCache(run, root), cache = ownedCache.root, tools = resolveT17FixedToolchain(process.cwd());
    await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, dependencies: { picocolors: '1.1.1' } }));
    await writeFile(join(root, 'sentinel.txt'), 'original-target');
    const projects = join(cache, 'pnpm/v11/projects');
    try {
      const result = await runProductProcess({ run, executable: resolve(dirname(tools.nodeExecutable), '../pnpm-native-12.18.0/package/pnpm.exe'),
        args: nativeProductCommandArguments('pnpm', 'install', cache), cwd: root, timeoutMs: 60000, env: productProcessEnvironment(tools, root) });
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const links: string[] = [];
      for (const name of await readdir(projects).catch(() => [] as string[])) if ((await lstat(join(projects, name))).isSymbolicLink()) links.push(name);
      expect(links).toHaveLength(1);
      const records: unknown[] = [];
      await ownedCache.retireReferences(async record => { records.push(structuredClone(record)); });
      expect(records).toHaveLength(1);
      expect(await readdir(projects)).toEqual([]);
      expect(await readFile(join(root, 'sentinel.txt'), 'utf8')).toBe('original-target');
      await ownedCache.registerOwnedContents();
    } finally {
      for (const name of await readdir(projects).catch(() => [] as string[])) {
        const path = join(projects, name);
        if (!(await lstat(path)).isSymbolicLink() || await realpath(path) !== await realpath(root)) throw new Error('Native store test created an unexpected project link.');
        await unlink(path);
      }
      await run.registerOwnedPath(cache, (await readdir(cache)).filter(name => name !== '.t17-owner.json'));
    }
  }, 65000);

  it.each(['vue', 'react'] as const)('places the %s line center datum at the declared click using public coordinate options', async framework => {
    const run = await createOwnedRun(); runs.push(run);
    const scenario = T17_POSITIVE_SCENARIOS.find(item => item.framework === framework && item.caseId.endsWith('01'))!;
    const componentApi = { ...api, framework, props: [...api.props, { name: 'optionOverrides', type: 'SupportedOptionOverrides', required: false }] };
    const project = await materializeOwnedProductProject(run, scenario, { packages }, new Map([['instance-1', componentApi]]));
    const source = await readFile(join(project.workspaceDir, 'src/App.' + (framework === 'vue' ? 'vue' : 'tsx')), 'utf8');
    expect(source).toContain('containLabel: false');
    expect(source).toContain("outerBoundsMode: 'none' as const");
    expect(source).toContain('yAxis: { min: 0, max: 100 }');
    expect(source).toContain('"matrix.optionOverrides": matrixCenterOptions');
  });

  it.each(['vue', 'react'] as const)('places the %s grouped bar under the frozen host-center click with public grid options', async framework => {
    const run = await createOwnedRun(); runs.push(run);
    const scenario = T17_POSITIVE_SCENARIOS.find(item => item.framework === framework && item.caseId.endsWith('02'))!;
    const frozenBrowser = structuredClone(scenario.browser);
    const componentApi = { ...api, framework, componentId: 'bar', props: [...api.props, { name: 'optionOverrides', type: 'SupportedOptionOverrides', required: false }] };
    const project = await materializeOwnedProductProject(run, scenario, { packages }, new Map([['instance-1', componentApi]]));
    const source = await readFile(join(project.workspaceDir, 'src/App.' + (framework === 'vue' ? 'vue' : 'tsx')), 'utf8');
    expect(source).toContain("grid: { left: 24, right: 192, top: 24, bottom: 24, containLabel: false, outerBoundsMode: 'none' as const }");
    expect(source).toContain('"matrix.optionOverrides": matrixCenterOptions');
    expect(scenario.browser).toEqual(frozenBrowser);
  });

  it('materializes three real generated instances for the declared two-round budget refusal', async () => {
    const refusal = T17_REFUSAL_SCENARIOS.find(item => item.caseId === 'N10')!;
    const scenario = positiveScenarioForRefusal(refusal);
    expect(scenario.components).toHaveLength(3);
    expect(scenario.hostMode).toBe('multi');
    expect(scenario.requiresRepairFault).toBe(true);
    const run = await createOwnedRun(); runs.push(run);
    const project = await materializeOwnedProductProject(run, scenario, { packages }, new Map(scenario.components.map(component => [component.instanceId, { ...api, props: [...api.props, { name: 'optionOverrides', type: 'SupportedOptionOverrides', required: false }] }])));
    expect(project.generatedPaths).toHaveLength(3);
    const source = await readFile(join(project.workspaceDir, 'src/App.vue'), 'utf8');
    for (let index = 1; index <= 3; index++) expect(source).toContain('<Chart' + index + ' v-bind="props' + index + '" />');
    expect(scenario.browser.assertions.filter(assertion => assertion.kind === 'visible' && assertion.selector.endsWith(' canvas'))).toHaveLength(3);
    expect(T17_POSITIVE_SCENARIOS).toHaveLength(20);
    expect(T17_REFUSAL_SCENARIOS).toHaveLength(13);
  });

  it('rejects a zero-write zero-attempt budget result as two-round exhaustion evidence', () => {
    const scenario = T17_REFUSAL_SCENARIOS.find(item => item.caseId === 'N10')!;
    expect(classifyProductRefusal(scenario, { exitCode: 2, issueCodes: ['REPAIR_LIMIT_REACHED'], repairStatus: 'stopped-or-rejected', repairWrites: 0 })).toBe(false);
  });

  it('keeps the internal repair-attempt count out of the strict refusal report interface', () => {
    expect(productRefusalReportObservation({ exitCode: 2, issueCodes: ['BEHAVIOR_FAILED'], repairStatus: 'stopped-or-rejected', repairWrites: 2, repairAttempts: 2 }))
      .toEqual({ exitCode: 2, issueCodes: ['BEHAVIOR_FAILED'], repairStatus: 'stopped-or-rejected', repairWrites: 2 });
  });

  it('binds product verification to the actual plan/apply and workspace manifest bytes', () => {
    const scenario = T17_POSITIVE_SCENARIOS.find(item => item.caseId === 'V03')!;
    const spec = buildProductSpec({ scenario, projectRoot: 'C:/owned/project', manifestBytes: Buffer.from('{"scripts":{"build":"vite build"}}'),
      plan: validIntegrationPlanFixture() as IntegrationPlanV1, applyResult: applyResultFixture() as IntegrationApplyResultV1, url: 'http://127.0.0.1:49531/' });
    expect(spec.commands.map(command => command.manifestPath)).toEqual(['apps/web/package.json', 'apps/web/package.json']);
    expect(spec.commands[1]?.outputDirectories).toEqual(['apps/web/dist']);
    expect(spec.browser?.actions).toEqual(scenario.browser.actions);
    expect(spec.browser?.visual).toBeUndefined();
    expect(spec.planDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(spec.applyResultDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(spec.planDigest).not.toBe(spec.applyResultDigest);
  });

  it('does not count an unrelated process error as a successful declared refusal', () => {
    const scenario = T17_REFUSAL_SCENARIOS.find(item => item.caseId === 'N01')!;
    expect(classifyProductRefusal(scenario, { exitCode: 1, issueCodes: ['EXECUTION_FAILED'], status: 'failed' })).toBe(false);
    expect(classifyProductRefusal(scenario, { exitCode: 2, issueCodes: ['DEPENDENCY_CONFLICT'], status: 'blocked' })).toBe(true);
  });

  it('requires exact visual refusal state rather than treating NEW as DIFF', () => {
    const scenario = T17_REFUSAL_SCENARIOS.find(item => item.caseId === 'N08')!;
    expect(classifyProductRefusal(scenario, { exitCode: 2, issueCodes: ['VISUAL_BASELINE_MISSING'], status: 'failed', visualResult: 'NEW' })).toBe(false);
    expect(classifyProductRefusal(scenario, { exitCode: 2, issueCodes: ['VISUAL_DIFF'], status: 'failed', visualResult: 'DIFF' })).toBe(true);
  });

  it('executes a real owned subprocess and sanitizes tokens before preserving its output', async () => {
    const run = await createOwnedRun(); runs.push(run);
    const result = await runProductProcess({ run, executable: process.execPath,
      args: ['-e', "process.stdout.write('private-token-value'); process.stderr.write('diagnostic'); process.exitCode = 2"],
      cwd: run.projectRoots.vue, secrets: ['private-token-value'], timeoutMs: 5000 });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('[REDACTED]');
    expect(result.stderr).toBe('diagnostic');
    expect(result.timedOut).toBe(false);
  });

  it('waits for a timed-out owned subprocess to close', async () => {
    const run = await createOwnedRun(); runs.push(run);
    const result = await runProductProcess({ run, executable: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'], cwd: run.projectRoots.vue, timeoutMs: 40 });
    expect(result.exitCode).not.toBe(0);
    expect(result.timedOut).toBe(true);
    await run.stopOwnedProcesses();
  });

  it('authors the independent expected adapter directly from the public SDK contract', () => {
    const source = independentReferenceComponent(api, '@company/charts-vue');
    expect(source).toContain('from "@company/charts-vue/line"');
    expect(source).toContain('"@company/charts-vue/style.css"');
    expect(source).toContain('dataSources[\'matrix.data\']');
    expect(source).not.toContain('data-layout');
    expect(source).not.toContain('generateVueComponent');
  });

  it('preserves the React public onPointClick event name exactly once', () => {
    const source = independentReferenceComponent({ ...api, framework: 'react', events: [{ name: 'onPointClick', payload: 'ChartEvent' }] }, '@company/charts-react');
    expect(source).toContain("onPointClick={handlers['matrixHandler']}");
    expect(source).not.toContain('onOnPointClick');
  });

  it('requires every generated module in a source map of JavaScript the browser really loaded', async () => {
    const run = await createOwnedRun(); runs.push(run);
    const root = run.projectRoots.vue, dist = join(root, 'dist'), assets = join(dist, 'assets');
    await mkdir(assets, { recursive: true });
    await mkdir(join(root, 'src/components/zhinexus'), { recursive: true });
    await writeFile(join(root, 'src/components/zhinexus/component-0001.vue'), '<template><RealSdk /></template>\n');
    const script = 'console.log("real");\n//# sourceMappingURL=entry.js.map\n';
    await writeFile(join(assets, 'entry.js'), script);
    await writeFile(join(assets, 'entry.js.map'), JSON.stringify({ version: 3, sources: ['../../src/App.vue'], sourcesContent: ['<template />'], mappings: '' }));
    const loaded = [{ url: 'http://127.0.0.1:40001/assets/entry.js', bytes: Buffer.byteLength(script), sha256: createHash('sha256').update(script).digest('hex') }];
    await expect(proveGeneratedProductImports({ projectRoot: root, distDir: dist, generatedPaths: ['src/components/zhinexus/component-0001.vue'], loaded })).rejects.toThrow(/generated|map|bytes/i);
  });

  it('binds a real loaded bundle map to the exact generated source bytes', async () => {
    const run = await createOwnedRun(); runs.push(run);
    const root = run.projectRoots.vue, dist = join(root, 'dist'), assets = join(dist, 'assets'), generatedPath = 'src/components/zhinexus/component-0001.vue';
    await mkdir(assets, { recursive: true }); await mkdir(join(root, 'src/components/zhinexus'), { recursive: true });
    const source = '<template><RealSdk /></template>\n', script = 'console.log("real");\n//# sourceMappingURL=entry.js.map\n';
    await writeFile(join(root, generatedPath), source); await writeFile(join(assets, 'entry.js'), script);
    await writeFile(join(assets, 'entry.js.map'), JSON.stringify({ version: 3, sources: ['../../' + generatedPath], sourcesContent: [source], mappings: '' }));
    const loaded = [{ url: 'http://127.0.0.1:40001/assets/entry.js', bytes: Buffer.byteLength(script), sha256: createHash('sha256').update(script).digest('hex') }];
    const proof = await proveGeneratedProductImports({ projectRoot: root, distDir: dist, generatedPaths: [generatedPath], loaded });
    expect(proof.map(record => record.generatedPath)).toEqual([generatedPath]);
    expect(proof[0]?.generatedSha256).toBe(createHash('sha256').update(source).digest('hex'));
  });

  it('measures an independent real baseline after every multi-instance ready host is visible', async () => {
    const run = await createOwnedRun(); runs.push(run);
    const root = run.projectRoots.vue;
    await writeFile(join(root, 'index.html'), '<!doctype html><style>.chart{width:100px;height:50px}</style><main><div class="chart"></div><div class="chart"></div><div class="chart"></div></main>');
    const server = await startStaticServer(root);
    try {
      const scenario = { ...T17_POSITIVE_SCENARIOS[0]!, browser: { readySelector: '.chart', actions: [], assertions: [] } };
      const result = await captureIndependentProductBaseline(server.origin + '/', scenario);
      expect(result.environment.fontDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(result.bytes.length).toBeGreaterThan(100);
    } finally { await server.close(); }
  }, 60000);

  it('waits for real asynchronous DOM assertions before capturing the independent baseline', async () => {
    const run = await createOwnedRun(); runs.push(run);
    const root = run.projectRoots.vue;
    await writeFile(join(root, 'index.html'), '<!doctype html><button id=show>show</button><main></main><script>document.querySelector("#show").onclick=()=>setTimeout(()=>document.querySelector("main").appendChild(document.createElement("canvas")),150)</script>');
    const server = await startStaticServer(root);
    try {
      const scenario = { ...T17_POSITIVE_SCENARIOS[0]!, browser: { readySelector: '#show', actions: [{ kind: 'click' as const, selector: '#show' }], assertions: [{ kind: 'count' as const, selector: 'canvas', count: 1 }] } };
      await expect(captureIndependentProductBaseline(server.origin + '/', scenario)).resolves.toHaveProperty('bytes');
    } finally { await server.close(); }
  }, 60000);
});
