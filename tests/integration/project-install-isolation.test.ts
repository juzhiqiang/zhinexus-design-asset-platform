/**
 * T16 B / P1 产品失败测试：安装隔离（暂存进程边界与依赖目录交付）。
 *
 * 依据 docs/superpowers/plans/2026-11-18-t16-b-install-isolation-brief.md 的 12 组要求中属于安装隔离的部分：
 * ⑦ 暂存进程 cwd、argv、环境与复制字段白名单；恶意 .npmrc/pnpmfile/环境 NODE_OPTIONS/scripts 无执行；
 *    npm API token 不在 registry/config/env，registry token 不在 API 或原始错误输出；
 * ⑧ 冻结锁不符、实际安装版本不符、stage 外链接、未知目标依赖链接、并发 node_modules 变化：失败关闭，
 *    不能 applied；目录交付只落在明确安装范围，不运行项目 build。
 * 另覆盖“所有包管理器进程必须仅在工程外 staging”“源码 rollback 不恢复 node_modules”
 * “影响解析且尚未支持的配置须 DEPENDENCY_CONFLICT 阻断”。
 *
 * 边界：
 * - 包管理器进程与文件系统故障都由**测试私有 module mock** 注入，不向公开 options 注入任何 runner；
 * - 物化过程由 mock 生成**受控包树**（真实目录 + 真实 package.json/入口文件），不用文本 bytes 冒充 tarball；
 * - 正式 Windows 真实 npm/pnpm 进程验收仍由宿主 C 执行；本文件只冻结可观察要求。
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
import { parse as parseYaml } from 'yaml';
import { stringify as stringifyYaml } from 'yaml';
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
} from './t16-support/cli-namespace.js';
import {
  ECHARTS_VERSION,
  PACKAGE_VERSION,
  VUE_FRAMEWORK_VERSION,
  VUE_PACKAGE_NAME,
  externalRoot,
  fileExists,
  linkDirectory,
  readText,
  releaseSyntheticDirs,
  sha256Hex,
  tarballSha256,
  treeDifferences,
  treeSnapshot,
  vueNpmNewDependencyProject,
  vuePnpmNewDependencyProject,
  vuePnpmWorkspaceNewDependencyProject,
  writeFiles,
} from './t16-support/synthetic-projects.js';
import {
  SYNTHETIC_API_TOKEN,
  SYNTHETIC_REGISTRY_TOKEN,
  authorizationHeaders,
  requestsTo,
  startSyntheticNetwork,
  type SyntheticNetwork,
} from './t16-support/loopback-services.js';
import {
  candidateLockCalls,
  describeCall,
  installProcessInterceptor,
  isOutsideProject,
  materializationCalls,
  packageManagerCalls,
  sameVolume,
  type ProcessRecorderState,
  type RecordedProcessCall,
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

const HOSTILE_ENV: Record<string, string> = {
  NODE_OPTIONS: '--require /tmp/t16-evil-hook.js',
  NODE_PATH: '/tmp/t16-evil-modules',
  PNPM_HOME: '/tmp/t16-evil-pnpm',
  COREPACK_ENABLE_STRICT: '0',
  COREPACK_ROOT: '/tmp/t16-evil-corepack',
  PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS: 'true',
  npm_config_registry: 'https://attacker.example.invalid/',
  npm_config_userconfig: '/tmp/t16-evil-user.npmrc',
  npm_config_globalconfig: '/tmp/t16-evil-global.npmrc',
  'npm_config_//attacker.example.invalid/:_authToken': 'evil-registry-token',
  HTTP_PROXY: 'http://attacker.example.invalid:8080',
  HTTPS_PROXY: 'http://attacker.example.invalid:8080',
  http_proxy: 'http://attacker.example.invalid:8080',
  https_proxy: 'http://attacker.example.invalid:8080',
  NODE_EXTRA_CA_CERTS: '/tmp/t16-evil-ca.pem',
  NODE_TLS_REJECT_UNAUTHORIZED: '0',
  COMPANY_API_TOKEN: SYNTHETIC_API_TOKEN,
  COMPANY_REGISTRY_TOKEN: SYNTHETIC_REGISTRY_TOKEN,
};

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

function matchPlan(packageManager: 'npm' | 'pnpm'): MatchPlanV1 {
  const target = vueTarget() as MatchPlanV1['elements'][number]['target'];
  return {
    schemaVersion: 1, source: 'design-id', inputDigest: 'a'.repeat(64), ruleSetId: 'library', revision: 'draft-1',
    context: { framework: 'vue', frameworkVersion: VUE_FRAMEWORK_VERSION, echartsVersion: ECHARTS_VERSION, packageManager, requirements: [] },
    elements: [{
      instanceId: 'node-1', designId: '设计/Line', status: 'mapped', target,
      props: [
        { name: 'data', type: 'ChartData', required: true, source: 'sales' },
        { name: 'config', type: 'LineChartConfig', required: false },
      ],
      events: [{ name: 'point-click', payload: 'ChartEvent', handler: 'showDetail' }],
      layout: 'grid cell 1',
      gaps: [],
    }],
    exactDependencies: VUE_DEPENDENCIES.map(dependency => ({ ...dependency })),
    gaps: [],
  };
}

function planOptions(overrides?: { workspace?: string }): PlanOptions {
  return {
    apiUrl: network.apiOrigin, registryUrl: network.registryOrigin,
    apiToken: network.apiToken, registryToken: network.registryToken, requestTimeoutMs: 15000,
    ...(overrides?.workspace !== undefined ? { workspace: overrides.workspace } : {}),
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

async function buildPlan(root: string, packageManager: 'npm' | 'pnpm', workspace?: string): Promise<IntegrationPlanV1> {
  const source = matchPlan(packageManager);
  expect(validateMatchPlan(source).ok, '夹具源 MatchPlan 必须结构合法').toBe(true);
  network.apiResponder = query => ({
    schemaVersion: 1, query, status: 'matched', target: vueTarget(),
    api: {
      schemaVersion: 1, componentId: 'line', framework: 'vue', exportName: 'LineChart', exportPath: './line',
      props: [{ name: 'data', type: 'ChartData', required: true }, { name: 'config', type: 'LineChartConfig', required: false }],
      events: [{ name: 'point-click', payload: 'ChartEvent' }], styleExport: './style.css', readyMethod: 'whenRendered', notes: [],
    },
    exactDependencies: VUE_DEPENDENCIES.map(dependency => ({ ...dependency })), gaps: [],
  });
  expect(validateComponentMatchResponse({
    schemaVersion: 1,
    query: { componentId: 'line', framework: 'vue', packageName: VUE_PACKAGE_NAME, packageVersion: PACKAGE_VERSION, frameworkVersion: VUE_FRAMEWORK_VERSION, echartsVersion: ECHARTS_VERSION },
    status: 'matched', target: vueTarget(),
    api: {
      schemaVersion: 1, componentId: 'line', framework: 'vue', exportName: 'LineChart', exportPath: './line',
      props: [{ name: 'data', type: 'ChartData', required: true }], events: [], styleExport: './style.css', readyMethod: 'whenRendered', notes: [],
    },
    exactDependencies: VUE_DEPENDENCIES.map(dependency => ({ ...dependency })), gaps: [],
  }).ok, '夹具权威响应必须结构合法').toBe(true);
  const plan = await planIntegration(root, source, planOptions(workspace !== undefined ? { workspace } : {}));
  expect(plan.status, `夹具必须产出 planned 计划（冲突：${plan.conflicts.map(c => c.code).join(',')}）`).toBe('planned');
  return plan;
}

/** 识别目标工程真实包管理器，避免夹具上下文与工程不符造成 MATCH_CONTEXT_MISMATCH。 */
function packageManagerOf(root: string): 'npm' | 'pnpm' {
  return fs.existsSync(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm' : 'npm';
}

async function attemptApply(
  root: string,
  plan: IntegrationPlanV1,
  backupRoot: string,
  options?: { workspace?: string },
): Promise<{ result?: IntegrationApplyResultV1; thrown?: unknown }> {
  const applyOptions: IntegrationApplyOptions = {
    apiUrl: network.apiOrigin, registryUrl: network.registryOrigin,
    apiToken: network.apiToken, registryToken: network.registryToken, requestTimeoutMs: 15000,
    backupRoot, authorization: authorizationFor(root, plan),
    ...(options?.workspace !== undefined ? { workspace: options.workspace } : {}),
  };
  try {
    return { result: await callApply(exports, root, plan, applyOptions) };
  } catch (error) {
    return { thrown: error };
  }
}

// ─── 固定 argv 形状（brief 冻结表） ───

type ExpectedShape = { tool: 'npm' | 'pnpm'; step: 'candidate-lock' | 'materialization'; positionals: string[]; flags: string[] };

const EXPECTED_SHAPES: ExpectedShape[] = [
  { tool: 'npm', step: 'candidate-lock', positionals: ['install'], flags: ['--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', '--registry', '--userconfig', '--globalconfig', '--cache'] },
  { tool: 'npm', step: 'materialization', positionals: ['ci'], flags: ['--ignore-scripts', '--no-audit', '--no-fund', '--registry', '--userconfig', '--globalconfig', '--cache'] },
  { tool: 'pnpm', step: 'candidate-lock', positionals: ['install'], flags: ['--lockfile-only', '--no-frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile', '--registry', '--store-dir'] },
  { tool: 'pnpm', step: 'materialization', positionals: ['install'], flags: ['--frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile', '--registry', '--store-dir'] },
];

const toolRoot = path.resolve(import.meta.dirname, '../../.tools');
const nodeExe = path.join(toolRoot, 'node-v26.13.0-win-x64/node.exe');
const npmCli = path.join(toolRoot, 'node-v26.13.0-win-x64/node_modules/npm/bin/npm-cli.js');
const pnpmExe = path.join(toolRoot, 'pnpm-native-12.18.0/package/pnpm.exe');
function toolOf(call: RecordedProcessCall): 'npm' | 'pnpm' {
  expect(path.isAbsolute(call.command), '固定工具必须是绝对路径').toBe(true);
  if (path.resolve(call.command).toLowerCase() === pnpmExe.toLowerCase()) return 'pnpm';
  expect(path.resolve(call.command).toLowerCase()).toBe(nodeExe.toLowerCase());
  expect(call.args[0] && path.resolve(call.args[0]).toLowerCase(), 'npm-cli 必须在 launcher 后第一个参数').toBe(npmCli.toLowerCase());
  return 'npm';
}
function subcommandArgs(call: RecordedProcessCall): string[] { return toolOf(call) === 'npm' ? call.args.slice(1) : call.args; }
function parseArgv(args: readonly string[]): { positionals: string[]; flags: Map<string, string | undefined> } {
  const positionals: string[] = []; const flags = new Map<string, string | undefined>();
  const takesValue = new Set(['--registry', '--userconfig', '--globalconfig', '--cache', '--store-dir']);
  for (let i=0; i<args.length; i++) {
    const arg=args[i]!;
    if (!arg.startsWith('--')) { positionals.push(arg); continue; }
    const equals=arg.indexOf('='); const flag=equals<0 ? arg : arg.slice(0,equals);
    expect(flags.has(flag), '禁止重复参数').toBe(false);
    const value=equals>=0 ? arg.slice(equals+1) : takesValue.has(flag) ? args[++i] : undefined;
    flags.set(flag,value);
  }
  return { positionals, flags };
}

/** 所有执行必须明确 shell:false（参数数组，不走 shell）。 */
function expectNoShell(call: RecordedProcessCall): void {
  expect(call.shell, `必须显式 shell:false：${describeCall(call)}`).toBe(false);
}

function stepOf(call: RecordedProcessCall): ExpectedShape['step'] | undefined {
  if (call.args.some(arg => arg === '--package-lock-only' || arg === '--lockfile-only')) return 'candidate-lock';
  if (call.args.some(arg => arg === 'ci' || arg === '--frozen-lockfile')) return 'materialization';
  return undefined;
}

/** 安装相关调用（候选锁/冻结物化）；工具链 --version 探测单独核验，不走固定形状表。 */
function installCalls(): RecordedProcessCall[] {
  return packageManagerCalls(processes).filter(call => stepOf(call) !== undefined);
}

function shapeFor(call: RecordedProcessCall): ExpectedShape {
  const tool = toolOf(call);
  const step = stepOf(call);
  const shape = EXPECTED_SHAPES.find(candidate => candidate.tool === tool && candidate.step === step);
  expect(shape, `包管理器调用必须命中固定 argv 形状之一：${describeCall(call)}`).toBeDefined();
  return shape!;
}

function expectFixedShape(call: RecordedProcessCall, projectRoot: string): void {
  const shape = shapeFor(call);
  const parsed = parseArgv(subcommandArgs(call));
  expect(parsed.positionals, `位置参数必须固定：${describeCall(call)}`).toEqual(shape.positionals);
  expect([...parsed.flags.keys()], `旗标必须逐个固定：${describeCall(call)}`).toEqual(shape.flags);
  expect(parsed.flags.get('--registry'), 'registry 必须是本地 loopback origin').toBe(network.registryOrigin);
  expect(call.cwd, '包管理器 cwd 必填').toBeDefined();
  expect(isOutsideProject(call.cwd, projectRoot), `cwd 必须位于工程外 staging：${describeCall(call)}`).toBe(true);
  expect(sameVolume(call.cwd!, projectRoot), 'staging 必须与目标同卷').toBe(true);
  expectNoShell(call);
  expectEnvWhitelist(call, projectRoot);
  expectIsolatedUserConfig(call);
  expectStagingClean(call.cwd!, projectRoot);
  for (const [flag, value] of parsed.flags) {
    if (!['--userconfig', '--globalconfig', '--cache', '--store-dir'].includes(flag)) continue;
    expect(value, `${flag} 必须是隔离绝对路径`).toBeDefined();
    expect(path.isAbsolute(value!), `${flag} 必须是绝对路径`).toBe(true);
    expect(isOutsideProject(value!, projectRoot), `${flag} 必须位于工程外`).toBe(true);
  }
}

/** 键和值都检查，不继承任意宿主环境。 */
function expectEnvWhitelist(call: RecordedProcessCall, projectRoot: string): void {
  const env = new Map(Object.entries(call.env).filter(([,v]) => v !== undefined).map(([k,v]) => [k.toLowerCase(), v!]));
  const windows = ['systemroot', 'windir', 'comspec', 'pathext'];
  const dirs = ['tmp', 'temp', 'userprofile', 'home', 'appdata', 'localappdata'];
  const configs = ['npm_config_userconfig', 'npm_config_globalconfig', 'pnpm_config_manage_package_manager_versions'];
  const allowed = new Set([...windows, ...dirs, ...configs, 'path', 'ci', 'no_color']);
  for (const key of env.keys()) expect(allowed.has(key), '非白名单环境键：'+key).toBe(true);
  expect(env.get('ci')).toBe('true'); expect(env.get('no_color')).toBe('1');
  expect(env.get('pnpm_config_manage_package_manager_versions')).toBe('false');
  for (const key of windows) {
    const host = Object.entries(process.env).find(([k]) => k.toLowerCase() === key)?.[1];
    if (host !== undefined) expect(env.get(key)).toBe(host);
  }
  const allowedTools = [path.dirname(nodeExe), path.dirname(pnpmExe), path.join(toolRoot, 'bin')].map(p=>p.toLowerCase());
  expect(env.get('path'), '必须构造固定工具 PATH').toBeDefined();
  for (const p of env.get('path')!.split(path.delimiter)) expect(allowedTools).toContain(path.resolve(p).toLowerCase());
  for (const key of [...dirs, 'npm_config_userconfig', 'npm_config_globalconfig']) if (env.has(key)) {
    expect(path.isAbsolute(env.get(key)!)).toBe(true); expect(isOutsideProject(env.get(key), projectRoot)).toBe(true);
  }
  expect(JSON.stringify(call.env)).not.toContain(SYNTHETIC_API_TOKEN);
  expect(JSON.stringify(call.env)).not.toContain(SYNTHETIC_REGISTRY_TOKEN);
}
function capturedFiles(call: RecordedProcessCall): Record<string,string> {
  expect(call.files, '必须留存进程启动时 staging 字节').toBeDefined(); return call.files!;
}
function expectStagingClean(cwd: string, projectRoot: string): void {
  const calls = installCalls().filter(c=>c.cwd === cwd);
  expect(calls.length, '必须有真实 staging 启动记录').toBeGreaterThan(0);
  const manifestKeys = new Set(['name','version','private','type','dependencies','devDependencies','peerDependencies','optionalDependencies','engines','workspaces']);
  const settings = { nodeLinker:'hoisted', packageImportMethod:'copy', enableGlobalVirtualStore:false, strictPeerDependencies:true, engineStrict:true, pmOnFail:'error', ignoreScripts:true, ignorePnpmfile:true };
  for (const call of calls) {
    const files=capturedFiles(call);
    expect(files[path.join(cwd,'package.json')], 'staging 根 manifest 必须在启动前存在').toBeDefined();
    expect(files[path.join(cwd,'.t16-owner.json')], 'stage 根必须存在本次操作的所有权标记').toBeDefined();
    if (toolOf(call) === 'pnpm') expect(files[path.join(cwd,'pnpm-workspace.yaml')], '每次 pnpm 启动必须存在固定隔离设置 YAML').toBeDefined();
    for (const [absolute,text] of Object.entries(files)) {
      expect(text).not.toContain(SYNTHETIC_API_TOKEN);
      if (!absolute.startsWith(cwd+path.sep)) continue; // 外部隔离配置单独精确检查。
      const relative=path.relative(cwd,absolute).split(path.sep).join('/');
      expect(/^(?:package.json|package-lock.json|pnpm-lock.yaml|pnpm-workspace.yaml|apps\/web\/package.json|\.t16-owner\.json)$/.test(relative), 'staging 文件白名单：'+relative).toBe(true);
      if (relative === '.t16-owner.json') {
        // 产品外部目录所有权标记：只放行 stage 根上这一确切名称，且必须是本次操作的
        // 精确标记（固定 kind/role、字节形态 canonical JSON、operationId 绑定本 staging
        // cwd 末尾），且不含两种 synthetic token——任意点文件/任意 JSON 不得放行。
        const marker=JSON.parse(text) as Record<string,unknown>;
        expect(marker !== null && typeof marker === 'object' && !Array.isArray(marker), '所有权标记必须是 JSON 对象').toBe(true);
        expect(Object.keys(marker).sort(), '所有权标记键白名单').toEqual(['kind','operationId','role']);
        expect(marker.kind, '所有权标记 kind 必须固定').toBe('t16-external-root');
        expect(marker.role, '所有权标记 role 必须为 stage').toBe('stage');
        expect(typeof marker.operationId === 'string' && marker.operationId.length >= 12, '所有权标记 operationId 必须是合法字符串').toBe(true);
        expect(text, '所有权标记必须是精确 canonical JSON 字节').toBe(`${JSON.stringify({ kind:marker.kind, operationId:marker.operationId, role:marker.role }, null, 2)}\n`);
        expect(text).not.toContain(SYNTHETIC_REGISTRY_TOKEN);
        expect(path.basename(cwd).startsWith(`.t16-stage-${(marker.operationId as string).slice(-12)}-`), '所有权标记 operationId 必须绑定本 staging 目录').toBe(true);
        continue;
      }
      if (relative.endsWith('package.json')) {
        const manifest=JSON.parse(text) as Record<string,unknown>;
        for(const key of Object.keys(manifest)) expect(manifestKeys.has(key), 'manifest 字段白名单：'+key).toBe(true);
        expect(manifest.private).toBe(true);
        if (manifest.engines) for(const key of Object.keys(manifest.engines as object)) expect(['node','npm','pnpm']).toContain(key);
      }
      if(relative === 'pnpm-workspace.yaml') {
        const yaml=parseYaml(text) as Record<string,unknown>;
        for(const key of Object.keys(yaml)) expect(['packages',...Object.keys(settings)]).toContain(key);
        for(const [key,value] of Object.entries(settings)) expect(yaml[key], '固定 pnpm 设置：'+key).toBe(value);
        if(yaml.packages !== undefined) expect(yaml.packages).toEqual(['apps/web']);
      }
    }
  }
  expect(isOutsideProject(cwd,projectRoot)).toBe(true);
}
function expectIsolatedUserConfig(call: RecordedProcessCall): void {
  const parsed=parseArgv(subcommandArgs(call));
  const userconfig=parsed.flags.get('--userconfig') ?? call.env.npm_config_userconfig;
  const globalconfig=parsed.flags.get('--globalconfig') ?? call.env.npm_config_globalconfig;
  expect(userconfig, '必须有隔离 userconfig').toBeDefined(); expect(globalconfig).toBeDefined();
  const files=capturedFiles(call);
  expect(files[userconfig!], '启动前 userconfig 必须存在').toBeDefined(); expect(files[globalconfig!]).toBeDefined();
  const registry=new URL(network.registryOrigin);
  const key='//'+registry.host+registry.pathname+':_authToken';
  const lines=files[userconfig!]!.split(/\r?\n/).map(l=>l.trim()).filter(l=>l && !l.startsWith('#') && !l.startsWith(';'));
  expect(lines, '凭据只能绑定精确 registry host/path').toEqual([key+'='+SYNTHETIC_REGISTRY_TOKEN]);
  expect(files[globalconfig!]!.trim(), 'globalconfig 必须为空').toBe('');
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
  network.tarballProvider = (name, version) => Buffer.from(`synthetic tarball payload for ${name}@${version}\n`);
});

afterEach(() => {
  faults.disarm();
  expect(processes.fixtureErrors ?? [], '测试夹具不得以安装失败掩盖错误').toEqual([]);
  network.apiResponder = () => ({ schemaVersion: 1, status: 'gap', exactDependencies: [], gaps: [] });
});

describe('T16 C / 审查补测：安装结束的可信证据与凭据清理', () => {
  it('C24 env 认领后被未知普通树替换、stage 创建失败：不得回收用户 sentinel 树', async () => {
    const root = vuePnpmNewDependencyProject('review-env-replaced-before-context');
    const backupRoot = externalRoot('review-env-replaced-before-context-store');
    const holder = externalRoot('review-env-replaced-before-context-holder');
    const plan = await buildPlan(root, 'pnpm');
    processes.dependencies = plan.exactDependencies;
    const before = treeSnapshot(root);
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    const previous = fsFaults.intercept;
    const userBytes = Buffer.from('USER OWNED REPLACEMENT ENV SENTINEL\n');
    const savedEnv = path.join(holder, 'saved-env');
    let envRoot: string | undefined, sentinel: string | undefined, injected = false;
    let replacementBefore: Map<string, string> | undefined, savedBefore: Map<string, string> | undefined;
    fsFaults.intercept = (operation, paths, data) => {
      const stage = paths[0];
      if (!injected && operation === 'mkdir' && stage && path.basename(stage).startsWith('.t16-stage-')) {
        envRoot = path.join(path.dirname(stage), path.basename(stage).replace('.t16-stage-', '.t16-env-'));
        const claimed = actual.lstatSync(envRoot);
        expect(claimed.isDirectory() && !claimed.isSymbolicLink(), '先证明本次 env 已真实独占创建').toBe(true);
        actual.renameSync(envRoot, savedEnv);
        savedBefore = treeSnapshot(savedEnv);
        actual.mkdirSync(envRoot);
        actual.mkdirSync(path.join(envRoot, 'user-empty-dir'));
        sentinel = path.join(envRoot, 'user-sentinel.txt');
        actual.writeFileSync(sentinel, userBytes);
        expect(actual.existsSync(path.join(envRoot, '.t16-owner.json')), '替换树不伪造本次 owner marker').toBe(false);
        replacementBefore = treeSnapshot(envRoot);
        injected = true;
        return true; // 仅 stage 的真实 mkdir 一次 EACCES，进入 context 前回收出口。
      }
      return previous?.(operation, paths, data) ?? false;
    };
    try {
      const { result, thrown } = await attemptApply(root, plan, backupRoot);
      expect(injected, '必须在真实 env 创建后、stage mkdir 前完成普通树替换').toBe(true);
      expect(thrown).toBeUndefined();
      expect(actual.existsSync(sentinel!), '不能以路径历史认领授权删除替换的未知用户树').toBe(true);
      expect(actual.readFileSync(sentinel!)).toEqual(userBytes);
      expect(treeSnapshot(envRoot!)).toEqual(replacementBefore);
      expect(actual.lstatSync(savedEnv).isDirectory(), '移走的原 env 现场也须保留').toBe(true);
      expect(treeSnapshot(savedEnv)).toEqual(savedBefore);
      expect(treeSnapshot(root)).toEqual(before);
      expect(result?.status).toBe('blocked');
      expect(result?.changedFiles).toEqual([]);
      expect(result?.installState).toBe('not-run');
      expect(packageManagerCalls(processes)).toEqual([]);
    } finally { fsFaults.intercept = previous; }
  });

  it('C21 stage 创建窗口被未知普通树抢占：不得认领并删除用户 sentinel', async () => {
    const root = vuePnpmNewDependencyProject('review-stage-claim-window');
    const backupRoot = externalRoot('review-stage-claim-window-store');
    const plan = await buildPlan(root, 'pnpm');
    processes.dependencies = plan.exactDependencies;
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    const previous = fsFaults.intercept;
    const userBytes = Buffer.from('USER OWNED STAGE SENTINEL\n');
    let sentinel: string | undefined, injected = false, initiallyUnmarked = false;
    fsFaults.intercept = (operation, paths, data) => {
      const absolute = paths[0];
      if (!injected && operation === 'mkdir' && absolute && path.basename(absolute).startsWith('.t16-stage-')) {
        expect(actual.existsSync(absolute), '先前 exists 检查通过后才由其他进程抢占').toBe(false);
        actual.mkdirSync(absolute, { recursive: true });
        sentinel = path.join(absolute, 'user-sentinel.txt');
        actual.writeFileSync(sentinel, userBytes);
        initiallyUnmarked = !actual.existsSync(path.join(absolute, '.t16-owner.json'));
        injected = true;
      }
      return previous?.(operation, paths, data) ?? false;
    };
    try {
      const { result, thrown } = await attemptApply(root, plan, backupRoot);
      expect(injected && initiallyUnmarked, '必须在真实 mkdir 前抢占普通目录且不伪造 owner marker').toBe(true);
      expect(thrown).toBeUndefined();
      expect(actual.existsSync(sentinel!), '未知用户树不能被标记成本次目录再递归删除').toBe(true);
      expect(actual.readFileSync(sentinel!)).toEqual(userBytes);
      expect(result?.status).toBe('blocked');
      expect(materializationCalls(processes)).toEqual([]);
    } finally { fsFaults.intercept = previous; }
  });

  it.each(['fail', 'wrong-version'] as const)('物化结果为 %s：返回后本次临时凭据必须删除', async mode => {
    const root = vuePnpmNewDependencyProject('review-credentials-failure');
    const backupRoot = externalRoot('review-credentials-failure-backup');
    const plan = await buildPlan(root, 'pnpm');
    processes.dependencies = plan.exactDependencies;
    processes.materialization = mode;

    const { result, thrown } = await attemptApply(root, plan, backupRoot);
    expect(thrown).toBeUndefined();
    expect(materializationCalls(processes)).toHaveLength(1);
    expect(result!.status).not.toBe('applied');
    expect(result!.installState).toBe('reinstall-required');
    const credentialPaths = [...new Set(installCalls().flatMap(call =>
      Object.entries(call.files ?? {}).filter(([, bytes]) => bytes.includes(SYNTHETIC_REGISTRY_TOKEN)).map(([absolute]) => absolute)))];
    expect(credentialPaths.length, '启动前真实快照必须包含隔离 registry 凭据文件').toBeGreaterThan(0);
    // 仅输出路径存在性，断言日志不回显凭据字节。
    expect(credentialPaths.map(absolute => fs.existsSync(absolute)), '失败返回也必须安全删除本次临时凭据').toEqual(credentialPaths.map(() => false));
  });

  it('创建 globalconfig 失败：已落盘的隔离 userconfig 也必须清除', async () => {
    const root = vuePnpmNewDependencyProject('review-credentials-creation');
    const backupRoot = externalRoot('review-credentials-creation-backup');
    const plan = await buildPlan(root, 'pnpm');
    processes.dependencies = plan.exactDependencies;
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    const previous = fsFaults.intercept;
    let credentialPath: string | undefined;
    let credentialWasWritten = false;
    fsFaults.intercept = (operation, paths, data) => {
      const absolute = paths[0];
      if (operation === 'writeFile' && absolute && path.basename(absolute) === 'global-npmrc') {
        credentialPath = path.join(path.dirname(absolute), 'npmrc');
        credentialWasWritten = actual.readFileSync(credentialPath, 'utf8').includes(SYNTHETIC_REGISTRY_TOKEN);
        return true;
      }
      return previous?.(operation, paths, data) ?? false;
    };
    let outcome: Awaited<ReturnType<typeof attemptApply>>;
    try { outcome = await attemptApply(root, plan, backupRoot); }
    finally { fsFaults.intercept = previous; }
    expect(credentialWasWritten, '故障接点必须在真实 userconfig 写入之后').toBe(true);
    expect(credentialPath).toBeDefined();
    expect(installCalls(), '创建隔离环境失败不得启动安装').toEqual([]);
    expect(outcome!.result?.status).not.toBe('applied');
    expect(actual.existsSync(credentialPath!), 'context 未返回也不能遗留临时凭据').toBe(false);
  });

  it('依赖版本正确但 package name 被换：不得当作计划依赖交付', async () => {
    const root = vuePnpmNewDependencyProject('review-installed-name');
    const backupRoot = externalRoot('review-installed-name-backup');
    const plan = await buildPlan(root, 'pnpm');
    processes.dependencies = plan.exactDependencies;
    const previous = processes.intercept;
    let changed = false;
    processes.intercept = request => {
      const response = previous?.(request);
      if (request.args.includes('--frozen-lockfile') && request.cwd) {
        const manifestPath = path.join(request.cwd, 'node_modules', ...VUE_PACKAGE_NAME.split('/'), 'package.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        expect(manifest.name).toBe(VUE_PACKAGE_NAME);
        expect(manifest.version).toBe(PACKAGE_VERSION);
        manifest.name = 'synthetic-wrong-package';
        fs.writeFileSync(manifestPath, JSON.stringify(manifest));
        changed = true;
      }
      return response;
    };
    try {
      const { result, thrown } = await attemptApply(root, plan, backupRoot);
      expect(thrown).toBeUndefined();
      expect(changed, '必须改变已物化的真实 package.json，版本保持正确').toBe(true);
      expect(result!.status).not.toBe('applied');
      expect(fileExists(root, `node_modules/${VUE_PACKAGE_NAME}/package.json`)).toBe(false);
    } finally { processes.intercept = previous; }
  });

  it.each(['src/components/zhinexus/component-0001.vue', 'package.json', 'pnpm-lock.yaml'])('物化期间用户修改 %s：保留新字节且不能返回 applied', async relative => {
    const root = vuePnpmNewDependencyProject('review-final-hash');
    const backupRoot = externalRoot('review-final-hash-backup');
    const plan = await buildPlan(root, 'pnpm');
    processes.dependencies = plan.exactDependencies;
    expect(plan.allowedPaths).toContain(relative);
    const previous = processes.intercept;
    let newBytes: Buffer | undefined;
    processes.intercept = request => {
      const response = previous?.(request);
      if (request.args.includes('--frozen-lockfile') && request.cwd) {
        const absolute = path.join(root, relative);
        const existing = fs.readFileSync(absolute);
        newBytes = relative === 'package.json'
          ? Buffer.from(JSON.stringify({ ...JSON.parse(existing.toString()), userEditedDuringInstall: true }))
          : Buffer.concat([existing, Buffer.from('\n# synthetic user edit during install\n')]);
        fs.writeFileSync(absolute, newBytes);
      }
      return response;
    };
    try {
      const { result, thrown } = await attemptApply(root, plan, backupRoot);
      expect(thrown).toBeUndefined();
      expect(newBytes, '必须在真实物化接点修改已提交目标').toBeDefined();
      expect(fs.readFileSync(path.join(root, relative))).toEqual(newBytes);
      expect(result!.status, '安装尾部必须复核目标摘要，不能复用安装前 afterHashes').not.toBe('applied');
      expect(result!.installState).toBe('reinstall-required');
    } finally { processes.intercept = previous; }
  });
});

describe('T16 C / 审查补测：安装输入与既有依赖树', () => {
  it.each(['file:C:/synthetic-outside/package', 'git+https://example.invalid/repo.git', 'link:../outside', 'portal:../outside', 'patch:vue@3.5.45#./synthetic.patch', 'workspace:*'])('非目标成员声明 %s：候选锁前失败关闭', async specifier => {
    const root = vuePnpmWorkspaceNewDependencyProject('review-sibling-protocol', {
      'pnpm-workspace.yaml': 'packages:\n  - apps/web\n  - apps/aux\n',
      'apps/aux/package.json': JSON.stringify({ name: '@host/aux', version: '1.0.0', private: true, dependencies: { vue: specifier } }),
    });
    const backupRoot = externalRoot('review-sibling-protocol-backup');
    const plan = await buildPlan(root, 'pnpm', 'apps/web');
    processes.dependencies = plan.exactDependencies;
    const before = treeSnapshot(root);
    const { result, thrown } = await attemptApply(root, plan, backupRoot, { workspace: 'apps/web' });
    expect(thrown).toBeUndefined();
    expect(candidateLockCalls(processes), '全部暂存成员必须在包管理器进程前拒绝不支持的依赖协议').toEqual([]);
    expect(materializationCalls(processes)).toEqual([]);
    expect(result!.status).toBe('blocked');
    expect(result!.issues.map(issue => issue.code)).toContain('DEPENDENCY_CONFLICT');
    expect(treeSnapshot(root)).toEqual(before);
  });

  it.each(['integrity', 'origin'] as const)('候选锁 %s 偏离已验证 SDK：不启动物化，目标零改动', async field => {
    const root = vuePnpmNewDependencyProject('review-candidate-identity');
    const backupRoot = externalRoot('review-candidate-identity-backup');
    const plan = await buildPlan(root, 'pnpm');
    processes.dependencies = plan.exactDependencies;
    const evidence = plan.registryEvidence.find(entry => entry.name === VUE_PACKAGE_NAME);
    expect(evidence, '新增 SDK 必须有 T15 已核验发布证据').toBeDefined();
    const before = treeSnapshot(root);
    const previous = processes.intercept;
    let changed = false;
    processes.intercept = request => {
      const response = previous?.(request);
      if (request.args.includes('--lockfile-only') && request.cwd) {
        const absolute = path.join(request.cwd, 'pnpm-lock.yaml');
        const lock = parseYaml(fs.readFileSync(absolute, 'utf8'));
        const entry = lock.packages[`${VUE_PACKAGE_NAME}@${PACKAGE_VERSION}`];
        expect(entry.resolution.integrity).toBe(evidence!.integrity);
        if (field === 'integrity') entry.resolution.integrity = `sha512-${Buffer.alloc(64, 17).toString('base64')}`;
        else entry.resolution.tarball = 'https://synthetic-other-origin.invalid/changed.tgz';
        fs.writeFileSync(absolute, stringifyYaml(lock));
        changed = true;
      }
      return response;
    };
    try {
      const { result, thrown } = await attemptApply(root, plan, backupRoot);
      expect(thrown).toBeUndefined();
      expect(changed, '故障必须修改真实候选锁且先核对原身份').toBe(true);
      expect(materializationCalls(processes), '冻结物化前必须绑定已验证身份与 registry origin').toEqual([]);
      expect(result!.status).not.toBe('applied');
      expect(treeSnapshot(root)).toEqual(before);
    } finally { processes.intercept = previous; }
  });

  it('安全既有 node_modules：受守卫移动至仓外 quarantine 后交付新依赖树', async () => {
    const root = vuePnpmNewDependencyProject('review-existing-dependencies');
    const backupRoot = externalRoot('review-existing-dependencies-backup');
    const plan = await buildPlan(root, 'pnpm');
    processes.dependencies = plan.exactDependencies;
    writeFiles(root, {
      'node_modules/vue/package.json': JSON.stringify({ name: 'vue', version: VUE_FRAMEWORK_VERSION }),
      'node_modules/vue/dist/index.js': 'export const syntheticOldTree = true;\n',
    });
    const oldTree = path.join(root, 'node_modules');
    const oldSnapshot = treeSnapshot(oldTree);
    const previous = fsFaults.intercept;
    let quarantine: string | undefined;
    fsFaults.intercept = (operation, paths, data) => {
      if (operation === 'rename' && paths[0] === oldTree) quarantine = paths[1];
      return previous?.(operation, paths, data) ?? false;
    };
    try {
      const { result, thrown } = await attemptApply(root, plan, backupRoot);
      expect(thrown).toBeUndefined();
      expect(result!.status, '普通已安装工程属于已批准交付范围，不能在安装启动后无条件拒绝非空目录').toBe('applied');
      expect(quarantine, '必须受控 rename 保留旧树，不复制覆盖').toBeDefined();
      expect(isOutsideProject(quarantine, root)).toBe(true);
      expect(treeSnapshot(quarantine!)).toEqual(oldSnapshot);
      expect(fileExists(root, `node_modules/${VUE_PACKAGE_NAME}/package.json`)).toBe(true);
      expect(result!.installState).toBe('succeeded');
    } finally { fsFaults.intercept = previous; }
  });
});

describe('T16 C / 审查补测：目录交付日志与清理故障', () => {
  type DeliveryJournal = {
    schemaVersion: number; kind: string; operationId: string; projectRoot: string; planDigest: string;
    entries: { importer: string; target: string; hadOriginal: boolean; quarantine?: string; state: string }[];
  };
  const journalAt = (backupRoot: string, id: string): DeliveryJournal => {
    const absolute = path.join(backupRoot, id, 'install-delivery.json');
    const stat = fs.lstatSync(absolute);
    expect(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1).toBe(true);
    const text = fs.readFileSync(absolute, 'utf8');
    expect(text.includes(SYNTHETIC_API_TOKEN) || text.includes(SYNTHETIC_REGISTRY_TOKEN), '日志禁止包含令牌').toBe(false);
    return JSON.parse(text) as DeliveryJournal;
  };
  it('首次 ready 构建前出现未知普通用户树：保留其字节并停止目标交付', async () => {
    const root = vuePnpmNewDependencyProject('review-ready-unknown-tree');
    const backupRoot = externalRoot('review-ready-unknown-tree-backup');
    const plan = await buildPlan(root, 'pnpm'); processes.dependencies = plan.exactDependencies;
    const before = treeSnapshot(root), previous = processes.intercept;
    let unknownReady: string | undefined, unknownSnapshot: Map<string, string> | undefined;
    processes.intercept = request => {
      const response = previous?.(request);
      if (request.args.includes('--frozen-lockfile') && request.cwd && !unknownReady) {
        unknownReady = path.join(path.dirname(request.cwd), path.basename(request.cwd).replace('.t16-stage-', '.t16-ready-'));
        expect(unknownReady).not.toBe(request.cwd);
        writeFiles(unknownReady, { 'keep/user.txt': 'UNKNOWN READY USER BYTES\n' });
        unknownSnapshot = treeSnapshot(unknownReady);
      }
      return response;
    };
    try {
      const { result, thrown } = await attemptApply(root, plan, backupRoot);
      expect(thrown).toBeUndefined();
      expect(unknownReady, '必须在真实候选锁物化后、ready 初次构建前出现未知树').toBeDefined();
      expect(treeSnapshot(unknownReady!), 'ready 名称不能授权递归删除未知用户树').toEqual(unknownSnapshot);
      expect(result!.status).not.toBe('applied');
      expect(result!.installState).toBe('reinstall-required');
      expect(treeSnapshot(root)).toEqual(before);
    } finally { processes.intercept = previous; }
  });
  it('日志临时写入窗口备份根被祖先 junction 替换：不得沿链接改写外部证据', async () => {
    const root = vuePnpmNewDependencyProject('review-journal-ancestor-window');
    const backupRoot = externalRoot('review-journal-ancestor-window-backup');
    const outside = externalRoot('review-journal-ancestor-window-outside');
    const plan = await buildPlan(root, 'pnpm'); processes.dependencies = plan.exactDependencies;
    const before = treeSnapshot(root), previous = fsFaults.intercept;
    let swapped = false, saved: string | undefined, outsideBefore: Map<string, string> | undefined;
    let newTreeMoves = 0;
    fsFaults.intercept = (operation, paths, data) => {
      if (!swapped && operation === 'writeFile' && /^\.install-delivery-.+\.tmp$/.test(path.basename(paths[0] ?? ''))) {
        swapped = true;
        fs.cpSync(backupRoot, outside, { recursive: true });
        outsideBefore = treeSnapshot(outside);
        saved = `${backupRoot}-preserved`;
        fs.renameSync(backupRoot, saved);
        linkDirectory(backupRoot, outside);
      }
      if (operation === 'rename' && paths[1] === path.join(root, 'node_modules')) newTreeMoves++;
      return previous?.(operation, paths, data) ?? false;
    };
    try {
      const { result, thrown } = await attemptApply(root, plan, backupRoot);
      expect(swapped, '必须在祖先已核验、日志临时文件实际写入前交换真实目录与 junction').toBe(true);
      expect(treeSnapshot(outside), '既存合法备份字节不能授权沿新 junction 提交日志').toEqual(outsideBefore);
      expect(fs.lstatSync(saved!).isDirectory()).toBe(true);
      expect(thrown).toBeUndefined();
      expect(result!.status).toBe('rolled-back');
      expect(result!.installState).toBe('reinstall-required');
      expect(result!.issues.some(issue => issue.code === 'INSTALL_FAILED')).toBe(true);
      expect(treeSnapshot(root), '同次 apply 必须真实恢复源码，不能只返回失败状态').toEqual(before);
      expect(newTreeMoves).toBe(0);
    } finally { fsFaults.intercept = previous; }
  });
  it.each(['user-edit', 'restore-io'] as const)('日志窗口备份祖先被替换后 %s：保留源码现场并返回 recovery-required', async mode => {
    const root = vuePnpmNewDependencyProject(`review-hot-recovery-${mode}`);
    const backupRoot = externalRoot(`review-hot-recovery-${mode}-backup`);
    const outside = externalRoot(`review-hot-recovery-${mode}-outside`);
    const plan = await buildPlan(root, 'pnpm'); processes.dependencies = plan.exactDependencies;
    const generated = plan.changes.find(change => change.kind === 'generated-component')!;
    expect(generated, '夹具必须包含真实生成文件').toBeDefined();
    const generatedAbs = path.join(root, generated.path), before = treeSnapshot(root);
    const previous = fsFaults.intercept, userBytes = 'USER EDITED GENERATED SOURCE\n';
    let swapped = false, saved: string | undefined, outsideBefore: Map<string, string> | undefined;
    let sourceAtFailure: string | undefined, denied = false, newTreeMoves = 0;
    fsFaults.intercept = (operation, paths, data) => {
      if (!swapped && operation === 'writeFile' && /^\.install-delivery-.+\.tmp$/.test(path.basename(paths[0] ?? ''))) {
        sourceAtFailure = fs.readFileSync(generatedAbs, 'utf8');
        if (mode === 'user-edit') fs.writeFileSync(generatedAbs, userBytes);
        swapped = true;
        fs.cpSync(backupRoot, outside, { recursive: true });
        outsideBefore = treeSnapshot(outside);
        saved = `${backupRoot}-preserved`;
        fs.renameSync(backupRoot, saved);
        linkDirectory(backupRoot, outside);
      }
      if (swapped && mode === 'restore-io' && operation === 'rm' && paths[0] === generatedAbs) {
        denied = true; return true;
      }
      if (operation === 'rename' && paths[1] === path.join(root, 'node_modules')) newTreeMoves++;
      return previous?.(operation, paths, data) ?? false;
    };
    try {
      const { result, thrown } = await attemptApply(root, plan, backupRoot);
      expect(swapped, '必须在真实日志临时写入窗口替换备份祖先').toBe(true);
      expect(sourceAtFailure, '故障必须发生在生成源码已提交之后').toBeDefined();
      expect(treeSnapshot(outside), '热恢复不得穿 junction 读写外部证据').toEqual(outsideBefore);
      expect(fs.lstatSync(saved!).isDirectory()).toBe(true);
      expect(thrown).toBeUndefined();
      expect(result!.status).toBe('recovery-required');
      expect(result!.installState).toBe('reinstall-required');
      expect(result!.issues.some(issue => issue.code === 'INSTALL_FAILED')).toBe(true);
      expect(fs.readFileSync(generatedAbs, 'utf8')).toBe(mode === 'user-edit' ? userBytes : sourceAtFailure);
      const code = mode === 'user-edit' ? 'USER_EDITED' : 'WRITE_FAILED';
      expect(result!.issues.some(issue => issue.code === code && issue.path === generated.path)).toBe(true);
      expect(result!.issues.some(issue => issue.code === (mode === 'user-edit' ? 'WRITE_FAILED' : 'USER_EDITED') && issue.path === generated.path)).toBe(false);
      if (mode === 'restore-io') expect(denied, '必须真实命中生成源码删除的 I/O 故障').toBe(true);
      const after = treeSnapshot(root);
      for (const change of plan.changes) if (change.path !== generated.path) {
        expect(after.get(change.path), `其余源码应恢复原字节：${change.path}`).toBe(before.get(change.path));
      }
      expect(newTreeMoves).toBe(0);
    } finally { fsFaults.intercept = previous; }
  });
  it('后续日志提交窗口出现用户编辑：保留日志原字节，停止新依赖树交付', async () => {
    const root = vuePnpmNewDependencyProject('review-journal-user-edit-window');
    const backupRoot = externalRoot('review-journal-user-edit-window-backup');
    const plan = await buildPlan(root, 'pnpm'); processes.dependencies = plan.exactDependencies;
    writeFiles(root, { 'node_modules/vue/package.json': JSON.stringify({ name: 'vue', version: VUE_FRAMEWORK_VERSION }),
      'node_modules/vue/user.txt': 'original dependency bytes\n' });
    const oldTree = path.join(root, 'node_modules'), oldSnapshot = treeSnapshot(oldTree);
    const previous = fsFaults.intercept, userBytes = 'USER EDITED JOURNAL\n';
    let quarantine: string | undefined, editedJournal: string | undefined;
    let newTreeMoves = 0;
    fsFaults.intercept = (operation, paths, data) => {
      if (operation === 'rename' && paths[0] === oldTree) quarantine = paths[1];
      if (operation === 'writeFile' && quarantine && !editedJournal
        && /^\.install-delivery-.+\.tmp$/.test(path.basename(paths[0] ?? ''))) {
        editedJournal = path.join(path.dirname(paths[0]!), 'install-delivery.json');
        fs.writeFileSync(editedJournal, userBytes);
      }
      if (operation === 'rename' && paths[1] === oldTree) newTreeMoves++;
      return previous?.(operation, paths, data) ?? false;
    };
    try {
      const { result, thrown } = await attemptApply(root, plan, backupRoot);
      expect(thrown).toBeUndefined();
      expect(editedJournal, '必须在旧日志已核验、临时日志实际写入之前注入编辑').toBeDefined();
      expect(fs.readFileSync(editedJournal!, 'utf8'), '产品不得覆盖用户修改的日志字节').toBe(userBytes);
      expect(result!.status).not.toBe('applied');
      expect(result!.installState).toBe('reinstall-required');
      expect(newTreeMoves, '日志不能推进时不得继续新树交付').toBe(0);
      expect(treeSnapshot(quarantine!)).toEqual(oldSnapshot);
      expect(fs.existsSync(oldTree)).toBe(false);
    } finally { fsFaults.intercept = previous; }
  });
  it('成功清理窗口外部暂存目录被普通用户目录替换：不得递归删除未知树', async () => {
    const root = vuePnpmNewDependencyProject('review-cleanup-replaced-stage');
    const backupRoot = externalRoot('review-cleanup-replaced-stage-backup');
    const plan = await buildPlan(root, 'pnpm'); processes.dependencies = plan.exactDependencies;
    const userRoot = externalRoot('review-cleanup-replaced-stage-user');
    writeFiles(userRoot, { 'keep/user.txt': 'UNKNOWN USER TREE\n' });
    const userSnapshot = treeSnapshot(userRoot), previous = fsFaults.intercept;
    let replacedPath: string | undefined, savedPath: string | undefined;
    fsFaults.intercept = (operation, paths, data) => {
      if (operation === 'writeFile' && !replacedPath
        && /^\.install-delivery-.+\.tmp$/.test(path.basename(paths[0] ?? ''))
        && JSON.parse(String(data)).entries.every((entry: { state: string }) => entry.state === 'delivered')) {
        const call = materializationCalls(processes).at(-1);
        expect(call?.cwd).toBeDefined();
        replacedPath = call!.cwd!; savedPath = `${replacedPath}-preserved`;
        fs.renameSync(replacedPath, savedPath);
        fs.renameSync(userRoot, replacedPath);
      }
      return previous?.(operation, paths, data) ?? false;
    };
    try {
      const { result, thrown } = await attemptApply(root, plan, backupRoot);
      expect(thrown).toBeUndefined();
      expect(replacedPath, '必须在最终 delivered 日志写入窗口真实替换外部 stage').toBeDefined();
      expect(treeSnapshot(replacedPath!), '目录名前缀不能授权删除用户替换树').toEqual(userSnapshot);
      expect(fs.lstatSync(savedPath!).isDirectory(), '原始暂存证据应保留').toBe(true);
      expect(result!.status).not.toBe('applied');
      expect(result!.installState).toBe('reinstall-required');
    } finally { fsFaults.intercept = previous; }
  });
  it('首份交付日志持久化失败：不得移动任何目标依赖目录', async () => {
    const root = vuePnpmNewDependencyProject('review-initial-journal-failure');
    const backupRoot = externalRoot('review-initial-journal-failure-backup');
    const plan = await buildPlan(root, 'pnpm'); processes.dependencies = plan.exactDependencies;
    const before = treeSnapshot(root), previous = fsFaults.intercept;
    let denied = false;
    const dependencyMoves: string[] = [];
    fsFaults.intercept = (operation, paths, data) => {
      if (operation === 'rename' && path.basename(paths[1] ?? '') === 'install-delivery.json') {
        denied = true; return true;
      }
      if (operation === 'rename' && paths.some(absolute => absolute === path.join(root, 'node_modules'))) {
        dependencyMoves.push(paths.join(' -> '));
      }
      return previous?.(operation, paths, data) ?? false;
    };
    try {
      const { result, thrown } = await attemptApply(root, plan, backupRoot);
      expect(thrown).toBeUndefined();
      expect(denied, '必须真实命中 install-delivery.json 的原子提交失败').toBe(true);
      expect(result!.status).toBe('rolled-back');
      expect(result!.installState).toBe('reinstall-required');
      expect(dependencyMoves).toEqual([]);
      expect(treeSnapshot(root)).toEqual(before);
    } finally { fsFaults.intercept = previous; }
  });
  it('旧树移出后的日志更新失败：保留旧树与最后成功日志，停止新树交付', async () => {
    const root = vuePnpmNewDependencyProject('review-quarantine-journal-failure');
    const backupRoot = externalRoot('review-quarantine-journal-failure-backup');
    const plan = await buildPlan(root, 'pnpm'); processes.dependencies = plan.exactDependencies;
    writeFiles(root, { 'node_modules/vue/package.json': JSON.stringify({ name: 'vue', version: VUE_FRAMEWORK_VERSION }),
      'node_modules/vue/user.txt': 'original user bytes\n' });
    const oldTree = path.join(root, 'node_modules'), oldSnapshot = treeSnapshot(oldTree), before = treeSnapshot(root);
    const previous = fsFaults.intercept;
    let quarantine: string | undefined, denied = false, plannedBytes: string | undefined;
    fsFaults.intercept = (operation, paths, data) => {
      if (operation === 'rename' && paths[0] === oldTree) {
        quarantine = paths[1];
        const operations = fs.readdirSync(backupRoot, { withFileTypes: true }).filter(entry => entry.isDirectory());
        expect(operations).toHaveLength(1);
        plannedBytes = fs.readFileSync(path.join(backupRoot, operations[0]!.name, 'install-delivery.json'), 'utf8');
      }
      if (quarantine && operation === 'rename' && path.basename(paths[1] ?? '') === 'install-delivery.json') {
        denied = true; return true;
      }
      return previous?.(operation, paths, data) ?? false;
    };
    try {
      const { result, thrown } = await attemptApply(root, plan, backupRoot);
      expect(thrown).toBeUndefined();
      expect(denied, '必须真实命中旧树 rename 后的日志更新失败').toBe(true);
      expect(result!.status).toBe('rolled-back');
      expect(result!.installState).toBe('reinstall-required');
      expect(quarantine).toBeDefined();
      expect(treeSnapshot(quarantine!)).toEqual(oldSnapshot);
      expect(fs.existsSync(oldTree)).toBe(false);
      expect(fs.readFileSync(path.join(backupRoot, result!.operationId, 'install-delivery.json'), 'utf8')).toBe(plannedBytes);
      expect(journalAt(backupRoot, result!.operationId).entries).toEqual([
        { importer: '.', target: 'node_modules', hadOriginal: true, state: 'planned' },
      ]);
      for (const change of plan.changes) expect(treeSnapshot(root).get(change.path)).toBe(before.get(change.path));
    } finally { fsFaults.intercept = previous; }
  });
  it('workspace 第二目录交付失败：持久化逐目录现场，旧树 quarantine 与已交付树均保留', async () => {
    const root = vuePnpmWorkspaceNewDependencyProject('review-partial-delivery', {
      'pnpm-workspace.yaml': 'packages:\n  - apps/web\n  - apps/aux\n',
      'apps/aux/package.json': JSON.stringify({ name: '@host/aux', version: '1.0.0', private: true, dependencies: { vue: VUE_FRAMEWORK_VERSION } }),
    });
    const backupRoot = externalRoot('review-partial-delivery-backup');
    const plan = await buildPlan(root, 'pnpm', 'apps/web');
    processes.dependencies = plan.exactDependencies;
    writeFiles(root, {
      'node_modules/vue/package.json': JSON.stringify({ name: 'vue', version: VUE_FRAMEWORK_VERSION }),
      'node_modules/vue/old.txt': 'root original bytes\n',
      'apps/aux/node_modules/vue/package.json': JSON.stringify({ name: 'vue', version: VUE_FRAMEWORK_VERSION }),
      'apps/aux/node_modules/vue/old.txt': 'aux original bytes\n',
    });
    const oldTrees = new Map(['node_modules', 'apps/aux/node_modules'].map(relative => [relative, treeSnapshot(path.join(root, relative))]));
    const before = treeSnapshot(root);
    const previousProcess = processes.intercept, previousFs = fsFaults.intercept;
    const moves = new Map<string, string>();
    let failed = false, firstReady: Map<string, string> | undefined;
    let journalBeforeAnyMove: DeliveryJournal | undefined;
    processes.intercept = request => {
      const response = previousProcess?.(request);
      if (request.args.includes('--frozen-lockfile') && request.cwd) {
        fs.mkdirSync(path.join(request.cwd, 'apps/aux/node_modules'), { recursive: true });
        fs.cpSync(path.join(request.cwd, 'node_modules/vue'), path.join(request.cwd, 'apps/aux/node_modules/vue'), { recursive: true });
      }
      return response;
    };
    fsFaults.intercept = (operation, paths, data) => {
      if (operation === 'rename') {
        const from = paths[0]!, to = paths[1]!;
        const oldRelative = [...oldTrees.keys()].find(relative => path.join(root, relative) === from);
        if (oldRelative) {
          if (!journalBeforeAnyMove) {
            const operations = fs.readdirSync(backupRoot, { withFileTypes: true }).filter(entry => entry.isDirectory());
            expect(operations).toHaveLength(1);
            journalBeforeAnyMove = journalAt(backupRoot, operations[0]!.name);
            expect(journalBeforeAnyMove.entries.every(entry => entry.state === 'planned')).toBe(true);
          }
          moves.set(oldRelative, to);
        }
        if (to === path.join(root, 'node_modules') && isOutsideProject(from, root)) firstReady = treeSnapshot(from);
        if (to === path.join(root, 'apps/aux/node_modules') && isOutsideProject(from, root) && !failed) {
          failed = true;
          return true;
        }
      }
      return previousFs?.(operation, paths, data) ?? false;
    };
    try {
      const { result, thrown } = await attemptApply(root, plan, backupRoot, { workspace: 'apps/web' });
      expect(thrown).toBeUndefined();
      expect(failed, '必须命中第二个 ready 目录的真实 rename').toBe(true);
      expect(firstReady).toBeDefined();
      expect(result!.status).toBe('rolled-back');
      expect(result!.installState).toBe('reinstall-required');
      expect(treeSnapshot(path.join(root, 'node_modules'))).toEqual(firstReady);
      expect(moves.size).toBe(2);
      for (const [relative, quarantine] of moves) {
        expect(isOutsideProject(quarantine, root) && sameVolume(quarantine, root)).toBe(true);
        expect(treeSnapshot(quarantine)).toEqual(oldTrees.get(relative));
      }
      const journal = journalAt(backupRoot, result!.operationId);
      expect(journal).toMatchObject({ schemaVersion: 1, kind: 't16-install-delivery', operationId: result!.operationId, projectRoot: canonicalRoot(root), planDigest: result!.planDigest });
      expect(journal.planDigest).toBe(sha256Hex(canonicalJson(plan)));
      expect(journal.entries.map(entry => entry.target).sort()).toEqual([...oldTrees.keys()].sort());
      expect(journal.entries.find(entry => entry.target === 'node_modules')).toMatchObject({ importer: '.', hadOriginal: true, quarantine: moves.get('node_modules'), state: 'delivered' });
      expect(journal.entries.find(entry => entry.target === 'apps/aux/node_modules')).toMatchObject({ importer: 'apps/aux', hadOriginal: true, quarantine: moves.get('apps/aux/node_modules'), state: 'quarantined' });
      for (const change of plan.changes) expect(treeSnapshot(root).get(change.path)).toBe(before.get(change.path));
      expect(fs.existsSync(path.join(root, 'apps/aux/node_modules'))).toBe(false);
    } finally { processes.intercept = previousProcess; fsFaults.intercept = previousFs; }
  });
  it('旧树在 quarantine rename 窗口被编辑：保留真实用户字节且不得 applied', async () => {
    const root = vuePnpmNewDependencyProject('review-old-tree-race');
    const backupRoot = externalRoot('review-old-tree-race-backup');
    const plan = await buildPlan(root, 'pnpm');
    processes.dependencies = plan.exactDependencies;
    writeFiles(root, { 'node_modules/vue/package.json': JSON.stringify({ name: 'vue', version: VUE_FRAMEWORK_VERSION }), 'node_modules/vue/user.txt': 'original\n' });
    const oldTree = path.join(root, 'node_modules');
    const previous = fsFaults.intercept;
    let quarantine: string | undefined;
    fsFaults.intercept = (operation, paths, data) => {
      if (!quarantine && operation === 'rename' && paths[0] === oldTree) {
        quarantine = paths[1];
        fs.writeFileSync(path.join(oldTree, 'vue/user.txt'), 'concurrent user bytes\n');
      }
      return previous?.(operation, paths, data) ?? false;
    };
    try {
      const { result, thrown } = await attemptApply(root, plan, backupRoot);
      expect(thrown).toBeUndefined();
      expect(quarantine, '必须真实命中旧树移出窗口').toBeDefined();
      expect(result!.status).not.toBe('applied');
      expect(result!.installState).toBe('reinstall-required');
      const locations = [oldTree, quarantine!].filter(absolute => fs.existsSync(path.join(absolute, 'vue/user.txt')));
      expect(locations).toHaveLength(1);
      expect(fs.readFileSync(path.join(locations[0]!, 'vue/user.txt'), 'utf8')).toBe('concurrent user bytes\n');
      expect(fs.existsSync(path.join(root, 'node_modules', VUE_PACKAGE_NAME))).toBe(false);
    } finally { fsFaults.intercept = previous; }
  });
  it.each(['stage', 'ready'] as const)('交付后 %s 清理持续失败：不冒称 applied，源码恢复且依赖副作用保留', async kind => {
    const root = vuePnpmNewDependencyProject('review-cleanup-residue');
    const backupRoot = externalRoot('review-cleanup-residue-backup');
    const plan = await buildPlan(root, 'pnpm');
    processes.dependencies = plan.exactDependencies;
    const before = treeSnapshot(root);
    const previous = fsFaults.intercept;
    let deliveryStarted = false, denied: string | undefined;
    fsFaults.intercept = (operation, paths, data) => {
      if (operation === 'rename' && paths[1] === path.join(root, 'node_modules')) deliveryStarted = true;
      if (deliveryStarted && operation === 'rm' && path.basename(paths[0]!).startsWith(`.t16-${kind}-`)) {
        denied = paths[0]; return true;
      }
      return previous?.(operation, paths, data) ?? false;
    };
    try {
      const { result, thrown } = await attemptApply(root, plan, backupRoot);
      expect(thrown).toBeUndefined();
      expect(deliveryStarted).toBe(true);
      expect(denied, '必须真实拒绝尾部清理').toBeDefined();
      expect(fs.existsSync(denied!)).toBe(true);
      expect(result!.status, '任何本次外部工作目录残留都不能冒称干净交付').toBe('rolled-back');
      expect(result!.installState).toBe('reinstall-required');
      expect(result!.issues.some(issue => issue.code === 'INSTALL_FAILED')).toBe(true);
      for (const change of plan.changes) expect(treeSnapshot(root).get(change.path)).toBe(before.get(change.path));
      expect(fileExists(root, `node_modules/${VUE_PACKAGE_NAME}/package.json`)).toBe(true);
      const credentials = installCalls().flatMap(call => Object.entries(call.files ?? {}).filter(([, bytes]) => bytes.includes(SYNTHETIC_REGISTRY_TOKEN)).map(([absolute]) => absolute));
      expect(credentials.length).toBeGreaterThan(0);
      expect(credentials.map(absolute => fs.existsSync(absolute))).toEqual(credentials.map(() => false));
    } finally {
      fsFaults.intercept = previous;
      if (denied && isOutsideProject(denied, root) && path.basename(denied).startsWith(`.t16-${kind}-`)) fs.rmSync(denied, { recursive: true, force: true });
    }
  });
});

// ─── ⑦ 暂存进程边界 ───

describe('T16 B / P1 安装隔离：暂存进程 cwd/argv', () => {
  it.each([
    { label: '错误 Node 版本', version: 'v25.0.0\n', status: 0, allowed: false },
    { label: 'Node 探针失败', version: '', status: 1, allowed: false },
    { label: '固定 Node 版本', version: 'v26.13.0\n', status: 0, allowed: true },
  ])('$label 必须在候选锁与物化前真实校验', async ({ version, status, allowed }) => {
    const root = vueNpmNewDependencyProject('isolate-node-version');
    const backupRoot = externalRoot('isolate-node-version-backup');
    const plan = await buildPlan(root, 'npm');
    processes.dependencies = plan.exactDependencies;
    const original = treeSnapshot(root), previous = processes.intercept;
    const isNodeProbe = (command: string, args: readonly string[]) =>
      /(?:^|[\\/])node\.exe$/i.test(command) && args.length === 1 && args[0] === '--version';
    processes.intercept = request => isNodeProbe(request.command, request.args) ? {
      syncResult: { pid: 4242, output: [null, Buffer.from(version), Buffer.alloc(0)],
        stdout: Buffer.from(version), stderr: Buffer.alloc(0), status, signal: null },
    } : previous?.(request);
    try {
      const { result, thrown } = await attemptApply(root, plan, backupRoot);
      expect(thrown).toBeUndefined();
      const probes = processes.calls.filter(call => isNodeProbe(call.command, call.args));
      expect(probes, '必须启动裸 node.exe --version，不能把 npm 版本当 Node 版本').toHaveLength(1);
      expect(probes[0]!.shell).toBe(false);
      if (allowed) {
        expect(result!.status).toBe('applied');
        expect(processes.calls.indexOf(probes[0]!)).toBeLessThan(processes.calls.indexOf(candidateLockCalls(processes)[0]!));
      } else {
        expect(result!.status).not.toBe('applied');
        expect(result!.issues.map(issue => issue.code)).toContain('INSTALL_FAILED');
        expect(candidateLockCalls(processes)).toEqual([]);
        expect(materializationCalls(processes)).toEqual([]);
        expect(treeSnapshot(root)).toEqual(original);
      }
    } finally { processes.intercept = previous; }
  });

  it('pnpm 候选锁与冻结物化：argv 逐个匹配固定表，cwd 在工程外同卷 staging', async () => {
    const root = vuePnpmNewDependencyProject('isolate-pnpm-argv');
    const backupRoot = externalRoot('isolate-pnpm-argv-backup');
    const plan = await buildPlan(root, packageManagerOf(root));
    processes.dependencies = plan.exactDependencies;

    const { result } = await attemptApply(root, plan, backupRoot);

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    const calls = installCalls();
    expect(calls.length, '必须真实发生候选锁与冻结物化进程').toBeGreaterThanOrEqual(2);
    for (const call of calls) {
      expect(toolOf(call), '必须使用固定工具链形态').toBe('pnpm');
      expectFixedShape(call, root);
    }
    expect(candidateLockCalls(processes).length).toBeGreaterThanOrEqual(1);
    expect(materializationCalls(processes).length).toBeGreaterThanOrEqual(1);
    const staging = new Set(calls.map(call => call.cwd));
    for (const cwd of staging) {
      expect(isOutsideProject(cwd, root)).toBe(true);
      expect(sameVolume(cwd!, root)).toBe(true);
      expect(cwd!.startsWith(path.resolve(root))).toBe(false);
    }
  });

  it('npm 候选锁与冻结物化：argv 逐个匹配固定表，且使用隔离 userconfig/globalconfig/cache', async () => {
    const root = vueNpmNewDependencyProject('isolate-npm-argv');
    const backupRoot = externalRoot('isolate-npm-argv-backup');
    const plan = await buildPlan(root, packageManagerOf(root));
    expect(plan.packageManager, 'npm 夹具必须识别为 npm').toBe('npm');
    processes.dependencies = plan.exactDependencies;

    const { result } = await attemptApply(root, plan, backupRoot);

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    const calls = installCalls();
    expect(calls.length, '必须真实发生候选锁与冻结物化进程').toBeGreaterThanOrEqual(2);
    for (const call of calls) {
      expect(toolOf(call), '必须使用固定工具链形态').toBe('npm');
      expectFixedShape(call, root);
      expectIsolatedUserConfig(call);
      expectStagingClean(call.cwd!, root);
    }
  });

  it('环境白名单：恶意 NODE_OPTIONS/代理/npm_config_*/平台凭据一律不继承', async () => {
    const root = vuePnpmNewDependencyProject('isolate-env');
    const backupRoot = externalRoot('isolate-env-backup');
    // 保存宿主原值，finally 无条件恢复（断言失败也不得跳过恢复）。
    const original = new Map<string, string | undefined>();
    try {
      for (const [key, value] of Object.entries(HOSTILE_ENV)) {
        original.set(key, process.env[key]);
        process.env[key] = value;
      }
      const plan = await buildPlan(root, packageManagerOf(root));
      processes.dependencies = plan.exactDependencies;

      const { result } = await attemptApply(root, plan, backupRoot);

      expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
      const calls = installCalls();
      expect(calls.length, '必须真实发生包管理器进程才能核验环境').toBeGreaterThan(0);
      for (const call of calls) {
        // 在 mock 进程调用时快照环境：不得等清理后文件缺失再判通过。
        expectEnvWhitelist(call, root);
        expect(JSON.stringify(call.args), 'argv 不得放置任何令牌').not.toContain(SYNTHETIC_API_TOKEN);
        expect(JSON.stringify(call.args), 'argv 不得放置 registry 令牌').not.toContain(SYNTHETIC_REGISTRY_TOKEN);
      }
    } finally {
      for (const [key, value] of original) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('两套凭据不互传：API 凭据不进 registry/config/env/staging，registry 凭据不进 API 或结果', async () => {
    const root = vuePnpmNewDependencyProject('isolate-credentials');
    const backupRoot = externalRoot('isolate-credentials-backup');
    const plan = await buildPlan(root, packageManagerOf(root));
    processes.dependencies = plan.exactDependencies;
    network.requests.length = 0;

    const { result } = await attemptApply(root, plan, backupRoot);

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    const calls = installCalls();
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const call of calls) {
      expect(JSON.stringify(call.args) + JSON.stringify(call.env), '包管理器进程不得接触 API 凭据').not.toContain(SYNTHETIC_API_TOKEN);
      expectStagingClean(call.cwd!, root);
    }
    const apiHeaders = authorizationHeaders(network, 'api').filter((header): header is string => header !== undefined);
    const registryHeaders = authorizationHeaders(network, 'registry').filter((header): header is string => header !== undefined);
    expect(apiHeaders.length).toBeGreaterThan(0);
    expect(registryHeaders.length).toBeGreaterThan(0);
    expect(apiHeaders.every(header => header === `Bearer ${SYNTHETIC_API_TOKEN}`), 'API 只接受 API 凭据').toBe(true);
    expect(registryHeaders.every(header => header === `Bearer ${SYNTHETIC_REGISTRY_TOKEN}`), 'registry 只接受 registry 凭据').toBe(true);
    expect(apiHeaders.some(header => header.includes(SYNTHETIC_REGISTRY_TOKEN)), 'API 请求不得携带 registry 凭据').toBe(false);
    expect(registryHeaders.some(header => header.includes(SYNTHETIC_API_TOKEN)), 'registry 请求不得携带 API 凭据').toBe(false);
    expect(requestsTo(network, 'api').every(request => !request.path.includes(SYNTHETIC_REGISTRY_TOKEN))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_API_TOKEN);
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_REGISTRY_TOKEN);
  });

  it('恶意 .npmrc / pnpmfile / 生命周期脚本：不复制进 staging，也不产生任何执行痕迹', async () => {
    const root = vuePnpmNewDependencyProject('isolate-malicious-config', {
      '.npmrc': '//registry.example.invalid/:_authToken=evil-token\nscript-shell=/tmp/t16-evil-shell.sh\naudit=false\n',
      'pnpmfile.cjs': "module.exports = { hooks: { readPackage: (pkg) => pkg } };\n",
    });
    const backupRoot = externalRoot('isolate-malicious-config-backup');
    // 用一个会写 marker 的生命周期脚本证明“未执行”：marker 只能由真实包管理器/脚本运行产生。
    const manifest = JSON.parse(readText(root, 'package.json')!) as { scripts: Record<string, string> };
    manifest.scripts['preinstall'] = "node -e \"require('fs').writeFileSync('src/t16-marker-should-not-exist.txt','executed')\"";
    fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    const plan = await buildPlan(root, packageManagerOf(root));
    processes.dependencies = plan.exactDependencies;
    const baseline = treeSnapshot(root);

    const { result } = await attemptApply(root, plan, backupRoot);

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    if (result!.status === 'blocked') {
      expect(result!.issues.map(issue=>issue.code)).toContain('DEPENDENCY_CONFLICT');
      expect(packageManagerCalls(processes)).toEqual([]);
      expect(treeSnapshot(root)).toEqual(baseline);
      return;
    }
    expect(result!.status).toBe('applied');
    expect(materializationCalls(processes).length).toBeGreaterThan(0);
    expect(fileExists(root, 'src/t16-marker-should-not-exist.txt'), '任何配置/脚本/pnpmfile 都不得执行').toBe(false);
    for (const call of installCalls()) {
      // 在 mock 进程调用时快照 staging：不得等清理后文件缺失再判通过。
      expectStagingClean(call.cwd!, root);
      // pnpmfile 禁止以工程文件路径传入，但允许安全的 --ignore-pnpmfile 旗标。
      const pnpmfileArgs = call.args.filter(arg => arg.includes('pnpmfile') && !arg.startsWith('--'));
      expect(pnpmfileArgs, '不得把工程内 pnpmfile 路径传给包管理器').toEqual([]);
    }

  });

  it('不执行项目原生 typecheck/build：plan.commands 只是展示数据', async () => {
    const root = vuePnpmNewDependencyProject('isolate-no-build');
    const backupRoot = externalRoot('isolate-no-build-backup');
    const plan = await buildPlan(root, packageManagerOf(root));
    processes.dependencies = plan.exactDependencies;
    const previewed = plan.commands.filter(command => command.purpose !== 'install').map(command => command.args.join(' '));
    expect(previewed.length, '夹具必须带原生脚本预览').toBeGreaterThan(0);

    const { result } = await attemptApply(root, plan, backupRoot);

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(result!.status).toBe('applied');
    expect(materializationCalls(processes).length).toBeGreaterThan(0);
    for (const call of processes.calls) {
      const joined = call.args.join(' ');
      expect(joined, 'apply 不得执行项目 typecheck 脚本').not.toContain('typecheck');
      expect(joined, 'apply 不得执行项目 build 脚本').not.toContain('build');
      expect(joined, 'apply 不得把 plan.commands 传给 shell').not.toContain('run build');
    }
  });

  it('静态 workspace：staging 含根与成员 manifest 及成员列表，npm 不接收用户注入的 --workspace', async () => {
    const root = vuePnpmWorkspaceNewDependencyProject('isolate-workspace');
    const backupRoot = externalRoot('isolate-workspace-backup');
    const plan = await buildPlan(root, 'pnpm', 'apps/web');
    processes.dependencies = plan.exactDependencies;
    expect(plan.localProject.workspace).toBe('apps/web');
    expect(plan.changes.some(change => change.kind === 'lockfile-regeneration'), 'workspace 夹具必须有真实安装意图').toBe(true);

    const { result } = await attemptApply(root, plan, backupRoot, { workspace: 'apps/web' });

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    const calls = installCalls();
    expect(calls.length, '静态 workspace 必须真实发生候选锁与物化进程').toBeGreaterThanOrEqual(2);
    for (const call of calls) {
      expectFixedShape(call, root);
      expect(call.args.some(arg => arg === '--workspace' || arg === '-w' || arg.startsWith('--workspace=')),
        'workspace 成员由静态白名单决定，不得由用户注入 --workspace').toBe(false);
      const staging=call.cwd!;
      const files=capturedFiles(call);
      expect(files[path.join(staging,'package.json')]).toBeDefined();
      expect(files[path.join(staging,'apps/web/package.json')]).toBeDefined();
      expectStagingClean(staging,root);
    }
    const lockText=candidateLockCalls(processes)[0]?.lockAfter;
    expect(lockText, '候选锁必须留存真实生成结果').toBeDefined();
    const lock=parseYaml(lockText!) as { importers: Record<string,{dependencies?: Record<string,unknown>}> };
    expect(Object.keys(lock.importers).sort()).toEqual(['.','apps/web']);
    expect(lock.importers['.']!.dependencies ?? {}).toEqual({});
    expect(lock.importers['apps/web']!.dependencies?.[VUE_PACKAGE_NAME]).toBeDefined();
  });
});

// ─── ⑧ 安装核验与目录交付 ───

describe('T16 B / P1 安装隔离：核验与目录交付', () => {
  it('非目标静态 workspace 成员是工程外 junction：安装前 blocked，外部字节不进入 staging', async () => {
    const root = vuePnpmWorkspaceNewDependencyProject('review-member-junction', {
      'pnpm-workspace.yaml': "packages:\n  - apps/web\n  - apps/aux\n",
    });
    const outside = externalRoot('review-member-junction-outside');
    writeFiles(outside, { 'package.json': JSON.stringify({
      name: '@host/aux', version: '1.0.0', private: true, dependencies: {},
    }), 'outside-only.txt': 'independent outside sentinel' });
    linkDirectory(path.join(root, 'apps/aux'), outside);
    const backupRoot = externalRoot('review-member-junction-backup');
    const plan = await buildPlan(root, 'pnpm', 'apps/web');
    processes.dependencies = plan.exactDependencies;
    const expected = treeSnapshot(root), outsideExpected = treeSnapshot(outside);
    const { result, thrown } = await attemptApply(root, plan, backupRoot, { workspace: 'apps/web' });
    expect(thrown).toBeUndefined();
    expect(treeSnapshot(outside), '工程外成员必须零写入').toEqual(outsideExpected);
    expect(treeSnapshot(root)).toEqual(expected);
    expect(result?.status, '所有成员必须在候选锁进程前完成路径校验').toBe('blocked');
    expect(result?.installState).toBe('not-run');
    expect(candidateLockCalls(processes)).toEqual([]);
    expect(materializationCalls(processes)).toEqual([]);
    expect(treeSnapshot(backupRoot)).toEqual(new Map());
  });

  it('物化后非目标成员被替换为外部 junction：交付失败关闭并保留并发现场', async () => {
    const root = vuePnpmWorkspaceNewDependencyProject('review-member-race', {
      'pnpm-workspace.yaml': "packages:\n  - apps/web\n  - apps/aux\n",
      'apps/aux/package.json': JSON.stringify({
        name: '@host/aux', version: '1.0.0', private: true,
        dependencies: { vue: VUE_FRAMEWORK_VERSION },
      }),
    });
    const outside = externalRoot('review-member-race-outside');
    writeFiles(outside, { 'package.json': readText(root, 'apps/aux/package.json')!, 'sentinel.txt': 'unchanged' });
    const outsideExpected = treeSnapshot(outside);
    const backupRoot = externalRoot('review-member-race-backup');
    const plan = await buildPlan(root, 'pnpm', 'apps/web');
    processes.dependencies = plan.exactDependencies;
    const previous = processes.intercept;
    let swapped = false;
    processes.intercept = request => {
      const response = previous?.(request);
      if (!swapped && request.args.includes('--frozen-lockfile') && request.cwd) {
        // 真实物化夹具的成员依赖目录；随后用户替换非目标成员，交付必须再次校验父链。
        fs.mkdirSync(path.join(request.cwd, 'apps/aux/node_modules'), { recursive: true });
        fs.cpSync(path.join(request.cwd, 'node_modules/vue'), path.join(request.cwd, 'apps/aux/node_modules/vue'), { recursive: true });
        fs.renameSync(path.join(root, 'apps/aux'), path.join(root, 'apps/aux-original'));
        linkDirectory(path.join(root, 'apps/aux'), outside);
        swapped = true;
      }
      return response;
    };
    try {
      const { result, thrown } = await attemptApply(root, plan, backupRoot, { workspace: 'apps/web' });
      expect(swapped, '必须命中物化后的实际成员替换').toBe(true);
      expect(thrown).toBeUndefined();
      expect(treeSnapshot(outside), '不能沿被替换的父链把依赖交付到外部').toEqual(outsideExpected);
      expect(result?.status).not.toBe('applied');
      expect(fs.realpathSync(path.join(root, 'apps/aux'))).toBe(fs.realpathSync(outside));
      expect(readText(root, 'apps/aux-original/package.json')).toBe(readText(outside, 'package.json'));
    } finally { processes.intercept = previous; }
  });

  it('冻结候选锁被改写：失败关闭，目标锁字节不变，不得 applied', async () => {
    const root = vuePnpmNewDependencyProject('isolate-lock-rewritten');
    const backupRoot = externalRoot('isolate-lock-rewritten-backup');
    const plan = await buildPlan(root, packageManagerOf(root));
    processes.dependencies = plan.exactDependencies;
    processes.materialization = 'rewrite-lock';
    const expected = treeSnapshot(root);
    const originalLock = readText(root, 'pnpm-lock.yaml');

    const { result } = await attemptApply(root, plan, backupRoot);

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(materializationCalls(processes).length, '必须真实命中冻结物化故障').toBeGreaterThan(0);
    expect(result!.status, '冻结锁被改写必须失败关闭').not.toBe('applied');
    expect(readText(root, 'pnpm-lock.yaml'), '目标锁不得被写入非冻结内容').toBe(originalLock);
    expect(treeSnapshot(root)).toEqual(expected);
  });

  it('实际安装版本与计划不符：INSTALLED_VERSION_MISMATCH，不得 applied，目标不得交付 node_modules', async () => {
    const root = vuePnpmNewDependencyProject('isolate-version-mismatch');
    const backupRoot = externalRoot('isolate-version-mismatch-backup');
    const plan = await buildPlan(root, packageManagerOf(root));
    processes.dependencies = plan.exactDependencies;
    processes.materialization = 'wrong-version';
    const expected = treeSnapshot(root);

    const { result } = await attemptApply(root, plan, backupRoot);

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(result!.status).not.toBe('applied');
    expect(materializationCalls(processes).length, '必须真实命中冻结物化故障').toBeGreaterThan(0);
    expect(result!.issues.map(issue => issue.code)).toContain('INSTALLED_VERSION_MISMATCH');
    expect(fileExists(root, `node_modules/${VUE_PACKAGE_NAME}/package.json`), '核验失败不得交付 node_modules').toBe(false);
    expect(treeSnapshot(root)).toEqual(expected);
  });

  it('安装后依赖被删（并发变化）：失败关闭，不得 applied', async () => {
    const root = vuePnpmNewDependencyProject('isolate-dropped-package');
    const backupRoot = externalRoot('isolate-dropped-package-backup');
    const plan = await buildPlan(root, packageManagerOf(root));
    processes.dependencies = plan.exactDependencies;
    processes.materialization = 'drop-package';
    const expected = treeSnapshot(root);

    const { result } = await attemptApply(root, plan, backupRoot);

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(result!.status).not.toBe('applied');
    expect(materializationCalls(processes).length, '必须真实命中冻结物化故障').toBeGreaterThan(0);
    expect(result!.issues.length).toBeGreaterThan(0);
    expect(treeSnapshot(root)).toEqual(expected);
  });

  it('staging node_modules 含指向工程外的链接：拒绝交付，链接目标零改动', async () => {
    const root = vuePnpmNewDependencyProject('isolate-stage-link');
    const backupRoot = externalRoot('isolate-stage-link-backup');
    const plan = await buildPlan(root, packageManagerOf(root));
    processes.dependencies = plan.exactDependencies;
    processes.materialization = 'external-link';
    const expected = treeSnapshot(root);

    const { result } = await attemptApply(root, plan, backupRoot);

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(result!.status, 'stage 外链接必须失败关闭').not.toBe('applied');
    // 链接目标必须是 mock 在 staging 里真实创建的那个目录，并在调用后快照比较。
    const linkTarget = processes.stageOutsideRoot;
    expect(linkTarget, '测试必须真的在 staging 里放了指向工程外的链接').toBeDefined();
    const outsideExpected = processes.stageOutsideBaseline;
    expect(outsideExpected, '外链目标基线必须在 mock 返回前取得').toBeDefined();
    expect(fileExists(root, 'node_modules/linked-outside'), '不得把工程外链接交付进目标').toBe(false);
    expect(treeSnapshot(linkTarget!), '不得读写链接目标目录').toEqual(outsideExpected);
    expect(treeSnapshot(root)).toEqual(expected);
  });

  it('目标已有含未知链接的 node_modules：失败关闭，不递归清理、不覆盖', async () => {
    const root = vuePnpmNewDependencyProject('isolate-target-link');
    const outside = externalRoot('isolate-target-link-outside');
    const backupRoot = externalRoot('isolate-target-link-backup');
    const plan = await buildPlan(root, packageManagerOf(root));
    processes.dependencies = plan.exactDependencies;
    fs.writeFileSync(path.join(outside, 'user-data.txt'), 'USER DATA\n', 'utf8');
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    linkDirectory(path.join(root, 'node_modules', 'user-linked'), outside);
    const outsideExpected = treeSnapshot(outside);
    const expected = treeSnapshot(root);

    const { result } = await attemptApply(root, plan, backupRoot);

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(result!.status, '未知目标依赖链接必须失败关闭').not.toBe('applied');
    expect(treeSnapshot(outside), '不得读写工程外目录').toEqual(outsideExpected);
    expect(fileExists(root, 'node_modules/user-linked/user-data.txt'), '不得递归清理或覆盖用户目录').toBe(true);
    expect(treeDifferences(expected, treeSnapshot(root)).filter(difference => !difference.includes('user-linked'))).toEqual([]);
  });

  it('目录交付只落在明确安装范围：目标 node_modules 只出现计划确切依赖', async () => {
    const root = vuePnpmNewDependencyProject('isolate-delivery-scope');
    const backupRoot = externalRoot('isolate-delivery-scope-backup');
    const plan = await buildPlan(root, packageManagerOf(root));
    processes.dependencies = plan.exactDependencies;

    const { result } = await attemptApply(root, plan, backupRoot);

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(result!.status, '夹具应可 applied 才能核验交付范围').toBe('applied');
    const expectedTop = new Set(plan.exactDependencies.map(dependency => dependency.name.split('/')[0]!));
    const nodeModules = path.join(root, 'node_modules');
    const delivered = fs.existsSync(nodeModules) ? fs.readdirSync(nodeModules).filter(name => !name.startsWith('.')) : [];
    expect([...delivered].sort(), '交付范围不得超出计划确切依赖').toEqual([...expectedTop].sort());
    for (const dependency of plan.exactDependencies) {
      expect(fileExists(root, `node_modules/${dependency.name}/package.json`), `${dependency.name} 必须已交付`).toBe(true);
      const manifest = JSON.parse(readText(root, `node_modules/${dependency.name}/package.json`)!) as { version: string };
      expect(manifest.version, '交付版本必须与计划精确一致').toBe(dependency.version);
    }
    expect(fileExists(root, 'src/components/zhinexus/component-0001.vue')).toBe(true);
  });

  it.each(['普通文件', '工程外链接'] as const)('npm 隐藏锁元数据为%s：仅安全文件允许依赖交付', async kind => {
    // Real npm ci creates node_modules/.package-lock.json. Rejecting every
    // root file breaks successful installs; bypassing the link guard is unsafe.
    const root = vueNpmNewDependencyProject('isolate-npm-hidden-lock');
    const backupRoot = externalRoot('isolate-npm-hidden-lock-backup');
    const outside = externalRoot('isolate-npm-hidden-lock-outside');
    writeFiles(outside, { 'user-data.txt': 'must remain unchanged' });
    const outsideBefore = treeSnapshot(outside);
    const plan = await buildPlan(root, 'npm');
    processes.dependencies = plan.exactDependencies;
    const previous = processes.intercept;
    let metadataCreated = false;
    processes.intercept = request => {
      const response = previous?.(request);
      if (request.args.includes('ci') && request.cwd) {
        const metadata = path.join(request.cwd, 'node_modules', '.package-lock.json');
        if (kind === '普通文件') fs.writeFileSync(metadata, JSON.stringify({
          name: 'synthetic-hidden-lock', version: '1.0.0', lockfileVersion: 3,
          requires: true, packages: {},
        }));
        else linkDirectory(metadata, outside);
        metadataCreated = true;
      }
      return response;
    };
    try {
      const { result, thrown } = await attemptApply(root, plan, backupRoot);
      expect(thrown).toBeUndefined();
      expect(metadataCreated, '必须在物化后创建真实隐藏元数据条目').toBe(true);
      expect(treeSnapshot(outside)).toEqual(outsideBefore);
      if (kind === '普通文件') {
        expect(result!.status, 'npm 自身的安全隐藏锁不能导致合法安装回退').toBe('applied');
        expect(result!.installState).toBe('succeeded');
        for (const dependency of plan.exactDependencies) {
          const installed = JSON.parse(readText(root, `node_modules/${dependency.name}/package.json`)!);
          expect(installed.version).toBe(dependency.version);
        }
      } else {
        expect(result!.status).not.toBe('applied');
        expect(fileExists(root, `node_modules/${VUE_PACKAGE_NAME}/package.json`)).toBe(false);
      }
    } finally { processes.intercept = previous; }
  });

  it('影响解析且尚未支持的工程配置：DEPENDENCY_CONFLICT 阻断，且不启动任何安装进程', async () => {
    const root = vuePnpmNewDependencyProject('isolate-unsupported-config');
    const backupRoot = externalRoot('isolate-unsupported-config-backup');
    writeFiles(root, {
      '.npmrc': 'node-linker=isolated\nshamefully-hoist=true\nregistry=https://attacker.example.invalid/\n',
    });
    const plan = await buildPlan(root, packageManagerOf(root));
    const expected = treeSnapshot(root);

    const { result } = await attemptApply(root, plan, backupRoot);

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(result!.status).toBe('blocked');
    expect(result!.issues.map(issue => issue.code)).toContain('DEPENDENCY_CONFLICT');
    expect(packageManagerCalls(processes), '阻断后不得启动任何包管理器进程').toEqual([]);
    expect(treeSnapshot(root)).toEqual(expected);
  });

  it('候选锁生成失败：不得启动冻结物化，installState 不得声称成功', async () => {
    const root = vuePnpmNewDependencyProject('isolate-candidate-failed');
    const backupRoot = externalRoot('isolate-candidate-failed-backup');
    const plan = await buildPlan(root, packageManagerOf(root));
    processes.dependencies = plan.exactDependencies;
    processes.candidateLock = 'fail';
    const expected = treeSnapshot(root);

    const { result } = await attemptApply(root, plan, backupRoot);

    expect(result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(candidateLockCalls(processes).length, '必须真实尝试过候选锁').toBeGreaterThanOrEqual(1);
    expect(materializationCalls(processes), '候选锁失败不得启动冻结物化').toEqual([]);
    expect(result!.status).not.toBe('applied');
    expect(result!.installState).not.toBe('succeeded');
    expect(treeSnapshot(root)).toEqual(expected);
  });

  it('源码 rollback 不恢复 node_modules：installStarted=true 时文件恢复仍保持 reinstall-required', async () => {
    const root = vuePnpmNewDependencyProject('isolate-rollback-node-modules');
    const backupRoot = externalRoot('isolate-rollback-node-modules-backup');
    const plan = await buildPlan(root, packageManagerOf(root));
    processes.dependencies = plan.exactDependencies;
    processes.materialization = 'fail';
    const originalManifest = readText(root, 'package.json');

    const applied = await attemptApply(root, plan, backupRoot);

    expect(applied.result, capabilityNote(exports, 'applyIntegration')).toBeDefined();
    expect(applied.result!.installState, '安装确已启动').toBe('reinstall-required');
    expect(applied.result!.status).toBe('rolled-back');
    expect(readText(root, 'package.json'), '源码必须已恢复').toBe(originalManifest);
    // apply 失败已自动把源码恢复成备份前的 before 状态：再次 rollback 时这些候选“已匹配 before”，
    // 必须归入 unchanged，而不是再次声称 restored；node_modules 属于安装副作用，永不冒称已恢复。
    let result: IntegrationRollbackResultV1 | undefined;
    let thrown: unknown;
    try {
      result = await callRollback(exports, root, applied.result!.backupRef!, { backupRoot });
    } catch (error) {
      thrown = error;
    }
    expect(thrown, 'installStarted=true 的有效备份仍可做文件恢复').toBeUndefined();
    expect(result, capabilityNote(exports, 'rollbackIntegration')).toBeDefined();
    expect(result!.installState, '文件 rollback 不能洗掉已启动的安装副作用').toBe('reinstall-required');
    expect(result!.restoredPaths, '已自动恢复的候选不得再次冒称 restored').toEqual([]);
    expect([...result!.unchangedPaths].sort(), '已恢复候选必须归入 unchanged').toEqual([...plan.allowedPaths].sort());
    expect(result!.restoredPaths.some((relative: string) => relative.includes('node_modules')), '不得把 node_modules 冒称已恢复').toBe(false);
  });
});
