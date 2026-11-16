import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { validateComponentMatchResponse, type ComponentMatchResponseV1 } from '@company/contracts';
import type { PackageRef, VariantRef } from '@company/contracts';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { ComponentQueryService } from '../../apps/api/dist/matching/component-query.js';
import { PlatformError } from '../../apps/api/dist/errors.js';
import { workerHarness, realRegistry } from './t06-support.js';
import { replaceBundleArtifact } from '../fixtures/t05-artifacts.js';
import { componentApiFixture } from '../fixtures/match-plan.js';

/**
 * 二期 P1：`GET /v1/matching/components` 真实隔离 Nest HTTP / PostgreSQL / MinIO / Verdaccio 验收。
 *
 * 范围与约束（与 `docs/superpowers/specs/2026-11-16-phase2-query-completion-design.md` 一致）：
 * - 无 body、Bearer `read`；`Cache-Control: no-store`、`X-Robots-Tag: noindex`；
 * - 原始 query 串整串保留：重复原始键、重复解码后键、未知键、数组/嵌套、空值、范围版本、
 *   畸形百分号编码一律 400 `INVALID_SCHEMA`，不取首值/末值；
 * - 不可读 / 不存在 / 非 Ready / 已废弃 / peer 不符同形 200 gap；跨包同版本歧义 409 `CONFLICT`，
 *   `packageName` 可消歧；材料损坏 gap `API_UNSUPPORTED`；
 * - 材料读取期间撤权/禁用/废弃或新增歧义必须返回前复查，不残留 target/api/依赖；
 * - GET 是纯查询：不创建发布、映射或索引（本测试逐项核对相关表行数不变）。
 *
 * 前置：本地隔离 PostgreSQL / MinIO / Verdaccio / 本地签名 JWT+JWK 必须真实启动；
 * 环境未启动时测试必须失败，**不得静默 skip**。
 *
 * TDD 记录：路由未实现时 `GET /v1/matching/components` 返回 404，本文件相关用例因此失败（RED）；
 * 由 C 在宿主确认 RED 后再转 GREEN。
 */

type Harness = Awaited<ReturnType<typeof workerHarness>>;

async function setup(): Promise<Harness> {
  const h = await workerHarness(f => {
    for (const v of f.manifest.variants) {
      const api = { ...componentApiFixture(v.framework), componentId: v.componentId, exportName: v.exportName, exportPath: v.exportPath };
      replaceBundleArtifact(f, v.api.path, Buffer.from(JSON.stringify(api)));
    }
    f.manifest.packages.find(p => p.peerDependencies.react)!.peerDependencies['react-dom'] = '19.3.1';
  });
  await new ReleaseWorker(h.db, h.store, await realRegistry()).runOnce(h.jobId);
  return h;
}

/**
 * 已发布 variant_releases 行的真实形状（按 variant_id 取第一个）。
 * 用显式必填类型而不是 `any`：`name`/`version`/`pkg`/`metadata` 在断言里都要逐字段访问。
 */
type ReleaseRow = {
  id: string;
  variant_id: string;
  metadata: VariantRef;
  package_id: string;
  name: string;
  version: string;
  sha256: string;
  pkg: PackageRef;
  job_id: string;
};

async function releaseRow(h: Harness, variantId: string): Promise<ReleaseRow> {
  const result = await h.db.query<ReleaseRow>(`SELECT vr.id, vr.variant_id, vr.metadata, p.id AS package_id, p.name, p.version, p.sha256, p.metadata AS pkg, p.job_id
    FROM variant_releases vr JOIN package_releases p ON p.id=vr.package_release_id WHERE vr.variant_id=$1`, [variantId]);
  return result.rows[0]!;
}

const queryString = (params: Record<string, string | undefined>) =>
  Object.entries(params).filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value!)}`).join('&');

/**
 * 追加一个「同组件 / 同框架 / 同版本、不同包名」的当前可读发布。
 *
 * **元数据身份必须同步到新包名**：`resolveRelease` 会核对 `pkg.name === candidate.packageName`
 * 与 `variant.packageName === candidate.packageName`，直接克隆原包元数据会让资格复读先失败。
 * 那样即使断言到 409，也只是「同名多条发布」造成的歧义，不是真正的跨包歧义。
 */
async function insertAltPackage(
  h: Harness, row: ReleaseRow, altName: string,
  patch?: (pkg: PackageRef, variant: VariantRef) => void,
): Promise<void> {
  const pkg: PackageRef = { ...structuredClone(row.pkg), name: altName };
  const variant: VariantRef = { ...structuredClone(row.metadata), packageName: altName };
  patch?.(pkg, variant);
  const packageId = randomUUID();
  await h.db.query(`INSERT INTO package_releases(id,job_id,name,version,sha256,metadata,state)
    VALUES ($1,$2,$3,$4,$5,$6,'READY')`, [packageId, row.job_id, altName, row.version, row.sha256, pkg]);
  await h.db.query(`INSERT INTO variant_releases(id,variant_id,package_release_id,metadata,availability)
    VALUES ($1,$2,$3,$4,'Ready')`, [randomUUID(), row.variant_id, packageId, variant]);
}

describe('GET /v1/matching/components：真实隔离服务验收', () => {
  it('__proto__ 与百分号编码的 __proto__ 查询键都必须 400，不能被静默丢掉', async () => {
    const h = await setup();
    try {
      const row = await releaseRow(h, 'line-vue');
      const base = `componentId=line&framework=vue&packageVersion=${row.version}&frameworkVersion=3.5.45&echartsVersion=6.1.0`;
      for (const suffix of ['&__proto__=x', '&%5F%5Fproto%5F%5F=x', '&__proto__=' + encodeURIComponent('{"polluted":true}')]) {
        const response = await h.request(`/v1/matching/components?${base}${suffix}`, undefined, h.auth, 'GET');
        expect(response.status).toBe(400);
        expect((await response.json()).code).toBe('INVALID_SCHEMA');
      }
      // 不得污染全局原型
      expect(await h.request(`/v1/matching/components?${base}`, undefined, h.auth, 'GET').then(r => r.status)).toBe(200);
    } finally { await h.close(); }
  });

  it('路由存在并返回双框架精确匹配、no-store/noindex 与公开校验通过的响应', async () => {
    const h = await setup();
    try {
      const row = await releaseRow(h, 'line-vue');
      const response = await h.request(`/v1/matching/components?${queryString({
        componentId: 'line', framework: 'vue', packageVersion: row.version, frameworkVersion: '3.5.45', echartsVersion: '6.1.0',
      })}`, undefined, h.auth, 'GET');
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-robots-tag')).toContain('noindex');
      const body = await response.json();
      expect(validateComponentMatchResponse(body).ok).toBe(true);
      const matched = body as ComponentMatchResponseV1;
      expect(matched.status).toBe('matched');
      expect(matched.query).toEqual({ componentId: 'line', framework: 'vue', packageVersion: row.version, frameworkVersion: '3.5.45', echartsVersion: '6.1.0' });
      expect(matched.target).toMatchObject({
        componentId: 'line', framework: 'vue', packageName: row.name, packageVersion: row.version,
        variantId: 'line-vue', exportName: 'LineChart', compatibility: { status: 'unverified', recordIds: [] },
      });
      expect(matched.api).toMatchObject({ componentId: 'line', framework: 'vue', exportName: 'LineChart' });
      // 依赖顺序未在契约中约定：只断言集合完整、无重复、无多余项
      expect(matched.exactDependencies).toHaveLength(3);
      expect(matched.exactDependencies).toEqual(expect.arrayContaining([
        { name: row.name, version: row.version }, { name: 'vue', version: '3.5.45' }, { name: 'echarts', version: '6.1.0' },
      ]));
      expect(matched.gaps.map(g => g.code)).toEqual(['COMPATIBILITY_UNVERIFIED']);
    } finally { await h.close(); }
  });

  it('React 必须提供精确 reactDomVersion，并计入精确依赖', async () => {
    const h = await setup();
    try {
      const row = await releaseRow(h, 'line-react');
      const response = await h.request(`/v1/matching/components?${queryString({
        componentId: 'line', framework: 'react', packageVersion: row.version, packageName: row.name,
        frameworkVersion: '19.3.1', reactDomVersion: '19.3.1', echartsVersion: '6.1.0',
      })}`, undefined, h.auth, 'GET');
      expect(response.status).toBe(200);
      const body = await response.json() as ComponentMatchResponseV1;
      expect(body.status).toBe('matched');
      expect(body.target!.framework).toBe('react');
      expect(body.exactDependencies).toHaveLength(4);
      expect(body.exactDependencies).toEqual(expect.arrayContaining([
        { name: row.name, version: row.version }, { name: 'react', version: '19.3.1' },
        { name: 'echarts', version: '6.1.0' }, { name: 'react-dom', version: '19.3.1' },
      ]));
    } finally { await h.close(); }
  });

  it('未认证 401、无 read 角色 403', async () => {
    const h = await setup();
    try {
      const row = await releaseRow(h, 'line-vue');
      const url = `/v1/matching/components?${queryString({ componentId: 'line', framework: 'vue', packageVersion: row.version, frameworkVersion: '3.5.45', echartsVersion: '6.1.0' })}`;
      expect((await h.request(url, undefined, undefined, 'GET')).status).toBe(401);
      expect((await h.request(url, undefined, await h.token('nobody', []), 'GET')).status).toBe(403);
    } finally { await h.close(); }
  });

  it.each([
    ['缺 componentId', { framework: 'vue', packageVersion: '0.0.1', frameworkVersion: '3.5.45', echartsVersion: '6.1.0' }],
    ['范围版本', { componentId: 'line', framework: 'vue', packageVersion: '^0.0.1', frameworkVersion: '3.5.45', echartsVersion: '6.1.0' }],
    ['latest', { componentId: 'line', framework: 'vue', packageVersion: 'latest', frameworkVersion: '3.5.45', echartsVersion: '6.1.0' }],
    ['未知参数', { componentId: 'line', framework: 'vue', packageVersion: '0.0.1', frameworkVersion: '3.5.45', echartsVersion: '6.1.0', debug: '1' }],
    ['数组化参数', { componentId: 'line', framework: 'vue', packageVersion: '0.0.1', frameworkVersion: '3.5.45', echartsVersion: '6.1.0', 'componentId[]': 'x' }],
    ['空值', { componentId: '', framework: 'vue', packageVersion: '0.0.1', frameworkVersion: '3.5.45', echartsVersion: '6.1.0' }],
    ['React 缺 DOM 版本', { componentId: 'line', framework: 'react', packageVersion: '0.0.1', frameworkVersion: '19.3.1', echartsVersion: '6.1.0' }],
    ['Vue 带 DOM 版本', { componentId: 'line', framework: 'vue', packageVersion: '0.0.1', frameworkVersion: '3.5.45', echartsVersion: '6.1.0', reactDomVersion: '19.3.1' }],
    ['畸形百分号编码', { componentId: 'line', framework: 'vue', packageVersion: '0.0.1', frameworkVersion: '3.5.45', echartsVersion: '6.1.0', packageName: '%zz' }],
  ])('非法 query 400：%s', async (_label, params) => {
    const h = await setup();
    try {
      const response = await h.request(`/v1/matching/components?${queryString(params as Record<string, string>)}`, undefined, h.auth, 'GET');
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe('INVALID_SCHEMA');
    } finally { await h.close(); }
  });

  it('重复原始键与重复解码后键都 400，且不取首值/末值', async () => {
    const h = await setup();
    try {
      const row = await releaseRow(h, 'line-vue');
      const base = `componentId=line&framework=vue&packageVersion=${row.version}&frameworkVersion=3.5.45&echartsVersion=6.1.0`;
      for (const suffix of ['&componentId=bar', '&component%49d=bar', '&componentId%5B%5D=x']) {
        const response = await h.request(`/v1/matching/components?${base}${suffix}`, undefined, h.auth, 'GET');
        expect(response.status).toBe(400);
        expect((await response.json()).code).toBe('INVALID_SCHEMA');
      }
    } finally { await h.close(); }
  });

  it('合法 scoped packageName 单次百分号解码可查询；二次编码不被再次解释', async () => {
    const h = await setup();
    try {
      const row = await releaseRow(h, 'line-vue');
      const ok = await h.request(`/v1/matching/components?componentId=line&framework=vue&packageVersion=${row.version}`
        + `&packageName=${encodeURIComponent(row.name)}&frameworkVersion=3.5.45&echartsVersion=6.1.0`, undefined, h.auth, 'GET');
      expect(ok.status).toBe(200);
      expect((await ok.json() as ComponentMatchResponseV1).target!.packageName).toBe(row.name);

      const twice = await h.request(`/v1/matching/components?componentId=line&framework=vue&packageVersion=${row.version}`
        + `&packageName=${encodeURIComponent(encodeURIComponent(row.name))}&frameworkVersion=3.5.45&echartsVersion=6.1.0`, undefined, h.auth, 'GET');
      expect(twice.status).toBe(400);
    } finally { await h.close(); }
  });

  it('无权、不存在、非 Ready、已废弃同形 200 gap，不泄露其他目标', async () => {
    const h = await setup();
    try {
      const row = await releaseRow(h, 'line-vue');
      const expectedQuery = (componentId: string) => ({
        componentId, framework: 'vue', packageVersion: row.version, frameworkVersion: '3.5.45', echartsVersion: '6.1.0',
      });
      const url = (componentId: string) => `/v1/matching/components?${queryString(expectedQuery(componentId))}`;
      const read = async (componentId: string) => {
        const response = await h.request(url(componentId), undefined, h.auth, 'GET');
        expect(response.status).toBe(200);
        return await response.json() as ComponentMatchResponseV1;
      };
      /** 去掉 query 后剩下的全部内容：同形断言要覆盖整个响应体，不能只比缺口 code。 */
      const rest = (body: ComponentMatchResponseV1) => {
        const { query: _query, ...others } = body;
        return others;
      };

      const unknown = await read('nope');
      expect(unknown.query).toEqual(expectedQuery('nope'));
      expect(unknown.status).toBe('gap');
      expect(unknown.gaps.map(g => g.code)).toEqual(['TARGET_UNAVAILABLE']);
      expect(unknown.target).toBeUndefined();
      expect(unknown.api).toBeUndefined();
      expect(unknown.exactDependencies).toEqual([]);
      const expectedRest = rest(unknown);

      await h.db.query('UPDATE component_permissions SET can_read=false,can_publish=false,can_maintain=false WHERE subject=$1 AND component_id=$2', ['alice', 'line']);
      const revoked = await read('line');
      // query 必须分别等于各自输入（一个是 nope，一个是 line），不能整体 toEqual
      expect(revoked.query).toEqual(expectedQuery('line'));
      expect(rest(revoked)).toEqual(expectedRest);

      await h.db.query('UPDATE component_permissions SET can_read=true WHERE subject=$1 AND component_id=$2', ['alice', 'line']);
      await h.db.query('UPDATE package_releases SET state=$2 WHERE id=$1', [row.package_id, 'PENDING']);
      const pending = await read('line');
      expect(pending.query).toEqual(expectedQuery('line'));
      expect(rest(pending)).toEqual(expectedRest);
      await h.db.query('UPDATE package_releases SET state=$2 WHERE id=$1', [row.package_id, 'READY']);

      await h.db.query('UPDATE variant_releases SET availability=$2 WHERE id=$1', [row.id, 'DEPRECATED']);
      const deprecated = await read('line');
      expect(deprecated.query).toEqual(expectedQuery('line'));
      expect(rest(deprecated)).toEqual(expectedRest);
      await h.db.query('UPDATE variant_releases SET availability=$2 WHERE id=$1', [row.id, 'Ready']);
    } finally { await h.close(); }
  });

  it('peer 不符同形 gap，不返回材料', async () => {
    const h = await setup();
    try {
      const row = await releaseRow(h, 'line-vue');
      const response = await h.request(`/v1/matching/components?${queryString({
        componentId: 'line', framework: 'vue', packageVersion: row.version, frameworkVersion: '3.5.44', echartsVersion: '6.1.0',
      })}`, undefined, h.auth, 'GET');
      expect(response.status).toBe(200);
      const body = await response.json() as ComponentMatchResponseV1;
      expect(body.status).toBe('gap');
      expect(body.gaps.map(g => g.code)).toEqual(['TARGET_UNAVAILABLE']);
      expect(body.target).toBeUndefined();
    } finally { await h.close(); }
  });

  it('同版本跨包歧义 409 CONFLICT，指定 packageName 后唯一命中', async () => {
    const h = await setup();
    try {
      const row = await releaseRow(h, 'line-vue');
      await insertAltPackage(h, row, `${row.name}-alt`);
      const base = { componentId: 'line', framework: 'vue', packageVersion: row.version, frameworkVersion: '3.5.45', echartsVersion: '6.1.0' };
      const conflict = await h.request(`/v1/matching/components?${queryString(base)}`, undefined, h.auth, 'GET');
      expect(conflict.status).toBe(409);
      expect((await conflict.json()).code).toBe('CONFLICT');
      const scoped = await h.request(`/v1/matching/components?${queryString({ ...base, packageName: row.name })}`, undefined, h.auth, 'GET');
      expect(scoped.status).toBe(200);
      expect((await scoped.json() as ComponentMatchResponseV1).target!.packageName).toBe(row.name);
    } finally { await h.close(); }
  });

  it('peer 不符但当前可读的第二包也必须造成跨包歧义 409，不能用资格过滤消除', async () => {
    const h = await setup();
    try {
      const row = await releaseRow(h, 'line-vue');
      // 同一组件/框架/版本、不同包名；peer 与查询不符，但当前可读且 Ready
      await insertAltPackage(h, row, `${row.name}-alt`, pkg => { pkg.peerDependencies = { ...pkg.peerDependencies, vue: '3.5.44' }; });
      const base = { componentId: 'line', framework: 'vue', packageVersion: row.version, frameworkVersion: '3.5.45', echartsVersion: '6.1.0' };
      const conflict = await h.request(`/v1/matching/components?${queryString(base)}`, undefined, h.auth, 'GET');
      expect(conflict.status).toBe(409);
      expect((await conflict.json()).code).toBe('CONFLICT');
    } finally { await h.close(); }
  });

  it('材料损坏 gap API_UNSUPPORTED，不返回 target/api/依赖', async () => {
    const h = await setup();
    try {
      const row = await releaseRow(h, 'line-vue');
      const apiPath = (row.metadata as { api: { path: string } }).api.path;
      await h.db.query('UPDATE release_artifacts SET sha256=$2 WHERE job_id=$1 AND path=$3', [row.job_id, 'f'.repeat(64), apiPath]);
      const response = await h.request(`/v1/matching/components?${queryString({
        componentId: 'line', framework: 'vue', packageVersion: row.version, packageName: row.name, frameworkVersion: '3.5.45', echartsVersion: '6.1.0',
      })}`, undefined, h.auth, 'GET');
      expect(response.status).toBe(200);
      const body = await response.json() as ComponentMatchResponseV1;
      expect(body.status).toBe('gap');
      expect(body.gaps.map(g => g.code)).toEqual(['API_UNSUPPORTED']);
      expect(body.exactDependencies).toEqual([]);
    } finally { await h.close(); }
  });

  it('材料读取期间撤权：返回前复查并清空材料与依赖', async () => {
    const h = await setup();
    try {
      const row = await releaseRow(h, 'line-vue');
      const original = h.db.query.bind(h.db);
      let reads = 0;
      h.db.query = (async (sql: string, values?: unknown[]) => {
        if (sql.includes('AS can_read') && ++reads === 2) {
          await original('UPDATE component_permissions SET can_read=false,can_publish=false,can_maintain=false WHERE subject=$1 AND component_id=$2', ['alice', 'line']);
        }
        return original(sql, values);
      }) as typeof h.db.query;
      const result = await new ComponentQueryService(h.db, h.store).query({
        componentId: 'line', framework: 'vue', packageVersion: row.version, frameworkVersion: '3.5.45', echartsVersion: '6.1.0',
      }, 'alice');
      expect(reads).toBeGreaterThanOrEqual(2);
      expect(result.status).toBe('gap');
      expect(result.gaps.map(g => g.code)).toEqual(['TARGET_UNAVAILABLE']);
      expect(result.target).toBeUndefined();
      expect(result.exactDependencies).toEqual([]);
    } finally { await h.close(); }
  });

  it('GET 是纯查询：发布、映射、索引与审计写入都不增加', async () => {
    const h = await setup();
    try {
      const row = await releaseRow(h, 'line-vue');
      const counts = async () => {
        const row = (await h.db.query(`SELECT
          (SELECT count(*)::int FROM release_jobs) AS jobs,
          (SELECT count(*)::int FROM variant_releases) AS variants,
          (SELECT count(*)::int FROM package_releases) AS packages,
          (SELECT count(*)::int FROM search_documents) AS documents,
          (SELECT count(*)::int FROM upload_sessions) AS uploads`)).rows[0]!;
        return { jobs: row.jobs, variants: row.variants, packages: row.packages, documents: row.documents, uploads: row.uploads };
      };
      const before = await counts();
      for (const params of [
        { componentId: 'line', framework: 'vue', packageVersion: row.version, frameworkVersion: '3.5.45', echartsVersion: '6.1.0' },
        { componentId: 'line', framework: 'react', packageVersion: row.version, packageName: row.name, frameworkVersion: '19.3.1', reactDomVersion: '19.3.1', echartsVersion: '6.1.0' },
      ]) {
        const response = await h.request(`/v1/matching/components?${queryString(params)}`, undefined, h.auth, 'GET');
        expect(response.status).toBe(200);
        expect(validateComponentMatchResponse(await response.json()).ok).toBe(true);
      }
      expect(await counts()).toEqual(before);
      expect((await h.db.query('SELECT count(*)::int AS n FROM search_documents')).rows[0]!.n).toBe(0);
    } finally { await h.close(); }
  });

  /**
   * 真实 HTTP 下的「读取期间状态变更」回归。
   *
   * 手法：patch `h.platform().store!.read`，在**真实材料读取进行中**通过 `h.db` 改变状态，
   * 然后照常用 `h.request` 发 GET。不走 `new ComponentQueryService(...)` 直调——那只是单元级，
   * 证明不了 HTTP 链路上「返回前复查」真的挡住了变更。
   */
  describe('真实 HTTP：材料读取期间撤权/禁用/废弃/新增歧义', () => {
    const baseParams = (row: { version: string; name: string }) => ({
      componentId: 'line', framework: 'vue', packageVersion: row.version, packageName: row.name,
      frameworkVersion: '3.5.45', echartsVersion: '6.1.0',
    });

    /**
     * 在真实材料读取时执行一次 `mutate()`，然后照常发 GET 并解析响应。
     * 同时回传 `fired`：调用方必须证明钩子真的在材料读取期间触发过，
     * 否则「什么都没发生」也能得到同样的结果，断言就失去了意义。
     */
    async function getWithMidReadMutation(
      h: Awaited<ReturnType<typeof setup>>,
      params: Record<string, string>,
      mutate: () => Promise<void>,
    ): Promise<{ status: number; body: ComponentMatchResponseV1 | { code: string }; fired: boolean }> {
      const store = h.platform().store!;
      const original = store.read.bind(store);
      let fired = false;
      store.read = (async (key: string, expectedBytes: number) => {
        const bytes = await original(key, expectedBytes);
        if (!fired) { fired = true; await mutate(); }
        return bytes;
      }) as typeof store.read;
      try {
        const response = await h.request(`/v1/matching/components?${queryString(params)}`, undefined, h.auth, 'GET');
        return { status: response.status, body: await response.json(), fired };
      } finally { store.read = original; }
    }

    it('材料读取期间被撤权：同形 TARGET_UNAVAILABLE，不残留 target/api/依赖', async () => {
      const h = await setup();
      try {
        const row = await releaseRow(h, 'line-vue');
        const { status, body } = await getWithMidReadMutation(h, baseParams(row), async () => {
          await h.db.query('UPDATE component_permissions SET can_read=false,can_publish=false,can_maintain=false WHERE subject=$1 AND component_id=$2', ['alice', 'line']);
        });
        expect(status).toBe(200);
        const gap = body as ComponentMatchResponseV1;
        expect(gap.status).toBe('gap');
        expect(gap.gaps.map(g => g.code)).toEqual(['TARGET_UNAVAILABLE']);
        expect(gap.target).toBeUndefined();
        expect(gap.api).toBeUndefined();
        expect(gap.exactDependencies).toEqual([]);
      } finally { await h.close(); }
    });

    it('材料读取期间被禁用（disabled_subjects）：同形 TARGET_UNAVAILABLE', async () => {
      const h = await setup();
      try {
        const row = await releaseRow(h, 'line-vue');
        const { status, body } = await getWithMidReadMutation(h, baseParams(row), async () => {
          await h.db.query('INSERT INTO disabled_subjects(subject) VALUES ($1)', ['alice']);
        });
        expect(status).toBe(200);
        const gap = body as ComponentMatchResponseV1;
        expect(gap.status).toBe('gap');
        expect(gap.gaps.map(g => g.code)).toEqual(['TARGET_UNAVAILABLE']);
        expect(gap.exactDependencies).toEqual([]);
      } finally { await h.close(); }
    });

    it('材料读取期间被废弃：同形 TARGET_UNAVAILABLE，不残留材料', async () => {
      const h = await setup();
      try {
        const row = await releaseRow(h, 'line-vue');
        const { status, body } = await getWithMidReadMutation(h, baseParams(row), async () => {
          await h.db.query('UPDATE variant_releases SET availability=$2 WHERE id=$1', [row.id, 'DEPRECATED']);
        });
        expect(status).toBe(200);
        const gap = body as ComponentMatchResponseV1;
        expect(gap.status).toBe('gap');
        expect(gap.gaps.map(g => g.code)).toEqual(['TARGET_UNAVAILABLE']);
        expect(gap.exactDependencies).toEqual([]);
      } finally { await h.close(); }
    });

    it('材料读取期间新增同版本可读发布：409 CONFLICT，不沿用首次结果', async () => {
      const h = await setup();
      try {
        const row = await releaseRow(h, 'line-vue');
        // **不能带 packageName**：带上就等于已经指定唯一目标，新增的第二个包根本进不了歧义集，
        // 那样的用例即使通过也没有验证「新增歧义被返回前复查拦住」。
        const { packageName: _packageName, ...ambiguous } = baseParams(row);
        const { status, body, fired } = await getWithMidReadMutation(h, ambiguous, async () => {
          // 完整追加 package + variant 两行，元数据身份同步到新包名
          await insertAltPackage(h, row, `${row.name}-alt`);
        });
        // 先证明 mid-read 钩子真的在材料读取期间触发过，否则「什么都没变」也能得到同样结果
        expect(fired).toBe(true);
        expect(status).toBe(409);
        expect((body as { code: string }).code).toBe('CONFLICT');
      } finally { await h.close(); }
    });

    it('未发生状态变更时同一手法必须仍然 matched（证明手法本身不制造失败）', async () => {
      const h = await setup();
      try {
        const row = await releaseRow(h, 'line-vue');
        const { status, body, fired } = await getWithMidReadMutation(h, baseParams(row), async () => {});
        expect(fired).toBe(true);
        expect(status).toBe(200);
        expect((body as ComponentMatchResponseV1).status).toBe('matched');
      } finally { await h.close(); }
    });
  });

  /**
   * 真实 HTTP：静态材料读取的存储层错误归一回归。
   *
   * 已证实的产品缺陷：`ArtifactStore.read` 对 S3 404 抛 `UPLOAD_INCOMPLETE`(409)、
   * 对对象大于 `expectedBytes` 抛 `LIMIT_EXCEEDED`(413)，而 `materials.readApi`
   * 只吞 `NOT_FOUND` / `DIGEST_MISMATCH`，于是这两类**静态材料不可用**既不会被归一成
   * `API_UNSUPPORTED`，还会让请求在「返回前复查」之前就抛错退出——等于跳过复查。
   *
   * 手法：改写 patch 里转发给 `original` 的 key / expectedBytes，让**真实的**
   * `ArtifactStore.read` 真正走完 S3 交互后抛出上述错误，不用假 error 冒充。
   */
  describe('真实 HTTP：材料读取的存储层 404/超长必须归一，且仍执行最终复查', () => {
    /** 查询参数**不带** packageName：避免任何歧义消歧把测试目标掩盖掉。 */
    const paramsFor = (row: ReleaseRow) => ({
      componentId: 'line', framework: 'vue', packageVersion: row.version,
      frameworkVersion: '3.5.45', echartsVersion: '6.1.0',
    });

    /**
     * 在材料读取时把 `original` 的入参改写后真实读取；`mutate` 在读取**之前**执行，
     * 因此可以模拟「读材料期间被撤权」与「读材料失败」同时发生。
     */
    async function getWithStoreReadRewrite(
      h: Awaited<ReturnType<typeof setup>>,
      params: Record<string, string>,
      rewrite: (key: string, expectedBytes: number) => { key: string; expectedBytes: number },
      mutate?: () => Promise<void>,
    ): Promise<{ status: number; body: unknown; fired: boolean }> {
      const store = h.platform().store!;
      const original = store.read.bind(store);
      let fired = false;
      store.read = (async (key: string, expectedBytes: number) => {
        if (!fired) { fired = true; if (mutate) await mutate(); }
        const target = rewrite(key, expectedBytes);
        return original(target.key, target.expectedBytes);
      }) as typeof store.read;
      try {
        const response = await h.request(`/v1/matching/components?${queryString(params)}`, undefined, h.auth, 'GET');
        return { status: response.status, body: await response.json(), fired };
      } finally { store.read = original; }
    }

    it('真实 S3 404（对象键不存在）→ 200 gap API_UNSUPPORTED，不返回 target/api/依赖', async () => {
      const h = await setup();
      try {
        const row = await releaseRow(h, 'line-vue');
        const { status, body, fired } = await getWithStoreReadRewrite(h, paramsFor(row), () => ({
          key: 'api/definitely-not-present-in-minio.json', expectedBytes: 1,
        }));
        expect(fired).toBe(true);
        expect(status).toBe(200);
        const gap = body as ComponentMatchResponseV1;
        expect(gap.status).toBe('gap');
        expect(gap.gaps.map(g => g.code)).toEqual(['API_UNSUPPORTED']);
        expect(gap.target).toBeUndefined();
        expect(gap.api).toBeUndefined();
        expect(gap.exactDependencies).toEqual([]);
      } finally { await h.close(); }
    });

    it('真实超长（期望字节数比对象少 1）→ 200 gap API_UNSUPPORTED', async () => {
      const h = await setup();
      try {
        const row = await releaseRow(h, 'line-vue');
        const { status, body, fired } = await getWithStoreReadRewrite(
          h, paramsFor(row),
          (key, expectedBytes) => ({ key, expectedBytes: expectedBytes - 1 }),
        );
        expect(fired).toBe(true);
        expect(status).toBe(200);
        const gap = body as ComponentMatchResponseV1;
        expect(gap.status).toBe('gap');
        expect(gap.gaps.map(g => g.code)).toEqual(['API_UNSUPPORTED']);
        expect(gap.target).toBeUndefined();
        expect(gap.exactDependencies).toEqual([]);
      } finally { await h.close(); }
    });

    it('存储 404 叠加材料读取期间撤权：必须同形 TARGET_UNAVAILABLE，不得跳过最终复查', async () => {
      const h = await setup();
      try {
        const row = await releaseRow(h, 'line-vue');
        const { status, body, fired } = await getWithStoreReadRewrite(
          h, paramsFor(row),
          () => ({ key: 'api/definitely-not-present-in-minio.json', expectedBytes: 1 }),
          async () => {
            await h.db.query('UPDATE component_permissions SET can_read=false,can_publish=false,can_maintain=false WHERE subject=$1 AND component_id=$2', ['alice', 'line']);
          },
        );
        expect(fired).toBe(true);
        expect(status).toBe(200);
        const gap = body as ComponentMatchResponseV1;
        expect(gap.status).toBe('gap');
        // 撤权与材料不可用必须同形：不能因为存储层先抛错就泄露目标存在性
        expect(gap.gaps.map(g => g.code)).toEqual(['TARGET_UNAVAILABLE']);
        expect(gap.target).toBeUndefined();
        expect(gap.api).toBeUndefined();
        expect(gap.exactDependencies).toEqual([]);
      } finally { await h.close(); }
    });

    it('INFRA_UNAVAILABLE 仍以 503 结束，不得伪装成业务缺口', async () => {
      const h = await setup();
      try {
        const row = await releaseRow(h, 'line-vue');
        const store = h.platform().store!;
        const original = store.read.bind(store);
        let fired = false;
        store.read = (async (key: string, expectedBytes: number) => {
          if (!fired) {
            fired = true;
            // 基础设施故障（非 404 / 非超长的 S3 失败）在 `ArtifactStore.read` 中归一为
            // INFRA_UNAVAILABLE，见 apps/api/src/storage/artifact-store.ts。这里在 seam 上
            // 复现同一错误对象，断言 GET 不把它降级成 gap——S3→INFRA_UNAVAILABLE 的映射本身
            // 由 artifact-store 自己的测试覆盖，不在本文件重复推导。
            throw new PlatformError('INFRA_UNAVAILABLE');
          }
          return original(key, expectedBytes);
        }) as typeof store.read;
        try {
          const response = await h.request(`/v1/matching/components?${queryString(paramsFor(row))}`, undefined, h.auth, 'GET');
          expect(fired).toBe(true);
          expect(response.status).toBe(503);
          expect((await response.json()).code).toBe('INFRA_UNAVAILABLE');
        } finally { store.read = original; }
      } finally { await h.close(); }
    });
  });
});
