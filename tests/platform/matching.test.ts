import { describe, expect, it } from 'vitest';
import { manifestDigest, validateMatchPlan, validateSearchCandidatesResponse, type MatchPlanRequest } from '@company/contracts';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { MatchingService } from '../../apps/api/dist/matching/service.js';
import { workerHarness, realRegistry } from './t06-support.js';
import { replaceBundleArtifact } from '../fixtures/t05-artifacts.js';
import { componentApiFixture, matchRequestFixture } from '../fixtures/match-plan.js';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { SearchIndexer } from '../../apps/api/dist/index/search-indexer.js';
import { evaluateIdMatching, type IdEvalCase } from '../evaluation/id-matching.js';

async function setup() {
  const h = await workerHarness(f => {
    for (const v of f.manifest.variants) {
      const api = { ...componentApiFixture(v.framework), componentId: v.componentId, exportName: v.exportName, exportPath: v.exportPath };
      replaceBundleArtifact(f, v.api.path, Buffer.from(JSON.stringify(api)));
    }
    f.manifest.packages.find(p => p.peerDependencies.react)!.peerDependencies['react-dom'] = '19.3.1';
  });
  await new ReleaseWorker(h.db, h.store, await realRegistry()).runOnce(h.jobId);
  const rows = (await h.db.query('SELECT id,variant_id FROM variant_releases')).rows;
  const input = matchRequestFixture(); input.design.mapping.entries[0]!.variantReleaseId = rows.find(r => r.variant_id === 'line-vue')!.id;
  return { ...h, input, rows };
}
describe('真实服务 ID 规则装配 HTTP', () => {
  it('鉴权、无索引 Ready、未知目标、精确框架/peer 与完整输入摘要', async () => {
    const h = await setup();
    try {
      const request = (input: unknown = h.input, token: string | undefined = h.auth) => h.request('/v1/matching/plans', input, token);
      expect((await h.request('/v1/matching/plans', h.input)).status).toBe(401);
      expect((await request(h.input, await h.token('nobody', []))).status).toBe(403);
      expect((await request({ ...h.input, subject: 'alice' })).status).toBe(400);
      const response = await request(); expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('x-robots-tag')).toContain('noindex');
      const plan = await response.json(); expect(validateMatchPlan(plan).ok).toBe(true);
      expect(plan.elements[0].target.variantReleaseId).toBe(h.input.design.mapping.entries[0]!.variantReleaseId);
      expect(plan.inputDigest).toBe(await manifestDigest(h.input));
      expect((await h.db.query('SELECT count(*)::int AS n FROM search_documents')).rows[0]!.n).toBe(0);
      await h.db.query("UPDATE release_outbox SET state='failed'");
      expect((await (await request()).json()).elements[0].status).toBe('mapped');
      const unknown = structuredClone(h.input); unknown.design.mapping.entries[0]!.variantReleaseId = "x' OR 1=1 --";
      expect((await (await request(unknown)).json()).elements[0].gaps[0].code).toBe('TARGET_UNAVAILABLE');
      const peer = structuredClone(h.input); peer.context.frameworkVersion = '3.5.44';
      expect((await (await request(peer)).json()).elements[0].gaps[0].code).toBe('TARGET_UNAVAILABLE');
      const react = { ...structuredClone(h.input), context: { ...h.input.context, framework: 'react', frameworkVersion: '19.3.1' } };
      expect((await (await request(react)).json()).elements[0].gaps[0].code).toBe('UNMAPPED_ID');
      const reactInput = { ...react, design: { ...react.design, mapping: { ...react.design.mapping, entries: [{ designId: '设计/Line', framework: 'react', variantReleaseId: h.rows.find(r => r.variant_id === 'line-react')!.id }] } } };
      expect((await (await request(reactInput)).json()).elements[0].gaps[0].code).toBe('TARGET_UNAVAILABLE');
      const reactPlan = await (await request({ ...reactInput, reactDomVersion: '19.3.1' })).json();
      expect(reactPlan.elements[0].events[0].name).toBe('onPointClick');
    } finally { await h.close(); }
  });
  it('无权、不存在、废弃、非Ready同形返回；材料读取期间撤权/禁用清空结果', async () => {
    const h = await setup();
    try {
      const plan = () => new MatchingService(h.db, h.store).plan(h.input, 'alice');
      const id = h.input.design.mapping.entries[0]!.variantReleaseId;
      await h.db.query("UPDATE variant_releases SET availability='DEPRECATED' WHERE id=$1", [id]);
      expect((await plan()).elements[0]!.gaps[0]!.code).toBe('TARGET_UNAVAILABLE');
      await h.db.query("UPDATE variant_releases SET availability='Ready' WHERE id=$1", [id]);
      const original = h.db.query.bind(h.db); let batches = 0;
      h.db.query = (async (sql: string, values?: unknown[]) => {
        if (sql.includes('AS can_read') && ++batches === 2) await original("UPDATE component_permissions SET can_publish=false,can_read=false,can_maintain=false WHERE subject='alice'");
        return original(sql, values);
      }) as typeof h.db.query;
      const revoked = await plan(); expect(batches).toBe(2); expect(revoked.elements[0]!.gaps[0]!.code).toBe('TARGET_UNAVAILABLE'); expect(revoked.exactDependencies).toEqual([]);
      h.db.query = original;
      await h.db.query("UPDATE component_permissions SET can_read=true WHERE subject='alice'"); batches = 0;
      h.db.query = (async (sql: string, values?: unknown[]) => {
        if (sql.includes('AS can_read') && ++batches === 2) await original("INSERT INTO disabled_subjects(subject) VALUES ('alice')");
        return original(sql, values);
      }) as typeof h.db.query;
      expect((await plan()).elements[0]!.gaps[0]!.code).toBe('TARGET_UNAVAILABLE');
    } finally { await h.close(); }
  });
  it('读取损坏材料和旧版材料时返回显式缺口，不执行上传内容', async () => {
    const h = await setup();
    try {
      const variant = h.fixture.manifest.variants[0]!;
      await h.db.query("UPDATE release_artifacts SET sha256=$2 WHERE job_id=$1 AND path=$3", [h.jobId, 'f'.repeat(64), variant.api.path]);
      const result = await new MatchingService(h.db, h.store).plan(h.input, 'alice');
      expect(result.elements[0]!.gaps[0]!.code).toBe('API_UNSUPPORTED'); expect(result.exactDependencies).toEqual([]);
    } finally { await h.close(); }
  });
  it('合成 200/1000 发布记录规模：真实数据库与材料读取量测，不作为业务质量证据', async () => {
    const h = await setup();
    try {
      const source = (await h.db.query(`SELECT vr.metadata,vr.variant_id,p.metadata AS pkg FROM variant_releases vr
        JOIN package_releases p ON p.id=vr.package_release_id WHERE vr.id=$1`, [h.input.design.mapping.entries[0]!.variantReleaseId])).rows[0]!;
      const rows = Array.from({ length: 1000 }, (_, i) => ({ id: randomUUID(), packageId: randomUUID(), version: `0.1.${i}` }));
      // Protocol-only seeded versions reuse verified API/docs bytes. These are NOT registry-published versions.
      const measurements: object[] = [];
      let inserted = 0;
      for (const count of [200, 1000]) {
        const batch = rows.slice(inserted, count);
        await h.db.query(`INSERT INTO package_releases(id,job_id,name,version,sha256,metadata,state)
        SELECT (r->>'packageId')::uuid,$2,p.name,r->>'version',p.sha256,jsonb_set(p.metadata,'{version}',r->'version'),'READY'
        FROM jsonb_array_elements($1::jsonb) r CROSS JOIN package_releases p WHERE p.id=(SELECT package_release_id FROM variant_releases WHERE id=$3)`,
      [JSON.stringify(batch), h.jobId, h.input.design.mapping.entries[0]!.variantReleaseId]);
      await h.db.query(`INSERT INTO variant_releases(id,variant_id,package_release_id,metadata,availability)
        SELECT (r->>'id')::uuid,$2,(r->>'packageId')::uuid,jsonb_set($3::jsonb,'{packageVersion}',r->'version'),'Ready'
        FROM jsonb_array_elements($1::jsonb) r`, [JSON.stringify(batch), source.variant_id, JSON.stringify(source.metadata)]);
        inserted = count;
        const request = structuredClone(h.input);
        request.design.mapping.entries = rows.slice(0, count).map((r, i) => ({ designId: `opaque-${i}`, framework: 'vue', variantReleaseId: r.id }));
        request.design.elements = rows.slice(0, count).map((_, i) => ({ instanceId: `node-${i}`, designId: `opaque-${i}` }));
        const start = performance.now(); const response = await h.request('/v1/matching/plans', request, h.auth); const plan = await response.json();
        const durationMs = Math.round(performance.now() - start);
        expect(response.status).toBe(200); expect(validateMatchPlan(plan).ok).toBe(true);
        expect(plan.elements.filter((e: { status: string }) => e.status === 'mapped')).toHaveLength(count);
        expect(plan.elements.map((e: { target: { variantReleaseId: string } }) => e.target.variantReleaseId)).toEqual(rows.slice(0, count).map(r => r.id));
        // All package versions conflict: do not pick a winner simply because all ID mappings exist.
        expect(plan.exactDependencies).toEqual([]); expect(plan.gaps[0].code).toBe('DEPENDENCY_CONFLICT');
        measurements.push({ event: 'ID_MATCH_SCALE', origin: 'synthetic', distinctReleaseCount: count, durationMs, exactTargets: count, productionAcceptance: false });
        await new SearchIndexer(h.db).rebuild(h.jobId);
        const indexedRecords = (await h.db.query('SELECT count(*)::int AS n FROM search_documents')).rows[0]!.n;
        expect(indexedRecords).toBe(count + h.rows.length);
        const textStart = performance.now();
        const textResponse = await h.request('/v1/search/candidates', { query: 'line', context: h.input.context }, h.auth);
        const textPlan = await textResponse.json(); const textDurationMs = Math.round(performance.now() - textStart);
        expect(textResponse.status).toBe(200); expect(validateSearchCandidatesResponse(textPlan).ok).toBe(true);
        expect(textPlan.candidates).toHaveLength(50); expect(textPlan.gaps.join(' ')).toContain('50');
        measurements.push({ event: 'TEXT_SEARCH_SCALE', origin: 'synthetic', seededReleaseCount: count, indexedRecords, durationMs: textDurationMs, returnedCandidates: 50, productionAcceptance: false });
      }
      await writeFile('.tools/id-matching-scale.json', JSON.stringify(measurements, null, 2));
    } finally { await h.close(); }
  }, 120000);
  it('API 实际方案进入合成评估报告，真实样本为零时保持未验收', async () => {
    const h = await setup();
    try {
      const cases: IdEvalCase[] = [];
      const vueId = h.input.design.mapping.entries[0]!.variantReleaseId;
      const reactId = h.rows.find(r => r.variant_id === 'line-react')!.id;
      const collect = async (caseId: string, request: MatchPlanRequest, expected: IdEvalCase['expected']) => {
        const response = await h.request('/v1/matching/plans', request, h.auth);
        expect(response.status).toBe(200);
        cases.push({ caseId, origin: 'synthetic', expected, plan: await response.json() });
      };
      const mapped = (request: MatchPlanRequest, id: string): IdEvalCase['expected'] => ({ elements: request.design.elements.map(e => ({ ...e, expectedStatus: 'mapped', expectedVariantReleaseId: id, expectedFramework: request.context.framework, requiredGapCodes: ['COMPATIBILITY_UNVERIFIED'] })) });
      const gap = (request: MatchPlanRequest, code: 'UNMAPPED_ID'|'TARGET_UNAVAILABLE'|'API_UNSUPPORTED'): IdEvalCase['expected'] => ({ elements: request.design.elements.map(e => ({ ...e, expectedStatus: 'gap', requiredGapCodes: [code] })) });
      await collect('vue', h.input, mapped(h.input, vueId));
      const multiple = structuredClone(h.input); multiple.design.elements.push({ instanceId: 'node-2', designId: multiple.design.elements[0]!.designId });
      await collect('multiple-instances', multiple, mapped(multiple, vueId));
      const unknown = structuredClone(h.input); unknown.design.elements[0]!.designId = 'unknown';
      await collect('unknown-id', unknown, gap(unknown, 'UNMAPPED_ID'));
      const react: MatchPlanRequest = structuredClone(h.input); react.context.framework = 'react'; react.context.frameworkVersion = '19.3.1'; react.reactDomVersion = '19.3.1';
      await collect('missing-framework', react, gap(react, 'UNMAPPED_ID'));
      react.design.mapping.entries[0]!.framework = 'react';
      await collect('wrong-framework-target', react, gap(react, 'TARGET_UNAVAILABLE'));
      react.design.mapping.entries[0]!.variantReleaseId = reactId;
      await collect('react', react, mapped(react, reactId));
      const peer = structuredClone(h.input); peer.context.frameworkVersion = '3.5.44';
      await collect('wrong-peer', peer, gap(peer, 'TARGET_UNAVAILABLE'));
      const bindings: MatchPlanRequest = { ...structuredClone(h.input), bindings: [{ instanceId: 'node-1', props: [{ name: 'invented', source: 'sales' }], events: [] }] };
      const bindingExpected = mapped(bindings, vueId); bindingExpected.elements[0]!.requiredGapCodes.push('UNKNOWN_PROP', 'MISSING_PROP', 'MISSING_EVENT', 'LAYOUT_UNKNOWN');
      await collect('missing-and-unknown-bindings', bindings, bindingExpected);
      const duplicate = structuredClone(h.input); duplicate.design.mapping.entries.push({ ...duplicate.design.mapping.entries[0]! });
      expect((await h.request('/v1/matching/plans', duplicate, h.auth)).status).toBe(400);
      duplicate.design.mapping.entries[1]!.variantReleaseId = reactId;
      expect((await h.request('/v1/matching/plans', duplicate, h.auth)).status).toBe(400);
      await h.db.query("UPDATE component_permissions SET can_read=false,can_publish=false,can_maintain=false WHERE subject='alice'");
      await collect('revoked', h.input, gap(h.input, 'TARGET_UNAVAILABLE'));
      await h.db.query("UPDATE component_permissions SET can_read=true WHERE subject='alice'");
      const variant = h.fixture.manifest.variants.find(v => v.framework === 'vue')!;
      await h.db.query('UPDATE release_artifacts SET sha256=$2 WHERE job_id=$1 AND path=$3', [h.jobId, 'f'.repeat(64), variant.api.path]);
      await collect('corrupt-material', h.input, gap(h.input, 'API_UNSUPPORTED'));
      const report = evaluateIdMatching(cases);
      expect(report.synthetic.passed).toBe(true); expect(report.synthetic.exactMappingRate.value).toBe(1);
      expect(report.synthetic.hardViolationCases).toBe(0); expect(report.failures).toEqual([]);
      expect(report.real.totalCases).toBe(0); expect(report.passed).toBe(false);
      await writeFile('.tools/id-matching-evaluation.json', JSON.stringify({ ...report, rejectedDuplicateOrConflictingInputs: 2, caseIds: cases.map(c => c.caseId), productionAcceptance: false }, null, 2));
    } finally { await h.close(); }
  });
});
