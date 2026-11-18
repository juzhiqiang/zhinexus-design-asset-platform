/**
 * T16 B / P1 产品失败测试：applyIntegration。
 *
 * 依据 docs/superpowers/plans/2026-11-18-t16-b-install-isolation-brief.md 的 12 组要求中属于 apply 的部分：
 * ① 授权/replan 及时间变化；③ 安全字符串绑定；④ 首个写入失败；⑤ 第二个写入失败；
 * ⑥ 安装启动后保守 reinstall；启动前日志精确故障待 GREEN 接入。
 * 另检查 API/registry 可控请求的目标和认证分别隔离。
 *
 * 边界：
 * - 只通过 CLI **根出口命名空间**可选调用 `applyIntegration`；RED 期缺导出时返回 undefined，
 *   由对状态/字节/摘要/进程边界的实质断言失败，而不是 import/collect 错误；
 * - 临时工程位于工作区之外且每例独占；文件证据用 Node fs/crypto 独立实算；
 * - API/registry 是两个本地 loopback 服务，只使用 synthetic 凭据，不连接公司环境；
 * - 包管理器进程与文件系统故障都由**测试私有 module mock** 注入，不向公开 options 注入任何 runner；
 * - 首写/第二写失败在 replan 与备份完成后按“提交写入计数”注入，不提前在工程内放置阻断文件。
 *
 * Windows 固定工具链下的正式 collect/RED 由宿主 C 执行；本文件不在沙箱声称任何验证结果。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// fs-faults 必须位于 import 列表首位：node:fs mock 工厂在首个模块请求 node:fs 时运行。
import {
  buildFsModuleMock,
  installFsInterceptor,
  type FsFaultController,
  type FsInterceptorState,
} from './t16-support/fs-faults.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonicalJson } from '../../packages/component-cli/src/contracts/schema.js';
import type {
  IntegrationApplyAuthorizationV1,
  IntegrationApplyResultV1,
  IntegrationRollbackResultV1,
} from '../../packages/component-cli/src/contracts/integration-apply.js';
import type { IntegrationPlanV1 } from '../../packages/component-cli/src/contracts/integration-plan.js';
import type { ComponentApiV1 } from '../../packages/component-cli/src/contracts/component-api.js';
import { sdkApiAuditMatrix } from '../acceptance/t16-a/sdk-api-matrix.js';
import { validateComponentMatchResponse } from '../../packages/component-cli/src/contracts/component-match.js';
import { validateMatchPlan } from '../../packages/component-cli/src/contracts/match-plan.js';
import type { MatchPlanV1 } from '../../packages/component-cli/src/contracts/match-plan.js';
import { planIntegration, type PlanOptions } from '../../packages/component-cli/src/integration/plan.js';
import {
  callApply,
  callRollback,
  capabilityNote,
  loadCliExports,
  type CliExports,
  type IntegrationApplyOptions,
  type IntegrationBackupRef,
} from './t16-support/cli-namespace.js';
import {
  ECHARTS_VERSION,
  PACKAGE_VERSION,
  REACT_PACKAGE_NAME,
  REACT_DOM_VERSION,
  REACT_FRAMEWORK_VERSION,
  VUE_FRAMEWORK_VERSION,
  VUE_PACKAGE_NAME,
  externalRoot,
  fileExists,
  readBytes,
  readText,
  releaseSyntheticDirs,
  sha256Hex,
  sha256Of,
  tarballBytes,
  tarballSha256,
  treeDifferences,
  treeSnapshot,
  reactNpmLockedProject,
  vuePnpmLockedProject,
  vuePnpmNewDependencyProject,
} from './t16-support/synthetic-projects.js';
import {
  SYNTHETIC_API_TOKEN,
  SYNTHETIC_REGISTRY_TOKEN,
  authorizationHeaders,
  requestsTo,
  startSyntheticNetwork,
  type SyntheticNetwork,
} from './t16-support/loopback-services.js';
import { readBackupFiles, storedBackup } from './t16-support/backup-store.js';
import {
  EXECUTION_PRIMITIVES,
  expectBoundString,
  expectSafeBinding,
  scanSource,
} from './t16-support/source-scan.js';
import {
  candidateLockCalls,
  installProcessInterceptor,
  isOutsideProject,
  materializationCalls,
  packageManagerCalls,
  type ProcessRecorderState,
  type SyntheticDependency,
} from './t16-support/process-recorder.js';

// ─── 测试私有 module mock ───

const processes = vi.hoisted((): ProcessRecorderState => ({
  calls: [],
  candidateLock: 'succeed',
  materialization: 'succeed',
  dependencies: [],
  registryOrigin: undefined,
  intercept: null,
  stageOutsideRoot: undefined,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const readCwd = (value: unknown): string | undefined => {
    if (value === null || typeof value !== 'object') return undefined;
    const candidate = (value as Record<string, unknown>)['cwd'];
    return typeof candidate === 'string' ? candidate : undefined;
  };
  const readShell = (value: unknown): boolean | undefined => {
    if (value === null || typeof value !== 'object') return undefined;
    const candidate = (value as Record<string, unknown>)['shell'];
    return typeof candidate === 'boolean' ? candidate : undefined;
  };
  const envOf = (options: unknown): Record<string, string | undefined> | undefined => {
    if (options === null || typeof options !== 'object') return undefined;
    const env = (options as Record<string, unknown>)['env'];
    return env !== null && typeof env === 'object' ? (env as Record<string, string | undefined>) : undefined;
  };
  const intercept = (
    command: string,
    args: readonly string[],
    options: unknown,
    sync: boolean,
  ): { syncResult?: unknown; child?: unknown } | undefined => {
    const cwd = readCwd(options);
    const shell = readShell(options);
    const env = envOf(options);
    processes.calls.push({ command, args: [...args], cwd, shell, env: { ...env }, sync });
    return processes.intercept?.({ command, args, cwd, shell, env, sync });
  };
  const mocked = {
    ...actual,
    spawnSync: (command: string, args: readonly string[], options?: unknown) =>
      intercept(command, args, options, true)?.syncResult
      ?? (actual.spawnSync as (...a: unknown[]) => unknown)(command, args, options),
    spawn: (command: string, args: readonly string[], options?: unknown) =>
      intercept(command, args, options, false)?.child
      ?? (actual.spawn as (...a: unknown[]) => unknown)(command, args, options),
  };
  return { ...mocked, default: mocked };
});

const fsFaults = vi.hoisted((): FsInterceptorState => ({ intercept: null }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return buildFsModuleMock(fsFaults, actual);
});

// ─── synthetic 网络与夹具 ───

let network: SyntheticNetwork;
let exports: CliExports;
let faults: FsFaultController;

const VUE_DEPENDENCIES: SyntheticDependency[] = [
  { name: VUE_PACKAGE_NAME, version: PACKAGE_VERSION },
  { name: 'vue', version: VUE_FRAMEWORK_VERSION },
  { name: 'echarts', version: ECHARTS_VERSION },
];

const GENERATED_VUE_PATH = 'src/components/zhinexus/component-0001.vue';
const GENERATED_REACT_PATH = 'src/components/zhinexus/component-0001.tsx';

function vueTarget(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    variantReleaseId: '00000000-0000-4000-8000-000000000001', variantId: 'line-vue', componentId: 'line',
    framework: 'vue', packageName: VUE_PACKAGE_NAME, packageVersion: PACKAGE_VERSION,
    packageSha256: tarballSha256(VUE_PACKAGE_NAME, PACKAGE_VERSION),
    exportName: 'LineChart', exportPath: './line',
    evidence: [{ kind: 'api', path: 'api/line.json', sha256: 'c'.repeat(64) }, { kind: 'docs', path: 'docs/line.md', sha256: 'd'.repeat(64) }],
    compatibility: { status: 'verified', recordIds: ['synthetic-test-only'] },
    examples: [{ id: 'example', previewEntry: 'preview/index.html' }],
    styleExport: './style.css', readyMethod: 'whenRendered', notes: [],
    ...overrides,
  };
}

function reactTarget(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    ...vueTarget(),
    variantReleaseId: '00000000-0000-4000-8000-000000000002', variantId: 'line-react', framework: 'react',
    packageName: REACT_PACKAGE_NAME, packageSha256: tarballSha256(REACT_PACKAGE_NAME, PACKAGE_VERSION),
    ...overrides,
  };
}

function componentApi(framework: 'vue' | 'react'): unknown {
  return {
    schemaVersion: 1, componentId: 'line', framework, exportName: 'LineChart', exportPath: './line',
    props: [{ name: 'data', type: 'ChartData', required: true }, { name: 'config', type: 'LineChartConfig', required: false }],
    events: [{ name: 'point-click', payload: 'ChartEvent' }],
    styleExport: './style.css', readyMethod: 'whenRendered', notes: [],
  };
}

function dependenciesOf(framework: 'vue' | 'react'): SyntheticDependency[] {
  return framework === 'vue' ? VUE_DEPENDENCIES : [
    { name: REACT_PACKAGE_NAME, version: PACKAGE_VERSION },
    { name: 'react', version: REACT_FRAMEWORK_VERSION },
    { name: 'react-dom', version: REACT_DOM_VERSION },
    { name: 'echarts', version: ECHARTS_VERSION },
  ];
}

function matchedResponse(target: Record<string, unknown>, framework: 'vue' | 'react', dependencies: readonly SyntheticDependency[]): unknown {
  return {
    schemaVersion: 1,
    query: {
      componentId: 'line', framework, packageName: target['packageName'], packageVersion: PACKAGE_VERSION,
      frameworkVersion: framework === 'vue' ? VUE_FRAMEWORK_VERSION : REACT_FRAMEWORK_VERSION,
      echartsVersion: ECHARTS_VERSION,
      ...(framework === 'react' ? { reactDomVersion: REACT_DOM_VERSION } : {}),
    },
    status: 'matched', target, api: componentApi(framework),
    exactDependencies: dependenciesOf(framework).map(dependency => ({ ...dependency })), gaps: [],
  };
}

function matchPlan(framework: 'vue' | 'react', bindings?: { source?: string; handler?: string; layout?: string }): MatchPlanV1 {
  const target = (framework === 'vue' ? vueTarget() : reactTarget()) as MatchPlanV1['elements'][number]['target'];
  const element: MatchPlanV1['elements'][number] = {
    instanceId: 'node-1', designId: '设计/Line', status: 'mapped', target,
    props: [
      { name: 'data', type: 'ChartData', required: true, source: bindings?.source ?? 'sales' },
      { name: 'config', type: 'LineChartConfig', required: false },
    ],
    events: [{ name: 'point-click', payload: 'ChartEvent', handler: bindings?.handler ?? 'showDetail' }],
    layout: bindings?.layout ?? 'grid cell 1',
    gaps: [],
  };
  return {
    schemaVersion: 1, source: 'design-id', inputDigest: 'a'.repeat(64), ruleSetId: 'library', revision: 'draft-1',
    context: {
      framework, frameworkVersion: framework === 'vue' ? VUE_FRAMEWORK_VERSION : REACT_FRAMEWORK_VERSION,
      echartsVersion: ECHARTS_VERSION, packageManager: framework === 'vue' ? 'pnpm' : 'npm', requirements: [],
    },
    elements: [element],
    exactDependencies: dependenciesOf(framework).map(dependency => ({ ...dependency })),
    gaps: [],
  };
}

/** 权威响应按请求 query 回显，保证身份逐字段一致（产品会核对请求与响应）。 */
function respondMatched(framework: 'vue' | 'react'): void {
  const target = framework === 'vue' ? vueTarget() : reactTarget();
  const dependencies = dependenciesOf(framework);
  network.apiResponder = (query: Record<string, string>): unknown => {
    const body = matchedResponse(target, framework, dependencies) as Record<string, unknown>;
    return { ...body, query };
  };
}

function respondWith(framework: 'vue' | 'react', mutate: (body: Record<string, unknown>) => void): void {
  const target = framework === 'vue' ? vueTarget() : reactTarget();
  const dependencies = dependenciesOf(framework);
  network.apiResponder = (query: Record<string, string>): unknown => {
    const body = matchedResponse(target, framework, dependencies) as Record<string, unknown>;
    mutate(body);
    return { ...body, query };
  };
}

function gapResponse(framework: 'vue' | 'react', code: 'TARGET_UNAVAILABLE' | 'DEPENDENCY_CONFLICT'): void {
  network.apiResponder = query => ({
    schemaVersion: 1, query, status: 'gap', exactDependencies: [], gaps: [{ code, message: `权威响应返回 gap：${code}` }],
  });
}

function planOptions(): PlanOptions {
  return {
    apiUrl: network.apiOrigin, registryUrl: network.registryOrigin,
    apiToken: network.apiToken, registryToken: network.registryToken, requestTimeoutMs: 15000,
  };
}

function applyOptions(overrides: Partial<IntegrationApplyOptions> & { backupRoot: string }): IntegrationApplyOptions {
  return {
    apiUrl: network.apiOrigin, registryUrl: network.registryOrigin,
    apiToken: network.apiToken, registryToken: network.registryToken, requestTimeoutMs: 15000, ...overrides,
  };
}

function canonicalRoot(root: string): string {
  try {
    return path.resolve(fs.realpathSync(path.resolve(root))).split(path.sep).join('/');
  } catch {
    return path.resolve(root).split(path.sep).join('/');
  }
}

function authorizationFor(root: string, plan: IntegrationPlanV1, overrides?: Partial<IntegrationApplyAuthorizationV1>): IntegrationApplyAuthorizationV1 {
  return {
    schemaVersion: 1, operation: 'apply', projectRoot: canonicalRoot(root),
    planDigest: sha256Hex(canonicalJson(plan)), allowedPaths: [...plan.allowedPaths], allowInstall: true, ...overrides,
  };
}

async function buildPlan(root: string, framework: 'vue' | 'react', bindings?: { source?: string; handler?: string; layout?: string }): Promise<IntegrationPlanV1> {
  const source = matchPlan(framework, bindings);
  expect(validateMatchPlan(source).ok, '夹具源 MatchPlan 必须结构合法').toBe(true);
  respondMatched(framework);
  expect(validateComponentMatchResponse(matchedResponse(framework === 'vue' ? vueTarget() : reactTarget(), framework, dependenciesOf(framework))).ok,
    '夹具权威响应必须结构合法').toBe(true);
  const plan = await planIntegration(root, source, planOptions());
  expect(plan.status, `夹具必须产出 planned 计划（冲突：${plan.conflicts.map(c => c.code).join(',')}）`).toBe('planned');
  return plan;
}

/** 独立 API 期望来自 A 的 SDK 审计；保持离线绑定与权威响应逐字段相同。 */
async function buildReactPlanWithApi(root: string, api: ComponentApiV1): Promise<IntegrationPlanV1> {
  const source = matchPlan('react');
  source.elements[0]!.props = api.props.map(prop => ({ ...prop, ...(prop.required ? { source: 'sales' } : {}) }));
  source.elements[0]!.events = api.events.map(event => ({ ...event, handler: 'showDetail' }));
  expect(validateMatchPlan(source).ok).toBe(true);
  const response = { ...(matchedResponse(reactTarget(), 'react', dependenciesOf('react')) as Record<string, unknown>), api };
  expect(validateComponentMatchResponse(response).ok, '独立 API 夹具必须通过公共契约').toBe(true);
  respondWith('react', body => { body['api'] = api; });
  const plan = await planIntegration(root, source, planOptions());
  expect(plan.status, plan.conflicts.map(conflict => conflict.code).join(',')).toBe('planned');
  return plan;
}

async function attemptApply(
  root: string,
  plan: IntegrationPlanV1,
  options: IntegrationApplyOptions,
): Promise<{ result?: IntegrationApplyResultV1; thrown?: unknown }> {
  try {
    return { result: await callApply(exports, root, plan, options) };
  } catch (error) {
    return { thrown: error };
  }
}

async function attemptRollback(
  root: string,
  backupRef: IntegrationBackupRef,
  backupRoot: string,
): Promise<{ result?: IntegrationRollbackResultV1; thrown?: unknown }> {
  try {
    return { result: await callRollback(exports, root, backupRef, { backupRoot }) };
  } catch (error) {
    return { thrown: error };
  }
}

function expectSanitized(error: unknown): void {
  const record = error as { code?: unknown; message?: unknown };
  const text = `${String(record?.code ?? '')} ${error instanceof Error ? error.message : String(error)}`;
  expect(text).not.toContain(SYNTHETIC_API_TOKEN);
  expect(text).not.toContain(SYNTHETIC_REGISTRY_TOKEN);
}

function codes(result: IntegrationApplyResultV1): string[] {
  return result.issues.map(issue => issue.code);
}

function expectNoSideEffects(root: string, expected: Map<string, string>, backupRoot: string): void {
  expect(treeSnapshot(root), 'blocked 结果不得改动目标工程').toEqual(expected);
  expect(packageManagerCalls(processes).length, 'blocked 结果不得启动任何包管理器进程').toBe(0);
  expect(readBackupFiles(backupRoot), 'blocked 结果不得落盘备份').toEqual([]);
}

beforeAll(async () => {
  installProcessInterceptor(processes);
  faults = installFsInterceptor(fsFaults);
  network = await startSyntheticNetwork();
  processes.registryOrigin = network.registryOrigin;
  exports = await loadCliExports();
  // 根出口加载失败不是“缺产品能力”：必须显式失败，不能吞掉后冒称 RED。
  expect(exports.loadError, `CLI 根出口必须可加载：${exports.loadError ?? ''}`).toBeUndefined();
});

afterAll(async () => {
  faults.disarm();
  await network.close();
  releaseSyntheticDirs();
});

beforeEach(() => {
  faults.disarm();
  processes.calls.length = 0;
  processes.fixtureErrors = [];
  processes.stageOutsideRoot = undefined;
  processes.stageOutsideBaseline = undefined;
  processes.candidateLock = 'succeed';
  processes.materialization = 'succeed';
  processes.dependencies = [];
  network.requests.length = 0;
  network.tarballProvider = (name, version) => tarballBytes(name, version);
});

afterEach(() => {
  faults.disarm();
  expect(processes.fixtureErrors ?? [], '测试夹具不得以安装失败掩盖错误').toEqual([]);
  network.apiResponder = () => ({ schemaVersion: 1, status: 'gap', exactDependencies: [], gaps: [] });
});

// ─── ① 授权与计划绑定 ───

describe('T16 B / P1 applyIntegration 授权与计划绑定', () => {
  it('缺 authorization：blocked + AUTHORIZATION_REQUIRED，且无目标改动、无备份、无包管理器进程', async () => {
    const root = vuePnpmLockedProject('apply-no-auth');
    const backupRoot = externalRoot('apply-no-auth-backup');
    const plan = await buildPlan(root, 'vue');
    const expected = treeSnapshot(root);

    const { result, thrown } = await attemptApply(root, plan, applyOptions({ backupRoot }));

    expect(thrown, '缺授权应返回结构化 blocked，而不是抛错').toBeUndefined();
    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(result!.status).toBe('blocked');
    expect(codes(result!)).toContain('AUTHORIZATION_REQUIRED');
    expect(result!.changedFiles).toEqual([]);
    expect(result!.installState).toBe('not-run');
    expect(result!.backupRef).toBeUndefined();
    expectNoSideEffects(root, expected, backupRoot);
  });

  it('planDigest 与计划不符：blocked + AUTHORIZATION_MISMATCH，零副作用', async () => {
    const root = vuePnpmLockedProject('apply-digest');
    const backupRoot = externalRoot('apply-digest-backup');
    const plan = await buildPlan(root, 'vue');
    const expected = treeSnapshot(root);

    const { result, thrown } = await attemptApply(root, plan, applyOptions({
      backupRoot, authorization: authorizationFor(root, plan, { planDigest: 'a'.repeat(64) }),
    }));

    expect(thrown).toBeUndefined();
    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(result!.status).toBe('blocked');
    expect(codes(result!)).toContain('AUTHORIZATION_MISMATCH');
    expectNoSideEffects(root, expected, backupRoot);
  });

  it('projectRoot 指向其他工程：blocked + AUTHORIZATION_MISMATCH，两个工程都不得被改动', async () => {
    const root = vuePnpmLockedProject('apply-root');
    const other = vuePnpmLockedProject('apply-root-other');
    const backupRoot = externalRoot('apply-root-backup');
    const plan = await buildPlan(root, 'vue');
    const expected = treeSnapshot(root);
    const otherExpected = treeSnapshot(other);

    const { result } = await attemptApply(root, plan, applyOptions({
      backupRoot, authorization: authorizationFor(root, plan, { projectRoot: canonicalRoot(other) }),
    }));

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(result!.status).toBe('blocked');
    expect(codes(result!)).toContain('AUTHORIZATION_MISMATCH');
    expectNoSideEffects(root, expected, backupRoot);
    expect(treeSnapshot(other), '不得把写入落到授权之外的工程').toEqual(otherExpected);
  });

  it('allowedPaths 少列一项计划路径：blocked + AUTHORIZATION_MISMATCH，零副作用', async () => {
    const root = vuePnpmLockedProject('apply-paths-missing');
    const backupRoot = externalRoot('apply-paths-missing-backup');
    const plan = await buildPlan(root, 'vue');
    const expected = treeSnapshot(root);

    const { result } = await attemptApply(root, plan, applyOptions({
      backupRoot, authorization: authorizationFor(root, plan, { allowedPaths: plan.allowedPaths.slice(1) }),
    }));

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(result!.status).toBe('blocked');
    expect(codes(result!)).toContain('AUTHORIZATION_MISMATCH');
    expectNoSideEffects(root, expected, backupRoot);
  });

  it('allowedPaths 多列计划外路径：blocked + AUTHORIZATION_MISMATCH，零副作用', async () => {
    const root = vuePnpmLockedProject('apply-paths-extra');
    const backupRoot = externalRoot('apply-paths-extra-backup');
    const plan = await buildPlan(root, 'vue');
    const expected = treeSnapshot(root);

    const { result } = await attemptApply(root, plan, applyOptions({
      backupRoot, authorization: authorizationFor(root, plan, { allowedPaths: [...plan.allowedPaths, 'src/not-planned.vue'] }),
    }));

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(result!.status).toBe('blocked');
    expect(codes(result!)).toContain('AUTHORIZATION_MISMATCH');
    expectNoSideEffects(root, expected, backupRoot);
  });

  it('计划需要安装但 allowInstall=false：blocked，且不启动候选锁或物化进程', async () => {
    const root = vuePnpmNewDependencyProject('apply-install-denied');
    const backupRoot = externalRoot('apply-install-denied-backup');
    const plan = await buildPlan(root, 'vue');
    const expected = treeSnapshot(root);

    const { result } = await attemptApply(root, plan, applyOptions({
      backupRoot, authorization: authorizationFor(root, plan, { allowInstall: false }),
    }));

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(result!.status).toBe('blocked');
    expect(codes(result!).some(code => code.startsWith('AUTHORIZATION'))).toBe(true);
    expect(candidateLockCalls(processes), '未授权安装不得生成候选锁').toEqual([]);
    expect(materializationCalls(processes), '未授权安装不得物化依赖').toEqual([]);
    expectNoSideEffects(root, expected, backupRoot);
  });

  it('把磁盘计划本身当授权传入：blocked，计划永不构成执行授权', async () => {
    const root = vuePnpmLockedProject('apply-plan-as-auth');
    const backupRoot = externalRoot('apply-plan-as-auth-backup');
    const plan = await buildPlan(root, 'vue');
    const expected = treeSnapshot(root);

    const { result } = await attemptApply(root, plan, applyOptions({
      backupRoot, authorization: plan as unknown as IntegrationApplyAuthorizationV1,
    }));

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(result!.status).toBe('blocked');
    expect(result!.changedFiles).toEqual([]);
    expectNoSideEffects(root, expected, backupRoot);
  });

  it('conflicted 计划：blocked + INVALID_PLAN，零副作用', async () => {
    const root = vuePnpmLockedProject('apply-conflicted');
    const backupRoot = externalRoot('apply-conflicted-backup');
    const plan = await buildPlan(root, 'vue');
    const conflicted: IntegrationPlanV1 = {
      ...plan,
      status: 'conflicted',
      conflicts: [{ code: 'API_MISMATCH', message: '权威 API 与离线计划不一致', blocking: true }],
    };
    const expected = treeSnapshot(root);

    const { result } = await attemptApply(root, conflicted, applyOptions({
      backupRoot, authorization: authorizationFor(root, conflicted),
    }));

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(result!.status).toBe('blocked');
    expect(codes(result!)).toContain('INVALID_PLAN');
    expectNoSideEffects(root, expected, backupRoot);
  });
});

// ─── ② 重新核验 ───

describe('T16 B / P1 applyIntegration 重新核验', () => {
  it('checkedAt 单独变化不使一致计划失效：applied，且 before/after 与真实字节一致', async () => {
    const root = vuePnpmLockedProject('apply-checkedat');
    const backupRoot = externalRoot('apply-checkedat-backup');
    const plan = await buildPlan(root, 'vue');
    const shifted: IntegrationPlanV1 = {
      ...plan,
      publicationEvidence: plan.publicationEvidence.map(entry => ({ ...entry, checkedAt: '2026-11-18T00:00:00.000Z' })),
    };
    const originalHashes = new Map(shifted.allowedPaths.map(relative => [relative, fileExists(root, relative) ? sha256Of(root, relative) : undefined]));

    const { result, thrown } = await attemptApply(root, shifted, applyOptions({
      backupRoot, authorization: authorizationFor(root, shifted),
    }));

    expect(thrown, '一致计划（仅检查时间变化）应可执行').toBeUndefined();
    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(result!.status).toBe('applied');
    expect(result!.issues).toEqual([]);
    expect(result!.operation).toBe('apply');
    expect(result!.projectRoot).toBe(canonicalRoot(root));
    expect(result!.planDigest).toBe(sha256Hex(canonicalJson(shifted)));
    expect([...result!.changedFiles].sort()).toEqual([...shifted.allowedPaths].sort());
    expect(result!.installState).toBe('not-run');
    expect(result!.backupRef?.id).toBe(result!.operationId);
    for (const snapshot of result!.beforeHashes) {
      expect(originalHashes.get(snapshot.path), `${snapshot.path} 的 before 守卫必须来自计划前的真实字节`)
        .toBe(snapshot.exists ? snapshot.sha256 : undefined);
    }
    for (const snapshot of result!.afterHashes) {
      expect(snapshot.exists, '写入后的文件必须真实存在').toBe(true);
      expect(snapshot.sha256, `${snapshot.path} 的 after 守卫必须等于落盘实算摘要`).toBe(sha256Of(root, snapshot.path));
    }
    expect(materializationCalls(processes), '无安装意图不得物化依赖').toEqual([]);
  });

  it('计划通过后目标 package.json 被用户修改：blocked + PROJECT_CHANGED，用户新字节必须保留', async () => {
    const root = vuePnpmLockedProject('apply-project-changed');
    const backupRoot = externalRoot('apply-project-changed-backup');
    const plan = await buildPlan(root, 'vue');
    const userEdit = `${readText(root, 'package.json') ?? ''}\n// 用户在计划之后的手工编辑\n`;
    fs.writeFileSync(path.join(root, 'package.json'), userEdit, 'utf8');
    const expected = treeSnapshot(root);

    const { result } = await attemptApply(root, plan, applyOptions({ backupRoot, authorization: authorizationFor(root, plan) }));

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(result!.status).toBe('blocked');
    expect(codes(result!)).toContain('PROJECT_CHANGED');
    expectNoSideEffects(root, expected, backupRoot);
    expect(readText(root, 'package.json'), 'blocked 不得删除用户新编辑的字节').toBe(userEdit);
  });

  it('重新核验发现权威 target 变化（平台摘要改变）：blocked，零副作用', async () => {
    const root = vuePnpmLockedProject('apply-target-changed');
    const backupRoot = externalRoot('apply-target-changed-backup');
    const plan = await buildPlan(root, 'vue');
    const expected = treeSnapshot(root);
    respondWith('vue', body => {
      body['target'] = { ...(body['target'] as Record<string, unknown>), packageSha256: 'b'.repeat(64) };
    });

    const { result } = await attemptApply(root, plan, applyOptions({ backupRoot, authorization: authorizationFor(root, plan) }));

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(result!.status).toBe('blocked');
    expect(codes(result!).some(code => ['TARGET_CHANGED', 'API_MISMATCH', 'PROJECT_CHANGED'].includes(code))).toBe(true);
    expectNoSideEffects(root, expected, backupRoot);
  });

  it('重新核验发现发布被撤权（gap）：blocked，零副作用', async () => {
    const root = vuePnpmLockedProject('apply-revoked');
    const backupRoot = externalRoot('apply-revoked-backup');
    const plan = await buildPlan(root, 'vue');
    const expected = treeSnapshot(root);
    gapResponse('vue', 'TARGET_UNAVAILABLE');

    const { result } = await attemptApply(root, plan, applyOptions({ backupRoot, authorization: authorizationFor(root, plan) }));

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(result!.status).toBe('blocked');
    expect(codes(result!).length).toBeGreaterThan(0);
    expectNoSideEffects(root, expected, backupRoot);
  });

  it('重新核验发现 registry 实收摘要与平台摘要不符：blocked，零副作用', async () => {
    const root = vuePnpmLockedProject('apply-digest-mismatch');
    const backupRoot = externalRoot('apply-digest-mismatch-backup');
    const plan = await buildPlan(root, 'vue');
    const expected = treeSnapshot(root);
    network.tarballProvider = (name, version) => Buffer.from(`tampered bytes for ${name}@${version}\n`);

    const { result } = await attemptApply(root, plan, applyOptions({ backupRoot, authorization: authorizationFor(root, plan) }));

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(result!.status).toBe('blocked');
    expect(codes(result!).some(code => ['DEPENDENCY_CONFLICT', 'API_MISMATCH', 'PROJECT_CHANGED', 'TARGET_CHANGED'].includes(code))).toBe(true);
    expectNoSideEffects(root, expected, backupRoot);
  });

  it('API 与 registry 两套凭据分别只发各自 origin，且都不进入结果 JSON', async () => {
    const root = vuePnpmLockedProject('apply-credentials');
    const backupRoot = externalRoot('apply-credentials-backup');
    const plan = await buildPlan(root, 'vue');
    // 只断言本次 apply 产生的请求：计划阶段的请求先清空。
    network.requests.length = 0;

    const { result } = await attemptApply(root, plan, applyOptions({ backupRoot, authorization: authorizationFor(root, plan) }));

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    const apiHeaders = authorizationHeaders(network, 'api').filter((header): header is string => header !== undefined);
    const registryHeaders = authorizationHeaders(network, 'registry').filter((header): header is string => header !== undefined);
    expect(apiHeaders.length, '管理 API 必须收到 API 凭据').toBeGreaterThan(0);
    expect(registryHeaders.length, 'registry 必须收到 registry 凭据').toBeGreaterThan(0);
    expect(apiHeaders.every(header => header === `Bearer ${SYNTHETIC_API_TOKEN}`)).toBe(true);
    expect(registryHeaders.every(header => header === `Bearer ${SYNTHETIC_REGISTRY_TOKEN}`)).toBe(true);
    expect(apiHeaders.some(header => header.includes(SYNTHETIC_REGISTRY_TOKEN)), 'API 请求不得携带 registry 凭据').toBe(false);
    expect(registryHeaders.some(header => header.includes(SYNTHETIC_API_TOKEN)), 'registry 请求不得携带 API 凭据').toBe(false);
    expect(requestsTo(network, 'api').every(request => !request.path.includes(SYNTHETIC_REGISTRY_TOKEN))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_API_TOKEN);
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_REGISTRY_TOKEN);
  });
});

// ─── ③ 安全字符串绑定 ───

describe('T16 B / P1 applyIntegration 代码生成绑定', () => {
  it('Vue 正常绑定：applied，生成 SFC 用真实导出/样式与字符串 prop/callback 绑定，无执行原语', async () => {
    const root = vuePnpmLockedProject('apply-generate-vue');
    const backupRoot = externalRoot('apply-generate-vue-backup');
    const plan = await buildPlan(root, 'vue');

    const { result } = await attemptApply(root, plan, applyOptions({ backupRoot, authorization: authorizationFor(root, plan) }));

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(result!.status).toBe('applied');
    const generated = readText(root, GENERATED_VUE_PATH);
    expect(generated, '必须生成计划描述的 .vue 组件').toBeDefined();
    expect(generated!.length).toBeGreaterThan(0);
    expect(generated).toContain('LineChart');
    expect(generated).toContain('style.css');
    expectBoundString(generated!, 'sales', { framework: 'vue', prop: 'data' });
    expectBoundString(generated!, 'showDetail', { framework: 'vue', prop: 'onPointClick' });
    const scan = scanSource(generated!, 'vue');
    expect(scan.boundValues.has('grid cell 1'), '布局字符串必须参与真实模板绑定').toBe(true);
    for (const primitive of EXECUTION_PRIMITIVES) {
      expect(scan.codeText, `生成源码不得出现执行原语 ${primitive}`).not.toContain(primitive);
    }
  });

  it('React 正常绑定：applied，生成 TSX 用真实导出/样式与字符串 prop/callback 绑定，无执行原语', async () => {
    const root = reactNpmLockedProject('apply-generate-react');
    const backupRoot = externalRoot('apply-generate-react-backup');
    const plan = await buildPlan(root, 'react');

    const { result } = await attemptApply(root, plan, applyOptions({ backupRoot, authorization: authorizationFor(root, plan) }));

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(result!.status).toBe('applied');
    const generated = readText(root, GENERATED_REACT_PATH);
    expect(generated, '必须生成计划描述的 .tsx 组件').toBeDefined();
    expect(generated!.length).toBeGreaterThan(0);
    expect(generated).toContain('LineChart');
    expect(generated).toContain('style.css');
    expectBoundString(generated!, 'sales', { framework: 'react', prop: 'data' });
    expectBoundString(generated!, 'showDetail', { framework: 'react', prop: 'onPointClick' });
    const scan = scanSource(generated!, 'react');
    expect(scan.boundValues.has('grid cell 1'), '布局字符串必须参与真实 JSX 绑定').toBe(true);
    for (const primitive of EXECUTION_PRIMITIVES) {
      expect(scan.codeText, `生成源码不得出现执行原语 ${primitive}`).not.toContain(primitive);
    }
  });

  it('React 完整 SDK API：内建类型、样式与 ref 可选透传不能误判为不支持的核心类型', async () => {
    const root = reactNpmLockedProject('apply-react-real-api');
    const backupRoot = externalRoot('apply-react-real-api-backup');
    const audited = sdkApiAuditMatrix.find(entry => entry.componentId === 'line' && entry.framework === 'react')!;
    const api = { ...(componentApi('react') as ComponentApiV1),
      props: [...audited.requiredProps, ...audited.optionalProps].map(prop => ({ ...prop })),
      events: audited.events.map(({ name, payload }) => ({ name, payload })),
    };
    const plan = await buildReactPlanWithApi(root, api);
    const { result, thrown } = await attemptApply(root, plan, applyOptions({ backupRoot, authorization: authorizationFor(root, plan) }));
    expect(thrown).toBeUndefined();
    expect(result?.status, JSON.stringify(result?.issues)).toBe('applied');
    const generated = readText(root, GENERATED_REACT_PATH)!;
    expectBoundString(generated, 'sales', { framework: 'react', prop: 'data' });
    expectBoundString(generated, 'showDetail', { framework: 'react', prop: 'onPointClick' });
  });

  it('React 已带 on 前缀的权威事件：回调必须绑定 onPointClick，不能二次转换', async () => {
    const root = reactNpmLockedProject('apply-react-prefixed-event');
    const backupRoot = externalRoot('apply-react-prefixed-event-backup');
    // 只保留既有可支持的图表属性以隔离事件问题；完整 API 另有独立案例。
    const api = { ...(componentApi('react') as ComponentApiV1), events: [{ name: 'onPointClick', payload: 'ChartEvent' }] };
    const plan = await buildReactPlanWithApi(root, api);
    const { result } = await attemptApply(root, plan, applyOptions({ backupRoot, authorization: authorizationFor(root, plan) }));
    expect(result?.status, JSON.stringify(result?.issues)).toBe('applied');
    expectBoundString(readText(root, GENERATED_REACT_PATH)!, 'showDetail', { framework: 'react', prop: 'onPointClick' });
  });

  const hostileBindings: [string, string][] = [
    ['引号与语句逃逸', 'x"};alert(1);//'],
    ['单引号逃逸', "y';alert(2);//"],
    ['换行与注释', 'line-one\nline-two // trailing'],
    ['模板表达式', '${process.env.T16_SECRET}'],
    ['反引号脚本', '`${alert(1)}`'],
    ['原型键', '__proto__'],
    ['构造器键', 'constructor'],
  ];
  const distinctHandler = (source: string): string => source === '__proto__' ? 'constructor' : source === 'constructor' ? '__proto__' : `callback:${source}`;

  it.each(hostileBindings)('Vue 危险绑定文本（%s）：按字符串数据落地且无可执行表达式，或显式阻断', async (_label, payload) => {
    const root = vuePnpmLockedProject('apply-hostile-binding');
    const backupRoot = externalRoot('apply-hostile-binding-backup');
    const handler = distinctHandler(payload);
    const plan = await buildPlan(root, 'vue', { source: payload, handler, layout: `grid ${payload}` });
    const expected = treeSnapshot(root);

    const { result, thrown } = await attemptApply(root, plan, applyOptions({ backupRoot, authorization: authorizationFor(root, plan) }));

    expect(thrown, '危险绑定不得变成未捕获异常').toBeUndefined();
    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    if (result!.status === 'applied') {
      const generated = readText(root, GENERATED_VUE_PATH);
      expect(generated, 'applied 必须真实生成组件').toBeDefined();
      // 扫描器同时覆盖转义、单/双引号与模板字符串：绑定字符串值 + 无可执行位置 + 无执行原语。
      expectSafeBinding(generated!, payload, { framework: 'vue', prop: 'data' });
      expectSafeBinding(generated!, handler, { framework: 'vue', prop: 'onPointClick' });
    } else {
      expect(result!.status, '未应用时必须显式阻断').toBe('blocked');
      expect(codes(result!)).toContain('BINDING_UNSUPPORTED');
      expect(fileExists(root, GENERATED_VUE_PATH), '阻断时不得留下生成文件').toBe(false);
      expectNoSideEffects(root, expected, backupRoot);
    }
  });

  it.each(hostileBindings)('React 危险绑定文本（%s）：安全字符串绑定或显式阻断', async (_label, payload) => {
    const root = reactNpmLockedProject('apply-hostile-binding-react');
    const backupRoot = externalRoot('apply-hostile-binding-react-backup');
    const handler = distinctHandler(payload);
    const plan = await buildPlan(root, 'react', { source: payload, handler, layout: `grid ${payload}` });
    const expected = treeSnapshot(root);

    const { result, thrown } = await attemptApply(root, plan, applyOptions({ backupRoot, authorization: authorizationFor(root, plan) }));

    expect(thrown, '危险绑定不得变成未捕获异常').toBeUndefined();
    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    if (result!.status === 'applied') {
      const generated = readText(root, GENERATED_REACT_PATH);
      expect(generated, 'applied 必须真实生成组件').toBeDefined();
      expectSafeBinding(generated!, payload, { framework: 'react', prop: 'data' });
      expectSafeBinding(generated!, handler, { framework: 'react', prop: 'onPointClick' });
    } else {
      expect(result!.status, '未应用时必须显式阻断').toBe('blocked');
      expect(codes(result!)).toContain('BINDING_UNSUPPORTED');
      expect(fileExists(root, GENERATED_REACT_PATH), '阻断时不得留下生成文件').toBe(false);
      expectNoSideEffects(root, expected, backupRoot);
    }
  });
});

// ─── ④⑤⑥ 写入失败、安装生命周期与备份 ───

describe('T16 B / P1 applyIntegration 写入失败与安装生命周期', () => {
  const backupFaults = [
    ['version', 'writeFile'], ['version', 'rename'],
    ['latest', 'writeFile'], ['latest', 'rename'],
  ] as const;

  it.each(backupFaults)('初始备份 %s 的 %s 一次性失败：目标零写入且安装零启动', async (kind, operation) => {
    const root = vuePnpmLockedProject('apply-initial-backup-fault');
    const backupRoot = externalRoot('apply-initial-backup-fault-store');
    const plan = await buildPlan(root, 'vue');
    const expected = treeSnapshot(root);
    const originalInterceptor = fsFaults.intercept;
    let injected = false;
    fsFaults.intercept = (op, paths, data) => {
      const target = paths.at(-1);
      const name = target && path.basename(target);
      const matches = kind === 'version'
        ? (operation === 'writeFile' ? name?.startsWith('.backup-') : name?.startsWith('backup-'))
        : (operation === 'writeFile' ? name?.startsWith('.latest-') : name === 'latest.json');
      if (!injected && op === operation && target?.startsWith(backupRoot + path.sep) && matches) {
        injected = true;
        return true;
      }
      return originalInterceptor?.(op, paths, data) ?? false;
    };
    try {
      const { result, thrown } = await attemptApply(root, plan, applyOptions({ backupRoot, authorization: authorizationFor(root, plan) }));
      expect(injected, '必须命中真实备份写入接点').toBe(true);
      expect(thrown).toBeUndefined();
      expect(result).toBeDefined();
      expect(result!.status).toBe('blocked');
      expect(codes(result!)).toContain('BACKUP_INVALID');
      expect(result!.changedFiles).toEqual([]);
      expect(result!.backupRef).toBeUndefined();
      expect(result!.installState).toBe('not-run');
      expect(materializationCalls(processes)).toEqual([]);
      expect(treeSnapshot(root)).toEqual(expected);
    } finally {
      fsFaults.intercept = originalInterceptor;
    }
  });

  it.each(backupFaults)('installStarted 备份 %s 的 %s 一次性失败：恢复源码且不启动物化', async (kind, operation) => {
    const root = vuePnpmNewDependencyProject('apply-start-journal-fault');
    const backupRoot = externalRoot('apply-start-journal-fault-store');
    const plan = await buildPlan(root, 'vue');
    processes.dependencies = plan.exactDependencies;
    const expected = treeSnapshot(root);
    const originalInterceptor = fsFaults.intercept;
    const startedDigests = new Set<string>();
    let injected = false;
    fsFaults.intercept = (op, paths, data) => {
      const target = paths.at(-1);
      if (op === 'writeFile' && Buffer.isBuffer(data) && target?.startsWith(backupRoot + path.sep)) {
        try {
          if ((JSON.parse(data.toString('utf8')) as { installStarted?: boolean }).installStarted === true) {
            startedDigests.add(sha256Hex(data));
          }
        } catch { /* 非备份 JSON 不参与选择。 */ }
      }
      const name = target && path.basename(target);
      const matches = kind === 'version'
        ? (operation === 'writeFile' ? name?.startsWith('.backup-') : name?.startsWith('backup-'))
        : (operation === 'writeFile' ? name?.startsWith('.latest-') : name === 'latest.json');
      // latest 的目的文件不含摘要，从真实 journal 内容/rename 源文件取得对应版本。
      let started = paths.some(p => [...startedDigests].some(digest => p.includes(digest)));
      if (!started && op === 'writeFile' && Buffer.isBuffer(data)) {
        try { started = startedDigests.has((JSON.parse(data.toString('utf8')) as { sha256: string }).sha256); } catch { /* 无关写入。 */ }
      }
      if (!injected && op === operation && matches && started) {
        injected = true;
        return true;
      }
      return originalInterceptor?.(op, paths, data) ?? false;
    };
    try {
      const { result, thrown } = await attemptApply(root, plan, applyOptions({ backupRoot, authorization: authorizationFor(root, plan) }));
      expect(injected, '必须在 installStarted=true 的真实备份提交处失败').toBe(true);
      expect(thrown).toBeUndefined();
      expect(result).toBeDefined();
      expect(result!.status).toBe('rolled-back');
      expect(result!.installState).toBe('not-run');
      expect(codes(result!).some(code => code === 'BACKUP_INVALID' || code === 'WRITE_FAILED')).toBe(true);
      expect(materializationCalls(processes), '备份状态持久化成功前不得启动安装').toEqual([]);
      expect(treeSnapshot(root)).toEqual(expected);
      expect(result!.backupRef).toBeDefined();
      const stored = storedBackup(backupRoot, result!.backupRef!);
      expect(stored.document.installStarted).toBe(false);
      const latest = JSON.parse(fs.readFileSync(path.join(backupRoot, result!.operationId, 'latest.json'), 'utf8')) as { sha256: string };
      expect(latest.sha256, '失败后返回引用仍应是可达最新版本').toBe(stored.sha256);
    } finally {
      fsFaults.intercept = originalInterceptor;
    }
  });

  it('首个写入失败：备份已落盘，写入证据为空，WRITE_FAILED + rolled-back + not-run，原始字节不变', async () => {
    const root = vuePnpmLockedProject('apply-first-write');
    const backupRoot = externalRoot('apply-first-write-backup');
    const plan = await buildPlan(root, 'vue');
    const expected = treeSnapshot(root);
    // replan 与备份完成后才注入：实读合法备份并核对原字节后，第 1 个最终目标内容写入失败。
    faults.armCommitFailure(root, backupRoot, 1);

    const { result } = await attemptApply(root, plan, applyOptions({ backupRoot, authorization: authorizationFor(root, plan) }));

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(faults.failedOrdinal(), '完整备份落盘后首个最终目标写入必须命中失败').toBe(1);
    expect(result!.status).toBe('rolled-back');
    expect(codes(result!)).toContain('WRITE_FAILED');
    expect(result!.changedFiles).toEqual([]);
    expect(result!.beforeHashes).toEqual([]);
    expect(result!.afterHashes).toEqual([]);
    expect(result!.installedVersions).toEqual([]);
    expect(result!.installState).toBe('not-run');
    expect(result!.backupRef, '首写失败仍须保留可验证的 backupRef').toBeDefined();
    const backups = readBackupFiles(backupRoot);
    const stored = backups.find(backup => backup.sha256 === result!.backupRef!.sha256);
    expect(stored, 'backupRef 摘要必须对应 backupRoot 中真实落盘的备份 JSON').toBeDefined();
    const document = stored!.json as { operationId: string; installPlanned: boolean; installStarted: boolean; files: { path: string }[] };
    expect(document.operationId).toBe(result!.operationId);
    expect(document.installPlanned).toBe(false);
    expect(document.installStarted).toBe(false);
    expect([...document.files.map(file => file.path)].sort()).toEqual([...plan.allowedPaths].sort());
    expect(treeSnapshot(root), '恢复后所有原始文件字节必须不变').toEqual(expected);
    expect(materializationCalls(processes)).toEqual([]);
  });

  it('第二个写入失败：只记录已提交文件，恢复后已写 restored、未写候选 unchanged', async () => {
    const root = vuePnpmNewDependencyProject('apply-second-write');
    const backupRoot = externalRoot('apply-second-write-backup');
    const plan = await buildPlan(root, 'vue');
    processes.dependencies = plan.exactDependencies;
    const expected = treeSnapshot(root);
    const originalBytes = new Map(plan.allowedPaths.map(relative => [relative, readBytes(root, relative)]));
    faults.armCommitFailure(root, backupRoot, 2);

    const { result } = await attemptApply(root, plan, applyOptions({ backupRoot, authorization: authorizationFor(root, plan) }));

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(faults.failedOrdinal(), '第二次最终目标写入必须被注入一次失败').toBe(2);
    expect(result!.status).toBe('rolled-back');
    expect(codes(result!)).toContain('WRITE_FAILED');
    expect(result!.changedFiles.length, '部分写入：不能虚构完整成功').toBe(1);
    for (const relative of result!.changedFiles) expect(plan.allowedPaths).toContain(relative);
    expect(result!.installState).not.toBe('succeeded');
    expect(materializationCalls(processes), '目标写入未全部完成不得物化依赖').toEqual([]);
    expect([...result!.beforeHashes.map(snapshot => snapshot.path)].sort()).toEqual([...result!.changedFiles].sort());
    expect([...result!.afterHashes.map(snapshot => snapshot.path)].sort()).toEqual([...result!.changedFiles].sort());
    for (const relative of result!.changedFiles) {
      expect(readBytes(root, relative), `已写文件 ${relative} 必须被恢复`).toEqual(originalBytes.get(relative));
    }
    for (const relative of plan.allowedPaths) {
      if (result!.changedFiles.includes(relative)) continue;
      expect(readBytes(root, relative), `未写候选 ${relative} 必须保持原状`).toEqual(originalBytes.get(relative));
    }
    expect(treeSnapshot(root)).toEqual(expected);
  });

  it('backupRoot 不可用（是普通文件）：不得写入任何目标文件', async () => {
    const root = vuePnpmLockedProject('apply-backup-root');
    const backupRootPath = path.join(externalRoot('apply-backup-root-parent'), 'backup-root-is-a-file');
    fs.writeFileSync(backupRootPath, 'not a directory\n', 'utf8');
    const plan = await buildPlan(root, 'vue');
    const expected = treeSnapshot(root);

    const { result, thrown } = await attemptApply(root, plan, applyOptions({ backupRoot: backupRootPath, authorization: authorizationFor(root, plan) }));

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(result!.status === 'blocked' || result!.status === 'rolled-back').toBe(true);
    expect(result!.changedFiles).toEqual([]);
    expect(treeSnapshot(root), '备份不可用不得产生任何目标写入').toEqual(expected);
    if (thrown !== undefined) expectSanitized(thrown);
  });


  it('安装启动后失败：reinstall-required，返回摘要等于最后落盘 JSON，过时引用被拒绝', async () => {
    const root = vuePnpmNewDependencyProject('apply-install-failed');
    const backupRoot = externalRoot('apply-install-failed-backup');
    const plan = await buildPlan(root, 'vue');
    processes.dependencies = plan.exactDependencies;
    processes.materialization = 'fail';
    const expected = treeSnapshot(root);
    const originalBytes = new Map(plan.allowedPaths.map(relative => [relative, readBytes(root, relative)]));

    const { result } = await attemptApply(root, plan, applyOptions({ backupRoot, authorization: authorizationFor(root, plan) }));

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(result!.installState, '安装确已启动：必须保守返回 reinstall-required').toBe('reinstall-required');
    expect(codes(result!)).toContain('INSTALL_FAILED');
    expect(result!.status).toBe('rolled-back');
    expect(materializationCalls(processes).length, '必须真实发起过一次冻结物化进程').toBeGreaterThan(0);
    expect(isOutsideProject(materializationCalls(processes)[0]?.cwd, root), '物化进程只能在工程外 staging 运行').toBe(true);
    const backups = readBackupFiles(backupRoot);
    const latest = backups.find(backup => backup.sha256 === result!.backupRef?.sha256);
    expect(latest, '返回的 backupRef 摘要必须等于 backupRoot 中最后落盘 JSON 的实算摘要').toBeDefined();
    expect((latest!.json as { installStarted: boolean }).installStarted).toBe(true);
    expect((latest!.json as { operationId: string }).operationId).toBe(result!.operationId);
    expect(backups.length, '安装启动前后的备份版本都必须按摘要不可变保存').toBeGreaterThan(1);
    expect(backups.some(backup => (backup.json as { installStarted: boolean }).installStarted === false)).toBe(true);
    for (const relative of result!.changedFiles) expect(readBytes(root, relative)).toEqual(originalBytes.get(relative));
    expect(treeSnapshot(root), '源码恢复后目标必须回到 apply 前状态').toEqual(expected);
    const stale = backups.find(backup => backup.sha256 !== result!.backupRef?.sha256);
    expect(stale, '必须存在可被拒绝的过时备份版本').toBeDefined();
    const rollback = await attemptRollback(root, { id: result!.operationId, sha256: stale!.sha256 }, backupRoot);
    expect(rollback.thrown, '过时备份引用必须被拒绝').toBeDefined();
    expect(`${String((rollback.thrown as { code?: unknown })?.code ?? '')} ${rollback.thrown instanceof Error ? rollback.thrown.message : ''}`).toContain('BACKUP_INVALID');
    expectSanitized(rollback.thrown);
    expect(treeSnapshot(root), '拒绝过时引用不得改动目标').toEqual(expected);
  });
});
