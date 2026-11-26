import { describe, expect, it } from 'vitest';
import { manifestDigest, validateMatchPlan, type MatchPlanRequest } from '@company/contracts';
import { assembleMatchPlan, type MatchRepository } from '../../apps/api/dist/matching/service.js';
import { makeFixture, digest } from '../fixtures/releases/g1/factory.js';
import { componentApiFixture, matchRequestFixture } from '../fixtures/match-plan.js';
import type { CurrentCandidateSnapshot } from '../../apps/api/dist/search/eligibility.js';

function fixture() {
  const f = makeFixture(); const variant = f.manifest.variants[0]!; const pkg = f.manifest.packages[0]!;
  const api = new TextEncoder().encode(JSON.stringify(componentApiFixture()));
  variant.api.sha256 = digest(api); variant.api.bytes = api.length; f.files.set(variant.api.path, api);
  const id = matchRequestFixture().design.mapping.entries[0]!.variantReleaseId;
  const current: CurrentCandidateSnapshot = {
    variant, package: pkg, canRead: true, availability: 'Ready', packageState: 'READY', jobState: 'READY', revision: 'frozen-1',
    activeProviderVersion: '', index: { state: 'failed', revision: '', providerVersion: '' }, peerDependencies: pkg.peerDependencies, acceptedCompatibility: [],
    candidate: { variantReleaseId: id, variantId: variant.variantId, componentId: variant.componentId, framework: 'vue',
      packageName: pkg.name, packageVersion: pkg.version, packageSha256: pkg.tarball.sha256, exportName: variant.exportName,
      evidence: [{ kind: 'api', path: variant.api.path, sha256: variant.api.sha256 }, { kind: 'docs', path: variant.docs.path, sha256: variant.docs.sha256 }], gaps: [] },
  };
  let reads = 0; let artifacts = 0;
  const repo: MatchRepository = {
    async load(ids) { reads++; return new Map(ids.includes(id) ? [[id, structuredClone(current)]] : []); },
    async artifact(_id, path) { artifacts++; return f.files.get(path)!; },
  };
  return { current, repo, f, id, counts: () => ({ reads, artifacts }) };
}
const codes = (plan: Awaited<ReturnType<typeof assembleMatchPlan>>) => plan.elements.flatMap(e => e.gaps.map(g => g.code));
describe('设计 ID 确定性装配：真实 dist + 注入冻结材料仓库', () => {
  it.each(['styleExport', 'readyMethod'] as const)('普通组件缺少可选 %s 时仍描述真实 target，不虚构能力', async field => {
    const f = fixture(); const api = componentApiFixture(); delete api[field];
    const bytes = new TextEncoder().encode(JSON.stringify(api));
    f.f.files.set(f.current.variant!.api.path, bytes);
    f.current.variant!.api.sha256 = digest(bytes); f.current.variant!.api.bytes = bytes.length; f.current.candidate.evidence[0]!.sha256 = digest(bytes);
    const plan = await assembleMatchPlan(matchRequestFixture(), f.repo);
    expect(plan.elements[0]?.status).toBe('mapped');expect(plan.elements[0]?.target).not.toHaveProperty(field);
    expect(validateMatchPlan(plan).ok).toBe(true);
  });
  it('不依赖索引，保留多实例并绑定完整请求摘要、精确依赖和材料', async () => {
    const f = fixture(); const request: MatchPlanRequest = matchRequestFixture();
    request.design.elements.push({ instanceId: 'node-2', designId: '设计/Line' });
    request.bindings = [{ instanceId: 'node-1', props: [{ name: 'data', source: 'sales' }], events: [{ name: 'point-click', handler: 'detail' }], layout: 'cell 1' }];
    const plan = await assembleMatchPlan(request, f.repo);
    expect(validateMatchPlan(plan).ok).toBe(true); expect(plan.inputDigest).toBe(await manifestDigest(request));
    expect(plan.elements.map(e => e.status)).toEqual(['mapped', 'mapped']);
    expect(plan.exactDependencies).toEqual([{ name: '@company/charts-vue', version: '0.0.1' }]);
    expect(plan.elements[0]!.target).toMatchObject({ variantReleaseId: f.id, exportPath: './line', styleExport: './style.css', readyMethod: 'whenRendered', compatibility: { status: 'unverified', recordIds: [] } });
    expect(plan.elements[0]!.props[0]!.source).toBe('sales'); expect(plan.elements[1]!.props[0]).not.toHaveProperty('source');
    expect(f.counts()).toEqual({ reads: 2, artifacts: 2 });
    expect(codes(plan)).toEqual(expect.arrayContaining(['MISSING_PROP', 'MISSING_EVENT', 'LAYOUT_UNKNOWN', 'COMPATIBILITY_UNVERIFIED']));
  });
  it.each(['constructor', '__proto__', ' 设计/Line ', '设计/line', '*'])('未知 ID 原值精确比较：%s', async id => {
    const f = fixture(); const request = matchRequestFixture(); request.design.elements[0]!.designId = id;
    const plan = await assembleMatchPlan(request, f.repo);
    expect(codes(plan)).toEqual(['UNMAPPED_ID']); expect(plan.elements[0]).not.toHaveProperty('target'); expect(f.counts().artifacts).toBe(0);
  });
  it.each([
    ['无权', (s: CurrentCandidateSnapshot) => { s.canRead = false; }],
    ['废弃', (s: CurrentCandidateSnapshot) => { s.availability = 'DEPRECATED'; }],
    ['非Ready', (s: CurrentCandidateSnapshot) => { s.packageState = 'PENDING'; }],
    ['作业失败', (s: CurrentCandidateSnapshot) => { s.jobState = 'CONFLICT'; }],
    ['跨框架', (s: CurrentCandidateSnapshot) => { s.candidate.framework = 'react'; }],
    ['peer错误', (s: CurrentCandidateSnapshot) => { s.peerDependencies.vue = '3.5.44'; }],
    ['元数据身份错误', (s: CurrentCandidateSnapshot) => { s.variant!.componentId = 'secret'; }],
    ['包摘要错误', (s: CurrentCandidateSnapshot) => { s.package!.tarball.sha256 = 'e'.repeat(64); }],
  ] as const)('%s与不存在统一缺口，不能泄露材料或包', async (_label, change) => {
    const f = fixture(); change(f.current); const plan = await assembleMatchPlan(matchRequestFixture(), f.repo);
    expect(codes(plan)).toEqual(['TARGET_UNAVAILABLE']); expect(plan.exactDependencies).toEqual([]);
    expect(JSON.stringify(plan)).not.toContain('@company'); expect(f.counts().artifacts).toBe(0);
  });
  it('最终复读撤权和元数据变更后清除材料与依赖', async () => {
    for (const change of [(s: CurrentCandidateSnapshot) => { s.canRead = false; }, (s: CurrentCandidateSnapshot) => { s.revision = 'changed'; }]) {
      const f = fixture(); const original = f.repo.artifact;
      f.repo.artifact = async (...args) => { const bytes = await original(...args); change(f.current); return bytes; };
      const plan = await assembleMatchPlan(matchRequestFixture(), f.repo);
      expect(codes(plan)).toEqual(['TARGET_UNAVAILABLE']); expect(plan.exactDependencies).toEqual([]); expect(plan.elements[0]!.props).toEqual([]);
    }
  });
  it.each(['hash', 'legacy', 'identity'])('损坏/旧版/错误身份 API 材料失败关闭：%s', async mode => {
    const f = fixture(); const bytes = new TextEncoder().encode(JSON.stringify(mode === 'legacy' ? {} : { ...componentApiFixture(), componentId: 'wrong' }));
    f.f.files.set(f.current.variant!.api.path, bytes);
    if (mode !== 'hash') { f.current.variant!.api.sha256 = digest(bytes); f.current.variant!.api.bytes = bytes.length; f.current.candidate.evidence[0]!.sha256 = digest(bytes); }
    const plan = await assembleMatchPlan(matchRequestFixture(), f.repo);
    expect(codes(plan)).toEqual(['API_UNSUPPORTED']); expect(plan.elements[0]).not.toHaveProperty('target');
  });
  it('未知绑定只报缺口，不伪造 API；自然语言需求保持待验证', async () => {
    const f = fixture(); const request: MatchPlanRequest = matchRequestFixture(); request.context.requirements = ['销售业务'];
    request.bindings = [{ instanceId: 'node-1', props: [{ name: 'unknown', source: 'x' }], events: [{ name: 'onPointClick', handler: 'x' }] }];
    const plan = await assembleMatchPlan(request, f.repo);
    expect(codes(plan)).toEqual(expect.arrayContaining(['UNKNOWN_PROP', 'UNKNOWN_EVENT', 'MISSING_PROP', 'MISSING_EVENT']));
    expect(plan.elements[0]!.props.map(p => p.name)).toEqual(['data', 'config']); expect(plan.gaps.map(g => g.code)).toContain('REQUIREMENTS_UNASSESSED');
  });
  it('依赖与目标包冲突不能任意选择版本', async () => {
    const f = fixture(); f.current.package!.dependencies['@company/charts-vue'] = '0.0.2';
    const plan = await assembleMatchPlan(matchRequestFixture(), f.repo);
    expect(plan.exactDependencies).toEqual([]); expect(codes(plan)).toContain('DEPENDENCY_CONFLICT'); expect(plan.gaps.map(g => g.code)).toContain('DEPENDENCY_CONFLICT');
  });
  it('空设计有明确缺口；重复映射输入拒绝', async () => {
    const f = fixture(); const request = matchRequestFixture(); request.design.elements = [];
    expect((await assembleMatchPlan(request, f.repo)).gaps.map(g => g.code)).toContain('EMPTY_DESIGN');
    request.design.mapping.entries.push(request.design.mapping.entries[0]!);
    await expect(assembleMatchPlan(request, f.repo)).rejects.toMatchObject({ code: 'INVALID_SCHEMA' });
  });
  it('基础设施错误不能伪装成成功缺口', async () => {
    const f = fixture(); f.repo.artifact = async () => { throw new Error('storage outage'); };
    await expect(assembleMatchPlan(matchRequestFixture(), f.repo)).rejects.toThrow('storage outage');
  });
  it('合法最长字段名不会让缺口消息越界变成500', async () => {
    const f = fixture(); const api = componentApiFixture(); api.props[0]!.name = 'a'.repeat(2048); api.events[0]!.name = 'b'.repeat(2048);
    const bytes = new TextEncoder().encode(JSON.stringify(api)); f.f.files.set(f.current.variant!.api.path, bytes);
    f.current.variant!.api.sha256 = digest(bytes); f.current.variant!.api.bytes = bytes.length; f.current.candidate.evidence[0]!.sha256 = digest(bytes);
    const plan = await assembleMatchPlan(matchRequestFixture(), f.repo);
    expect(codes(plan)).toEqual(expect.arrayContaining(['MISSING_PROP', 'MISSING_EVENT'])); expect(validateMatchPlan(plan).ok).toBe(true);
  });
  it('1000实例的大API展开超预算时明确413，不能500或裁剪后冒称完整', async () => {
    const f = fixture(); const api = componentApiFixture(); api.props = Array.from({length:20},(_,i)=>({ name:`p${i}`, type:'string', required:false }));
    const bytes = new TextEncoder().encode(JSON.stringify(api)); f.f.files.set(f.current.variant!.api.path, bytes);
    f.current.variant!.api.sha256 = digest(bytes); f.current.variant!.api.bytes = bytes.length; f.current.candidate.evidence[0]!.sha256 = digest(bytes);
    const request = matchRequestFixture(); request.design.elements = Array.from({length:1000},(_,i)=>({instanceId:String(i),designId:'设计/Line'}));
    await expect(assembleMatchPlan(request, f.repo)).rejects.toMatchObject({ code:'LIMIT_EXCEEDED', status:413 });
  });
});
