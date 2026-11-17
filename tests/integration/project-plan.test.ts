/**
 * T15 P1 接入计划行为测试（角色 B：Claude 桌面端）。
 *
 * 依据：docs/superpowers/plans/2026-11-16-phase3-t15-kickoff.md P1「RED / 计划与远端」、
 * docs/superpowers/specs/2026-11-16-phase3-t15-design.md、.superpowers/t15/c-plan-next-stage-2026-11-17.md、
 * .superpowers/t15/c-plan-red-fixture-precheck-2026-11-17.md（成功夹具前提）。
 *
 * 覆盖：完整 MatchPlan 的 planned 形状（executionAuthorized 恒 false、digest、路径/改动/命令预览）、
 * 同包多实例、缺业务绑定/布局、兼容未验证、同名不同精确依赖、缺 ECharts、脏目标、输出已存在、
 * 输出目录穿越、本地项目本身冲突，以及“离线 MatchPlan 自洽但删掉 required prop/事件”时
 * 由权威 GET 交叉核对发现遗漏。远端细节（超时/超限/重定向/撤权/摘要不符）在
 * project-plan-network.test.ts。契约一律通过 CLI 内联合约副本导入；fixtures 在临时目录合成，
 * 不读取任何真实业务工作区。
 *
 * 成功夹具前提（C 预审要求）：API 与 registry 是两个独立的 loopback 服务；registry 返回
 * **固定合成 bytes** 的 packument 与 tarball，integrity/shasum 由这些 bytes 实算，target 的
 * 平台摘要用同一 SHA-256；正常 query 含完整 packageName 绑定；正常源 MatchPlan 与 API 响应
 * 均以冻结 validators 断言结构合法；commands 预览 install + 项目原生 typecheck/build。
 *
 * RED 期：integration/{resolve,registry,plan}.ts 与 commands/integrate.ts 为仅固定签名的
 * throwing stub，因此每个用例都必须实际收集并在行为断言上失败（不是 0 tests）。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { planIntegration, type PlanOptions } from '../../packages/component-cli/src/integration/plan.js';
import { runIntegrateCommand, type IntegrateCommandResult } from '../../packages/component-cli/src/commands/integrate.js';
import { canonicalJson } from '../../packages/component-cli/src/contracts/schema.js';
import { validateIntegrationPlan } from '../../packages/component-cli/src/contracts/integration-plan.js';
import type { IntegrationPlanV1 } from '../../packages/component-cli/src/contracts/integration-plan.js';
import { validateMatchPlan } from '../../packages/component-cli/src/contracts/match-plan.js';
import type { MatchPlanV1 } from '../../packages/component-cli/src/contracts/match-plan.js';
import { validateComponentMatchResponse } from '../../packages/component-cli/src/contracts/component-match.js';

const PACKAGE_NAME = '@company/charts-vue';
const PACKAGE_VERSION = '0.0.12';
const TARBALL_FILENAME = 'charts-vue-0.0.12.tgz';
/** 固定合成 tarball bytes：所有摘要、integrity、shasum 与平台 SHA-256 都从它实算。 */
const TARBALL_BYTES = Buffer.from('synthetic @company/charts-vue 0.0.12 tarball payload\n');
const TARBALL_SHA256 = createHash('sha256').update(TARBALL_BYTES).digest('hex');
const TARBALL_INTEGRITY = `sha512-${createHash('sha512').update(TARBALL_BYTES).digest('base64')}`;
const TARBALL_SHASUM = createHash('sha1').update(TARBALL_BYTES).digest('hex');
const API_PATH = '/v1/matching/components';

const createdDirs: string[] = [];
beforeEach(() => {
  // 受控 spy 记录跨用例累计，每次用例前清空，避免相互干扰造成假失败/假通过。
  apiRequests.length = 0;
  apiResponses.length = 0;
  registryRequests.length = 0;
  registryResponses.length = 0;
});
afterAll(() => {
  for (const dir of createdDirs) fs.rmSync(dir, { recursive: true, force: true });
  createdDirs.length = 0;
});

function tempProject(name: string, files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `t15-plan-${name}-`));
  createdDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return dir;
}

function sha256Of(root: string, rel: string): string {
  return createHash('sha256').update(fs.readFileSync(path.join(root, ...rel.split('/')))).digest('hex');
}

/** 递归字节快照：断言 plan 全程零目标写入。 */
function treeSnapshot(root: string): Map<string, string> {
  const entries = new Map<string, string>();
  const walk = (dir: string, rel: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) entries.set(childRel, `link:${fs.readlinkSync(abs)}`);
      else if (entry.isDirectory()) { entries.set(childRel, 'dir'); walk(abs, childRel); }
      else entries.set(childRel, `file:${fs.statSync(abs).size}:${fs.readFileSync(abs).toString('base64')}`);
    }
  };
  walk(root, '');
  return entries;
}

const manifestJson = (manifest: Record<string, unknown>): string => JSON.stringify(manifest, null, 2);

type PnpmImporterDeps = Record<string, { specifier: string; version: string }>;

function pnpmV9Lock(importers: Record<string, PnpmImporterDeps>, lockfileVersion = '9.0'): string {
  const versions = new Map<string, string>();
  for (const deps of Object.values(importers)) {
    for (const [name, entry] of Object.entries(deps)) if (entry.version) versions.set(name, entry.version);
  }
  const lock = {
    lockfileVersion,
    importers: Object.fromEntries(Object.entries(importers).map(([importer, deps]) => [importer, { dependencies: deps }])),
    packages: Object.fromEntries([...versions].map(([name, version]) => [`${name}@${version}`, { resolution: { integrity: `sha512-${'A'.repeat(86)}==` } }])),
    snapshots: Object.fromEntries([...versions].map(([name, version]) => [`${name}@${version}`, { dependencies: {} }])),
  };
  return yamlStringify(lock);
}

/** Vue + pnpm 的可用目标项目（vue/echarts 已在锁中，@company/charts-vue 为待新增依赖）。 */
function vuePnpmProject(name = 'vue-pnpm'): string {
  return tempProject(name, {
    'package.json': manifestJson({
      name: 'host-app', version: '1.0.0', private: true, packageManager: 'pnpm@12.18.0',
      dependencies: { vue: '^3.5.0', echarts: '6.1.0' },
      scripts: { build: 'vite build', typecheck: 'tsc --noEmit' },
    }),
    'pnpm-lock.yaml': pnpmV9Lock({ '.': { vue: { specifier: '^3.5.0', version: '3.5.45' }, echarts: { specifier: '6.1.0', version: '6.1.0' } } }),
  });
}

// ─── 受控 loopback 服务：API 与 registry 各自独立 ───

type ApiStep = { status: number; body: unknown };
type RegistryStep =
  | { kind: 'packument'; status: number; body: unknown }
  | { kind: 'tarball'; status: number; body: Buffer | string };

const apiRequests: { url: string; query: URLSearchParams }[] = [];
const apiResponses: ApiStep[] = [];
const registryRequests: string[] = [];
const registryResponses: RegistryStep[] = [];

/** 权威 GET 的完整 query：含 packageName 绑定已选包。 */
function expectedQuery(): Record<string, string> {
  return {
    componentId: 'line', framework: 'vue', packageName: PACKAGE_NAME, packageVersion: PACKAGE_VERSION,
    frameworkVersion: '3.5.45', echartsVersion: '6.1.0',
  };
}

function matchedResponse(overrides?: { target?: Record<string, unknown>; api?: unknown }): unknown {
  return {
    schemaVersion: 1, query: expectedQuery(), status: 'matched',
    target: targetFixture(overrides?.target),
    api: overrides?.api ?? {
      schemaVersion: 1, componentId: 'line', framework: 'vue', exportName: 'LineChart', exportPath: './line',
      props: [{ name: 'data', type: 'ChartData', required: true }, { name: 'config', type: 'LineChartConfig', required: false }],
      events: [{ name: 'point-click', payload: 'ChartEvent' }], styleExport: './style.css', readyMethod: 'whenRendered', notes: [],
    },
    exactDependencies: [
      { name: PACKAGE_NAME, version: PACKAGE_VERSION }, { name: 'vue', version: '3.5.45' }, { name: 'echarts', version: '6.1.0' },
    ],
    gaps: [],
  };
}

function gapResponse(code: 'TARGET_UNAVAILABLE' | 'DEPENDENCY_CONFLICT', message: string): unknown {
  return { schemaVersion: 1, query: expectedQuery(), status: 'gap', exactDependencies: [], gaps: [{ code, message }] };
}

function targetFixture(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    variantReleaseId: '00000000-0000-4000-8000-000000000001', variantId: 'line-vue', componentId: 'line',
    framework: 'vue', packageName: PACKAGE_NAME, packageVersion: PACKAGE_VERSION, packageSha256: TARBALL_SHA256,
    exportName: 'LineChart', exportPath: './line',
    evidence: [{ kind: 'api', path: 'api/line.json', sha256: 'c'.repeat(64) }, { kind: 'docs', path: 'docs/line.md', sha256: 'd'.repeat(64) }],
    compatibility: { status: 'verified', recordIds: ['synthetic-test-only'] },
    examples: [{ id: 'example', previewEntry: 'preview/index.html' }],
    styleExport: './style.css', readyMethod: 'whenRendered', notes: [],
    ...overrides,
  };
}

/** registry packument：只描述被请求的精确 name/version，tarball 指向本服务的真实路径。 */
function packument(integrity: string): unknown {
  return {
    name: PACKAGE_NAME, 'dist-tags': { latest: PACKAGE_VERSION },
    versions: { [PACKAGE_VERSION]: { name: PACKAGE_NAME, version: PACKAGE_VERSION,
      dist: { tarball: `${registryOrigin}/${PACKAGE_NAME}/-/${TARBALL_FILENAME}`, integrity, shasum: TARBALL_SHASUM } } },
  };
}

let apiServer: http.Server;
let registryServer: http.Server;
let apiOrigin = '';
let registryOrigin = '';

beforeAll(async () => {
  apiServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    apiRequests.push({ url: req.url ?? '/', query: url.searchParams });
    const step = apiResponses.shift() ?? { status: 200, body: matchedResponse() };
    res.writeHead(step.status, { 'content-type': 'application/json' });
    res.end(typeof step.body === 'string' ? step.body : JSON.stringify(step.body));
  });
  await new Promise<void>(resolve => apiServer.listen(0, '127.0.0.1', resolve));
  const apiAddress = apiServer.address();
  apiOrigin = typeof apiAddress === 'object' && apiAddress ? `http://127.0.0.1:${apiAddress.port}` : '';

  registryServer = http.createServer((req, res) => {
    res.on('error', () => { /* 客户端主动断开（如超限中止）不应冒泡为未处理异常 */ });
    registryRequests.push(req.url ?? '/');
    const expectedPackument = `/${PACKAGE_NAME}`;
    const expectedTarball = `/${PACKAGE_NAME}/-/${TARBALL_FILENAME}`;
    const step = registryResponses.shift();
    if (step) {
      if (step.kind === 'packument') {
        res.writeHead(step.status, { 'content-type': 'application/json' });
        res.end(typeof step.body === 'string' ? step.body : JSON.stringify(step.body));
        return;
      }
      const body = typeof step.body === 'string' ? Buffer.from(step.body) : step.body;
      res.writeHead(step.status, { 'content-type': 'application/octet-stream' });
      res.end(body);
      return;
    }
    // 缺省：只回答被请求的精确 name/version，其他路径一律 404（不靠宽泛任意返回放行）。
    if (req.url === expectedPackument) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(packument(TARBALL_INTEGRITY)));
      return;
    }
    if (req.url === expectedTarball) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(TARBALL_BYTES);
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  registryServer.on('clientError', (_error, socket) => socket.destroy());
  await new Promise<void>(resolve => registryServer.listen(0, '127.0.0.1', resolve));
  const registryAddress = registryServer.address();
  registryOrigin = typeof registryAddress === 'object' && registryAddress ? `http://127.0.0.1:${registryAddress.port}` : '';
});

afterEach(() => {
  apiResponses.length = 0;
  registryResponses.length = 0;
});

afterAll(async () => {
  await new Promise<void>(resolve => apiServer.close(() => resolve()));
  await new Promise<void>(resolve => registryServer.close(() => resolve()));
});

/** 目标项目 + 一个 mapped 且自洽的 MatchPlan（required prop 有 source、事件有 handler、有 layout、兼容已验）。 */
function matchPlan(overrides?: {
  target?: Record<string, unknown>;
  elements?: MatchPlanV1['elements'];
  context?: Partial<MatchPlanV1['context']>;
  gaps?: MatchPlanV1['gaps'];
  exactDependencies?: MatchPlanV1['exactDependencies'];
}): MatchPlanV1 {
  const target = { ...targetFixture(overrides?.target) } as MatchPlanV1['elements'][number]['target'];
  const element: MatchPlanV1['elements'][number] = {
    instanceId: 'node-1', designId: '设计/Line', status: 'mapped', target,
    props: [{ name: 'data', type: 'ChartData', required: true, source: 'sales' }, { name: 'config', type: 'LineChartConfig', required: false }],
    events: [{ name: 'point-click', payload: 'ChartEvent', handler: 'showDetail' }], layout: 'grid cell 1', gaps: [],
  };
  const context: MatchPlanV1['context'] = {
    framework: 'vue', frameworkVersion: '3.5.45', echartsVersion: '6.1.0', packageManager: 'pnpm', requirements: [],
    ...overrides?.context,
  };
  // 缺 ECharts 场景要真正“未给明确候选”：删除该键，而不是置为 undefined（后者会被当成显式存在的坏值）。
  if (overrides?.context && 'echartsVersion' in overrides.context && overrides.context.echartsVersion === undefined) {
    delete (context as Record<string, unknown>).echartsVersion;
  }
  return {
    schemaVersion: 1, source: 'design-id', inputDigest: 'a'.repeat(64), ruleSetId: 'library', revision: 'draft-1',
    context,
    elements: overrides?.elements ?? [element],
    exactDependencies: overrides?.exactDependencies ?? [{ name: PACKAGE_NAME, version: PACKAGE_VERSION }],
    gaps: overrides?.gaps ?? [],
  } as MatchPlanV1;
}

function planOptions(overrides?: Partial<PlanOptions>): PlanOptions {
  return {
    apiUrl: apiOrigin, registryUrl: registryOrigin, apiToken: 'api-secret-token', registryToken: 'registry-secret-token',
    requestTimeoutMs: 15000, ...overrides,
  };
}

/** 统一入口：捕获抛错与返回，保证 RED 失败点是行为断言而不是未捕获异常。 */
async function runPlan(root: string, plan: MatchPlanV1, options: PlanOptions):
  Promise<{ result?: IntegrationPlanV1; thrown?: unknown }> {
  try {
    return { result: await planIntegration(root, plan, options) };
  } catch (error) {
    return { thrown: error };
  }
}

function describeThrown(outcome: { thrown?: unknown }): string {
  return outcome.thrown === undefined ? 'no-throw' : `throw:${outcome.thrown instanceof Error ? outcome.thrown.message : String(outcome.thrown)}`;
}

/** 断言夹具自身合法：源 MatchPlan 与 API 响应都必须通过冻结 validators。 */
function assertFixturesValid(plan: MatchPlanV1, response: unknown): void {
  expect(validateMatchPlan(plan).ok, '成功夹具的源 MatchPlan 必须结构合法').toBe(true);
  expect(validateComponentMatchResponse(response).ok, '成功夹具的 API 响应必须结构合法').toBe(true);
}

/** 项目原生 typecheck/build 脚本 + 固定 install 预览（结构 argv、cwd 相对项目根）。 */
const EXPECTED_COMMANDS = [
  { executable: 'pnpm', args: ['install', '--ignore-scripts'], cwd: '.', purpose: 'install' },
  { executable: 'pnpm', args: ['run', 'typecheck'], cwd: '.', purpose: 'typecheck' },
  { executable: 'pnpm', args: ['run', 'build'], cwd: '.', purpose: 'build' },
] as const;

// ─── planned 形状 ───

describe('T15 P1 接入计划（planIntegration）', () => {
  it('完整 MatchPlan + matched/verified：产出通过契约校验的 planned 计划', async () => {
    const root = vuePnpmProject('planned');
    const plan = matchPlan();
    assertFixturesValid(plan, matchedResponse());
    const before = treeSnapshot(root);

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `应返回结构化计划而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result).toBeDefined();
    expect(result!.schemaVersion).toBe(1);
    expect(result!.stage).toBe('plan');
    expect(result!.executionAuthorized).toBe(false);
    expect(result!.status).toBe('planned');
    expect(result!.packageManager).toBe('pnpm');
    // 输入完整保存，digest 为 canonicalJson(sourceMatchPlan) 的原始 SHA-256。
    expect(result!.sourceMatchPlan).toEqual(plan);
    expect(result!.matchPlanDigest).toBe(createHash('sha256').update(canonicalJson(plan)).digest('hex'));
    // 基础文件守卫：识别快照原样保留 + 未来源码文件以 exists:false 表示（不用空文件 SHA 冒充）。
    expect(result!.baseFileHashes).toEqual(
      expect.arrayContaining([
        { path: 'package.json', exists: true, sha256: sha256Of(root, 'package.json') },
        { path: 'pnpm-lock.yaml', exists: true, sha256: sha256Of(root, 'pnpm-lock.yaml') },
        { path: 'src/components/zhinexus/component-0001.vue', exists: false },
      ]),
    );
    expect(result!.allowedPaths).toEqual(
      expect.arrayContaining(['package.json', 'pnpm-lock.yaml', 'src/components/zhinexus/component-0001.vue']),
    );
    // 命令预览：固定 install + 项目原生 typecheck/build（不执行）。
    expect([...result!.commands].sort((a, b) => a.purpose.localeCompare(b.purpose))).toEqual([...EXPECTED_COMMANDS].sort((a, b) => a.purpose.localeCompare(b.purpose)));
    expect(result!.changes).toEqual(expect.arrayContaining([
      { kind: 'package-json', path: 'package.json', dependencies: [{ name: PACKAGE_NAME, version: PACKAGE_VERSION }] },
      { kind: 'lockfile-regeneration', path: 'pnpm-lock.yaml' },
      { kind: 'generated-component', path: 'src/components/zhinexus/component-0001.vue', instanceId: 'node-1', framework: 'vue' },
    ]));
    expect(result!.exactDependencies).toEqual(expect.arrayContaining([
      { name: PACKAGE_NAME, version: PACKAGE_VERSION }, { name: 'vue', version: '3.5.45' }, { name: 'echarts', version: '6.1.0' },
    ]));
    expect(result!.conflicts).toEqual([]);
    // 权威 GET 的 query 必须含完整 packageName 绑定，且读到了 registry 的精确版本元数据与 tarball。
    expect(apiRequests.length, '至少一次权威 GET').toBeGreaterThan(0);
    for (const request of apiRequests) {
      for (const [key, value] of Object.entries(expectedQuery())) {
        expect(request.query.get(key), `权威 GET query 必须带 ${key}=${value}`).toBe(value);
      }
    }
    expect(registryRequests).toContain(`/${PACKAGE_NAME}`);
    expect(registryRequests).toContain(`/${PACKAGE_NAME}/-/${TARBALL_FILENAME}`);
    // 平台摘要证据用真实 bytes 的 SHA-256，且不声称未核对的摘要。
    expect(result!.registryEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: PACKAGE_NAME, version: PACKAGE_VERSION, sha256: TARBALL_SHA256, verification: 'platform-sha256' }),
    ]));
    expect(result!.publicationEvidence.length).toBeGreaterThan(0);
    // 计划本身必须通过运行时校验，且全程零目标写入。
    expect(validateIntegrationPlan(result).ok).toBe(true);
    expect(treeSnapshot(root)).toEqual(before);
  });

  it('同包多实例：按元素输入顺序编号，且只读一次包材料', async () => {
    const root = vuePnpmProject('multi-instance');
    const base = matchPlan().elements[0]!;
    const plan = matchPlan({ elements: [{ ...base, instanceId: 'node-a' }, { ...base, instanceId: 'node-b' }] });

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `应返回结构化计划而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
    const generated = result!.changes.filter(c => c.kind === 'generated-component');
    expect(generated.map(c => c.path)).toEqual([
      'src/components/zhinexus/component-0001.vue',
      'src/components/zhinexus/component-0002.vue',
    ]);
    expect(generated.map(c => (c as { instanceId: string }).instanceId)).toEqual(['node-a', 'node-b']);
    // 同一 variantReleaseId 只保留一条发布证据（同包多实例复用同一次读取）。
    const byTarget = result!.publicationEvidence.filter(e => e.response.target?.variantReleaseId === base.target!.variantReleaseId);
    expect(byTarget.length).toBe(1);
    expect(registryRequests.filter(url => url === `/${PACKAGE_NAME}/-/${TARBALL_FILENAME}`).length, '同包只读一次 tarball').toBe(1);
    expect(validateIntegrationPlan(result).ok).toBe(true);
  });

  it('--output-dir 自定义未来源码位置，且路径相对项目根', async () => {
    const root = vuePnpmProject('output-dir');
    const plan = matchPlan();

    const { result, thrown } = await runPlan(root, plan, planOptions({ outputDir: 'src/generated/图表' }));

    expect(thrown, `应返回结构化计划而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'generated-component', path: 'src/generated/图表/component-0001.vue' }),
    ]));
    expect(result!.allowedPaths).toContain('src/generated/图表/component-0001.vue');
    expect(validateIntegrationPlan(result).ok).toBe(true);
  });

  it('凭据不进入计划 JSON、stdout 可序列化结果或任何输出', async () => {
    const root = vuePnpmProject('no-credential-leak');
    const plan = matchPlan();
    const apiToken = 'api-secret-token';
    const registryToken = 'registry-secret-token';

    const { result, thrown } = await runPlan(root, plan, planOptions({ apiToken, registryToken }));

    expect(thrown, `应返回结构化计划而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(apiToken);
    expect(serialized).not.toContain(registryToken);
  });

  // ─── 冲突：业务绑定 / 兼容 / 依赖 ───

  it('兼容未验证：conflicted 且保留 COMPATIBILITY_UNVERIFIED，不伪称 planned', async () => {
    const root = vuePnpmProject('unverified');
    // 真正删除兼容记录并把状态改为 unverified，同时在 element.gaps 补显式 COMPATIBILITY_UNVERIFIED。
    const base = matchPlan().elements[0]!;
    const plan = matchPlan({
      target: { compatibility: { status: 'unverified', recordIds: [] } },
      elements: [{ ...base, target: { ...base.target!, compatibility: { status: 'unverified', recordIds: [] } },
        gaps: [{ code: 'COMPATIBILITY_UNVERIFIED', message: 'synthetic：缺少实测组合' }] }],
    });
    // 入口前源 MatchPlan 必须本身合法（产品保存完整输入，不能既存非法输入又输出合法结果）。
    expect(validateMatchPlan(plan).ok, 'unverified 的源 MatchPlan 必须结构合法').toBe(true);

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `应返回结构化计划而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'COMPATIBILITY_UNVERIFIED')).toBe(true);
    expect(validateIntegrationPlan(result).ok).toBe(true);
  });

  it('缺数据源/缺事件处理/缺布局：分别以 MISSING_PROP/MISSING_EVENT/LAYOUT_UNKNOWN 冲突保留', async () => {
    for (const [label, code, mutate] of [
      ['缺数据源', 'MISSING_PROP', (e: MatchPlanV1['elements'][number]) => {
        // 真正删除 required prop 的 source 字段，并补对应 element gap。
        const props = e.props.map(p => (p.required ? { name: p.name, type: p.type, required: p.required } : p));
        return { ...e, props, gaps: [...e.gaps, { code: 'MISSING_PROP' as const, message: 'synthetic：缺少数据源' }] };
      }],
      ['缺事件处理', 'MISSING_EVENT', (e: MatchPlanV1['elements'][number]) => {
        // 真正删除事件的 handler 字段，并补对应 element gap。
        const events = e.events.map(v => ({ name: v.name, payload: v.payload }));
        return { ...e, events, gaps: [...e.gaps, { code: 'MISSING_EVENT' as const, message: 'synthetic：缺少事件处理' }] };
      }],
      ['缺布局', 'LAYOUT_UNKNOWN', (e: MatchPlanV1['elements'][number]) => {
        // 真正删除 layout 字段，并补对应 element gap。
        const { layout: _layout, ...rest } = e;
        return { ...rest, gaps: [...e.gaps, { code: 'LAYOUT_UNKNOWN' as const, message: 'synthetic：缺少布局' }] };
      }],
    ] as const) {
      const root = vuePnpmProject(`binding-${label}`);
      const base = matchPlan().elements[0]!;
      const plan = matchPlan({ elements: [mutate(base) as MatchPlanV1['elements'][number]] });
      // 删除可选字段 + 补对应 gap 后，源 MatchPlan 必须结构合法（不得靠取消断言规避）。
      expect(validateMatchPlan(plan).ok, `${label}：源 MatchPlan 必须结构合法`).toBe(true);

      const { result, thrown } = await runPlan(root, plan, planOptions());

      expect(thrown, `${label}：应返回结构化计划而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
      expect(result!.status, label).toBe('conflicted');
      expect(result!.conflicts.some(c => c.code === code), label).toBe(true);
      expect(validateIntegrationPlan(result).ok).toBe(true);
    }
  });

  it('同名不同精确依赖：不静默升级已锁宿主，显式冲突', async () => {
    const root = vuePnpmProject('same-name-conflict');
    // 本地已锁 @company/charts-vue@0.0.10，MatchPlan 要求 0.0.12。
    fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), pnpmV9Lock({ '.': {
      vue: { specifier: '^3.5.0', version: '3.5.45' }, echarts: { specifier: '6.1.0', version: '6.1.0' },
      '@company/charts-vue': { specifier: '0.0.10', version: '0.0.10' },
    } }), 'utf8');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as Record<string, unknown>;
    (manifest.dependencies as Record<string, string>)['@company/charts-vue'] = '0.0.10';
    fs.writeFileSync(path.join(root, 'package.json'), manifestJson(manifest), 'utf8');
    const plan = matchPlan();

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `应返回结构化计划而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'VERSION_MISMATCH' || c.code === 'DEPENDENCY_CONFLICT')).toBe(true);
    // 不得把冲突版本写进 exactDependencies 冒充一致。
    expect(result!.exactDependencies.some(d => d.name === PACKAGE_NAME && d.version === PACKAGE_VERSION)).toBe(false);
    expect(validateIntegrationPlan(result).ok).toBe(true);
  });

  it('缺 ECharts 且 MatchPlan 未给明确候选：ECHARTS_MISSING 冲突，不凭空补版本', async () => {
    const root = vuePnpmProject('no-echarts');
    fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), pnpmV9Lock({ '.': { vue: { specifier: '^3.5.0', version: '3.5.45' } } }), 'utf8');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as Record<string, unknown>;
    delete (manifest.dependencies as Record<string, string>).echarts;
    fs.writeFileSync(path.join(root, 'package.json'), manifestJson(manifest), 'utf8');
    const plan = matchPlan({ context: { echartsVersion: undefined } });
    expect(validateMatchPlan(plan).ok, '缺 ECharts 的 MatchPlan 仍须结构合法').toBe(true);

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `应返回结构化计划而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'ECHARTS_MISSING')).toBe(true);
    expect(validateIntegrationPlan(result).ok).toBe(true);
  });

  // ─── 冲突：目标路径与工作区状态 ───

  it('拟生成的组件文件已存在：OUTPUT_EXISTS 冲突且不覆盖', async () => {
    const root = vuePnpmProject('output-exists');
    const target = path.join(root, 'src/components/zhinexus/component-0001.vue');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '<template>existing</template>\n', 'utf8');
    const plan = matchPlan();

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `应返回结构化计划而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'OUTPUT_EXISTS')).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('<template>existing</template>\n');
    expect(validateIntegrationPlan(result).ok).toBe(true);
  });

  it('目标 package.json 有未提交改动：DIRTY_TARGET 冲突，其他脏文件仅记录不阻塞', async () => {
    const root = vuePnpmProject('dirty-target');
    const git = (args: string[]): void => {
      const done = spawnSync('git', args, { cwd: root, stdio: 'ignore' });
      if (done.status !== 0) throw new Error(`git ${args.join(' ')} 失败`);
    };
    git(['init', '-q', '--template=']);
    git(['config', 'user.email', 't15-fixture@example.invalid']);
    git(['config', 'user.name', 'T15 Fixture']);
    git(['config', 'commit.gpgsign', 'false']);
    git(['add', '--all']);
    git(['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'baseline']);
    fs.appendFileSync(path.join(root, 'package.json'), '\n', 'utf8');
    fs.appendFileSync(path.join(root, 'notes.md'), 'unrelated\n', 'utf8');
    const plan = matchPlan();

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `应返回结构化计划而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'DIRTY_TARGET' && c.path === 'package.json')).toBe(true);
    expect(result!.localProject.git.dirtyPaths).toContain('notes.md');
    expect(validateIntegrationPlan(result).ok).toBe(true);
  });

  it('--output-dir 穿越项目根：PATH_UNSAFE 类冲突且不产生任何写入', async () => {
    const root = vuePnpmProject('output-escape');
    const outside = path.join(path.dirname(root), 'plan-escape-outside');
    fs.rmSync(outside, { recursive: true, force: true });
    createdDirs.push(outside);
    const plan = matchPlan();
    const before = treeSnapshot(root);

    const { result, thrown } = await runPlan(root, plan, planOptions({ outputDir: `../${path.basename(outside)}` }));

    expect(thrown, `应返回结构化计划而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'PATH_UNSAFE' || c.code === 'WORKSPACE_INVALID')).toBe(true);
    expect(fs.existsSync(outside)).toBe(false);
    expect(treeSnapshot(root)).toEqual(before);
    expect(validateIntegrationPlan(result).ok).toBe(true);
  });

  it('本地项目本身冲突（多锁）：plan 保留识别冲突且不得 planned', async () => {
    const root = vuePnpmProject('local-conflicted');
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, name: 'host-app', packages: {} }), 'utf8');
    const plan = matchPlan();

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `应返回结构化计划而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'LOCKFILE_MULTIPLE')).toBe(true);
    expect(validateIntegrationPlan(result).ok).toBe(true);
  });

  // ─── 权威 API 交叉核对（离线自洽不足以免除） ───

  it('离线 MatchPlan 删掉 required prop 仍结构合法：权威 API 交叉核对必须发现遗漏', async () => {
    const root = vuePnpmProject('missing-required-prop');
    // props 只剩可选项：MatchPlan 自身校验通过（没有 required 而无 source 的元素）。
    const plan = matchPlan({ elements: [{ ...matchPlan().elements[0]!, props: [{ name: 'config', type: 'LineChartConfig', required: false }] }] });
    expect(validateMatchPlan(plan).ok, '删掉 required prop 后 MatchPlan 仍须结构合法').toBe(true);

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `应返回结构化计划而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'API_MISMATCH')).toBe(true);
    expect(validateIntegrationPlan(result).ok).toBe(true);
  });

  it('离线 MatchPlan 删空 events 仍结构合法：权威 API 交叉核对必须发现遗漏', async () => {
    const root = vuePnpmProject('empty-events');
    const plan = matchPlan({ elements: [{ ...matchPlan().elements[0]!, events: [] }] });
    expect(validateMatchPlan(plan).ok, '删空 events 后 MatchPlan 仍须结构合法').toBe(true);

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `应返回结构化计划而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'API_MISMATCH')).toBe(true);
    expect(validateIntegrationPlan(result).ok).toBe(true);
  });

  it('离线 MatchPlan 含权威 API 不存在的额外成员/过期类型：必须拒绝', async () => {
    const root = vuePnpmProject('extra-member');
    const plan = matchPlan({ elements: [{
      ...matchPlan().elements[0]!,
      props: [...matchPlan().elements[0]!.props, { name: 'ghost', type: 'NoSuchType', required: false }],
    }] });
    expect(validateMatchPlan(plan).ok, '含额外成员时 MatchPlan 仍须结构合法').toBe(true);

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `应返回结构化计划而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'API_MISMATCH')).toBe(true);
    expect(validateIntegrationPlan(result).ok).toBe(true);
  });

  it('目标在下载后被废弃/撤权（最终复读为 gap）：以结构化冲突拒绝 planned', async () => {
    const root = vuePnpmProject('revoked-late');
    const plan = matchPlan();
    // 首次 matched/verified，随后（复读时）变为 gap。
    apiResponses.push({ status: 200, body: matchedResponse() });
    apiResponses.push({ status: 200, body: gapResponse('TARGET_UNAVAILABLE', 'Target withdrawn') });

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `撤销应以结构化冲突返回而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'TARGET_UNAVAILABLE' || c.code === 'TARGET_CHANGED')).toBe(true);
    expect(apiRequests.length, '撤权必须由最终复读发现').toBeGreaterThanOrEqual(2);
    expect(validateIntegrationPlan(result).ok).toBe(true);
  });
});

// ─── 原 P1 候选审查回归：CLI 失败矩阵（.superpowers/t15/c-plan-product-review-2026-11-17.md ⑥） ───
//
// 参数/JSON/读取/网络错误必须走同一条路径：exit 1 + **单一 JSON stdout** + stderr 诊断，
// 不发无必要请求；错误 JSON 是命令本地最小稳定对象，不冒称 IntegrationPlan。

type ErrorEnvelope = { status?: unknown; error?: { code?: unknown; message?: unknown }; [key: string]: unknown };

function parseStdoutJson(stdout: string): ErrorEnvelope {
  expect(stdout, 'stdout 必须是单个 JSON 对象，不能为空').not.toBe('');
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`stdout 不是合法 JSON：${stdout.slice(0, 200)}`);
  }
  expect(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'stdout 必须是 JSON 对象').toBe(true);
  return parsed as ErrorEnvelope;
}

/** 失败路径：exit 1 + 单一 JSON（status=error，带稳定 code/message）+ stderr 诊断。 */
function expectFailureEnvelope(result: IntegrateCommandResult): ErrorEnvelope {
  expect(result.exitCode, '执行错误必须 exit 1').toBe(1);
  const envelope = parseStdoutJson(result.stdout);
  expect(envelope.status).toBe('error');
  expect(typeof envelope.error?.code, '错误 code 必须是非空字符串').toBe('string');
  expect((envelope.error?.code as string).length, '错误 code 必须是非空字符串').toBeGreaterThan(0);
  expect(typeof envelope.error?.message, '错误 message 必须是非空字符串').toBe('string');
  // 不得冒称 IntegrationPlan（共享 contracts 没有专用执行错误 envelope，本地最小对象即可）。
  expect(envelope).not.toHaveProperty('schemaVersion');
  expect(envelope).not.toHaveProperty('stage');
  expect(result.stderr, '诊断必须走 stderr').not.toBe('');
  return envelope;
}

describe('T15 P1 候选审查回归：CLI 失败矩阵单一 JSON stdout', () => {
  const savedEnv: Record<string, string | undefined> = {};
  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('参数类错误：exit 1 + 单一 JSON + stderr 诊断，且不发任何请求', async () => {
    const root = vuePnpmProject('cli-arg-errors');
    savedEnv.ZHINEXUS_API_TOKEN = process.env.ZHINEXUS_API_TOKEN;
    savedEnv.ZHINEXUS_REGISTRY_TOKEN = process.env.ZHINEXUS_REGISTRY_TOKEN;
    process.env.ZHINEXUS_API_TOKEN = 'api-secret-token';
    process.env.ZHINEXUS_REGISTRY_TOKEN = 'registry-secret-token';
    const cases: { label: string; args: string[] }[] = [
      { label: '缺子命令', args: [] },
      { label: '未知子命令', args: ['bogus'] },
      { label: '重复 --project', args: ['inspect', '--project', root, '--project', root] },
      { label: '未知参数', args: ['inspect', '--project', root, '--bogus'] },
      { label: '参数缺值', args: ['inspect', '--project'] },
      { label: '缺必填 --project', args: ['inspect'] },
      { label: 'plan 缺 --match', args: ['plan', '--project', root, '--api-url', apiOrigin, '--registry', registryOrigin] },
      { label: 'plan 缺 --api-url', args: ['plan', '--project', root, '--match', 'x.json', '--registry', registryOrigin] },
      { label: 'plan 缺 --registry', args: ['plan', '--project', root, '--match', 'x.json', '--api-url', apiOrigin] },
    ];
    for (const item of cases) {
      apiRequests.length = 0;
      registryRequests.length = 0;
      const result = await runIntegrateCommand(item.args);
      const envelope = expectFailureEnvelope(result);
      expect(envelope.error?.code, `${item.label} 的 code 必须稳定`).toBe('INVALID_ARGUMENTS');
      expect(apiRequests.length, `${item.label} 不得发出 API 请求`).toBe(0);
      expect(registryRequests.length, `${item.label} 不得发出 registry 请求`).toBe(0);
      expect(result.stdout + result.stderr, `${item.label} 不得回显凭据`).not.toContain('secret-token');
    }
  });

  it('MatchPlan 读取/解析/结构非法：exit 1 + 单一 JSON，且不发任何请求', async () => {
    const root = vuePnpmProject('cli-match-plan-errors');
    const matchFile = path.join(root, '..', `cli-match-errors-${Date.now()}.json`);
    const brokenJson = path.join(root, '..', `cli-match-broken-${Date.now()}.json`);
    fs.writeFileSync(brokenJson, '{ not json');
    const structurallyInvalid = { schemaVersion: 1 };
    fs.writeFileSync(matchFile, JSON.stringify(structurallyInvalid));
    const cases: { label: string; match: string }[] = [
      { label: '坏 JSON', match: brokenJson },
      { label: '文件不存在', match: `${matchFile}-missing` },
      { label: '结构非法', match: matchFile },
    ];
    try {
      for (const item of cases) {
        apiRequests.length = 0;
        registryRequests.length = 0;
        const result = await runIntegrateCommand(['plan', '--project', root,
          '--match', item.match, '--api-url', apiOrigin, '--registry', registryOrigin]);
        const envelope = expectFailureEnvelope(result);
        expect(envelope.error?.code, `${item.label} 的 code 必须稳定`).toBe('INVALID_MATCH_PLAN');
        expect(apiRequests.length, `${item.label} 不得发出 API 请求`).toBe(0);
        expect(registryRequests.length, `${item.label} 不得发出 registry 请求`).toBe(0);
      }
    } finally {
      fs.rmSync(matchFile, { force: true });
      fs.rmSync(brokenJson, { force: true });
    }
  });

  it('网络错误：exit 1 + 单一 JSON（透传稳定 code），错误 JSON 不含凭据', async () => {
    const API_TOKEN_VALUE = 'api-secret-token';
    const REGISTRY_TOKEN_VALUE = 'registry-secret-token';
    const root = vuePnpmProject('cli-network-error');
    const plan = matchPlan();
    const matchFile = path.join(root, '..', `cli-network-${Date.now()}.json`);
    fs.writeFileSync(matchFile, JSON.stringify(plan));
    savedEnv.ZHINEXUS_API_TOKEN = process.env.ZHINEXUS_API_TOKEN;
    savedEnv.ZHINEXUS_REGISTRY_TOKEN = process.env.ZHINEXUS_REGISTRY_TOKEN;
    process.env.ZHINEXUS_API_TOKEN = 'api-secret-token';
    process.env.ZHINEXUS_REGISTRY_TOKEN = 'registry-secret-token';
    try {
      apiResponses.push({ status: 500, body: `boom ${API_TOKEN_VALUE} ${REGISTRY_TOKEN_VALUE}` });
      const result = await runIntegrateCommand(['plan', '--project', root,
        '--match', matchFile, '--api-url', apiOrigin, '--registry', registryOrigin]);
      const envelope = expectFailureEnvelope(result);
      expect(envelope.error?.code).toBe('REGISTRY_UNAVAILABLE');
      expect(result.stdout, '错误 JSON 不得含 API 令牌').not.toContain(API_TOKEN_VALUE);
      expect(result.stdout, '错误 JSON 不得含 registry 令牌').not.toContain(REGISTRY_TOKEN_VALUE);
      expect(result.stderr, '诊断不得含 API 令牌').not.toContain(API_TOKEN_VALUE);
      expect(result.stderr, '诊断不得含 registry 令牌').not.toContain(REGISTRY_TOKEN_VALUE);
    } finally {
      fs.rmSync(matchFile, { force: true });
    }
  });

  it('成功路径 stdout 仍是单一 JSON：inspected exit 0、conflicted exit 2', async () => {
    const root = vuePnpmProject('cli-success-json');
    const inspected = await runIntegrateCommand(['inspect', '--project', root]);
    expect(inspected.exitCode, '无冲突的 inspect 应 exit 0').toBe(0);
    expect(inspected.stderr).toBe('');
    const inspection = parseStdoutJson(inspected.stdout);
    expect(inspection.schemaVersion).toBe(1);
    expect(inspection.status).toBe('inspected');

    // 拟生成文件已存在 → conflicted，stdout 仍是单一 JSON。
    fs.mkdirSync(path.join(root, 'src/components/zhinexus'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/components/zhinexus/component-0001.vue'), '<template/>\n');
    const plan = matchPlan();
    const matchFile = path.join(root, '..', `cli-success-${Date.now()}.json`);
    fs.writeFileSync(matchFile, JSON.stringify(plan));
    try {
      const conflicted = await runIntegrateCommand(['plan', '--project', root,
        '--match', matchFile, '--api-url', apiOrigin, '--registry', registryOrigin]);
      expect(conflicted.exitCode, '含 conflicts 的计划应 exit 2').toBe(2);
      expect(conflicted.stderr).toBe('');
      const parsed = parseStdoutJson(conflicted.stdout);
      expect(parsed.status).toBe('conflicted');
      expect(parsed.stage).toBe('plan');
      expect(validateIntegrationPlan(parsed).ok).toBe(true);
    } finally {
      fs.rmSync(matchFile, { force: true });
    }
  });
});

// ─── 最终整分支审查回归（C 2026-11-17 整分支审查候选 ①⑤；本轮只写测试，产品一字未改） ───
//
// ① 两个不同 variantReleaseId/逻辑组件（line/bar）共享同一包名+版本+摘要：合法 MatchPlan 必须形成
//    合法计划，且 registryEvidence 中同一 name@version 只能有一条（契约 unique(/registryEvidence)）；
//    按 finalReads 逐 variant push 会触发 `Duplicate or aliased entries` 而 schema crash。
// ⑤ 契约允许省略 context.echartsVersion（project-context.ts 将其列为可选）：本地已锁 ECharts 时，
//    要么安全取本地 inspected lock 版本形成真实查询并正常返回，要么形成合法上下文冲突；不得 schema
//    crash，且 GET query 不得发送空 echartsVersion。
//
// 全部用例沿用合法源输入（validateMatchPlan）与合法权威响应（validateComponentMatchResponse）先验断言、
// 真实 loopback API/registry、实算 bytes 摘要，并断言目标全树零写入。

/** 第二个逻辑组件的 target：variantReleaseId/variantId/componentId/导出都不同，但包名、版本与平台摘要相同。 */
function secondComponentTarget(): Record<string, unknown> {
  return {
    ...targetFixture(),
    variantReleaseId: '00000000-0000-4000-8000-000000000002', variantId: 'bar-vue', componentId: 'bar',
    exportName: 'BarChart', exportPath: './bar',
    evidence: [{ kind: 'api', path: 'api/bar.json', sha256: 'c'.repeat(64) }, { kind: 'docs', path: 'docs/bar.md', sha256: 'd'.repeat(64) }],
  };
}

/** 第二个逻辑组件的 matched 响应：query/api 身份与自身 target 一致，运行时依赖与第一个组件完全相同。 */
function secondComponentResponse(): unknown {
  return {
    schemaVersion: 1,
    query: { ...expectedQuery(), componentId: 'bar' },
    status: 'matched',
    target: secondComponentTarget(),
    api: {
      schemaVersion: 1, componentId: 'bar', framework: 'vue', exportName: 'BarChart', exportPath: './bar',
      props: [{ name: 'data', type: 'ChartData', required: true }, { name: 'config', type: 'LineChartConfig', required: false }],
      events: [{ name: 'point-click', payload: 'ChartEvent' }], styleExport: './style.css', readyMethod: 'whenRendered', notes: [],
    },
    exactDependencies: [
      { name: PACKAGE_NAME, version: PACKAGE_VERSION }, { name: 'vue', version: '3.5.45' }, { name: 'echarts', version: '6.1.0' },
    ],
    gaps: [],
  };
}

describe('T15 P1 最终整分支审查回归：同包多组件与省略 ECharts 版本', () => {
  it('同包不同 variantReleaseId（line/bar 共享包名+版本+摘要）：合法 planned 且 registryEvidence 同一 name@version 仅一条', async () => {
    const root = vuePnpmProject('same-package-two-components');
    const base = matchPlan().elements[0]!;
    const plan = matchPlan({ elements: [
      { ...base, instanceId: 'node-line', designId: '设计/Line', target: targetFixture() as MatchPlanV1['elements'][number]['target'] },
      { ...base, instanceId: 'node-bar', designId: '设计/Bar', target: secondComponentTarget() as MatchPlanV1['elements'][number]['target'] },
    ] });
    // 先验断言：源 MatchPlan 与两个权威响应都必须结构合法（不能靠非法输入凑出结论）。
    expect(validateMatchPlan(plan).ok, '同包两组件的源 MatchPlan 必须结构合法').toBe(true);
    expect(validateComponentMatchResponse(matchedResponse()).ok, 'line 的权威响应必须结构合法').toBe(true);
    expect(validateComponentMatchResponse(secondComponentResponse()).ok, 'bar 的权威响应必须结构合法').toBe(true);
    const before = treeSnapshot(root);
    // 权威 GET 按首次出现顺序（line、bar），最终复读再各一次。
    apiResponses.push({ status: 200, body: matchedResponse() });
    apiResponses.push({ status: 200, body: secondComponentResponse() });
    apiResponses.push({ status: 200, body: matchedResponse() });
    apiResponses.push({ status: 200, body: secondComponentResponse() });

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `合法同包 MatchPlan 应形成合法计划而非 schema crash（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('planned');
    expect(result!.conflicts).toEqual([]);
    // 两个逻辑组件各自生成一个组件文件（按元素输入顺序编号）。
    const generated = result!.changes.filter(c => c.kind === 'generated-component');
    expect(generated.map(c => (c as { instanceId: string }).instanceId)).toEqual(['node-line', 'node-bar']);
    expect(generated.map(c => c.path)).toEqual([
      'src/components/zhinexus/component-0001.vue',
      'src/components/zhinexus/component-0002.vue',
    ]);
    // 每个 variantReleaseId 都保留一条最终 GET 快照（两个目标都要有发布证据）。
    expect(result!.publicationEvidence.map(e => e.response.target?.variantReleaseId).sort()).toEqual(
      ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'],
    );
    // 同一 name@version 只允许一条 registryEvidence：契约 unique(/registryEvidence) 否则判 Duplicate or aliased entries。
    const shared = result!.registryEvidence.filter(e => e.name === PACKAGE_NAME && e.version === PACKAGE_VERSION);
    expect(shared.length, '同包两组件只能有一条平台摘要证据').toBe(1);
    expect(shared[0]).toEqual({
      name: PACKAGE_NAME, version: PACKAGE_VERSION, sha256: TARBALL_SHA256, integrity: TARBALL_INTEGRITY, verification: 'platform-sha256',
    });
    // 两个 variantReleaseId 各自都要权威 GET（首次 + 最终复读），且都带完整 packageName 绑定。
    expect(new Set(apiRequests.map(r => r.query.get('componentId')))).toEqual(new Set(['line', 'bar']));
    for (const request of apiRequests) {
      expect(request.query.get('packageName'), '权威 GET 必须带 packageName 绑定').toBe(PACKAGE_NAME);
    }
    // 同包只读一次 tarball（重复读取没有意义）。
    expect(registryRequests.filter(url => url === `/${PACKAGE_NAME}/-/${TARBALL_FILENAME}`).length, '同包只读一次 tarball').toBe(1);
    // 计划本身必须通过运行时校验，且全程零目标写入。
    expect(validateIntegrationPlan(result).ok).toBe(true);
    expect(treeSnapshot(root)).toEqual(before);
  });

  it('MatchPlan 省略 context.echartsVersion 且本地已锁 ECharts：查询不发空 echartsVersion，也不 schema crash', async () => {
    const root = vuePnpmProject('omit-echarts-version');
    // 契约把 echartsVersion 列为可选；这里真正删除该键（而不是置为 undefined 的显式坏值）。
    const plan = matchPlan({ context: { echartsVersion: undefined } });
    expect(validateMatchPlan(plan).ok, '省略 echartsVersion 的源 MatchPlan 必须结构合法').toBe(true);
    expect(validateComponentMatchResponse(matchedResponse()).ok, '6.1.0 的权威响应必须结构合法').toBe(true);
    const before = treeSnapshot(root);
    apiResponses.push({ status: 200, body: matchedResponse() });
    apiResponses.push({ status: 200, body: matchedResponse() });

    const { result, thrown } = await runPlan(root, plan, planOptions());

    // 不得以 INVALID_SCHEMA 等执行错误崩溃：要么用本地已锁版本形成真实查询并正常返回，要么形成合法上下文冲突。
    expect(thrown, `省略 echartsVersion 不得 schema crash（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result).toBeDefined();
    expect(['planned', 'conflicted']).toContain(result!.status);
    expect(validateIntegrationPlan(result).ok).toBe(true);
    // GET query 不得发送空 echartsVersion：要么不带该参数，要么带本地 inspected lock 的精确版本。
    for (const request of apiRequests) {
      const sent = request.query.get('echartsVersion');
      expect(sent === null || sent === '6.1.0', `GET 不得发送空或编造的 echartsVersion，实际 ${JSON.stringify(sent)}`).toBe(true);
    }
    // 若形成 planned，则必须真正用了本地已锁版本，并把该依赖完整保留（不凭空补版本、不悄悄丢依赖）。
    if (result!.status === 'planned') {
      expect(apiRequests.length, 'planned 必须真的发出过权威 GET').toBeGreaterThan(0);
      expect(apiRequests.every(r => r.query.get('echartsVersion') === '6.1.0')).toBe(true);
      expect(result!.exactDependencies).toEqual(expect.arrayContaining([{ name: 'echarts', version: '6.1.0' }]));
    }
    expect(treeSnapshot(root)).toEqual(before);
  });
});
