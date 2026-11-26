import {
  canonicalJson, manifestDigest, validateMatchPlanRequest, validateMatchPlan,
  type MatchElement, type MatchGap, type MatchPlanV1, type MatchPlanRequest,
} from '@company/contracts';
import { loadCurrentCandidates } from '../search/current.js';
import type { CurrentCandidateSnapshot } from '../search/eligibility.js';
import { CatalogService } from '../catalog/service.js';
import type { Database } from '../db/database.js';
import { uuid } from '../db/access.js';
import type { ArtifactStore } from '../storage/artifact-store.js';
import { PlatformError } from '../errors.js';
import { readApi, resolveRelease, type AssemblyApi, type Eligible, type MaterialRepository } from './materials.js';

export type MatchRepository = {
  load(ids: string[]): Promise<Map<string, CurrentCandidateSnapshot>>;
  artifact(id: string, path: string): Promise<Uint8Array>;
};
const gap = (code: MatchGap['code'], message: string): MatchGap => ({ code, message });
const unavailable = () => gap('TARGET_UNAVAILABLE', '目标当前不可用，请核对配置及访问条件');
/** 与组件精确查询 GET 共享的资格/材料 helper（`matching/materials.ts`）。 */
const release = (request: MatchPlanRequest, id: string, snapshot?: CurrentCandidateSnapshot): Eligible | null =>
  resolveRelease({ context: request.context, ...(request.reactDomVersion ? { reactDomVersion: request.reactDomVersion } : {}) }, id, snapshot);
function mapped(element: { instanceId: string; designId: string }, item: Eligible, api: AssemblyApi, request: MatchPlanRequest): MatchElement {
  const binding = request.bindings?.find(b => b.instanceId === element.instanceId);
  const gaps: MatchGap[] = [];
  const props = api.props.map(prop => {
    const source = binding?.props.find(p => p.name === prop.name)?.source;
    if (prop.required && source === undefined) gaps.push(gap('MISSING_PROP', '必填参数缺少数据引用，请查看参数列表'));
    return { ...prop, ...(source === undefined ? {} : { source }) };
  });
  const events = api.events.map(event => {
    const handler = binding?.events.find(e => e.name === event.name)?.handler;
    if (handler === undefined) gaps.push(gap('MISSING_EVENT', '事件缺少处理引用，请查看事件列表'));
    return { ...event, ...(handler === undefined ? {} : { handler }) };
  });
  if (binding?.props.some(p => !api.props.some(a => a.name === p.name))) gaps.push(gap('UNKNOWN_PROP', '部分参数绑定不在该版本 API 中'));
  if (binding?.events.some(e => !api.events.some(a => a.name === e.name))) gaps.push(gap('UNKNOWN_EVENT', '部分事件绑定不在该版本 API 中'));
  if (binding?.layout === undefined) gaps.push(gap('LAYOUT_UNKNOWN', '尚未声明布局'));
  if (item.candidate.compatibility.status === 'unverified') gaps.push(gap('COMPATIBILITY_UNVERIFIED', '缺少该精确版本组合的已接受兼容记录'));
  const { gaps: _candidateGaps, evidence: _evidence, ...candidate } = item.candidate;
  return { ...element, status: 'mapped', target: { ...candidate, exportPath: api.exportPath,
    evidence: (['api', 'docs'] as const).map(kind => ({ kind, path: item.variant[kind].path, sha256: item.variant[kind].sha256 })),
    examples: item.variant.examples.map(e => ({ id: e.id, previewEntry: e.previewEntry })), ...(api.styleExport ? { styleExport: api.styleExport } : {}), ...(api.readyMethod ? { readyMethod: api.readyMethod } : {}), notes: [...api.notes] },
    props, events, ...(binding?.layout === undefined ? {} : { layout: binding.layout }), gaps };
}
export async function assembleMatchPlan(input: unknown, repository: MatchRepository): Promise<MatchPlanV1> {
  const checked = validateMatchPlanRequest(input);
  if (!checked.ok) throw new PlatformError('INVALID_SCHEMA', checked.issues);
  const request = structuredClone(checked.value);
  const inputDigest = await manifestDigest(request);
  const mapping = new Map(request.design.mapping.entries.filter(e => e.framework === request.context.framework).map(e => [e.designId, e.variantReleaseId]));
  const ids = [...new Set(request.design.elements.flatMap(e => { const id = mapping.get(e.designId); return id === undefined ? [] : [id]; }))];
  const first = ids.length ? structuredClone(await repository.load(ids)) : new Map<string, CurrentCandidateSnapshot>();
  const materials = new Map<string, AssemblyApi | null>();
  // Bounded I/O, deduplicated per release even when hundreds of instances reuse it.
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, ids.length) }, async () => {
    while (next < ids.length) { const id = ids[next++]!; const item = release(request, id, first.get(id)); if (item) materials.set(id, await readApi(id, item, repository)); }
  }));
  const last = ids.length ? await repository.load(ids) : new Map<string, CurrentCandidateSnapshot>();
  const dependencies = new Map<string, Set<string>>();
  const dependencyUsers = new Map<string, MatchElement[]>();
  const elements = request.design.elements.map(element => {
    const unresolved = (reason: MatchGap): MatchElement => ({ ...element, status: 'gap', props: [], events: [], gaps: [reason] });
    const id = mapping.get(element.designId);
    if (id === undefined) return unresolved(gap('UNMAPPED_ID', '当前框架未配置该设计 ID'));
    const item = release(request, id, last.get(id));
    if (!item || item.revision !== first.get(id)?.revision || !materials.has(id)) return unresolved(unavailable());
    const api = materials.get(id);
    if (!api) return unresolved(gap('API_UNSUPPORTED', '该版本的 API 或文档材料不可用于装配'));
    const result = mapped(element, item, api, request);
    for (const [name, version] of [[item.pkg.name, item.pkg.version], ...Object.entries(item.pkg.dependencies)]) {
      const versions = dependencies.get(name!) ?? new Set<string>(); versions.add(version!); dependencies.set(name!, versions);
      const users = dependencyUsers.get(name!) ?? []; users.push(result); dependencyUsers.set(name!, users);
    }
    return result;
  });
  const gaps: MatchGap[] = [];
  if (!elements.length) gaps.push(gap('EMPTY_DESIGN', '尚未提供设计元素'));
  if (request.context.requirements.length) gaps.push(gap('REQUIREMENTS_UNASSESSED', '文本业务需求仍需人工确认'));
  const exactDependencies: MatchPlanV1['exactDependencies'] = [];
  for (const [name, versions] of [...dependencies].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (versions.size === 1) exactDependencies.push({ name, version: [...versions][0]! });
    else {
      gaps.push(gap('DEPENDENCY_CONFLICT', '多个组件要求不同的精确依赖版本'));
      for (const element of new Set(dependencyUsers.get(name))) element.gaps.push(gap('DEPENDENCY_CONFLICT', '当前组件的精确依赖存在版本冲突'));
    }
  }
  const plan: MatchPlanV1 = { schemaVersion: 1, source: 'design-id', inputDigest,
    ruleSetId: request.design.mapping.ruleSetId, revision: request.design.mapping.revision, context: request.context, elements, exactDependencies, gaps };
  // The wire validator has a shared 100k JSON-node budget. Reject oversized expansion explicitly; never truncate a plan.
  try { if (Buffer.byteLength(canonicalJson(plan)) > 8 * 1024 * 1024) throw new Error('response budget'); }
  catch { throw new PlatformError('LIMIT_EXCEEDED'); }
  const result = validateMatchPlan(plan);
  if (!result.ok) throw new PlatformError('INTERNAL_ERROR');
  return result.value;
}
export class MatchingService {
  constructor(private readonly db: Database, private readonly store?: ArtifactStore) {}
  plan(input: unknown, subject: string): Promise<MatchPlanV1> {
    const catalog = new CatalogService(this.db, this.store);
    return assembleMatchPlan(input, {
      load: ids => loadCurrentCandidates(this.db, ids.filter(id => { try { uuid(id); return true; } catch { return false; } }), subject),
      artifact: async (id, path) => (await catalog.artifact({ releaseId: id }, path, subject)).bytes,
    });
  }
}
