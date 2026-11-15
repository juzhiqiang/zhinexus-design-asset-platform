import { describe, expect, it } from 'vitest';
import type { AcceptedCompatibilityRecord, ProjectContext } from '@company/contracts';
import { filterEligibleCandidates, type CurrentCandidateSnapshot, type IndexedCandidateHit } from '../../apps/api/dist/search/eligibility.js';
import { candidateFixture } from '../fixtures/search.js';

const context: ProjectContext = { framework: 'react', frameworkVersion: '19.3.1', echartsVersion: '6.1.0', packageManager: 'pnpm', requirements: [] };
const hit = (): IndexedCandidateHit => ({ variantReleaseId: 'release-react-line', revision: 'r1', providerVersion: 'text-v1', ranking: { text: 0.8 } });
function snapshot(): CurrentCandidateSnapshot {
  const { compatibility: _compatibility, ranking: _ranking, ...candidate } = candidateFixture();
  return { candidate, canRead: true, availability: 'Ready', packageState: 'READY', jobState: 'READY', revision: 'r1',
    activeProviderVersion: 'text-v1', index: { state: 'ready', revision: 'r1', providerVersion: 'text-v1' },
    peerDependencies: { react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' }, acceptedCompatibility: [] };
}
const accepted = (): AcceptedCompatibilityRecord => ({ compatibilityId: 'record-1', variantReleaseId: 'release-react-line',
  packageName: '@company/charts-react', packageVersion: '0.1.0', packageSha256: 'a'.repeat(64), framework: 'react',
  frameworkVersion: '19.3.1', echartsVersion: '6.1.0', candidateIntegrity: 'sha512-' + 'a'.repeat(88),
  candidateSource: 'https://registry.example.test/charts.tgz', status: 'passed', evidenceSha256: 'e'.repeat(64), createdAt: '2026-11-15T00:00:00.000Z' });
const hostPeers = { 'react-dom': '19.3.1' };
async function run(current: CurrentCandidateSnapshot | null, ctx = context, hits = [hit()], peers: Record<string, string> = hostPeers) {
  return filterEligibleCandidates(ctx, hits, async () => current, peers);
}

describe('检索命中资格过滤（真实编译 dist，注入快照源，尚未接 HTTP/PG）', () => {
  it('返回精确发布与真实证据；相似度及手动图不能证明兼容', async () => {
    const current = snapshot();
    current.candidate.evidence.push({ kind: 'screenshot', path: 'images/line.png', sha256: 'b'.repeat(64), source: 'manual-upload' });
    const result = await run(current);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ ...current.candidate, compatibility: { status: 'unverified', recordIds: [] }, ranking: { text: 0.8 } });
    expect(result.candidates[0]!.ranking).not.toHaveProperty('visual');
  });
  it.each([
    ['权限撤销', (s: CurrentCandidateSnapshot) => { s.canRead = false; }],
    ['废弃', (s: CurrentCandidateSnapshot) => { s.availability = 'DEPRECATED'; }],
    ['包未Ready', (s: CurrentCandidateSnapshot) => { s.packageState = 'PENDING'; }],
    ['作业未Ready', (s: CurrentCandidateSnapshot) => { s.jobState = 'CONFLICT'; }],
    ['框架不符', (s: CurrentCandidateSnapshot) => { s.candidate.framework = 'vue'; }],
    ['内容revision过期', (s: CurrentCandidateSnapshot) => { s.revision = 'r2'; }],
    ['索引revision过期', (s: CurrentCandidateSnapshot) => { s.index.revision = 'r0'; }],
    ['provider过期', (s: CurrentCandidateSnapshot) => { s.activeProviderVersion = 'text-v2'; }],
    ['索引provider不符', (s: CurrentCandidateSnapshot) => { s.index.providerVersion = 'text-v0'; }],
    ['索引失败', (s: CurrentCandidateSnapshot) => { s.index.state = 'failed'; }],
    ['peer版本不符', (s: CurrentCandidateSnapshot) => { s.peerDependencies.react = '18.0.0'; }],
    ['peer范围不猜测', (s: CurrentCandidateSnapshot) => { s.peerDependencies.react = '^19.0.0'; }],
    ['缺框架peer', (s: CurrentCandidateSnapshot) => { delete s.peerDependencies.react; }],
    ['未知peer', (s: CurrentCandidateSnapshot) => { s.peerDependencies.other = '1.0.0'; }],
    ['快照发布ID不符', (s: CurrentCandidateSnapshot) => { s.candidate.variantReleaseId = 'other'; }],
  ] as const)('拒绝%s并且不泄露被过滤ID', async (_name, change) => {
    const current = snapshot(); change(current);
    const result = await run(current);
    expect(result.candidates).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(current.candidate.variantReleaseId);
  });
  it('缺 ECharts 或 ReactDOM 事实不推断，也不允许 hostPeers 覆盖上下文', async () => {
    const { echartsVersion: _engine, ...missingEngine } = context;
    expect((await run(snapshot(), missingEngine)).candidates).toEqual([]);
    expect((await run(snapshot(), context, [hit()], {} as typeof hostPeers)).candidates).toEqual([]);
    expect((await run(snapshot(), context, [hit()], { ...hostPeers, react: '18.0.0' })).candidates).toEqual([]);
  });
  it('支持 Vue 精确 peer，缺 accepted 记录保持未验证', async () => {
    const current = snapshot(); current.candidate.framework = 'vue';
    current.peerDependencies = { vue: '3.5.45', echarts: '6.1.0' };
    expect((await run(current, { ...context, framework: 'vue', frameworkVersion: '3.5.45' })).candidates[0]?.compatibility.status).toBe('unverified');
  });
  it('仅接受服务器记录的精确发布、摘要和版本组合，并去重记录ID', async () => {
    const current = snapshot(); current.acceptedCompatibility = [accepted(), accepted()];
    expect((await run(current)).candidates[0]?.compatibility).toEqual({ status: 'verified', recordIds: ['record-1'] });
  });
  it.each([
    { packageSha256: 'f'.repeat(64) }, { packageVersion: '0.0.9' }, { frameworkVersion: '19.3.0' },
    { echartsVersion: '6.0.0' }, { variantReleaseId: 'other' }, { packageName: '@company/other' }, { framework: 'vue' },
    { status: 'candidate' }, { evidenceSha256: 'bad' },
  ])('拒绝不匹配或非法兼容记录 %#', async patch => {
    const current = snapshot(); current.acceptedCompatibility = [{ ...accepted(), ...patch } as AcceptedCompatibilityRecord];
    expect((await run(current)).candidates[0]?.compatibility.status).toBe('unverified');
  });
  it('返回前复读当前权限，撤销后不得返回初读结果', async () => {
    let reads = 0;
    const result = await filterEligibleCandidates(context, [hit()], async () => {
      const current = snapshot(); if (++reads === 2) current.canRead = false; return current;
    }, hostPeers);
    expect(reads).toBe(2); expect(result.candidates).toEqual([]);
  });
  it('返回前复读身份及索引，且使用最后读取的证据', async () => {
    let reads = 0;
    const result = await filterEligibleCandidates(context, [hit()], async () => {
      const current = snapshot(); if (++reads === 2) current.candidate.gaps = ['最新缺口']; return current;
    }, hostPeers);
    expect(result.candidates[0]?.gaps).toContain('最新缺口');
    reads = 0;
    const stale = await filterEligibleCandidates(context, [hit()], async () => {
      const current = snapshot(); if (++reads === 2) current.revision = 'r2'; return current;
    }, hostPeers);
    expect(stale.candidates).toEqual([]);
  });
  it('去重命中，不存在的快照和无截图视觉评分不进入结果', async () => {
    expect((await run(snapshot(), context, [hit(), hit()])).candidates).toHaveLength(1);
    expect((await run(null)).candidates).toEqual([]);
    expect((await run(snapshot(), context, [{ ...hit(), ranking: { text: 0.8, visual: 1 } }])).candidates).toEqual([]);
  });
  it('无效上下文及读取异常不产生部分成功', async () => {
    await expect(run(snapshot(), { ...context, frameworkVersion: '^19' })).rejects.toThrow('INVALID_SCHEMA');
    await expect(filterEligibleCandidates(context, [hit()], async () => { throw new Error('database unavailable'); }, hostPeers)).rejects.toThrow('database unavailable');
  });
});
