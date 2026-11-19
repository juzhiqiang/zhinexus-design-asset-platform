/**
 * T17 矩阵平台适配：冻结 bundle 清单、变体映射与真实本地 API 的 MatchPlan 创建。
 *
 * 边界：
 * - 只消费 C 提供的冻结 bundle（manifest 字节摘要逐一核对）与变体映射；
 * - 合规性（compatibility=verified）必须在 C 的验收环境中已成立，否则用例 blocked，
 *   不在矩阵里擅自登记兼容记录；
 * - 令牌只进入 HTTP 头，不写日志/证据。
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  validateComponentApi,
  validateMatchPlan,
  type ComponentApiV1,
  type MatchPlanV1,
  type ReleaseManifestV1,
} from '@company/contracts';
import type { MatrixEnv } from './env.js';
import type { T17PositiveScenario } from '../../fixtures/t17-matrix/scenarios.js';

export type MatrixVariant = { componentId: string; framework: 'vue' | 'react'; variantReleaseId: string };

export type LoadedBundle = {
  manifest: ReleaseManifestV1;
  variants: MatrixVariant[];
  sha256Of: (relativePath: string) => Promise<string>;
  readApi: (framework: 'vue' | 'react', componentId: string) => Promise<ComponentApiV1>;
  manifestSha256: string;
};

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export async function loadBundle(env: MatrixEnv): Promise<LoadedBundle> {
  const manifestBytes = await readFile(path.join(env.frozenBundleDir, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as ReleaseManifestV1;
  if (manifest.schemaVersion !== 1) throw new Error('冻结 bundle manifest schemaVersion 必须为 1');
  const declared = new Map(manifest.files.map((file) => [file.path, file]));

  const variantsJson = JSON.parse(await readFile(env.variantsPath, 'utf8')) as { schemaVersion: number; variants: MatrixVariant[] };
  if (variantsJson.schemaVersion !== 1 || !Array.isArray(variantsJson.variants)) throw new Error('变体映射 JSON 结构非法');
  for (const variant of variantsJson.variants) {
    if (!variant.variantReleaseId || !variant.componentId || !['vue', 'react'].includes(variant.framework)) throw new Error('变体映射缺少字段');
    const published = manifest.variants.find((item) => item.componentId === variant.componentId && item.framework === variant.framework);
    if (!published) throw new Error('冻结 bundle 中不存在变体: ' + variant.componentId + '/' + variant.framework);
  }

  async function readVerified(relativePath: string): Promise<Buffer> {
    const file = declared.get(relativePath);
    if (!file) throw new Error('冻结 bundle 未声明文件: ' + relativePath);
    const bytes = await readFile(path.join(env.frozenBundleDir, ...relativePath.split('/')));
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error('冻结 bundle 文件摘要不一致: ' + relativePath);
    return bytes;
  }

  async function readApi(framework: 'vue' | 'react', componentId: string): Promise<ComponentApiV1> {
    const published = manifest.variants.find((item) => item.componentId === componentId && item.framework === framework);
    if (!published) throw new Error('冻结 bundle 缺少组件变体: ' + componentId + '/' + framework);
    const checked = validateComponentApi(JSON.parse((await readVerified(published.api.path)).toString('utf8')));
    if (!checked.ok) throw new Error('组件 API 文件非法: ' + componentId + '/' + framework);
    return checked.value;
  }

  return {
    manifest,
    variants: variantsJson.variants,
    sha256Of: async (relativePath) => sha256(await readVerified(relativePath)),
    readApi,
    manifestSha256: sha256(manifestBytes),
  };
}

export function variantReleaseIdFor(bundle: LoadedBundle, componentId: string, framework: 'vue' | 'react'): string {
  const match = bundle.variants.find((item) => item.componentId === componentId && item.framework === framework);
  if (!match) throw new Error('缺少变体映射: ' + componentId + '/' + framework);
  return match.variantReleaseId;
}

export type MatchPlanRequest = {
  design: {
    schemaVersion: 1;
    mapping: { schemaVersion: 1; ruleSetId: string; revision: string; entries: { designId: string; framework: 'vue' | 'react'; variantReleaseId: string }[] };
    elements: { instanceId: string; designId: string }[];
  };
  context: { framework: 'vue' | 'react'; frameworkVersion: string; echartsVersion: string; packageManager: 'npm' | 'pnpm'; requirements: string[] };
  reactDomVersion?: string;
  bindings: {
    instanceId: string;
    props: { name: string; source: string }[];
    events: { name: string; handler: string }[];
    layout: string;
  }[];
};

export async function buildMatchPlan(
  env: MatrixEnv,
  bundle: LoadedBundle,
  scenario: T17PositiveScenario,
  toolchain: { vue: string; react: string; reactDom: string; echarts: string },
): Promise<{ request: MatchPlanRequest; plan: MatchPlanV1; apis: Map<string, ComponentApiV1> }> {
  const apis = new Map<string, ComponentApiV1>();
  const bindings: MatchPlanRequest['bindings'] = [];
  const elements: MatchPlanRequest['design']['elements'] = [];
  const entries: MatchPlanRequest['design']['mapping']['entries'] = [];
  const mappingByDesign = new Map<string, MatchPlanRequest['design']['mapping']['entries'][number]>();
  for (const component of scenario.components) {
    const api = await bundle.readApi(scenario.framework, component.componentId);
    apis.set(component.instanceId, api);
    const entry = {
      designId: 'matrix/' + component.componentId,
      framework: scenario.framework,
      variantReleaseId: variantReleaseIdFor(bundle, component.componentId, scenario.framework),
    };
    elements.push({ instanceId: component.instanceId, designId: entry.designId });
    const mappingKey = JSON.stringify([entry.designId, entry.framework]);
    const existing = mappingByDesign.get(mappingKey);
    if (existing && existing.variantReleaseId !== entry.variantReleaseId) throw new Error('同一设计映射存在目标冲突: ' + entry.designId);
    if (!existing) {
      mappingByDesign.set(mappingKey, entry);
      entries.push(entry);
    }
    bindings.push({
      instanceId: component.instanceId,
      props: api.props.map((prop) => ({ name: prop.name, source: 'matrix.' + prop.name })),
      events: api.events.map((event) => ({ name: event.name, handler: 'matrixHandler' })),
      layout: 'matrix grid cell',
    });
  }
  const request: MatchPlanRequest = {
    design: {
      schemaVersion: 1,
      mapping: { schemaVersion: 1, ruleSetId: 't17-b-independent-matrix', revision: '1', entries },
      elements,
    },
    context: {
      framework: scenario.framework,
      frameworkVersion: scenario.framework === 'vue' ? toolchain.vue : toolchain.react,
      echartsVersion: toolchain.echarts,
      packageManager: scenario.packageManager,
      requirements: [],
    },
    ...(scenario.framework === 'react' ? { reactDomVersion: toolchain.reactDom } : {}),
    bindings,
  };
  const response = await fetch(new URL('/v1/matching/plans', env.apiBase), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.apiToken },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(60_000),
  });
  if (response.status !== 200) throw new Error('MatchPlan API 状态异常: ' + response.status);
  const payload: unknown = await response.json();
  const checked = validateMatchPlan(payload);
  if (!checked.ok) throw new Error('MatchPlan 契约非法: ' + JSON.stringify(checked.issues.slice(0, 3)));
  const plan = checked.value;
  const unmapped = plan.elements.filter((element) => element.status !== 'mapped');
  if (unmapped.length) throw new Error('MatchPlan 存在未映射元素: ' + JSON.stringify(unmapped.map((element) => element.gaps)));
  for (const element of plan.elements) {
    if (element.target?.compatibility.status !== 'verified') {
      throw new Error('目标兼容性未 verified（需 C 的验收环境先登记真实证据）: ' + element.instanceId);
    }
  }
  if (plan.gaps.length) throw new Error('MatchPlan 顶层 gaps 非空: ' + JSON.stringify(plan.gaps));
  return { request, plan, apis };
}
