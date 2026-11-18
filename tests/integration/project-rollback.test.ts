/**
 * T16 B / P1 产品失败测试：rollbackIntegration。
 *
 * 依据 docs/superpowers/plans/2026-11-18-t16-b-install-isolation-brief.md 的 12 组要求中属于恢复的部分：
 * ⑨ 有效备份恢复（原文件、新文件删除、已匹配 before 的 unchanged，四组互斥且完整覆盖）；
 * ⑩ 用户后续编辑 vs 恢复 I/O 失败（preserved + USER_EDITED；unresolved + WRITE_FAILED/RECOVERY_REQUIRED）；
 * ⑪ 同时存在 restored/unchanged/preserved/unresolved 时的逐路径 coverage 与 installStarted 保守性；
 * ⑫ 备份摘要失配、损坏 JSON、跨 root、链接/junction/hardlink 时不覆盖用户文件且异常脱敏；
 *    原字节/root/plan/id 字段级独立检查待 GREEN 存储接入。
 *
 * 边界：
 * - 只通过 CLI **根出口命名空间**可选调用 `applyIntegration` / `rollbackIntegration`；RED 期缺导出时返回
 *   undefined，由对状态/字节/摘要/进程边界的实质断言失败；
 * - 备份证据用 Node fs/crypto 独立实算；篡改场景只在产品**真实落盘路径**上原地改待检查字段，
 *   保持原引用，验证摘要失配；字段级与空字节接入见 GREEN 前待办；
 * - 恢复 I/O 故障由测试私有 `node:fs` mock 精确注入，不向公开 options 注入任何 runner。
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
  VUE_FRAMEWORK_VERSION,
  VUE_PACKAGE_NAME,
  externalRoot,
  fileExists,
  hardLinkFile,
  linkDirectory,
  projectFile,
  readBytes,
  readText,
  releaseSyntheticDirs,
  sha256Hex,
  tarballSha256,
  treeDifferences,
  treeSnapshot,
  vuePnpmLockedProject,
  vuePnpmNewDependencyProject,
} from './t16-support/synthetic-projects.js';
import {
  SYNTHETIC_API_TOKEN,
  SYNTHETIC_REGISTRY_TOKEN,
  startSyntheticNetwork,
  type SyntheticNetwork,
} from './t16-support/loopback-services.js';
import {
  readBackupFiles,
  storedBackup,
  backupEntry,
  type BackupDocument,
} from './t16-support/backup-store.js';
import {
  installProcessInterceptor,
  materializationCalls,
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
const GENERATED_VUE_PATH_2 = 'src/components/zhinexus/component-0002.vue';

function vueTarget(): Record<string, unknown> {
  return {
    variantReleaseId: '00000000-0000-4000-8000-000000000001', variantId: 'line-vue', componentId: 'line',
    framework: 'vue', packageName: VUE_PACKAGE_NAME, packageVersion: PACKAGE_VERSION,
    packageSha256: tarballSha256(VUE_PACKAGE_NAME, PACKAGE_VERSION),
    exportName: 'LineChart', exportPath: './line',
    evidence: [{ kind: 'api', path: 'api/line.json', sha256: 'c'.repeat(64) }, { kind: 'docs', path: 'docs/line.md', sha256: 'd'.repeat(64) }],
    compatibility: { status: 'verified', recordIds: ['synthetic-test-only'] },
    examples: [{ id: 'example', previewEntry: 'preview/index.html' }],
    styleExport: './style.css', readyMethod: 'whenRendered', notes: [],
  };
}

function componentApi(): unknown {
  return {
    schemaVersion: 1, componentId: 'line', framework: 'vue', exportName: 'LineChart', exportPath: './line',
    props: [{ name: 'data', type: 'ChartData', required: true }, { name: 'config', type: 'LineChartConfig', required: false }],
    events: [{ name: 'point-click', payload: 'ChartEvent' }],
    styleExport: './style.css', readyMethod: 'whenRendered', notes: [],
  };
}

function matchPlanWith(instanceIds: string[]): MatchPlanV1 {
  const target = vueTarget() as MatchPlanV1['elements'][number]['target'];
  const elements: MatchPlanV1['elements'] = instanceIds.map(instanceId => ({
    instanceId, designId: '设计/Line', status: 'mapped', target,
    props: [
      { name: 'data', type: 'ChartData', required: true, source: 'sales' },
      { name: 'config', type: 'LineChartConfig', required: false },
    ],
    events: [{ name: 'point-click', payload: 'ChartEvent', handler: 'showDetail' }],
    layout: 'grid cell 1',
    gaps: [],
  }));
  return {
    schemaVersion: 1, source: 'design-id', inputDigest: 'a'.repeat(64), ruleSetId: 'library', revision: 'draft-1',
    context: { framework: 'vue', frameworkVersion: VUE_FRAMEWORK_VERSION, echartsVersion: ECHARTS_VERSION, packageManager: 'pnpm', requirements: [] },
    elements,
    exactDependencies: VUE_DEPENDENCIES.map(dependency => ({ ...dependency })),
    gaps: [],
  };
}

function planOptions(): PlanOptions {
  return {
    apiUrl: network.apiOrigin, registryUrl: network.registryOrigin,
    apiToken: network.apiToken, registryToken: network.registryToken, requestTimeoutMs: 15000,
  };
}

function canonicalRoot(root: string): string {
  try {
    return path.resolve(fs.realpathSync(path.resolve(root))).split(path.sep).join('/');
  } catch {
    return path.resolve(root).split(path.sep).join('/');
  }
}

function authorizationFor(root: string, plan: IntegrationPlanV1): IntegrationApplyAuthorizationV1 {
  return {
    schemaVersion: 1, operation: 'apply', projectRoot: canonicalRoot(root),
    planDigest: sha256Hex(canonicalJson(plan)), allowedPaths: [...plan.allowedPaths], allowInstall: true,
  };
}

async function buildPlan(root: string, instanceIds: string[]): Promise<IntegrationPlanV1> {
  const source = matchPlanWith(instanceIds);
  expect(validateMatchPlan(source).ok, '夹具源 MatchPlan 必须结构合法').toBe(true);
  network.apiResponder = query => ({
    schemaVersion: 1, query, status: 'matched', target: vueTarget(), api: componentApi(),
    exactDependencies: VUE_DEPENDENCIES.map(dependency => ({ ...dependency })), gaps: [],
  });
  expect(validateComponentMatchResponse({
    schemaVersion: 1,
    query: { componentId: 'line', framework: 'vue', packageName: VUE_PACKAGE_NAME, packageVersion: PACKAGE_VERSION, frameworkVersion: VUE_FRAMEWORK_VERSION, echartsVersion: ECHARTS_VERSION },
    status: 'matched', target: vueTarget(), api: componentApi(),
    exactDependencies: VUE_DEPENDENCIES.map(dependency => ({ ...dependency })), gaps: [],
  }).ok, '夹具权威响应必须结构合法').toBe(true);
  const plan = await planIntegration(root, source, planOptions());
  expect(plan.status, `夹具必须产出 planned 计划（冲突：${plan.conflicts.map(c => c.code).join(',')}）`).toBe('planned');
  return plan;
}

/** 先真实走一次 apply，拿到可恢复的备份（恢复用例的前提）。 */
async function applyForRollback(
  root: string,
  instanceIds: string[],
  backupRoot: string,
): Promise<{ plan: IntegrationPlanV1; applied: IntegrationApplyResultV1 }> {
  const plan = await buildPlan(root, instanceIds);
  processes.dependencies = plan.exactDependencies;
  let applied: IntegrationApplyResultV1 | undefined;
  let thrown: unknown;
  try {
    applied = await callApply(exports, root, plan, {
      apiUrl: network.apiOrigin, registryUrl: network.registryOrigin,
      apiToken: network.apiToken, registryToken: network.registryToken, requestTimeoutMs: 15000,
      backupRoot, authorization: authorizationFor(root, plan),
    } satisfies IntegrationApplyOptions);
  } catch (error) {
    thrown = error;
  }
  expect(thrown, '恢复夹具的 apply 不得抛错').toBeUndefined();
  expect(applied, capabilityNote(exports, 'applyIntegration')).toBeDefined();
  expect(applied!.status, `恢复夹具的 apply 必须成功（issues：${applied!.issues.map(issue => issue.code).join(',')}）`).toBe('applied');
  expect(applied!.backupRef, '成功的 apply 必须返回可验证 backupRef').toBeDefined();
  return { plan, applied: applied! };
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

function errorText(error: unknown): string {
  const record = error as { code?: unknown };
  return `${String(record?.code ?? '')} ${error instanceof Error ? error.message : String(error)}`;
}

/** 备份不可信（损坏 JSON / 摘要不符 / 原字节与快照不符等）：必须抛固定脱敏 BACKUP_INVALID 类错误，
 *  不得编造合法 rollback 对象。 */
function expectBackupInvalid(outcome: { result?: IntegrationRollbackResultV1; thrown?: unknown }): void {
  expect(outcome.result, '不可信备份不得产生 rollback 结果对象').toBeUndefined();
  expect(outcome.thrown, '不可信备份必须抛固定脱敏执行错误').toBeDefined();
  expect(errorText(outcome.thrown)).toContain('BACKUP_INVALID');
  expectSanitized(outcome.thrown);
}

/** 恢复拒绝（root/planDigest 错绑等）：抛错或带 unresolved 的 recovery-required，且必须脱敏。 */
function expectRefused(outcome: { result?: IntegrationRollbackResultV1; thrown?: unknown }, allowed: readonly string[]): void {
  if (outcome.thrown !== undefined) {
    expect(allowed.some(code => errorText(outcome.thrown).includes(code)), `拒绝原因应可识别（实际：${errorText(outcome.thrown)}）`).toBe(true);
    expectSanitized(outcome.thrown);
    return;
  }
  expect(outcome.result, capabilityNote(exports, 'rollbackIntegration')).toBeDefined();
  expect(outcome.result!.status).toBe('recovery-required');
  expect(outcome.result!.unresolvedPaths.length).toBeGreaterThan(0);
}

/** 四组互斥且完整覆盖备份候选。 */
function expectCoverage(result: IntegrationRollbackResultV1, candidates: readonly string[]): void {
  const union = [...result.restoredPaths, ...result.unchangedPaths, ...result.preservedPaths, ...result.unresolvedPaths].sort();
  expect(union, '四组并集必须完整覆盖备份候选').toEqual([...candidates].sort());
  expect(new Set(union).size, '四组必须互斥').toBe(union.length);
}

/** 从一次真实 apply 的布局派生自包含备份 fixture；绝不冒称 apply 原始证据。
 * 新版本按实算摘要另存，真实 latest 仅替换摘要；合法控制证明不因缺索引失败。
 */
function derivedBackup(
  backupRoot: string,
  reference: IntegrationBackupRef,
  change: (document: BackupDocument) => void,
): IntegrationBackupRef {
  const stored = storedBackup(backupRoot, reference);
  const journalPath = path.join(path.dirname(path.dirname(stored.path)), 'latest.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as Record<string, unknown>;
  expect(journal['operationId']).toBe(reference.id);
  expect(journal['sha256']).toBe(stored.sha256);
  const document = structuredClone(stored.document);
  change(document);
  const bytes = Buffer.from(JSON.stringify(document, null, 2) + '\n');
  const sha256 = sha256Hex(bytes);
  const version = path.join(path.dirname(stored.path), `backup-${sha256}.json`);
  fs.writeFileSync(version, bytes);
  fs.writeFileSync(journalPath, JSON.stringify({ ...journal, sha256 }, null, 2) + '\n');
  expect(sha256Hex(fs.readFileSync(version))).toBe(sha256);
  return { id: reference.id, sha256 };
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
});

afterEach(() => {
  faults.disarm();
  expect(processes.fixtureErrors ?? [], '测试夹具不得以安装失败掩盖错误').toEqual([]);
  network.apiResponder = () => ({ schemaVersion: 1, status: 'gap', exactDependencies: [], gaps: [] });
});

// ─── ⑨ 有效备份恢复 ───

describe('T16 B / P1 rollbackIntegration 有效备份恢复', () => {
  it('无安装意图的成功 apply：新建组件被删除，四组中只有 restored，installState 保持 not-run', async () => {
    const root = vuePnpmLockedProject('rollback-basic');
    const backupRoot = externalRoot('rollback-basic-backup');
    const { plan, applied } = await applyForRollback(root, ['node-1'], backupRoot);
    expect(applied.installState).toBe('not-run');
    expect(fileExists(root, GENERATED_VUE_PATH)).toBe(true);

    const { result, thrown } = await attemptRollback(root, applied.backupRef!, backupRoot);

    expect(thrown, '有效备份应可恢复而不是抛错').toBeUndefined();
    expect(result, capabilityNote(exports, 'rollbackIntegration')).toBeDefined();
    expect(result!.schemaVersion).toBe(1);
    expect(result!.operation).toBe('rollback');
    expect(result!.status).toBe('rolled-back');
    expect(result!.operationId).toBe(applied.operationId);
    expect(result!.projectRoot).toBe(canonicalRoot(root));
    expect(result!.planDigest).toBe(applied.planDigest);
    expect([...result!.restoredPaths].sort()).toEqual([...plan.allowedPaths].sort());
    expect(result!.unchangedPaths).toEqual([]);
    expect(result!.preservedPaths).toEqual([]);
    expect(result!.unresolvedPaths).toEqual([]);
    expect(result!.issues).toEqual([]);
    expect(result!.installState).toBe('not-run');
    expect(fileExists(root, GENERATED_VUE_PATH), '恢复必须删除 apply 新建的文件').toBe(false);
  });

  it('安装已启动的成功 apply：源码与清单按原字节恢复，installState 保守为 reinstall-required，且不宣称恢复 node_modules', async () => {
    const root = vuePnpmNewDependencyProject('rollback-install');
    const backupRoot = externalRoot('rollback-install-backup');
    const originalManifest = readText(root, 'package.json');
    const originalLock = readText(root, 'pnpm-lock.yaml');
    const { plan, applied } = await applyForRollback(root, ['node-1'], backupRoot);
    expect(applied.installState).toBe('succeeded');
    expect(materializationCalls(processes).length, '安装意图必须真实发生过物化进程').toBeGreaterThan(0);
    const stored = storedBackup(backupRoot, applied.backupRef!);
    expect(stored.document.installStarted, '安装确已启动：备份必须记录 installStarted=true').toBe(true);

    const { result } = await attemptRollback(root, applied.backupRef!, backupRoot);

    expect(result, capabilityNote(exports, 'rollbackIntegration')).toBeDefined();
    expect(result!.status).toBe('rolled-back');
    expect([...result!.restoredPaths].sort()).toEqual([...plan.allowedPaths].sort());
    expect(result!.installState, '文件恢复不能洗掉已启动的安装副作用').toBe('reinstall-required');
    expect(result!.restoredPaths.some(relative => relative.includes('node_modules')), '不得把 node_modules 冒称已恢复').toBe(false);
    expect(readText(root, 'package.json'), '清单必须按备份原字节恢复').toBe(originalManifest);
    expect(readText(root, 'pnpm-lock.yaml'), '锁必须按备份原字节恢复').toBe(originalLock);
    expect(fileExists(root, GENERATED_VUE_PATH)).toBe(false);
  });


  it('候选已匹配 before（用户已自行改回原字节）：归入 unchanged，不重复恢复', async () => {
    const root = vuePnpmNewDependencyProject('rollback-unchanged');
    const backupRoot = externalRoot('rollback-unchanged-backup');
    const originalManifest = readText(root, 'package.json');
    const { applied } = await applyForRollback(root, ['node-1'], backupRoot);
    fs.writeFileSync(projectFile(root, 'package.json'), originalManifest ?? '', 'utf8');

    const { result } = await attemptRollback(root, applied.backupRef!, backupRoot);

    expect(result, capabilityNote(exports, 'rollbackIntegration')).toBeDefined();
    expect(result!.status).toBe('rolled-back');
    expect(result!.unchangedPaths).toEqual(['package.json']);
    expect(result!.restoredPaths).toEqual([GENERATED_VUE_PATH, 'pnpm-lock.yaml']);
    expect(result!.preservedPaths).toEqual([]);
    expect(result!.unresolvedPaths).toEqual([]);
    expect(readText(root, 'package.json')).toBe(originalManifest);
  });

  it('恢复候选集合必须完整覆盖：restored/unchanged/preserved/unresolved 互斥且并集等于备份候选', async () => {
    const root = vuePnpmNewDependencyProject('rollback-coverage');
    const backupRoot = externalRoot('rollback-coverage-backup');
    const originalManifest = readText(root, 'package.json');
    const { plan, applied } = await applyForRollback(root, ['node-a', 'node-b'], backupRoot);
    const candidates = [...plan.allowedPaths].sort();
    expect(candidates.length, '四组覆盖需要至少四个候选').toBe(4);
    // 四种互斥状态：已写未动（restored）、已改回原字节（unchanged）、用户编辑（preserved）、恢复 I/O 失败（unresolved）。
    fs.rmSync(projectFile(root, GENERATED_VUE_PATH_2), { force: true });
    fs.writeFileSync(projectFile(root, 'package.json'), `${originalManifest ?? ''}\n// 用户在 apply 之后的手工编辑\n`, 'utf8');
    faults.armPath(projectFile(root, 'pnpm-lock.yaml'));

    const { result } = await attemptRollback(root, applied.backupRef!, backupRoot);

    expect(result, capabilityNote(exports, 'rollbackIntegration')).toBeDefined();
    expect(result!.status, '存在保留与未解决项时必须 recovery-required').toBe('recovery-required');
    expect([...result!.restoredPaths].sort()).toEqual([GENERATED_VUE_PATH]);
    expect(result!.unchangedPaths).toEqual([GENERATED_VUE_PATH_2]);
    expect(result!.preservedPaths).toEqual(['package.json']);
    expect(result!.unresolvedPaths).toEqual(['pnpm-lock.yaml']);
    expectCoverage(result!, candidates);
    expect(result!.issues.some(issue => issue.code === 'USER_EDITED' && issue.path === 'package.json')).toBe(true);
    expect(result!.issues.some(issue => (issue.code === 'WRITE_FAILED' || issue.code === 'RECOVERY_REQUIRED') && issue.path === 'pnpm-lock.yaml')).toBe(true);
    expect(result!.issues.some(issue => issue.code === 'USER_EDITED' && issue.path === GENERATED_VUE_PATH), '未编辑文件不得被冒称用户编辑').toBe(false);
    expect(readText(root, 'package.json'), '用户编辑字节必须原样保留').toBe(`${originalManifest ?? ''}\n// 用户在 apply 之后的手工编辑\n`);
  });
});

// ─── ⑩ 用户编辑与恢复 I/O 失败 ───

describe('T16 B / P1 rollbackIntegration 用户编辑与 I/O 失败', () => {
  it('新建文件分类完成后、删除前用户改写：保留新字节而非删除后声称 restored', async () => {
    const root = vuePnpmLockedProject('review-rollback-late-delete');
    const backupRoot = externalRoot('review-rollback-late-delete-backup');
    const { plan, applied } = await applyForRollback(root, ['node-1'], backupRoot);
    const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const target = projectFile(root, GENERATED_VUE_PATH);
    const userBytes = Buffer.from('<!-- edited after classification -->\n');
    const previous = fsFaults.readIntercept;
    let classifiedRead = false, edited = false;
    fsFaults.readIntercept = (op, paths, data) => {
      if (paths[0] === target) {
        if (op === 'readFile') classifiedRead = true;
        if (!edited && op === 'lstat' && classifiedRead) {
          realFs.writeFileSync(target, userBytes);
          edited = true;
        }
      }
      return previous?.(op, paths, data) ?? false;
    };
    try {
      const { result, thrown } = await attemptRollback(root, applied.backupRef!, backupRoot);
      expect(edited, '必须命中分类读取之后的删除路径复核接点').toBe(true);
      expect(thrown).toBeUndefined();
      expect(readBytes(root, GENERATED_VUE_PATH), '删除前的新编辑必须保留').toEqual(userBytes);
      expect(result?.status).toBe('recovery-required');
      expect(result?.preservedPaths).toEqual([GENERATED_VUE_PATH]);
      expect(result?.restoredPaths).not.toContain(GENERATED_VUE_PATH);
      expect(result?.issues.some(issue => issue.code === 'USER_EDITED' && issue.path === GENERATED_VUE_PATH)).toBe(true);
      expectCoverage(result!, plan.allowedPaths);
    } finally { fsFaults.readIntercept = previous; }
  });

  it.each(['EACCES', 'EIO'])('恢复 lstat %s 不可读：归入 unresolved，不能当作新文件不存在', async code => {
    const root = vuePnpmLockedProject('review-rollback-lstat-error');
    const backupRoot = externalRoot('review-rollback-lstat-error-backup');
    const { plan, applied } = await applyForRollback(root, ['node-1'], backupRoot);
    const expected = readBytes(root, GENERATED_VUE_PATH);
    const target = projectFile(root, GENERATED_VUE_PATH);
    const previous = fsFaults.readIntercept;
    let injected = false;
    fsFaults.readIntercept = (op, paths, data) => {
      if (op === 'lstat' && paths[0] === target) {
        injected = true;
        const error = new Error('synthetic unreadable target') as NodeJS.ErrnoException;
        error.code = code;
        throw error;
      }
      return previous?.(op, paths, data) ?? false;
    };
    try {
      const { result, thrown } = await attemptRollback(root, applied.backupRef!, backupRoot);
      expect(injected, '必须命中真实目标 stat 读取').toBe(true);
      expect(thrown).toBeUndefined();
      expect(result?.status).toBe('recovery-required');
      expect(result?.unresolvedPaths).toEqual([GENERATED_VUE_PATH]);
      expect(result?.unchangedPaths).toEqual([]);
      expect(result?.preservedPaths).toEqual([]);
      expect(result?.issues.some(issue => issue.code === 'RECOVERY_REQUIRED' && issue.path === GENERATED_VUE_PATH)).toBe(true);
      expectCoverage(result!, plan.allowedPaths);
    } finally { fsFaults.readIntercept = previous; }
    expect(readBytes(root, GENERATED_VUE_PATH)).toEqual(expected);
  });

  it('恢复暂存原字节后用户改写目标：保留新编辑并归入 preserved，而非覆盖后冒称 restored', async () => {
    const root = vuePnpmNewDependencyProject('rollback-during-replace');
    const backupRoot = externalRoot('rollback-during-replace-store');
    const { plan, applied } = await applyForRollback(root, ['node-1'], backupRoot);
    const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const target = projectFile(root, 'package.json');
    const userBytes = Buffer.from('{"user":"edit-during-restore"}\n');
    const originalInterceptor = fsFaults.intercept;
    let edited = false;
    fsFaults.intercept = (op, paths, data) => {
      const temporary = paths[0];
      if (!edited && op === 'writeFile' && temporary && path.dirname(temporary) === root
        && path.basename(temporary).startsWith('.package.json.t16-')) {
        edited = true;
        realFs.writeFileSync(target, userBytes);
      }
      return originalInterceptor?.(op, paths, data) ?? false;
    };
    try {
      const { result, thrown } = await attemptRollback(root, applied.backupRef!, backupRoot);
      expect(edited, '必须命中真实暂存写入与目标 rename 之间的可观测窗口').toBe(true);
      expect(thrown).toBeUndefined();
      expect(result).toBeDefined();
      expect(readBytes(root, 'package.json'), '恢复期间新编辑不得被覆盖').toEqual(userBytes);
      expect(result!.status).toBe('recovery-required');
      expect(result!.preservedPaths).toEqual(['package.json']);
      expect(result!.restoredPaths).not.toContain('package.json');
      expect(result!.issues.some(issue => issue.code === 'USER_EDITED' && issue.path === 'package.json')).toBe(true);
      expectCoverage(result!, plan.allowedPaths);
    } finally {
      fsFaults.intercept = originalInterceptor;
    }
  });

  it('用户后续编辑单个文件：preserved + USER_EDITED，字节原样保留，状态 recovery-required', async () => {
    const root = vuePnpmLockedProject('rollback-user-edit');
    const backupRoot = externalRoot('rollback-user-edit-backup');
    const { applied } = await applyForRollback(root, ['node-1'], backupRoot);
    const userBytes = Buffer.from('// 用户在 apply 之后手工编辑的内容\n', 'utf8');
    fs.writeFileSync(projectFile(root, GENERATED_VUE_PATH), userBytes);

    const { result } = await attemptRollback(root, applied.backupRef!, backupRoot);

    expect(result, capabilityNote(exports, 'rollbackIntegration')).toBeDefined();
    expect(result!.status).toBe('recovery-required');
    expect(result!.preservedPaths).toEqual([GENERATED_VUE_PATH]);
    expect(result!.restoredPaths).toEqual([]);
    expect(result!.unresolvedPaths).toEqual([]);
    expect(result!.issues.map(issue => issue.code)).toEqual(['USER_EDITED']);
    expect(result!.issues[0]?.path).toBe(GENERATED_VUE_PATH);
    expect(readBytes(root, GENERATED_VUE_PATH), '用户编辑不得被回退覆盖').toEqual(userBytes);
  });

  it('删除新建文件时 I/O 失败：unresolved + WRITE_FAILED/RECOVERY_REQUIRED，不得冒称用户编辑', async () => {
    const root = vuePnpmLockedProject('rollback-delete-failed');
    const backupRoot = externalRoot('rollback-delete-failed-backup');
    const { applied } = await applyForRollback(root, ['node-1'], backupRoot);
    const written = readBytes(root, GENERATED_VUE_PATH);
    faults.armPath(projectFile(root, GENERATED_VUE_PATH));

    const { result } = await attemptRollback(root, applied.backupRef!, backupRoot);

    expect(result, capabilityNote(exports, 'rollbackIntegration')).toBeDefined();
    expect(result!.status).toBe('recovery-required');
    expect(result!.unresolvedPaths).toEqual([GENERATED_VUE_PATH]);
    expect(result!.preservedPaths).toEqual([]);
    expect(result!.issues.some(issue => (issue.code === 'WRITE_FAILED' || issue.code === 'RECOVERY_REQUIRED') && issue.path === GENERATED_VUE_PATH)).toBe(true);
    expect(result!.issues.some(issue => issue.code === 'USER_EDITED'), 'I/O 失败不得冒称用户编辑').toBe(false);
    expect(readBytes(root, GENERATED_VUE_PATH), '恢复失败不得破坏现场').toEqual(written);
  });

  it('写回既有文件时 I/O 失败：unresolved，用户现场字节不被覆盖', async () => {
    const root = vuePnpmNewDependencyProject('rollback-write-failed');
    const backupRoot = externalRoot('rollback-write-failed-backup');
    const originalManifest = readText(root, 'package.json');
    const { applied } = await applyForRollback(root, ['node-1'], backupRoot);
    const current = readBytes(root, 'package.json');
    expect(current).not.toEqual(Buffer.from(originalManifest ?? '', 'utf8'));
    faults.armPath(projectFile(root, 'package.json'));

    const { result } = await attemptRollback(root, applied.backupRef!, backupRoot);

    expect(result, capabilityNote(exports, 'rollbackIntegration')).toBeDefined();
    expect(result!.status).toBe('recovery-required');
    expect(result!.unresolvedPaths).toContain('package.json');
    expect(result!.issues.some(issue => (issue.code === 'WRITE_FAILED' || issue.code === 'RECOVERY_REQUIRED') && issue.path === 'package.json')).toBe(true);
    expect(readBytes(root, 'package.json'), '恢复写入失败不得改动用户现场').toEqual(current);
  });
});

// ─── ⑫ 备份可信性、跨 root 与链接 ───

describe('T16 B / P1 rollbackIntegration 备份可信性与链接边界', () => {
  it('备份根上层父目录为 junction：普通子目录与有效摘要不能授权恢复', async () => {
    // 捕获只核验 backupRoot 本身而漏查其祖先，沿链接读取备份后恢复目标的错误。
    const root = vuePnpmLockedProject('review-backup-ancestor');
    const container = externalRoot('review-backup-ancestor-container');
    const backupRoot = path.join(container, 'store');
    const outside = externalRoot('review-backup-ancestor-outside');
    const { applied } = await applyForRollback(root, ['node-1'], backupRoot);
    const stored = storedBackup(backupRoot, applied.backupRef!);
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    const moved = path.join(outside, 'moved-container');
    actual.renameSync(container, moved);
    linkDirectory(container, moved);
    expect(actual.lstatSync(container).isSymbolicLink()).toBe(true);
    expect(actual.lstatSync(backupRoot).isDirectory()).toBe(true);
    expect(actual.lstatSync(backupRoot).isSymbolicLink()).toBe(false);
    expect(sha256Hex(actual.readFileSync(stored.path))).toBe(applied.backupRef!.sha256);
    const projectBefore = treeSnapshot(root);
    const outsideBefore = treeSnapshot(outside);
    const outcome = await attemptRollback(root, applied.backupRef!, backupRoot);
    expect.soft(treeSnapshot(root), '链接祖先下的有效备份不得授权目标写入').toEqual(projectBefore);
    expect.soft(treeSnapshot(outside), '外部备份字节与目录保持不变').toEqual(outsideBefore);
    expectBackupInvalid(outcome);
  });

  it('创建备份前拒绝上层 junction：缺失的普通子目录不得先在外部创建', async () => {
    // 捕获 recursive mkdir 先于父链身份检查，或只检查新建 backupRoot 的错误。
    const root = vuePnpmLockedProject('review-backup-ancestor-create');
    const container = externalRoot('review-backup-ancestor-create-container');
    const outside = externalRoot('review-backup-ancestor-create-outside');
    const parent = path.join(container, 'linked-parent');
    linkDirectory(parent, outside);
    const backupRoot = path.join(parent, 'missing-store');
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    expect(actual.lstatSync(parent).isSymbolicLink()).toBe(true);
    expect(actual.existsSync(backupRoot)).toBe(false);
    const plan = await buildPlan(root, ['node-1']);
    processes.dependencies = plan.exactDependencies;
    const projectBefore = treeSnapshot(root);
    const outsideBefore = treeSnapshot(outside);
    let result: IntegrationApplyResultV1 | undefined;
    let thrown: unknown;
    try {
      result = await callApply(exports, root, plan, {
        ...planOptions(), backupRoot, authorization: authorizationFor(root, plan),
      });
    } catch (error) { thrown = error; }
    expect.soft(treeSnapshot(root), '不可信备份父链必须在首份目标写入前拒绝').toEqual(projectBefore);
    expect.soft(treeSnapshot(outside), '拒绝前不得沿 junction 创建备份目录或文件').toEqual(outsideBefore);
    expect(materializationCalls(processes)).toHaveLength(0);
    if (thrown !== undefined) {
      expect(errorText(thrown)).toMatch(/BACKUP_INVALID|PATH_UNSAFE/);
      expectSanitized(thrown);
    } else {
      expect(result).toBeDefined();
      expect(result!.status).toBe('blocked');
      expect(result!.changedFiles).toEqual([]);
      expect(result!.installState).toBe('not-run');
      expect(result!.issues.some(issue => ['BACKUP_INVALID', 'PATH_UNSAFE'].includes(issue.code))).toBe(true);
    }
  });

  it.each(['latest-hardlink', 'operation-junction', 'root-junction'] as const)('备份路径 %s 保留有效摘要仍须拒绝，目标与外部证据零改动', async kind => {
    // 捕获缺失的备份路径身份核验；摘要正确不能授权沿链接读取恢复证据。
    const root = vuePnpmLockedProject('review-backup-path-identity');
    const backupRoot = externalRoot('review-backup-path-identity-store');
    const outside = externalRoot('review-backup-path-identity-outside');
    const { applied } = await applyForRollback(root, ['node-1'], backupRoot);
    const stored = storedBackup(backupRoot, applied.backupRef!);
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    const operation = path.dirname(path.dirname(stored.path));
    const latest = path.join(operation, 'latest.json');
    if (kind === 'latest-hardlink') {
      const source = path.join(outside, 'latest.json');
      actual.writeFileSync(source, actual.readFileSync(latest));
      actual.unlinkSync(latest);
      actual.linkSync(source, latest);
      expect(actual.lstatSync(latest).nlink).toBeGreaterThan(1);
    } else {
      const original = kind === 'operation-junction' ? operation : backupRoot;
      const moved = path.join(outside, 'moved-backup');
      actual.renameSync(original, moved);
      linkDirectory(original, moved);
      expect(actual.lstatSync(original).isSymbolicLink()).toBe(true);
    }
    expect(sha256Hex(actual.readFileSync(stored.path))).toBe(applied.backupRef!.sha256);
    const expected = treeSnapshot(root);
    const outsideExpected = treeSnapshot(outside);
    const outcome = await attemptRollback(root, applied.backupRef!, backupRoot);
    expectRefused(outcome, ['BACKUP_INVALID', 'PATH_UNSAFE']);
    expect(treeSnapshot(root)).toEqual(expected);
    expect(treeSnapshot(outside)).toEqual(outsideExpected);
  });

  it.each(['hardlink', 'junction-parent'] as const)('备份版本路径为 %s 且摘要仍有效：拒绝并保持目标字节', async kind => {
    const root = vuePnpmLockedProject('review-backup-linked-version');
    const backupRoot = externalRoot('review-backup-linked-version-store');
    const outside = externalRoot('review-backup-linked-version-outside');
    const { applied } = await applyForRollback(root, ['node-1'], backupRoot);
    const stored = storedBackup(backupRoot, applied.backupRef!);
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    let source = path.join(outside, 'backup-version.json');
    const bytes = actual.readFileSync(stored.path);
    if (kind === 'hardlink') {
      actual.writeFileSync(source, bytes);
      actual.unlinkSync(stored.path);
      actual.linkSync(source, stored.path);
    } else {
      const versions = path.dirname(stored.path);
      const movedVersions = path.join(outside, 'versions');
      actual.renameSync(versions, movedVersions);
      linkDirectory(versions, movedVersions);
      source = path.join(movedVersions, path.basename(stored.path));
      expect(actual.lstatSync(versions).isSymbolicLink()).toBe(true);
    }
    expect(sha256Hex(actual.readFileSync(stored.path))).toBe(applied.backupRef!.sha256);
    if (kind === 'hardlink') expect(actual.lstatSync(stored.path).nlink).toBeGreaterThan(1);
    const before = treeSnapshot(root);
    const outcome = await attemptRollback(root, applied.backupRef!, backupRoot);
    expectRefused(outcome, ['BACKUP_INVALID', 'PATH_UNSAFE']);
    expect(treeSnapshot(root), '有效摘要不能使链接备份成为可信恢复输入').toEqual(before);
    expect(actual.readFileSync(source)).toEqual(bytes);
  });
  it('真实布局的合法派生备份可达：空原字节恢复为存在的零字节文件', async () => {
    const root = vuePnpmLockedProject('rollback-empty-original');
    const backupRoot = externalRoot('rollback-empty-original-store');
    const { plan, applied } = await applyForRollback(root, ['node-1'], backupRoot);
    const reference = derivedBackup(backupRoot, applied.backupRef!, document => {
      const entry = backupEntry(document, GENERATED_VUE_PATH);
      entry.before = { path: GENERATED_VUE_PATH, exists: true, sha256: sha256Hex(Buffer.alloc(0)) };
      entry.originalBase64 = '';
    });
    const { result, thrown } = await attemptRollback(root, reference, backupRoot);
    expect(thrown, '合法自包含 fixture 必须通过真实索引读取').toBeUndefined();
    expect(result!.status).toBe('rolled-back');
    expectCoverage(result!, plan.allowedPaths);
    expect(result!.restoredPaths).toContain(GENERATED_VUE_PATH);
    expect(fileExists(root, GENERATED_VUE_PATH)).toBe(true);
    expect(readBytes(root, GENERATED_VUE_PATH)).toEqual(Buffer.alloc(0));
  });

  const corruptions: [string, (document: BackupDocument) => void][] = [
    ['原字节与 before 摘要不符', document => {
      const entry = backupEntry(document, GENERATED_VUE_PATH);
      entry.before = { path: GENERATED_VUE_PATH, exists: true, sha256: sha256Hex(Buffer.alloc(0)) };
      entry.originalBase64 = Buffer.from('not empty').toString('base64');
    }],
    ['root 与调用不符', document => { document.projectRoot += '-different-root'; }],
    ['operationId 与真实引用不符', document => { document.operationId += '-different-id'; }],
    ['planDigest 格式非法', document => { document.planDigest = 'invalid-plan-digest'; }],
  ];
  it.each(corruptions)('引用与版本字节摘要一致时仍独立拒绝：%s', async (_label, change) => {
    const root = vuePnpmLockedProject('rollback-field-binding');
    const backupRoot = externalRoot('rollback-field-binding-store');
    const { applied } = await applyForRollback(root, ['node-1'], backupRoot);
    const expected = treeSnapshot(root);
    const reference = derivedBackup(backupRoot, applied.backupRef!, change);
    const outcome = await attemptRollback(root, reference, backupRoot);
    expectBackupInvalid(outcome);
    expect(treeSnapshot(root)).toEqual(expected);
  });

  it('latest 的 schemaVersion 不受支持：拒绝恢复且目标零写入', async () => {
    const root = vuePnpmLockedProject('rollback-journal-version');
    const backupRoot = externalRoot('rollback-journal-version-store');
    const { applied } = await applyForRollback(root, ['node-1'], backupRoot);
    const stored = storedBackup(backupRoot, applied.backupRef!);
    const journalPath = path.join(path.dirname(path.dirname(stored.path)), 'latest.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as Record<string, unknown>;
    expect(journal['schemaVersion']).toBe(1);
    expect(journal['sha256']).toBe(stored.sha256);
    const expected = treeSnapshot(root);
    fs.writeFileSync(journalPath, JSON.stringify({ ...journal, schemaVersion: 999 }) + '\n');
    expectBackupInvalid(await attemptRollback(root, applied.backupRef!, backupRoot));
    expect(treeSnapshot(root)).toEqual(expected);
  });

  it('备份字节被篡改（引用摘要不再匹配）：抛 BACKUP_INVALID，目标零改动且异常脱敏', async () => {
    const root = vuePnpmLockedProject('rollback-tampered-bytes');
    const backupRoot = externalRoot('rollback-tampered-bytes-backup');
    const { applied } = await applyForRollback(root, ['node-1'], backupRoot);
    const expected = treeSnapshot(root);
    const stored = storedBackup(backupRoot, applied.backupRef!);
    fs.appendFileSync(stored.path, '\n');

    const outcome = await attemptRollback(root, applied.backupRef!, backupRoot);

    expectBackupInvalid(outcome);
    expect(treeSnapshot(root), '拒绝不可信备份不得改动目标').toEqual(expected);
  });

  it('备份不是合法 JSON：抛 BACKUP_INVALID，不得编造 rollback 对象', async () => {
    const root = vuePnpmLockedProject('rollback-corrupt-json');
    const backupRoot = externalRoot('rollback-corrupt-json-backup');
    const { applied } = await applyForRollback(root, ['node-1'], backupRoot);
    const expected = treeSnapshot(root);
    const stored = storedBackup(backupRoot, applied.backupRef!);
    fs.writeFileSync(stored.path, '{ this is not json', 'utf8');

    const outcome = await attemptRollback(root, applied.backupRef!, backupRoot);

    expectBackupInvalid(outcome);
    expect(treeSnapshot(root), '拒绝损坏备份不得改动目标').toEqual(expected);
  });





  it('跨 root 调用（root 与备份绑定不符）：拒绝，且不改动任何工程', async () => {
    const root = vuePnpmLockedProject('rollback-cross-root');
    const other = vuePnpmLockedProject('rollback-cross-root-other');
    const backupRoot = externalRoot('rollback-cross-root-backup');
    const { applied } = await applyForRollback(root, ['node-1'], backupRoot);
    const expected = treeSnapshot(root);
    const otherExpected = treeSnapshot(other);

    const outcome = await attemptRollback(other, applied.backupRef!, backupRoot);

    expectRefused(outcome, ['BACKUP_INVALID', 'AUTHORIZATION_MISMATCH', 'INVALID_PLAN', 'PROJECT_CHANGED']);
    expect(treeSnapshot(root), '不得改动备份绑定的工程').toEqual(expected);
    expect(treeSnapshot(other), '不得改动被传入的工程').toEqual(otherExpected);
  });

  it('目标文件是硬链接：必须产生实质恢复结果，且不得顺着链接改写工程外字节', async () => {
    const root = vuePnpmNewDependencyProject('rollback-hardlink');
    const outside = externalRoot('rollback-hardlink-outside');
    const backupRoot = externalRoot('rollback-hardlink-backup');
    const originalManifest = readText(root, 'package.json');
    const { plan, applied } = await applyForRollback(root, ['node-1'], backupRoot);
    const outsideFile = projectFile(outside, 'outside-manifest.txt');
    fs.writeFileSync(outsideFile, 'OUTSIDE SECRET\n', 'utf8');
    hardLinkFile(projectFile(root, 'package.json'), outsideFile);

    const { result, thrown } = await attemptRollback(root, applied.backupRef!, backupRoot);

    // 必须产生实质结果：抛固定脱敏错误，或返回结构化 rollback 结果（不得因缺能力而空过）。
    if (thrown !== undefined) {
      expectSanitized(thrown);
      expect(errorText(thrown).length, '拒绝必须给出可识别原因').toBeGreaterThan(0);
    } else {
      expect(result, capabilityNote(exports, 'rollbackIntegration')).toBeDefined();
      expect(['rolled-back', 'recovery-required'], '必须返回结构化恢复结果').toContain(result!.status);
      expectCoverage(result!, plan.allowedPaths);
      if (result!.status === 'rolled-back') {
        // 只有安全替换（新 inode）后才能声称已恢复；就地写穿会把工程外字节一起改掉。
        expect(readText(root, 'package.json'), '安全替换后才能声称已恢复').toBe(originalManifest);
      } else {
        expect(result!.unresolvedPaths.length + result!.preservedPaths.length, 'recovery-required 必须给出未解决或保留路径').toBeGreaterThan(0);
      }
    }
    expect(readText(outside, 'outside-manifest.txt'), '恢复不得改写工程外字节').toBe('OUTSIDE SECRET\n');
  });

  it('生成组件的父目录被换成指向工程外的 junction：必须产生实质结果，且工程外零改动', async () => {
    const root = vuePnpmLockedProject('rollback-junction');
    const outside = externalRoot('rollback-junction-outside');
    const backupRoot = externalRoot('rollback-junction-backup');
    const { plan, applied } = await applyForRollback(root, ['node-1'], backupRoot);
    const expected = treeSnapshot(root);
    fs.writeFileSync(projectFile(outside, 'decoy.txt'), 'OUTSIDE DECOY\n', 'utf8');
    const outsideExpected = treeSnapshot(outside);
    fs.rmSync(projectFile(root, 'src/components/zhinexus'), { recursive: true, force: true });
    linkDirectory(projectFile(root, 'src/components/zhinexus'), outside);

    const { result, thrown } = await attemptRollback(root, applied.backupRef!, backupRoot);

    // 必须产生实质结果：抛固定脱敏错误，或返回结构化 rollback 结果（不得因缺能力而空过）。
    if (thrown !== undefined) {
      expectSanitized(thrown);
      expect(errorText(thrown).length, '拒绝必须给出可识别原因').toBeGreaterThan(0);
    } else {
      expect(result, capabilityNote(exports, 'rollbackIntegration')).toBeDefined();
      expect(['rolled-back', 'recovery-required'], '必须返回结构化恢复结果').toContain(result!.status);
      expectCoverage(result!, plan.allowedPaths);
      if (result!.status === 'recovery-required') {
        expect(result!.unresolvedPaths, '经链接逃逸的候选必须显式未解决').toContain(GENERATED_VUE_PATH);
      } else {
        // 即便声称 rolled-back，也不得删掉用户的链接或在链接目标里写任何东西。
        expect(fs.lstatSync(projectFile(root, 'src/components/zhinexus')).isSymbolicLink(), '不得删除用户放置的链接').toBe(true);
      }
    }
    expect(treeSnapshot(outside), '不得读写工程外目录').toEqual(outsideExpected);
    // 除链接替换本身外不得改动工程（恢复既不能删用户链接，也不能写进链接目标）。
    expect(treeDifferences(expected, treeSnapshot(root)).filter(difference => !difference.includes('zhinexus'))).toEqual([]);
  });
});
