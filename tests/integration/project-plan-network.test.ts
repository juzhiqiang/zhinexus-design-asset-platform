/**
 * T15 P1 接入计划远端边界测试（角色 B：Claude 桌面端）。
 *
 * 依据：docs/plans/2026-11-16-phase3-t15-kickoff.md P1「RED / 计划与远端」、
 * docs/specs/2026-11-16-phase3-t15-design.md「发布与凭据检查」、
 * .superpowers/t15/c-plan-next-stage-2026-11-17.md、.superpowers/t15/c-plan-red-fixture-precheck-2026-11-17.md。
 *
 * 覆盖：GET 请求身份不符、包摘要损坏、registry dist.integrity 与实收 bytes 不符、
 * 下载超限/超时/跨 origin 重定向、URL 内嵌凭证与非 loopback HTTP、令牌不进入输出、
 * 网络请求等待期间项目被并发编辑、tarball 响应暂停期间远端撤权后必须复读并拒绝 planned，
 * 以及 dangling 逃逸链接、matched 兼容未验证响应的远端值脱敏、权威依赖与本地锁版本冲突。
 * 本地 HTTP stub 仅作协议测试，标为 synthetic；真实服务联调由 C 负责。
 *
 * 成功夹具前提（C 预审要求）：integrity/shasum 由**实际 served bytes** 实算（不用占位值）；
 * 元数据只回答被请求的精确 name/version；正常 query 含完整 packageName 绑定；
 * 屏障用例用 entered + release 明确确认请求已进入才改文件/撤权，不用 sleep 冒充。
 *
 * RED 期：integration/{resolve,registry,plan}.ts 为仅固定签名的 throwing stub，
 * 因此每个用例都必须实际收集并在行为断言上失败（不是 0 tests）。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { planIntegration, IntegrationPlanError, type PlanOptions } from '../../packages/component-cli/src/integration/plan.js';
import { runIntegrateCommand } from '../../packages/component-cli/src/commands/integrate.js';
import { validateIntegrationPlan } from '../../packages/component-cli/src/contracts/integration-plan.js';
import type { IntegrationPlanV1 } from '../../packages/component-cli/src/contracts/integration-plan.js';
import { validateMatchPlan } from '../../packages/component-cli/src/contracts/match-plan.js';
import type { MatchPlanV1 } from '../../packages/component-cli/src/contracts/match-plan.js';
import { validateComponentMatchResponse } from '../../packages/component-cli/src/contracts/component-match.js';

const PACKAGE_NAME = '@company/charts-vue';
const PACKAGE_VERSION = '0.0.12';
const TARBALL_FILENAME = 'charts-vue-0.0.12.tgz';
/** GET 明确新增的 core 运行时依赖：本地未锁，只有 registry integrity 可核对（无平台摘要）。 */
const CORE_NAME = 'echarts';
const CORE_VERSION = '6.1.0';
const CORE_FILENAME = 'echarts-6.1.0.tgz';
const API_TOKEN = 'api-secret-token';
const REGISTRY_TOKEN = 'registry-secret-token';
/** 固定合成 tarball bytes：摘要、integrity、shasum 全部由它实算。 */
const TARBALL_BYTES = Buffer.from('synthetic @company/charts-vue 0.0.12 tarball payload\n');
const TARBALL_SHA256 = createHash('sha256').update(TARBALL_BYTES).digest('hex');
const TARBALL_INTEGRITY = `sha512-${createHash('sha512').update(TARBALL_BYTES).digest('base64')}`;
const TARBALL_SHASUM = createHash('sha1').update(TARBALL_BYTES).digest('hex');
/** core 依赖使用独立的 synthetic bytes，与所选组件包互不混用。 */
const CORE_BYTES = Buffer.from('synthetic echarts 6.1.0 core tarball payload\n');
const CORE_SHA256 = createHash('sha256').update(CORE_BYTES).digest('hex');
const CORE_INTEGRITY = `sha512-${createHash('sha512').update(CORE_BYTES).digest('base64')}`;
const CORE_SHASUM = createHash('sha1').update(CORE_BYTES).digest('hex');
/** 平台摘要与实收 bytes 不一致时用于构造摘要损坏案例。 */
const OTHER_SHA256 = createHash('sha256').update(Buffer.from('different bytes\n')).digest('hex');

const createdDirs: string[] = [];
beforeEach(() => {
  apiRequests.length = 0;
  apiResponses.length = 0;
  apiDefaultTargetSha = TARBALL_SHA256;
  registryRequests.length = 0;
  registryOverrides.clear();
});
afterAll(() => {
  for (const dir of createdDirs) fs.rmSync(dir, { recursive: true, force: true });
  createdDirs.length = 0;
});

function tempProject(name: string, files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `t15-plan-net-${name}-`));
  createdDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return dir;
}

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

function vuePnpmProject(name = 'net-vue-pnpm'): string {
  return tempProject(name, {
    'package.json': manifestJson({
      name: 'host-app', version: '1.0.0', private: true, packageManager: 'pnpm@12.18.0',
      dependencies: { vue: '^3.5.0', echarts: '6.1.0' },
      scripts: { build: 'vite build', typecheck: 'tsc --noEmit' },
    }),
    'pnpm-lock.yaml': pnpmV9Lock({ '.': { vue: { specifier: '^3.5.0', version: '3.5.45' }, echarts: { specifier: '6.1.0', version: '6.1.0' } } }),
  });
}

/** 本地未锁 ECharts的目标项目：core 依赖完全由 GET 明确新增，只能以 registry integrity 核对。 */
function vuePnpmProjectWithoutEcharts(name = 'net-vue-pnpm-no-core'): string {
  return tempProject(name, {
    'package.json': manifestJson({
      name: 'host-app', version: '1.0.0', private: true, packageManager: 'pnpm@12.18.0',
      dependencies: { vue: '^3.5.0' },
      scripts: { build: 'vite build', typecheck: 'tsc --noEmit' },
    }),
    'pnpm-lock.yaml': pnpmV9Lock({ '.': { vue: { specifier: '^3.5.0', version: '3.5.45' } } }),
  });
}

// ─── 受控 loopback 服务与屏障 ───

type ApiStep = { status: number; body: unknown; gate?: Gate };
type RegistryStep =
  | { kind: 'packument'; status: number; body: unknown; gate?: Gate }
  | { kind: 'tarball'; status: number; body: Buffer | string; gate?: Gate }
  | { kind: 'redirect'; status: number; location: string };

/** entered + release 屏障：只有确认请求已进入 handler 才放行，避免用 sleep 冒充“已开始下载”。 */
type Gate = { entered: Promise<void>; enter: () => void; opened: Promise<void>; release: () => void };

function createGate(): Gate {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const opened = new Promise<void>(resolve => { release = resolve; });
  return { entered, enter, opened, release };
}

/** 等请求进入屏障；若产品先失败（RED 期 stub）则返回 'settled'，由调用方按行为断言失败。 */
async function waitForEntry(gate: Gate, pending: Promise<unknown>, label: string): Promise<'entered' | 'settled'> {
  const settled = pending.then(() => 'settled' as const);
  const entered = gate.entered.then(() => 'entered' as const);
  const expired = new Promise<'timeout'>(resolve => { setTimeout(() => resolve('timeout'), 5000); });
  const outcome = await Promise.race([entered, settled, expired]);
  if (outcome === 'timeout') throw new Error(`${label}：请求既未进入屏障也未结束（setup 失败，不是行为 RED）`);
  return outcome;
}

const apiRequests: { url: string; query: URLSearchParams; authorization?: string }[] = [];
const apiResponses: ApiStep[] = [];
const registryRequests: { url: string; authorization?: string }[] = [];
/** API 缺省响应声明的平台摘要；用例可临时改写，使首次与最终复读稳定一致。 */
let apiDefaultTargetSha = TARBALL_SHA256;
/** 按请求路径覆盖 registry 响应（缺省按精确 name/version 路由，其他路径 404）。 */
const registryOverrides = new Map<string, RegistryStep>();

/** 权威 GET 的完整 query：含 packageName 绑定已选包。 */
function expectedQuery(): Record<string, string> {
  return {
    componentId: 'line', framework: 'vue', packageName: PACKAGE_NAME, packageVersion: PACKAGE_VERSION,
    frameworkVersion: '3.5.45', echartsVersion: '6.1.0',
  };
}

function targetFixture(packageSha256: string): Record<string, unknown> {
  return {
    variantReleaseId: '00000000-0000-4000-8000-000000000001', variantId: 'line-vue', componentId: 'line',
    framework: 'vue', packageName: PACKAGE_NAME, packageVersion: PACKAGE_VERSION, packageSha256,
    exportName: 'LineChart', exportPath: './line',
    evidence: [{ kind: 'api', path: 'api/line.json', sha256: 'c'.repeat(64) }, { kind: 'docs', path: 'docs/line.md', sha256: 'd'.repeat(64) }],
    compatibility: { status: 'verified', recordIds: ['synthetic-test-only'] },
    examples: [{ id: 'example', previewEntry: 'preview/index.html' }],
    styleExport: './style.css', readyMethod: 'whenRendered', notes: [],
  };
}

function matchedResponse(packageSha256: string, overrides?: { query?: Record<string, unknown>; api?: unknown }): unknown {
  return {
    schemaVersion: 1,
    query: { ...expectedQuery(), ...overrides?.query },
    status: 'matched', target: targetFixture(packageSha256),
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

function matchPlan(packageSha256: string): MatchPlanV1 {
  const target = targetFixture(packageSha256) as MatchPlanV1['elements'][number]['target'];
  return {
    schemaVersion: 1, source: 'design-id', inputDigest: 'a'.repeat(64), ruleSetId: 'library', revision: 'draft-1',
    context: { framework: 'vue', frameworkVersion: '3.5.45', echartsVersion: '6.1.0', packageManager: 'pnpm', requirements: [] },
    elements: [{ instanceId: 'node-1', designId: '设计/Line', status: 'mapped', target,
      props: [{ name: 'data', type: 'ChartData', required: true, source: 'sales' }, { name: 'config', type: 'LineChartConfig', required: false }],
      events: [{ name: 'point-click', payload: 'ChartEvent', handler: 'showDetail' }], layout: 'grid cell 1', gaps: [] }],
    exactDependencies: [{ name: PACKAGE_NAME, version: PACKAGE_VERSION }], gaps: [],
  } as MatchPlanV1;
}

/** registry packument：只描述被请求的精确 name/version；integrity 由实收 bytes 实算。 */
function packument(name: string, version: string, filename: string, integrity: string, shasum: string): unknown {
  return {
    name, 'dist-tags': { latest: version },
    versions: { [version]: { name, version,
      dist: { tarball: `${registryOrigin}/${name}/-/${filename}`, integrity, shasum } } },
  };
}

/** 所选组件包的精确元数据（平台摘要来自实收 bytes 的 SHA-256）。 */
function componentPackument(integrity = TARBALL_INTEGRITY): unknown {
  return packument(PACKAGE_NAME, PACKAGE_VERSION, TARBALL_FILENAME, integrity, TARBALL_SHASUM);
}

/** 新增 core 依赖的精确元数据：独立 synthetic bytes，只有 registry integrity 可核对。 */
function corePackument(integrity = CORE_INTEGRITY): unknown {
  return packument(CORE_NAME, CORE_VERSION, CORE_FILENAME, integrity, CORE_SHASUM);
}

let apiServer: http.Server;
let registryServer: http.Server;
let apiOrigin = '';
let registryOrigin = '';

beforeAll(async () => {
  apiServer = http.createServer((req, res) => {
    res.on('error', () => { /* 客户端主动断开不应冒泡为未处理异常 */ });
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    apiRequests.push({ url: req.url ?? '/', query: url.searchParams, authorization: req.headers.authorization });
    void (async (): Promise<void> => {
      const step = apiResponses.shift() ?? { status: 200, body: matchedResponse(apiDefaultTargetSha) };
      if (step.gate) {
        step.gate.enter();
        await step.gate.opened;
      }
      res.writeHead(step.status, { 'content-type': 'application/json' });
      res.end(typeof step.body === 'string' ? step.body : JSON.stringify(step.body));
    })();
  });
  await new Promise<void>(resolve => apiServer.listen(0, '127.0.0.1', resolve));
  const apiAddress = apiServer.address();
  apiOrigin = typeof apiAddress === 'object' && apiAddress ? `http://127.0.0.1:${apiAddress.port}` : '';

  registryServer = http.createServer((req, res) => {
    res.on('error', () => { /* 客户端主动断开（如超限中止）不应冒泡为未处理异常 */ });
    const requestUrl = req.url ?? '/';
    registryRequests.push({ url: requestUrl, authorization: req.headers.authorization });
    const override = registryOverrides.get(requestUrl);
    if (override) {
      void (async (): Promise<void> => {
        if (override.kind === 'redirect') {
          res.writeHead(override.status, { location: override.location });
          res.end();
          return;
        }
        if (override.gate) {
          override.gate.enter();
          await override.gate.opened;
        }
        if (override.kind === 'packument') {
          res.writeHead(override.status, { 'content-type': 'application/json' });
          res.end(typeof override.body === 'string' ? override.body : JSON.stringify(override.body));
          return;
        }
        const body = typeof override.body === 'string' ? Buffer.from(override.body) : override.body;
        res.writeHead(override.status, { 'content-type': 'application/octet-stream' });
        res.end(body);
      })();
      return;
    }
    // 缺省：只回答被请求的精确 name/version 与 tarball 路径，其他一律 404（不靠宽泛任意返回放行）。
    if (requestUrl === `/${PACKAGE_NAME}`) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(componentPackument()));
      return;
    }
    if (requestUrl === `/${PACKAGE_NAME}/-/${TARBALL_FILENAME}`) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(TARBALL_BYTES);
      return;
    }
    if (requestUrl === `/${CORE_NAME}`) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(corePackument()));
      return;
    }
    if (requestUrl === `/${CORE_NAME}/-/${CORE_FILENAME}`) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(CORE_BYTES);
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
  registryOverrides.clear();
});

afterAll(async () => {
  await new Promise<void>(resolve => apiServer.close(() => resolve()));
  await new Promise<void>(resolve => registryServer.close(() => resolve()));
});

function planOptions(overrides?: Partial<PlanOptions>): PlanOptions {
  return {
    apiUrl: apiOrigin, registryUrl: registryOrigin, apiToken: API_TOKEN, registryToken: REGISTRY_TOKEN,
    requestTimeoutMs: 15000, ...overrides,
  };
}

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

/** 断言为带稳定 code 的执行错误（CLI 映射 exit 1），而不是结构化计划。 */
function expectPlanError(thrown: unknown, code: string): void {
  expect(thrown, `应抛出 IntegrationPlanError(${code})，实际 ${describeThrown({ thrown })}`).toBeInstanceOf(IntegrationPlanError);
  expect((thrown as IntegrationPlanError).code, `错误 code 应为 ${code}`).toBe(code);
}

describe('T15 P1 接入计划远端边界（loopback 协议测试）', () => {
  it('planned 基线：API 与 registry 均一致，且请求带上各自独立令牌', async () => {
    const root = vuePnpmProject('baseline');
    const plan = matchPlan(TARBALL_SHA256);
    expect(validateMatchPlan(plan).ok, '基线 MatchPlan 必须结构合法').toBe(true);
    expect(validateComponentMatchResponse(matchedResponse(TARBALL_SHA256)).ok, '基线 API 响应必须结构合法').toBe(true);
    const before = treeSnapshot(root);

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `应返回结构化计划而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('planned');
    // 权威 GET 的 query 必须含完整 packageName 绑定。
    expect(apiRequests.length, '至少一次权威 GET').toBeGreaterThan(0);
    for (const request of apiRequests) {
      for (const [key, value] of Object.entries(expectedQuery())) {
        expect(request.query.get(key), `权威 GET query 必须带 ${key}=${value}`).toBe(value);
      }
    }
    // 两类凭据分别注入、互不转发。
    expect(apiRequests.every(r => r.authorization === `Bearer ${API_TOKEN}`)).toBe(true);
    expect(registryRequests.every(r => r.authorization === `Bearer ${REGISTRY_TOKEN}`)).toBe(true);
    // 元数据与 tarball 路径对应精确请求。
    expect(registryRequests.map(r => r.url)).toContain(`/${PACKAGE_NAME}`);
    expect(registryRequests.map(r => r.url)).toContain(`/${PACKAGE_NAME}/-/${TARBALL_FILENAME}`);
    expect(result!.registryEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: PACKAGE_NAME, version: PACKAGE_VERSION, sha256: TARBALL_SHA256, verification: 'platform-sha256' }),
    ]));
    expect(validateIntegrationPlan(result).ok).toBe(true);
    expect(treeSnapshot(root)).toEqual(before);
  });

  it('GET 响应 query 与请求身份不符：MATCH_CONTEXT_MISMATCH 冲突', async () => {
    const root = vuePnpmProject('query-mismatch');
    const plan = matchPlan(TARBALL_SHA256);
    apiResponses.push({ status: 200, body: matchedResponse(TARBALL_SHA256, { query: { frameworkVersion: '3.4.0' } }) });

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `应返回结构化计划而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'MATCH_CONTEXT_MISMATCH' || c.code === 'API_MISMATCH')).toBe(true);
    expect(validateIntegrationPlan(result).ok).toBe(true);
  });

  it('registry tarball 实收 bytes 的 SHA-256 与平台摘要不符：PACKAGE_DIGEST_MISMATCH 冲突', async () => {
    const root = vuePnpmProject('digest-mismatch');
    // 权威 GET 在首次与最终复读中都稳定声明 OTHER_SHA256，而实际 served tarball 仍是正常 bytes：
    // 唯一改变的就是下载摘要与平台摘要不符，才能单独归因到 PACKAGE_DIGEST_MISMATCH
    //（否则首次 GET 就会先触发 TARGET_CHANGED，覆盖不住本用例）。
    apiDefaultTargetSha = OTHER_SHA256;
    const plan = matchPlan(OTHER_SHA256);
    expect(validateMatchPlan(plan).ok, '摘要不一致时 MatchPlan 仍须结构合法').toBe(true);

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `应返回结构化计划而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'PACKAGE_DIGEST_MISMATCH')).toBe(true);
    // 不得把未核对的摘要声称成平台摘要证据。
    expect(result!.registryEvidence.every(r => r.verification !== 'platform-sha256' || r.sha256 === TARBALL_SHA256)).toBe(true);
    // tarball 必须被真实下载（否则谈不上核对下载摘要）。
    expect(registryRequests.map(r => r.url)).toContain(`/${PACKAGE_NAME}/-/${TARBALL_FILENAME}`);
    expect(validateIntegrationPlan(result).ok).toBe(true);
  });

  it('registry dist.integrity 与实收 bytes 不符：拒绝，不伪称已核对', async () => {
    const root = vuePnpmProject('integrity-mismatch');
    const plan = matchPlan(TARBALL_SHA256);
    // packument 声明的 integrity 不是实收 bytes 的真实摘要。
    registryOverrides.set(`/${PACKAGE_NAME}`, { kind: 'packument', status: 200, body: componentPackument(`sha512-${'B'.repeat(86)}==`) });

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(result, 'integrity 不符必须失败，不应返回计划').toBeUndefined();
    expectPlanError(thrown, 'REGISTRY_UNAVAILABLE');
    expect(result?.status).not.toBe('planned');
  });

  it('GET 明确新增 core 依赖：registry-integrity 证据且实际读取 core bytes', async () => {
    // 本地未锁 ECharts，MatchPlan 明确给出候选版本；GET 的 exactDependencies 显式包含该 core。
    const root = vuePnpmProjectWithoutEcharts('new-core');
    const plan = matchPlan(TARBALL_SHA256);
    expect(validateMatchPlan(plan).ok, '新增 core 的 MatchPlan 必须结构合法').toBe(true);
    expect(validateComponentMatchResponse(matchedResponse(TARBALL_SHA256)).ok, '新增 core 的 API 响应必须结构合法').toBe(true);
    const before = treeSnapshot(root);

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `应返回结构化计划而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('planned');
    // 所选组件包仍以平台摘要核对；新增 core 只有 registry integrity 可核对。
    expect(result!.registryEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: PACKAGE_NAME, version: PACKAGE_VERSION, sha256: TARBALL_SHA256, verification: 'platform-sha256' }),
      expect.objectContaining({
        name: CORE_NAME, version: CORE_VERSION, sha256: CORE_SHA256, integrity: CORE_INTEGRITY, verification: 'registry-integrity',
      }),
    ]));
    // 不得把没有平台摘要的 core 声称成平台摘要证据。
    expect(result!.registryEvidence.filter(r => r.name === CORE_NAME).every(r => r.verification !== 'platform-sha256')).toBe(true);
    // core 的元数据与 bytes 必须被真实读取（路径对应精确请求）。
    const urls = registryRequests.map(r => r.url);
    expect(urls).toContain(`/${CORE_NAME}`);
    expect(urls).toContain(`/${CORE_NAME}/-/${CORE_FILENAME}`);
    // 新增 core 需要显式清单修改、锁重建意图与 install 预览。
    expect(result!.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'package-json', path: 'package.json',
        dependencies: expect.arrayContaining([{ name: CORE_NAME, version: CORE_VERSION }, { name: PACKAGE_NAME, version: PACKAGE_VERSION }]) }),
      { kind: 'lockfile-regeneration', path: 'pnpm-lock.yaml' },
    ]));
    expect(result!.commands.some(c => c.purpose === 'install')).toBe(true);
    expect(validateIntegrationPlan(result).ok).toBe(true);
    expect(treeSnapshot(root)).toEqual(before);
  });

  it('core 的 dist.integrity 与实收 bytes 不符：拒绝，不伪称已核对', async () => {
    const root = vuePnpmProjectWithoutEcharts('new-core-bad-integrity');
    const plan = matchPlan(TARBALL_SHA256);
    registryOverrides.set(`/${CORE_NAME}`, { kind: 'packument', status: 200, body: corePackument(`sha512-${'C'.repeat(86)}==`) });

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(result, 'core integrity 不符必须失败，不应返回计划').toBeUndefined();
    expectPlanError(thrown, 'REGISTRY_UNAVAILABLE');
  });

  it('下载超过 50 MiB 限额：执行错误且不在项目内写缓存', async () => {
    const root = vuePnpmProject('oversize');
    const plan = matchPlan(TARBALL_SHA256);
    registryOverrides.set(`/${PACKAGE_NAME}`, { kind: 'packument', status: 200, body: componentPackument() });
    registryOverrides.set(`/${PACKAGE_NAME}/-/${TARBALL_FILENAME}`, { kind: 'tarball', status: 200, body: Buffer.alloc(51 * 1024 * 1024, 0x41) });
    const before = treeSnapshot(root);

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(result, '超限是执行错误，不应返回计划').toBeUndefined();
    expectPlanError(thrown, 'DOWNLOAD_LIMIT_EXCEEDED');
    expect(treeSnapshot(root)).toEqual(before);
  });

  it('请求超时：执行错误，不伪称 matched', async () => {
    const root = vuePnpmProject('timeout');
    const plan = matchPlan(TARBALL_SHA256);
    const gate = createGate();
    apiResponses.push({ status: 200, body: matchedResponse(TARBALL_SHA256), gate });
    const before = treeSnapshot(root);

    const pending = runPlan(root, plan, planOptions({ requestTimeoutMs: 300 }));
    // 请求确实进入屏障后才判定超时（避免等待一个从未发出的请求）。
    expect(await waitForEntry(gate, pending, '超时用例的权威 GET'), '请求应先进入屏障').toBe('entered');
    const { result, thrown } = await pending;

    expect(result, '超时是执行错误，不应返回计划').toBeUndefined();
    expectPlanError(thrown, 'REQUEST_TIMEOUT');
    expect(treeSnapshot(root)).toEqual(before);
  });

  it('registry 跨 origin 重定向：执行错误且不向重定向目的地发任何请求', async () => {
    const root = vuePnpmProject('cross-origin');
    const plan = matchPlan(TARBALL_SHA256);
    const evil = http.createServer((req, res) => {
      registryRequests.push({ url: `EVIL${req.url ?? '/'}`, authorization: req.headers.authorization });
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(Buffer.from('evil\n'));
    });
    await new Promise<void>(resolve => evil.listen(0, '127.0.0.1', resolve));
    const evilAddress = evil.address();
    const evilOrigin = typeof evilAddress === 'object' && evilAddress ? `http://127.0.0.1:${evilAddress.port}` : '';
    registryOverrides.set(`/${PACKAGE_NAME}`, { kind: 'packument', status: 200, body: componentPackument() });
    registryOverrides.set(`/${PACKAGE_NAME}/-/${TARBALL_FILENAME}`,
      { kind: 'redirect', status: 302, location: `${evilOrigin}/${PACKAGE_NAME}/-/${TARBALL_FILENAME}` });

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(result, '跨 origin 跳转是执行错误，不应返回计划').toBeUndefined();
    expectPlanError(thrown, 'REDIRECT_REJECTED');
    expect(registryRequests.some(r => r.url.startsWith('EVIL')), '不得向重定向目的地发请求').toBe(false);
    await new Promise<void>(resolve => evil.close(() => resolve()));
  });

  it('地址含内嵌凭证：执行错误且不发出任何请求', async () => {
    const root = vuePnpmProject('userinfo');
    const plan = matchPlan(TARBALL_SHA256);

    const { result, thrown } = await runPlan(root, plan, planOptions({ apiUrl: 'http://user:pass@127.0.0.1:1' }));

    expect(result, '含 userinfo 的地址是执行错误，不应返回计划').toBeUndefined();
    expectPlanError(thrown, 'INVALID_ENDPOINT');
    expect(apiRequests.length).toBe(0);
    expect(registryRequests.length).toBe(0);
  });

  it('非 loopback 的 HTTP 地址：执行错误且不发出任何请求', async () => {
    const root = vuePnpmProject('plain-http');
    const plan = matchPlan(TARBALL_SHA256);

    const { result, thrown } = await runPlan(root, plan, planOptions({ apiUrl: 'http://example.invalid' }));

    expect(result, '非 loopback HTTP 是执行错误，不应返回计划').toBeUndefined();
    expectPlanError(thrown, 'INVALID_ENDPOINT');
    expect(apiRequests.length).toBe(0);
    expect(registryRequests.length).toBe(0);
  });

  it('网络请求等待期间项目被并发编辑：PROJECT_CHANGED 冲突且保留用户修改', async () => {
    const root = vuePnpmProject('concurrent-edit');
    const plan = matchPlan(TARBALL_SHA256);
    const manifestPath = path.join(root, 'package.json');
    const original = fs.readFileSync(manifestPath, 'utf8');
    // 第一次权威 GET 进入屏障后才改写 package.json，证明编辑发生在请求在途期间。
    const gate = createGate();
    apiResponses.push({ status: 200, body: matchedResponse(TARBALL_SHA256), gate });
    apiResponses.push({ status: 200, body: matchedResponse(TARBALL_SHA256) });

    const pending = runPlan(root, plan, planOptions());
    expect(await waitForEntry(gate, pending, '并发编辑用例的权威 GET'), '请求应先进入屏障').toBe('entered');
    fs.writeFileSync(manifestPath, `${original}\n// 用户并发编辑\n`, 'utf8');
    const afterEdit = treeSnapshot(root);
    gate.release();
    const { result, thrown } = await pending;

    expect(thrown, `并发编辑应以 PROJECT_CHANGED 结构化冲突返回（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'PROJECT_CHANGED')).toBe(true);
    expect(validateIntegrationPlan(result).ok).toBe(true);
    expect(fs.readFileSync(manifestPath, 'utf8')).toBe(`${original}\n// 用户并发编辑\n`);
    expect(treeSnapshot(root)).toEqual(afterEdit);
  });

  it('tarball 响应暂停期间远端撤权：放行后必须复读并拒绝 planned', async () => {
    const root = vuePnpmProject('revoked-during-download');
    const plan = matchPlan(TARBALL_SHA256);
    const gate = createGate();
    registryOverrides.set(`/${PACKAGE_NAME}/-/${TARBALL_FILENAME}`, { kind: 'tarball', status: 200, body: TARBALL_BYTES, gate });
    apiResponses.push({ status: 200, body: matchedResponse(TARBALL_SHA256) });

    const pending = runPlan(root, plan, planOptions());
    // 确认 tarball 请求真的进入屏障（下载被暂停），再切到撤权状态。
    expect(await waitForEntry(gate, pending, '撤权用例的 tarball 下载'), 'tarball 请求应先进入屏障').toBe('entered');
    apiResponses.push({ status: 200, body: gapResponse('TARGET_UNAVAILABLE', 'Target withdrawn during download') });
    gate.release();
    const { result, thrown } = await pending;

    expect(thrown, `撤权应以结构化冲突返回（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'TARGET_UNAVAILABLE' || c.code === 'TARGET_CHANGED')).toBe(true);
    expect(apiRequests.length, '撤权必须由最终复读发现').toBeGreaterThanOrEqual(2);
    expect(validateIntegrationPlan(result).ok).toBe(true);
  });

  it('API 返回 gap（目标不可用）：conflicted 且不输出 target 派生内容', async () => {
    const root = vuePnpmProject('api-gap');
    const plan = matchPlan(TARBALL_SHA256);
    // 首次查询与最终复读都必须是 gap：否则缺省响应会在第二次 GET 时补上 matched target。
    apiResponses.push({ status: 200, body: gapResponse('TARGET_UNAVAILABLE', 'No such target') });
    apiResponses.push({ status: 200, body: gapResponse('TARGET_UNAVAILABLE', 'No such target') });

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `应返回结构化计划而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'TARGET_UNAVAILABLE')).toBe(true);
    expect(result!.changes.some(c => c.kind === 'generated-component')).toBe(false);
    expect(validateIntegrationPlan(result).ok).toBe(true);
  });

  it('远端 5xx：执行错误 REGISTRY_UNAVAILABLE，且错误消息与计划都不含凭据', async () => {
    const root = vuePnpmProject('token-leak');
    const plan = matchPlan(TARBALL_SHA256);
    // 远端在错误体里回显两类令牌：实现不得把它们带进自己的错误消息。
    apiResponses.push({ status: 500, body: `boom ${API_TOKEN} ${REGISTRY_TOKEN}` });

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(result, '远端失败是执行错误，不应返回计划').toBeUndefined();
    expectPlanError(thrown, 'REGISTRY_UNAVAILABLE');
    const serialized = JSON.stringify({
      result: result ?? null,
      code: (thrown as IntegrationPlanError | undefined)?.code ?? null,
      message: thrown instanceof Error ? thrown.message : String(thrown),
    });
    expect(serialized).not.toContain(API_TOKEN);
    expect(serialized).not.toContain(REGISTRY_TOKEN);
  });
});

// ─── 原 P1 候选审查回归（.superpowers/t15/c-plan-product-review-2026-11-17.md） ───
//
// 覆盖 7 项 Important：① 链接/junction 逃逸与链接读取；② 新增依赖最后下载期间撤权/编辑；
// ③ 原先不存在的第二锁/workspace 声明；④ 新依赖缺 integrity 不得自算冒验证；
// ⑤ 真实组件 bytes 损坏须 PACKAGE_DIGEST_MISMATCH；⑦ 远端算法/JSON 异常/冲突消息凭据脱敏。
// （⑥ 单一 JSON stdout 的失败矩阵在 project-plan.test.ts，直接走 runIntegrateCommand。）
//
// 全部用例沿用合法源输入、实算 bytes/integrity、gate entered 后才改状态、完整树基准；
// 链接创建失败一律抛 setup 错误，不静默跳过。

/** 不含连字符的远端受控 token：用于确认实现不会把远端值回显进诊断/计划。 */
const REMOTE_TOKEN = 'syntheticregistrytokenQ7X2';
const EXTERNAL_MANIFEST_BYTES = Buffer.from('{"name":"external-app","version":"9.9.9","private":true}\n');
const EXTERNAL_LOCK_BYTES = Buffer.from('lockfileVersion: "9.0"\n# external lock bytes\n');

const externalDirs: string[] = [];
afterAll(() => {
  for (const dir of externalDirs) fs.rmSync(dir, { recursive: true, force: true });
  externalDirs.length = 0;
});

function externalDir(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `t15-external-${name}-`));
  externalDirs.push(dir);
  return dir;
}

/**
 * 创建目录链接：Windows 用 junction（无需管理员特权），POSIX 退回目录符号链接。
 * 两种方式都创建失败时抛错——链接控制不可静默跳过。
 */
function linkDirectory(linkPath: string, target: string): void {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  try {
    fs.symlinkSync(target, linkPath, 'junction');
  } catch {
    fs.symlinkSync(target, linkPath, 'dir');
  }
}

/** 控制正例：链接必须真的指向外部目录，否则后续断言没有意义。 */
function assertDirectoryLinkEscapes(linkPath: string, target: string): void {
  let real: string;
  try {
    real = fs.realpathSync(linkPath);
  } catch {
    throw new Error(`setup 失败：目录链接未创建成功 ${linkPath}`);
  }
  if (fs.realpathSync(target) !== real) {
    throw new Error(`setup 失败：目录链接未指向目标 ${linkPath} -> ${real}`);
  }
}

/** 在项目外写入一份与项目内不同的成员清单/锁，用作链接目标。 */
function writeExternalMember(external: string): string {
  const member = path.join(external, 'member');
  fs.mkdirSync(member, { recursive: true });
  fs.writeFileSync(path.join(member, 'package.json'), EXTERNAL_MANIFEST_BYTES);
  fs.writeFileSync(path.join(member, 'pnpm-lock.yaml'), EXTERNAL_LOCK_BYTES);
  return member;
}

/** 单包 + 显式 workspace 成员：根声明 pnpm 与 apps/*，成员自带清单与锁。 */
function workspaceProject(name: string, external?: string): string {
  const root = tempProject(name, {
    'package.json': manifestJson({
      name: 'monorepo-root', version: '1.0.0', private: true, packageManager: 'pnpm@12.18.0',
    }),
    'pnpm-workspace.yaml': yamlStringify({ packages: ['apps/*'] }),
  });
  if (external === undefined) {
    fs.mkdirSync(path.join(root, 'apps/client'), { recursive: true });
    fs.writeFileSync(path.join(root, 'apps/client/package.json'), manifestJson({
      name: 'host-app', version: '1.0.0', private: true, packageManager: 'pnpm@12.18.0',
      dependencies: { vue: '^3.5.0', echarts: '6.1.0' },
      scripts: { build: 'vite build', typecheck: 'tsc --noEmit' },
    }), 'utf8');
    fs.writeFileSync(path.join(root, 'apps/client/pnpm-lock.yaml'),
      pnpmV9Lock({ '.': { vue: { specifier: '^3.5.0', version: '3.5.45' }, echarts: { specifier: '6.1.0', version: '6.1.0' } } }), 'utf8');
  } else {
    const member = writeExternalMember(external);
    linkDirectory(path.join(root, 'apps/client'), member);
    assertDirectoryLinkEscapes(path.join(root, 'apps/client'), member);
  }
  return root;
}

/** 断言计划里没有出现项目外文件的实算摘要（即实现没有跟随链接读取外部 bytes）。 */
function expectNoExternalDigest(result: IntegrationPlanV1, externalBytes: Buffer[]): void {
  const serialized = JSON.stringify(result);
  for (const bytes of externalBytes) {
    const digest = createHash('sha256').update(bytes).digest('hex');
    expect(serialized, '计划不得包含项目外文件的实算摘要（禁止跟随链接读取）').not.toContain(digest);
  }
}

describe('T15 P1 候选审查回归：链接/junction 逃逸与外部读取', () => {
  it('拟生成文件缺失但父目录是逃逸 junction：PATH_UNSAFE 且不向项目外生成', async () => {
    const root = vuePnpmProject('escape-parent');
    const plan = matchPlan(TARBALL_SHA256);
    const outside = externalDir('parent');
    fs.mkdirSync(outside, { recursive: true });
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    linkDirectory(path.join(root, 'src/components'), outside);
    assertDirectoryLinkEscapes(path.join(root, 'src/components'), outside);
    const externalBefore = fs.readdirSync(outside).sort();

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `应返回结构化计划而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'PATH_UNSAFE'), '父目录逃逸必须 PATH_UNSAFE').toBe(true);
    expect(validateIntegrationPlan(result).ok).toBe(true);
    // 不得在项目外（junction 目标）留下任何生成物。
    expect(fs.readdirSync(outside).sort()).toEqual(externalBefore);
  });

  it('既有 junction 承载拟生成目标文件：PATH_UNSAFE 且不读取项目外 bytes', async () => {
    const root = vuePnpmProject('existing-link');
    const plan = matchPlan(TARBALL_SHA256);
    const outside = externalDir('existing-link');
    // 链接目标里已经存在拟生成文件（内容与项目内不同）：既不能被当作“可覆盖的本地文件”，
    // 也不能为了做快照而把项目外 bytes 读出来。
    const externalTarget = path.join(outside, 'components/zhinexus');
    fs.mkdirSync(externalTarget, { recursive: true });
    fs.writeFileSync(path.join(externalTarget, 'component-0001.vue'), EXTERNAL_MANIFEST_BYTES);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    linkDirectory(path.join(root, 'src/components'), path.join(outside, 'components'));
    assertDirectoryLinkEscapes(path.join(root, 'src/components'), path.join(outside, 'components'));
    const generated = path.join(root, 'src/components/zhinexus/component-0001.vue');
    expect(fs.existsSync(generated), '控制正例：拟生成路径经链接已存在于项目外').toBe(true);

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `应返回结构化计划而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'PATH_UNSAFE'), '经链接逃逸的拟生成路径必须 PATH_UNSAFE').toBe(true);
    expectNoExternalDigest(result!, [EXTERNAL_MANIFEST_BYTES]);
    expect(validateIntegrationPlan(result).ok).toBe(true);
    // 外部 bytes 与链接本身保持原状。
    expect(fs.readFileSync(path.join(externalTarget, 'component-0001.vue'))).toEqual(EXTERNAL_MANIFEST_BYTES);
    expect(fs.readdirSync(path.join(outside, 'components')).sort()).toEqual(['zhinexus']);
  });

  it('等待期间目标目录被换成逃逸 junction：PATH_UNSAFE 且不读取项目外 bytes', async () => {
    const outside = externalDir('swap-link');
    const root = workspaceProject('swap-link');
    const gate = createGate();
    apiResponses.push({ status: 200, body: matchedResponse(TARBALL_SHA256), gate });
    apiResponses.push({ status: 200, body: matchedResponse(TARBALL_SHA256) });

    const pending = runPlan(root, matchPlan(TARBALL_SHA256), planOptions({ workspace: 'apps/client' }));
    expect(await waitForEntry(gate, pending, '链接替换用例的权威 GET'), '请求应先进入屏障').toBe('entered');
    // 用户把成员目录整体换成指向项目外的 junction（模拟链接替换）。
    fs.rmSync(path.join(root, 'apps/client'), { recursive: true, force: true });
    const member = writeExternalMember(outside);
    linkDirectory(path.join(root, 'apps/client'), member);
    assertDirectoryLinkEscapes(path.join(root, 'apps/client'), member);
    const afterEdit = treeSnapshot(root);
    gate.release();
    const { result, thrown } = await pending;

    expect(thrown, `链接替换应以结构化冲突返回（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'PATH_UNSAFE'), '等待期间换成逃逸链接必须 PATH_UNSAFE').toBe(true);
    expectNoExternalDigest(result!, [EXTERNAL_MANIFEST_BYTES, EXTERNAL_LOCK_BYTES]);
    expect(validateIntegrationPlan(result).ok).toBe(true);
    expect(treeSnapshot(root)).toEqual(afterEdit);
  });

  // 最终整分支审查候选 ④：dangling 链接（lstat 仍在、realpath ENOENT）不能被当成普通缺失段拼回。
  it('拟生成父目录是指向项目外且目标不存在的 junction：PATH_UNSAFE 且不读写项目外', async () => {
    const root = vuePnpmProject('dangling-link');
    const plan = matchPlan(TARBALL_SHA256);
    expect(validateMatchPlan(plan).ok, 'dangling 链接用例的源 MatchPlan 必须结构合法').toBe(true);
    // 链接目标目录尚不存在：lstat 仍显示链接存在，但 realpath 为 ENOENT（Windows 真实 dangling junction 的形态）。
    const outside = externalDir('dangling-target');
    fs.rmSync(outside, { recursive: true, force: true });
    linkDirectory(path.join(root, 'src'), outside);
    // 控制正例：链接必须真的创建成功、真的 dangling、目标必须真的不存在——否则夹具没有意义。
    expect(fs.lstatSync(path.join(root, 'src')).isSymbolicLink(), 'src 必须是真实链接/junction').toBe(true);
    expect(() => fs.realpathSync(path.join(root, 'src')), '链接目标必须尚不存在（dangling）').toThrow();
    expect(fs.existsSync(outside), '链接目标目录必须不存在').toBe(false);
    const afterLink = treeSnapshot(root);
    apiResponses.push({ status: 200, body: matchedResponse(TARBALL_SHA256) });
    apiResponses.push({ status: 200, body: matchedResponse(TARBALL_SHA256) });

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `dangling 逃逸链接应以结构化冲突返回而非崩溃（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'PATH_UNSAFE'), 'dangling 逃逸链接必须 PATH_UNSAFE').toBe(true);
    expect(validateIntegrationPlan(result).ok).toBe(true);
    // 不得在项目外留下任何生成物，也不得把项目外路径写进计划。
    expect(fs.existsSync(outside), '不得创建链接目标目录').toBe(false);
    expect(JSON.stringify(result), '计划不得包含项目外路径').not.toContain(outside);
    // 用户字节与链接本身保持原状（含 dangling 链接自身）。
    expect(treeSnapshot(root)).toEqual(afterLink);
  });

  // 最终整分支审查候选 ④（窄复核）：两跳 dangling。src 声明目标词法在项目内、物理仍逃逸：
  // 单跳 readlink 会把“未解析的链接声明”当成已解析的真实落点，因此必须失败关闭。
  it('两跳 dangling（src→项目内 bridge/future，bridge→项目外不存在目录）：PATH_UNSAFE 且不外读', async () => {
    const root = vuePnpmProject('dangling-two-hop');
    const plan = matchPlan(TARBALL_SHA256);
    expect(validateMatchPlan(plan).ok, '两跳 dangling 用例的源 MatchPlan 必须结构合法').toBe(true);
    const outside = externalDir('two-hop-target');
    fs.rmSync(outside, { recursive: true, force: true });
    // 第一跳：src 指向项目内、尚不存在的 bridge/future（词法落在项目内）。
    linkDirectory(path.join(root, 'src'), path.join(root, 'bridge/future'));
    // 第二跳：bridge 指向项目外、尚不存在的目录（物理逃逸）。
    linkDirectory(path.join(root, 'bridge'), outside);
    // 先验断言：两个链接都必须真实存在且真的 dangling，src 的声明目标必须词法落在项目内。
    expect(fs.lstatSync(path.join(root, 'src')).isSymbolicLink(), 'src 必须是真实链接/junction').toBe(true);
    expect(fs.lstatSync(path.join(root, 'bridge')).isSymbolicLink(), 'bridge 必须是真实链接/junction').toBe(true);
    expect(() => fs.realpathSync(path.join(root, 'src')), 'src 的目标必须尚不存在（dangling）').toThrow();
    expect(() => fs.realpathSync(path.join(root, 'bridge')), 'bridge 的目标必须尚不存在（dangling）').toThrow();
    const declared = path.resolve(fs.readlinkSync(path.join(root, 'src')));
    expect(declared.startsWith(`${root}${path.sep}`), 'src 声明的目标必须词法落在项目内（否则不是两跳陷阱）').toBe(true);
    expect(fs.existsSync(outside), '两跳的最终目标必须不存在').toBe(false);
    const afterLink = treeSnapshot(root);
    apiResponses.push({ status: 200, body: matchedResponse(TARBALL_SHA256) });
    apiResponses.push({ status: 200, body: matchedResponse(TARBALL_SHA256) });

    const { result, thrown } = await runPlan(root, plan, planOptions());

    // 无法证明 realpath 落在项目内时必须失败关闭：合法 conflicted + PATH_UNSAFE，而不是按词法放行。
    expect(thrown, `两跳 dangling 逃逸应以结构化冲突返回而非崩溃（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'PATH_UNSAFE'), '两跳 dangling 逃逸必须 PATH_UNSAFE').toBe(true);
    expect(validateIntegrationPlan(result).ok).toBe(true);
    // 不得读取项目外 bytes，也不得在项目外留下任何生成物。
    expect(fs.existsSync(outside), '不得创建两跳的最终目标目录').toBe(false);
    expect(JSON.stringify(result), '计划不得包含项目外路径').not.toContain(outside);
    expect(treeSnapshot(root)).toEqual(afterLink);
  });
});

describe('T15 P1 候选审查回归：新增依赖最后下载期间的状态变化', () => {
  it('新增 core 依赖下载期间远端撤权：放行后必须复读并拒绝 planned', async () => {
    const root = vuePnpmProjectWithoutEcharts('new-core-revoked');
    const plan = matchPlan(TARBALL_SHA256);
    const gate = createGate();
    registryOverrides.set(`/${CORE_NAME}/-/${CORE_FILENAME}`, { kind: 'tarball', status: 200, body: CORE_BYTES, gate });
    apiResponses.push({ status: 200, body: matchedResponse(TARBALL_SHA256) });

    const pending = runPlan(root, plan, planOptions());
    expect(await waitForEntry(gate, pending, '新增依赖撤权用例的 core tarball'), 'core tarball 请求应先进入屏障').toBe('entered');
    apiResponses.push({ status: 200, body: gapResponse('TARGET_UNAVAILABLE', 'Withdrawn after core download') });
    gate.release();
    const { result, thrown } = await pending;

    expect(thrown, `撤权应以结构化冲突返回（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'TARGET_UNAVAILABLE' || c.code === 'TARGET_CHANGED')).toBe(true);
    expect(apiRequests.length, '全部 registry 材料结束后必须再 GET 复读').toBeGreaterThanOrEqual(2);
    expect(validateIntegrationPlan(result).ok).toBe(true);
  });

  it('新增 core 依赖下载期间关键文件被编辑：PROJECT_CHANGED 且保留用户修改', async () => {
    const root = vuePnpmProjectWithoutEcharts('new-core-edited');
    const plan = matchPlan(TARBALL_SHA256);
    const manifestPath = path.join(root, 'package.json');
    const original = fs.readFileSync(manifestPath, 'utf8');
    const gate = createGate();
    registryOverrides.set(`/${CORE_NAME}/-/${CORE_FILENAME}`, { kind: 'tarball', status: 200, body: CORE_BYTES, gate });
    apiResponses.push({ status: 200, body: matchedResponse(TARBALL_SHA256) });

    const pending = runPlan(root, plan, planOptions());
    expect(await waitForEntry(gate, pending, '新增依赖编辑用例的 core tarball'), 'core tarball 请求应先进入屏障').toBe('entered');
    fs.writeFileSync(manifestPath, `${original}\n// 用户在新依赖下载期间编辑\n`, 'utf8');
    const afterEdit = treeSnapshot(root);
    gate.release();
    const { result, thrown } = await pending;

    expect(thrown, `并发编辑应以结构化冲突返回（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'PROJECT_CHANGED')).toBe(true);
    expect(validateIntegrationPlan(result).ok).toBe(true);
    expect(fs.readFileSync(manifestPath, 'utf8')).toBe(`${original}\n// 用户在新依赖下载期间编辑\n`);
    expect(treeSnapshot(root)).toEqual(afterEdit);
  });
});

describe('T15 P1 候选审查回归：原先不存在的第二锁与 workspace 声明', () => {
  it('planned 基线把可能影响识别的关键路径记为 exists:false', async () => {
    const root = vuePnpmProject('probe-paths');
    const plan = matchPlan(TARBALL_SHA256);

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `应返回结构化计划而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('planned');
    // plan 自行探测这些路径（不改 inspection 的已冻结输出）：原本不存在就以 exists:false 记录。
    expect(result!.baseFileHashes).toEqual(expect.arrayContaining([
      { path: 'package-lock.json', exists: false },
      { path: 'pnpm-workspace.yaml', exists: false },
    ]));
    expect(validateIntegrationPlan(result).ok).toBe(true);
  });

  it('下载期间新增第二锁 package-lock.json：PROJECT_CHANGED 且保留用户新文件', async () => {
    const root = vuePnpmProject('new-second-lock');
    const plan = matchPlan(TARBALL_SHA256);
    const secondLock = path.join(root, 'package-lock.json');
    const gate = createGate();
    apiResponses.push({ status: 200, body: matchedResponse(TARBALL_SHA256), gate });
    apiResponses.push({ status: 200, body: matchedResponse(TARBALL_SHA256) });

    const pending = runPlan(root, plan, planOptions());
    expect(await waitForEntry(gate, pending, '第二锁用例的权威 GET'), '请求应先进入屏障').toBe('entered');
    fs.writeFileSync(secondLock, JSON.stringify({ lockfileVersion: 3, packages: {} }), 'utf8');
    const afterEdit = treeSnapshot(root);
    gate.release();
    const { result, thrown } = await pending;

    expect(thrown, `新增第二锁应以结构化冲突返回（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'PROJECT_CHANGED')).toBe(true);
    expect(validateIntegrationPlan(result).ok).toBe(true);
    expect(fs.existsSync(secondLock), '用户新建的锁文件必须保留').toBe(true);
    expect(treeSnapshot(root)).toEqual(afterEdit);
  });

  it('下载期间单包新增 pnpm-workspace.yaml：PROJECT_CHANGED 且保留用户新文件', async () => {
    const root = vuePnpmProject('new-workspace-file');
    const plan = matchPlan(TARBALL_SHA256);
    const workspaceFile = path.join(root, 'pnpm-workspace.yaml');
    const gate = createGate();
    apiResponses.push({ status: 200, body: matchedResponse(TARBALL_SHA256), gate });
    apiResponses.push({ status: 200, body: matchedResponse(TARBALL_SHA256) });

    const pending = runPlan(root, plan, planOptions());
    expect(await waitForEntry(gate, pending, 'workspace 声明用例的权威 GET'), '请求应先进入屏障').toBe('entered');
    fs.writeFileSync(workspaceFile, yamlStringify({ packages: ['apps/*'] }), 'utf8');
    const afterEdit = treeSnapshot(root);
    gate.release();
    const { result, thrown } = await pending;

    expect(thrown, `新增 workspace 声明应以结构化冲突返回（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'PROJECT_CHANGED')).toBe(true);
    expect(validateIntegrationPlan(result).ok).toBe(true);
    expect(fs.existsSync(workspaceFile), '用户新建的 workspace 声明必须保留').toBe(true);
    expect(treeSnapshot(root)).toEqual(afterEdit);
  });
});

describe('T15 P1 候选审查回归：registry 摘要与声明核对', () => {
  it('新增 core 依赖元数据缺 integrity（只有 shasum）：执行失败且不伪造验证证据', async () => {
    const root = vuePnpmProjectWithoutEcharts('new-core-no-integrity');
    const plan = matchPlan(TARBALL_SHA256);
    // 元数据给出正确的 shasum 但没有 integrity：不得用自算摘要或 shasum 冒充已核对的 registry 声明。
    registryOverrides.set(`/${CORE_NAME}`, {
      kind: 'packument', status: 200,
      body: {
        name: CORE_NAME, 'dist-tags': { latest: CORE_VERSION },
        versions: { [CORE_VERSION]: { name: CORE_NAME, version: CORE_VERSION,
          dist: { tarball: `${registryOrigin}/${CORE_NAME}/-/${CORE_FILENAME}`, shasum: CORE_SHASUM } } },
      },
    });
    const before = treeSnapshot(root);

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(result, '缺 integrity 的新增依赖必须执行失败，不应返回计划').toBeUndefined();
    expectPlanError(thrown, 'REGISTRY_UNAVAILABLE');
    expect(result?.registryEvidence ?? []).toEqual([]);
    expect(treeSnapshot(root)).toEqual(before);
  });

  it('所选组件元数据缺 integrity：仍按平台 SHA 处理（与新增依赖区分）', async () => {
    const root = vuePnpmProject('component-no-integrity');
    const plan = matchPlan(TARBALL_SHA256);
    registryOverrides.set(`/${PACKAGE_NAME}`, {
      kind: 'packument', status: 200,
      body: {
        name: PACKAGE_NAME, 'dist-tags': { latest: PACKAGE_VERSION },
        versions: { [PACKAGE_VERSION]: { name: PACKAGE_NAME, version: PACKAGE_VERSION,
          dist: { tarball: `${registryOrigin}/${PACKAGE_NAME}/-/${TARBALL_FILENAME}`, shasum: TARBALL_SHASUM } } },
      },
    });

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `所选组件仍应按平台 SHA 处理（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('planned');
    expect(result!.registryEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: PACKAGE_NAME, version: PACKAGE_VERSION, sha256: TARBALL_SHA256, verification: 'platform-sha256' }),
    ]));
    expect(validateIntegrationPlan(result).ok).toBe(true);
  });

  it('真实组件 tarball bytes 损坏（元数据与平台摘要正常）：PACKAGE_DIGEST_MISMATCH 冲突', async () => {
    const root = vuePnpmProject('corrupt-tarball');
    const plan = matchPlan(TARBALL_SHA256);
    // 只翻转 served bytes：元数据（integrity/shasum）与平台摘要都保持正常，
    // 因此失败点必须落在“实收 bytes 的 SHA-256 与平台摘要不符”，而不是 REGISTRY_UNAVAILABLE。
    const corrupted = Buffer.from(TARBALL_BYTES);
    corrupted[corrupted.length - 1] = corrupted[corrupted.length - 1] === 0x0a ? 0x0b : 0x0a;
    expect(createHash('sha256').update(corrupted).digest('hex'), '夹具必须真的损坏 bytes').not.toBe(TARBALL_SHA256);
    registryOverrides.set(`/${PACKAGE_NAME}`, { kind: 'packument', status: 200, body: componentPackument() });
    registryOverrides.set(`/${PACKAGE_NAME}/-/${TARBALL_FILENAME}`, { kind: 'tarball', status: 200, body: corrupted });

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `bytes 损坏应返回合法 conflicted 计划而非抛错（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'PACKAGE_DIGEST_MISMATCH')).toBe(true);
    // tarball 必须被真实下载（否则谈不上核对实收摘要）。
    expect(registryRequests.map(r => r.url)).toContain(`/${PACKAGE_NAME}/-/${TARBALL_FILENAME}`);
    expect(result!.registryEvidence.every(r => r.verification !== 'platform-sha256' || r.sha256 === TARBALL_SHA256)).toBe(true);
    expect(validateIntegrationPlan(result).ok).toBe(true);
  });
});

describe('T15 P1 候选审查回归：远端值脱敏', () => {
  it('registry dist.integrity 算法字段带回显 token：执行失败且诊断不含远端值', async () => {
    const root = vuePnpmProject('remote-alg-token');
    const plan = matchPlan(TARBALL_SHA256);
    // token 不含连字符，被放进算法字段：实现不得把它回显进错误消息。
    registryOverrides.set(`/${PACKAGE_NAME}`, {
      kind: 'packument', status: 200, body: componentPackument(`${REMOTE_TOKEN}-tail`),
    });

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(result, '不支持的完整性算法必须执行失败，不应返回计划').toBeUndefined();
    expectPlanError(thrown, 'REGISTRY_UNAVAILABLE');
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    expect(message, '诊断不得回显远端算法字段').not.toContain(REMOTE_TOKEN);
    expect(message, '诊断应是固定文案，不夹带远端内容').toMatch(/^registry dist\.integrity/);
  });

  it('registry 元数据不是合法 JSON 且体内含 token：执行失败且不回显原文', async () => {
    const root = vuePnpmProject('remote-bad-json');
    const plan = matchPlan(TARBALL_SHA256);
    const raw = `not-json ${REMOTE_TOKEN} {{{`;
    registryOverrides.set(`/${PACKAGE_NAME}`, { kind: 'packument', status: 200, body: raw });

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(result, '非法 JSON 必须执行失败，不应返回计划').toBeUndefined();
    expectPlanError(thrown, 'REGISTRY_UNAVAILABLE');
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    expect(message, '诊断不得回显远端原文').not.toContain(REMOTE_TOKEN);
    expect(message).not.toContain('not-json');
  });

  it('远端 gap 消息带回显 token：conflicted 且计划 JSON 不含两类凭据', async () => {
    const root = vuePnpmProject('gap-token');
    const plan = matchPlan(TARBALL_SHA256);
    const leaky = `target gone ${API_TOKEN} ${REGISTRY_TOKEN}`;
    apiResponses.push({ status: 200, body: gapResponse('TARGET_UNAVAILABLE', leaky) });
    apiResponses.push({ status: 200, body: gapResponse('TARGET_UNAVAILABLE', leaky) });

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `gap 应以结构化冲突返回（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'TARGET_UNAVAILABLE')).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized, '计划 JSON 不得含 API 令牌').not.toContain(API_TOKEN);
    expect(serialized, '计划 JSON 不得含 registry 令牌').not.toContain(REGISTRY_TOKEN);
    expect(validateIntegrationPlan(result).ok).toBe(true);
  });
});

// ─── 最终整分支审查回归（C 2026-11-17 整分支审查候选 ②③；本轮只写测试，产品一字未改） ───
//
// ② matched + 兼容未验证的响应：gaps[].message 是远端可控文本，可能夹带凭据；publicationEvidence
//    原样保存响应会把它带进计划 JSON 与 CLI stdout。必须脱敏，同时保留 gap code 与兼容阻塞。
// ③ 权威 GET 的 exactDependencies 要求一个本地已锁但精确版本不同的运行时依赖：必须给出合法结构化
//    冲突（DEPENDENCY_CONFLICT 等，exit 2），而不是 schema crash；不得把冲突版本写进
//    exactDependencies 冒充一致，用户文件与已有锁版本必须原样保留。
//
// 全部用例沿用合法源输入（validateMatchPlan）与合法权威响应（validateComponentMatchResponse）先验断言、
// 实算 bytes/integrity、真实 loopback 服务，并断言目标全树零写入。

/** 本地已锁、而权威 GET 要求另一精确版本的运行时依赖（真实版本冲突，不是所选组件包本身）。 */
const CHARTS_CORE_NAME = '@company/charts-core';
const CHARTS_CORE_LOCKED = '0.0.10';
const CHARTS_CORE_REQUIRED = '0.0.12';

/** matched + 兼容未验证的权威响应：gaps 只带 COMPATIBILITY_UNVERIFIED，message 由调用方提供（可含远端回显值）。 */
function unverifiedResponse(message: string): unknown {
  const base = matchedResponse(TARBALL_SHA256) as Record<string, unknown>;
  return {
    ...base,
    target: { ...(base.target as Record<string, unknown>), compatibility: { status: 'unverified', recordIds: [] } },
    gaps: [{ code: 'COMPATIBILITY_UNVERIFIED', message }],
  };
}

/** 权威 GET 的 exactDependencies 额外要求一个本地已锁但精确版本不同的运行时依赖。 */
function matchedResponseWithCoreConflict(): unknown {
  const base = matchedResponse(TARBALL_SHA256) as Record<string, unknown>;
  return {
    ...base,
    exactDependencies: [
      { name: PACKAGE_NAME, version: PACKAGE_VERSION },
      { name: 'vue', version: '3.5.45' },
      { name: 'echarts', version: CORE_VERSION },
      { name: CHARTS_CORE_NAME, version: CHARTS_CORE_REQUIRED },
    ],
  };
}

describe('T15 P1 最终整分支审查回归：远端受控值脱敏与本地锁冲突', () => {
  it('matched + 兼容未验证且 gaps[].message 带回显 token：conflicted 且 CLI/库结果都不含两类凭据', async () => {
    const root = vuePnpmProject('unverified-gap-token');
    const plan = matchPlan(TARBALL_SHA256);
    const element = plan.elements[0]!;
    // 源 MatchPlan 自身改为兼容未验证（target 状态与 element gap 一致），仍须结构合法。
    element.target = { ...element.target!, compatibility: { status: 'unverified', recordIds: [] } };
    element.gaps = [{ code: 'COMPATIBILITY_UNVERIFIED', message: 'synthetic：缺少实测组合' }];
    expect(validateMatchPlan(plan).ok, '兼容未验证的源 MatchPlan 必须结构合法').toBe(true);
    const leaky = `synthetic：缺少实测组合 ${API_TOKEN} ${REGISTRY_TOKEN}`;
    expect(validateComponentMatchResponse(unverifiedResponse(leaky)).ok, '带回显 token 的 matched 响应必须结构合法').toBe(true);
    const before = treeSnapshot(root);
    apiResponses.push({ status: 200, body: unverifiedResponse(leaky) });
    apiResponses.push({ status: 200, body: unverifiedResponse(leaky) });

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `兼容未验证应以结构化冲突返回（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    // 保留 gap code 与兼容阻塞（不得为了脱敏把冲突一起吞掉）。
    expect(result!.conflicts.some(c => c.code === 'COMPATIBILITY_UNVERIFIED')).toBe(true);
    // 发布证据仍然保留（不得靠删空证据规避），且脱敏后仍带 gap code。
    expect(result!.publicationEvidence.length, '发布证据不得被删空').toBeGreaterThan(0);
    expect(result!.publicationEvidence.every(e => e.response.gaps.some(g => g.code === 'COMPATIBILITY_UNVERIFIED'))).toBe(true);
    // 库结果 JSON 不得含两类凭据（publicationEvidence 原样保存远端响应会泄漏）。
    const serialized = JSON.stringify(result);
    expect(serialized, '计划 JSON 不得含 API 令牌').not.toContain(API_TOKEN);
    expect(serialized, '计划 JSON 不得含 registry 令牌').not.toContain(REGISTRY_TOKEN);
    expect(validateIntegrationPlan(result).ok).toBe(true);
    expect(treeSnapshot(root)).toEqual(before);

    // 完整 CLI：stdout/stderr 都不得含两类凭据，冲突仍以 exit 2 返回。
    const matchFile = path.join(path.dirname(root), `net-unverified-${Date.now()}.json`);
    fs.writeFileSync(matchFile, JSON.stringify(plan));
    const savedApiToken = process.env.ZHINEXUS_API_TOKEN;
    const savedRegistryToken = process.env.ZHINEXUS_REGISTRY_TOKEN;
    process.env.ZHINEXUS_API_TOKEN = API_TOKEN;
    process.env.ZHINEXUS_REGISTRY_TOKEN = REGISTRY_TOKEN;
    try {
      apiResponses.push({ status: 200, body: unverifiedResponse(leaky) });
      apiResponses.push({ status: 200, body: unverifiedResponse(leaky) });
      const cli = await runIntegrateCommand(['plan', '--project', root,
        '--match', matchFile, '--api-url', apiOrigin, '--registry', registryOrigin]);
      expect(cli.exitCode, '兼容未验证应形成含 conflicts 的结构化结果').toBe(2);
      expect(cli.stdout + cli.stderr, 'CLI 输出不得含 API 令牌').not.toContain(API_TOKEN);
      expect(cli.stdout + cli.stderr, 'CLI 输出不得含 registry 令牌').not.toContain(REGISTRY_TOKEN);
      const parsed = JSON.parse(cli.stdout) as { status: string; conflicts: { code: string }[] };
      expect(parsed.status).toBe('conflicted');
      expect(parsed.conflicts.some(c => c.code === 'COMPATIBILITY_UNVERIFIED')).toBe(true);
      // CLI 调用同样不得写入目标项目（与库调用后的基准比较）。
      expect(treeSnapshot(root)).toEqual(before);
    } finally {
      fs.rmSync(matchFile, { force: true });
      if (savedApiToken === undefined) delete process.env.ZHINEXUS_API_TOKEN; else process.env.ZHINEXUS_API_TOKEN = savedApiToken;
      if (savedRegistryToken === undefined) delete process.env.ZHINEXUS_REGISTRY_TOKEN; else process.env.ZHINEXUS_REGISTRY_TOKEN = savedRegistryToken;
    }
  });

  it('本地已锁 @company/charts-core@0.0.10 而 GET exactDependencies 要求 0.0.12：合法结构化冲突且不升级', async () => {
    const root = vuePnpmProject('locked-core-conflict');
    // 本地锁里已有同一个运行时依赖，但精确版本与权威 GET 要求的不同。
    fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), pnpmV9Lock({ '.': {
      vue: { specifier: '^3.5.0', version: '3.5.45' }, echarts: { specifier: '6.1.0', version: '6.1.0' },
      [CHARTS_CORE_NAME]: { specifier: CHARTS_CORE_LOCKED, version: CHARTS_CORE_LOCKED },
    } }), 'utf8');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as Record<string, unknown>;
    (manifest.dependencies as Record<string, string>)[CHARTS_CORE_NAME] = CHARTS_CORE_LOCKED;
    fs.writeFileSync(path.join(root, 'package.json'), manifestJson(manifest), 'utf8');
    const plan = matchPlan(TARBALL_SHA256);
    expect(validateMatchPlan(plan).ok, '源 MatchPlan 必须结构合法').toBe(true);
    expect(validateComponentMatchResponse(matchedResponseWithCoreConflict()).ok, '要求 0.0.12 的权威响应必须结构合法').toBe(true);
    const before = treeSnapshot(root);
    apiResponses.push({ status: 200, body: matchedResponseWithCoreConflict() });
    apiResponses.push({ status: 200, body: matchedResponseWithCoreConflict() });

    const { result, thrown } = await runPlan(root, plan, planOptions());

    expect(thrown, `锁版本冲突应以结构化冲突返回而非 schema crash（${describeThrown({ thrown })}）`).toBeUndefined();
    expect(result!.status).toBe('conflicted');
    expect(result!.conflicts.some(c => c.code === 'DEPENDENCY_CONFLICT' || c.code === 'VERSION_MISMATCH'),
      '必须给出合法的结构化依赖冲突').toBe(true);
    // 不得把冲突版本写进 exactDependencies 冒充一致（契约禁止静默升级已锁依赖）。
    expect(result!.exactDependencies.some(d => d.name === CHARTS_CORE_NAME && d.version === CHARTS_CORE_REQUIRED)).toBe(false);
    // 不得为用户没有选择的版本声称任何 registry 验证证据。
    expect(result!.registryEvidence.some(r => r.name === CHARTS_CORE_NAME)).toBe(false);
    // 用户文件与已有锁版本保持原样。
    expect(result!.localProject.resolvedDependencies.find(d => d.name === CHARTS_CORE_NAME)?.version).toBe(CHARTS_CORE_LOCKED);
    expect(validateIntegrationPlan(result).ok).toBe(true);
    expect(treeSnapshot(root)).toEqual(before);

    // 完整 CLI：同样的结构化冲突必须映射为 exit 2，而不是 exit 1 的执行错误。
    const matchFile = path.join(path.dirname(root), `net-core-conflict-${Date.now()}.json`);
    fs.writeFileSync(matchFile, JSON.stringify(plan));
    const savedApiToken = process.env.ZHINEXUS_API_TOKEN;
    const savedRegistryToken = process.env.ZHINEXUS_REGISTRY_TOKEN;
    process.env.ZHINEXUS_API_TOKEN = API_TOKEN;
    process.env.ZHINEXUS_REGISTRY_TOKEN = REGISTRY_TOKEN;
    try {
      apiResponses.push({ status: 200, body: matchedResponseWithCoreConflict() });
      apiResponses.push({ status: 200, body: matchedResponseWithCoreConflict() });
      const cli = await runIntegrateCommand(['plan', '--project', root,
        '--match', matchFile, '--api-url', apiOrigin, '--registry', registryOrigin]);
      expect(cli.exitCode, '锁版本冲突应形成含 conflicts 的结构化结果（exit 2）').toBe(2);
      const parsed = JSON.parse(cli.stdout) as { status: string; conflicts: { code: string }[] };
      expect(parsed.status).toBe('conflicted');
      expect(parsed.conflicts.some(c => c.code === 'DEPENDENCY_CONFLICT' || c.code === 'VERSION_MISMATCH')).toBe(true);
      // CLI 调用同样不得写入目标项目（用户文件与已有锁版本保持原样）。
      expect(treeSnapshot(root)).toEqual(before);
    } finally {
      fs.rmSync(matchFile, { force: true });
      if (savedApiToken === undefined) delete process.env.ZHINEXUS_API_TOKEN; else process.env.ZHINEXUS_API_TOKEN = savedApiToken;
      if (savedRegistryToken === undefined) delete process.env.ZHINEXUS_REGISTRY_TOKEN; else process.env.ZHINEXUS_REGISTRY_TOKEN = savedRegistryToken;
    }
  });
});
