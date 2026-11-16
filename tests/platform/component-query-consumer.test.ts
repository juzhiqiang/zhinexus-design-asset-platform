import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { validateComponentMatchResponse } from '@company/contracts';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { workerHarness, realRegistry } from './t06-support.js';
import { replaceBundleArtifact } from '../fixtures/t05-artifacts.js';
import { componentApiFixture } from '../fixtures/match-plan.js';
// P3/D: public HTTP black-box for GET /v1/matching/components. Synthetic protocol material, not business samples.
// Before P1 lands every case sees 404: expected RED, not a facility failure.
const PATH = '/v1/matching/components';
let h: Awaited<ReturnType<typeof workerHarness>>;
let rows: Array<{ id: string; variant_id: string }>;
const pkg = (f: 'vue' | 'react') => { const v = h.fixture.manifest.variants.find(x => x.componentId === 'line' && x.framework === f)!; return { name: v.packageName, version: v.packageVersion }; };
const q = (f: 'vue' | 'react', o: Record<string, string> = {}) => ({ componentId: 'line', framework: f, packageVersion: pkg(f).version, frameworkVersion: f === 'vue' ? '3.5.45' : '19.3.1', echartsVersion: '6.1.0', ...(f === 'react' ? { reactDomVersion: '19.3.1' } : {}), ...o }) as Record<string, string>;
const get = (params: Record<string, string>, token: string | undefined = h.auth) => h.request(PATH + '?' + new URLSearchParams(params), undefined, token, 'GET');
const raw = (query: string) => h.request(PATH + '?' + query, undefined, h.auth, 'GET');
const body = async (r: Response) => { const t = await r.text(); try { return JSON.parse(t); } catch { throw new Error(`${r.status}: ${t.slice(0, 200)}`); } };
const checked = (input: unknown) => { const r = validateComponentMatchResponse(input); expect(r.ok, JSON.stringify(r.ok ? [] : r.issues)).toBe(true); if (!r.ok) throw new Error('invalid'); return r.value; };
const gap = (input: unknown, query: Record<string, string>) => { const r = checked(input); expect(r.status).toBe('gap'); expect(r.target).toBeUndefined(); expect(r.api).toBeUndefined(); expect(r.exactDependencies).toEqual([]); expect(r.gaps.length).toBeGreaterThan(0); expect(r.query).toEqual(query); return r; };
beforeAll(async () => {
  h = await workerHarness(f => { for (const v of f.manifest.variants) replaceBundleArtifact(f, v.api.path, Buffer.from(JSON.stringify({ ...componentApiFixture(v.framework), componentId: v.componentId, exportName: v.exportName, exportPath: v.exportPath }))); f.manifest.packages.find(p => p.peerDependencies.react)!.peerDependencies['react-dom'] = '19.3.1'; });
  await new ReleaseWorker(h.db, h.store, await realRegistry()).runOnce(h.jobId);
  rows = (await h.db.query<{ id: string; variant_id: string }>('SELECT id,variant_id FROM variant_releases')).rows;
}, 120_000);
afterAll(async () => { await h?.close(); });
describe('GET /v1/matching/components public acceptance (D)', () => {
  it('Vue/React exact match, identity, deps, scoped encoding', async () => {
    for (const f of ['vue', 'react'] as const) {
      const query = q(f); const r = await get(query); expect(r.status, await r.clone().text()).toBe(200);
      expect(r.headers.get('cache-control')).toBe('no-store'); expect(r.headers.get('x-robots-tag')).toMatch(/noindex.*nofollow/);
      const v = checked(await body(r)); expect(v.status).toBe('matched'); expect(v.query).toEqual(query); expect(v.target!.framework).toBe(f); expect(v.target!.packageName).toBe(pkg(f).name); expect(v.target!.packageVersion).toBe(pkg(f).version);
      expect(v.exactDependencies).toEqual(expect.arrayContaining([{ name: pkg(f).name, version: pkg(f).version }, { name: f, version: query.frameworkVersion }, { name: 'echarts', version: '6.1.0' }, ...(f === 'react' ? [{ name: 'react-dom', version: '19.3.1' }] : [])]));
      expect(v.api!.events.map(e => e.name)).toEqual([f === 'vue' ? 'point-click' : 'onPointClick']); expect(v.target!.compatibility.status).toBe('unverified'); expect(v.gaps.map(g => g.code)).toEqual(['COMPATIBILITY_UNVERIFIED']);
    }
    expect((await get(q('vue', { packageName: pkg('vue').name }))).status).toBe(200);
  }, 120_000);
  it('invalid queries rejected 400 INVALID_SCHEMA', async () => {
    const b = q('vue'); const enc = new URLSearchParams(b).toString();
    for (const suffix of ['&__proto__=x', '&%5F%5Fproto%5F%5F=x']) expect((await raw(enc + suffix)).status).toBe(400);
    const bad = [enc + '&extra=x', enc + '&componentId=line', enc + '&component%49d=line', enc + '&__proto__%5Bx%5D=1', enc + '&packageVersion[]=1', 'componentId=%E0%A4%A&framework=vue', new URLSearchParams({ ...b, echartsVersion: '' }).toString(), new URLSearchParams({ ...b, framework: 'svelte' }).toString(), new URLSearchParams({ ...b, packageVersion: 'latest' }).toString(), new URLSearchParams({ ...b, frameworkVersion: '~3.5' }).toString(), new URLSearchParams({ ...b, reactDomVersion: '19.3.1' }).toString(), new URLSearchParams(Object.entries(q('react')).filter(([k]) => k !== 'reactDomVersion')).toString()];
    for (const query of bad) { const r = await raw(query); expect(r.status, query).toBe(400); expect((await body(r)).code, query).toBe('INVALID_SCHEMA'); }
  });
  it('401 without token, 403 without read role', async () => {
    expect((await h.request(PATH + '?' + new URLSearchParams(q('vue')), undefined, undefined, 'GET')).status).toBe(401); expect((await get(q('vue'), await h.token('nobody', []))).status).toBe(403);
  });
  it('unknown/revoked/deprecated/peer gaps share one shape', async () => {
    const shapes: string[] = []; const collect = async (label: string, params: Record<string, string>) => { const r = await get(params); expect(r.status, label).toBe(200); expect(r.headers.get('cache-control')).toBe('no-store'); const v = gap(await body(r), params); expect(v.gaps.map(g => g.code), label).toEqual(['TARGET_UNAVAILABLE']); shapes.push(JSON.stringify({ ...v, query: null })); };
    const vue = rows.find(r => r.variant_id === 'line-vue')!;
    await collect('unknown', q('vue', { componentId: 'missing' }));
    await h.db.query("UPDATE component_permissions SET can_read=false,can_publish=false,can_maintain=false WHERE subject='alice' AND component_id='line'"); await collect('revoked', q('vue'));
    await h.db.query("UPDATE component_permissions SET can_read=true WHERE subject='alice' AND component_id='line'");
    await h.db.query("UPDATE variant_releases SET availability='DEPRECATED' WHERE id=$1", [vue.id]); await collect('deprecated', q('vue'));
    await h.db.query("UPDATE variant_releases SET availability='Ready' WHERE id=$1", [vue.id]);
    await collect('peer', q('vue', { frameworkVersion: '3.5.44' })); expect(new Set(shapes).size).toBe(1);
  }, 120_000);
  it('cross-package ambiguity 409, packageName selects', async () => {
    const vue = rows.find(r => r.variant_id === 'line-vue')!;
    const altName = pkg('vue').name + '.alt'; const altPkg = randomUUID(); const altVar = randomUUID();
    await h.db.query(`INSERT INTO package_releases(id,job_id,name,version,sha256,metadata,state) SELECT $1::uuid,job_id,$2,version,sha256,jsonb_set(metadata,'{name}',to_jsonb($2::text)),state FROM package_releases WHERE id=(SELECT package_release_id FROM variant_releases WHERE id=$3)`, [altPkg, altName, vue.id]);
    await h.db.query(`INSERT INTO variant_releases(id,variant_id,package_release_id,metadata,availability) SELECT $1::uuid,variant_id,$2::uuid,jsonb_set(metadata,'{packageName}',to_jsonb($3::text)),availability FROM variant_releases WHERE id=$4`, [altVar, altPkg, altName, vue.id]);
    const conflict = await get(q('vue')); expect(conflict.status).toBe(409); const text = JSON.stringify(await body(conflict)); expect(JSON.parse(text).code).toBe('CONFLICT'); for (const n of [altName, altVar]) expect(text).not.toContain(n);
    expect(checked(await body(await get(q('vue', { packageName: pkg('vue').name })))).target!.variantReleaseId).toBe(vue.id);
    expect(checked(await body(await get(q('vue', { packageName: altName })))).target!.variantReleaseId).toBe(altVar);
  }, 120_000);
});
