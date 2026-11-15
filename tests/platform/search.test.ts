import { describe, expect, it } from 'vitest';
import { validateSearchCandidatesResponse } from '@company/contracts';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { SearchIndexer } from '../../apps/api/dist/index/search-indexer.js';
import { SearchService } from '../../apps/api/dist/search/service.js';
import { randomUUID } from 'node:crypto';
import { workerHarness, realRegistry } from './t06-support.js';

const input = { query: 'line', context: { framework: 'vue', frameworkVersion: '3.5.45', echartsVersion: '6.1.0', packageManager: 'pnpm', requirements: [] } };
describe('真实 PostgreSQL 文本检索与 HTTP', () => {
  it('独立消费索引，鉴权后返回当前精确发布且不编造评分或兼容', async () => {
    const h = await workerHarness();
    try {
      const search = (body: unknown = input, token = h.auth) => h.request('/v1/search/candidates', body, token);
      expect((await search()).status).toBe(200);
      expect((await (await search()).json()).candidates).toEqual([]);
      await new ReleaseWorker(h.db, h.store, await realRegistry()).runOnce(h.jobId);
      expect((await (await search()).json()).candidates).toEqual([]);
      const indexer = new SearchIndexer(h.db);
      expect(await indexer.runOnce(h.jobId)).toBe(true);
      expect(await indexer.runOnce(h.jobId)).toBe(false);
      const response = await search(); const body = await response.json();
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-robots-tag')).toContain('noindex');
      expect(validateSearchCandidatesResponse(body).ok).toBe(true);
      expect(body.candidates).toHaveLength(1);
      expect(body.candidates[0]).toMatchObject({ componentId: 'line', framework: 'vue', compatibility: { status: 'unverified', recordIds: [] } });
      expect(Object.keys(body.candidates[0].ranking)).toEqual(['text']);
      expect(body.gaps.join(' ')).toContain('元数据');
      expect((await h.request('/v1/search/candidates', input)).status).toBe(401);
      expect((await search(input, await h.token('nobody', []))).status).toBe(403);
      expect((await search({ ...input, subject: 'alice' })).status).toBe(400);
      expect((await (await search({ ...input, query: "x' OR 1=1 --" })).json()).candidates).toEqual([]);
      expect((await (await search({ ...input, context: { ...input.context, frameworkVersion: '3.5.44' } })).json()).candidates).toEqual([]);
      expect((await (await search({ ...input, context: { ...input.context, echartsVersion: undefined } })).json()).candidates).toEqual([]);
    } finally { await h.close(); }
  });
  it('当前权限、禁用、废弃和过期索引均失败关闭，重建不改变 Ready', async () => {
    const h = await workerHarness();
    try {
      await new ReleaseWorker(h.db, h.store, await realRegistry()).runOnce(h.jobId);
      const indexer = new SearchIndexer(h.db); await indexer.runOnce(h.jobId);
      const search = async (token = h.auth) => (await h.request('/v1/search/candidates', input, token)).json();
      const first = (await search()).candidates[0]; expect(first).toBeDefined();
      await h.db.query("UPDATE components SET public=false WHERE id='line'");
      expect((await search(await h.token('bob', ['reader']))).candidates).toEqual([]);
      await h.db.query("INSERT INTO component_permissions(subject,component_id,can_read) VALUES ('bob','line',true)");
      const bob = await h.token('bob', ['reader']); expect((await search(bob)).candidates).toHaveLength(1);
      await h.db.query("UPDATE component_permissions SET can_read=false WHERE subject='bob'");
      expect((await search(bob)).candidates).toEqual([]);
      await h.db.query("INSERT INTO disabled_subjects(subject) VALUES ('bob')");
      expect((await h.request('/v1/search/candidates', input, bob)).status).toBe(403);
      await h.db.query("UPDATE components SET public=true,category='new-category' WHERE id='line'");
      expect((await search()).candidates).toEqual([]);
      await indexer.rebuild(h.jobId); expect((await search()).candidates).toHaveLength(1);
      await h.db.query("UPDATE search_documents SET provider_version='old' WHERE variant_release_id=$1", [first.variantReleaseId]);
      expect((await search()).candidates).toEqual([]);
      await indexer.rebuild(h.jobId);
      await h.db.query("UPDATE release_outbox SET state='failed' WHERE job_id=$1", [h.jobId]);
      expect((await search()).candidates).toEqual([]);
      const concurrent = await Promise.all([indexer.runOnce(h.jobId), indexer.runOnce(h.jobId)]);
      expect(concurrent.filter(Boolean)).toHaveLength(1);
      expect((await search()).candidates).toHaveLength(1);
      await h.db.query("UPDATE variant_releases SET availability='DEPRECATED' WHERE id=$1", [first.variantReleaseId]);
      expect((await search()).candidates).toEqual([]);
      expect((await h.db.query('SELECT state FROM release_jobs WHERE id=$1', [h.jobId])).rows[0]?.state).toBe('READY');
    } finally { await h.close(); }
  });
  it('失败索引原子回滚，恢复后精确 React DOM 与 accepted 摘要独立校验', async () => {
    const h = await workerHarness(fixture => {
      fixture.manifest.packages.find(p => p.peerDependencies.react)!.peerDependencies['react-dom'] = '19.3.1';
    });
    try {
      await new ReleaseWorker(h.db, h.store, await realRegistry()).runOnce(h.jobId);
      const indexer = new SearchIndexer(h.db);
      const target = (await h.db.query("SELECT vr.id,vr.metadata,vr.package_release_id,p.name,p.version,p.sha256 FROM variant_releases vr JOIN variants v ON v.id=vr.variant_id JOIN package_releases p ON p.id=vr.package_release_id WHERE v.framework='react' AND v.component_id='line'")).rows[0]!;
      await h.db.query("UPDATE variant_releases SET metadata=jsonb_set(metadata,'{exportName}','\"bad.name\"') WHERE id=$1", [target.id]);
      await indexer.runOnce(h.jobId);
      expect((await h.db.query('SELECT count(*)::int AS count FROM search_documents')).rows[0]?.count).toBe(0);
      expect((await h.db.query('SELECT state FROM release_outbox WHERE job_id=$1', [h.jobId])).rows[0]?.state).toBe('failed');
      await h.db.query('UPDATE variant_releases SET metadata=$2 WHERE id=$1', [target.id, JSON.stringify(target.metadata)]);
      await indexer.runOnce(h.jobId);
      const request = { ...input, context: { ...input.context, framework: 'react', frameworkVersion: '19.3.1' } };
      const search = async (body: unknown) => (await h.request('/v1/search/candidates', body, h.auth)).json();
      expect((await search(request)).candidates).toEqual([]);
      expect((await search({ ...request, reactDomVersion: '19.3.0' })).candidates).toEqual([]);
      expect((await search({ ...request, reactDomVersion: '19.3.1' })).candidates).toHaveLength(1);
      const compatibilityId = randomUUID();
      await h.db.query(`INSERT INTO compatibility_evidences(id,variant_release_id,package_release_id,package_name,package_version,package_sha256,
        framework,framework_version,echarts_version,candidate_integrity,candidate_source,status,evidence,evidence_sha256,reason,subject)
        VALUES ($1,$2,$3,$4,$5,$6,'react','19.3.1','6.1.0',$7,'https://registry.test/echarts.tgz','passed','{}',$8,'synthetic adapter test','alice')`,
        [compatibilityId,target.id,target.package_release_id,target.name,target.version,'f'.repeat(64),'sha512-'+Buffer.alloc(64).toString('base64'),'e'.repeat(64)]);
      expect((await search({ ...request, reactDomVersion: '19.3.1' })).candidates[0].compatibility.status).toBe('unverified');
      await h.db.query('UPDATE compatibility_evidences SET package_sha256=$2 WHERE id=$1', [compatibilityId,target.sha256]);
      expect((await search({ ...request, reactDomVersion: '19.3.1' })).candidates[0].compatibility).toEqual({ status: 'verified', recordIds: [compatibilityId] });
    } finally { await h.close(); }
  });
  it('最终批次复读会拦截检索期间提交的撤权', async () => {
    const h = await workerHarness();
    try {
      await new ReleaseWorker(h.db, h.store, await realRegistry()).runOnce(h.jobId);
      await new SearchIndexer(h.db).runOnce(h.jobId);
      const original = h.db.query.bind(h.db); let snapshots = 0;
      h.db.query = (async (sql: string, values?: unknown[]) => {
        if (sql.includes('AS can_read') && ++snapshots === 2) {
          await original("UPDATE component_permissions SET can_publish=false,can_read=false,can_maintain=false WHERE subject='alice'");
        }
        return original(sql, values);
      }) as typeof h.db.query;
      const response = await new SearchService(h.db).search(input, 'alice');
      expect(snapshots).toBe(2); expect(response.candidates).toEqual([]);
    } finally { await h.close(); }
  });
});
