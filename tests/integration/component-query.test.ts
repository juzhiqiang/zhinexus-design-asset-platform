import { describe, expect, it } from 'vitest';
import { validateComponentMatchResponse, type ComponentMatchQueryV1 } from '@company/contracts';
import { makeFixture, digest } from '../fixtures/releases/g1/factory.js';
import { componentApiFixture } from '../fixtures/match-plan.js';
import { PlatformError } from '../../apps/api/dist/errors.js';
import type { CurrentCandidateSnapshot } from '../../apps/api/dist/search/eligibility.js';
import {
  parseComponentMatchQuery,
} from '../../apps/api/dist/matching/component-query-routes.js';
import {
  queryComponentMatch,
  type ComponentQueryStore,
} from '../../apps/api/dist/matching/component-query.js';

/**
 * 二期 P1：`GET /v1/matching/components` 组件精确查询集成测试。
 *
 * 范围与约束（与 `docs/superpowers/specs/2026-11-16-phase2-query-completion-design.md` 一致）：
 * - 权威 SQL 查询 + 精确 package/variant 选择；先应用 `catalog_can_read` 再判断可读歧义，
 *   不可因私有目标存在泄露信息；
 * - 不可读 / 不存在 / 非 Ready / 已废弃 / peer 不满足同形 200 gap `TARGET_UNAVAILABLE`；
 * - API/docs 缺失或摘要/格式不符 gap `API_UNSUPPORTED`；依赖不一致 gap `DEPENDENCY_CONFLICT`；
 * - 同条件多个当前可读发布 409 `CONFLICT`，`packageName` 可消歧；
 * - 材料读完复查权限、状态、废弃与新增歧义；撤权/禁用清空 target/api/exactDependencies；
 * - 缺兼容证据返回 `matched` + `unverified` + `COMPATIBILITY_UNVERIFIED`；
 * - GET 不返回设计绑定 gaps，不创建发布/映射/索引（本测试断言 store 未发生任何写语句）。
 *
 * 原始 query 串必须整串保留并在解码后检查重复键：不使用任何框架 query 对象，
 * 因此重复键不会被静默覆盖。
 *
 * TDD 记录：实现文件缺失时本文件因无法解析导入而失败（RED），宿主确认 RED 后已转 GREEN；
 * 后续修订只涉及测试夹具与断言口径（见验证文档 0-A.2），未削弱任何安全断言。
 */

type Snapshot = CurrentCandidateSnapshot;

/**
 * 依据冻结 fixture 构造可注入的查询 store，并暴露篡改钩子。
 *
 * fixture 约定（避免测试自身缺陷掩盖产品缺陷）：
 * - **每个框架独立 API/docs 材料**：Vue 与 React 不共用一份字节，否则 React 的 API 身份
 *  校验会因读到 Vue 材料而失真；
 * - `add()` 克隆**同框架模板**后再改 `name` / `variant.packageName` / `version`，
 *   不用任意包名去反查模板（那会拿到 undefined）；
 * - `candidate.evidence` 与 `variant.api` / `variant.docs` 始终一致：资格复读会核对
 *   「evidence 与 metadata 同 path 同 sha256」，不一致会先失败成 TARGET_UNAVAILABLE，
 *   那就测不到材料层了。要测材料层，就保持 metadata/evidence 一致、只篡改 store 读出的字节。
 */
function harness() {
  const f = makeFixture();
  const apiPathFor = (framework: 'vue' | 'react') => `api/line-${framework}.json`;
  const docsPathFor = (framework: 'vue' | 'react') => `docs/line-${framework}.md`;
  const apiBytesFor = (framework: 'vue' | 'react') => new TextEncoder().encode(JSON.stringify(componentApiFixture(framework)));
  const docsBytesFor = (framework: 'vue' | 'react') => new TextEncoder().encode(`# ${framework} line`);
  for (const framework of ['vue', 'react'] as const) {
    f.files.set(apiPathFor(framework), apiBytesFor(framework));
    f.files.set(docsPathFor(framework), docsBytesFor(framework));
  }

  const rows: Array<{ id: string; snapshot: Snapshot }> = [];
  const add = (framework: 'vue' | 'react', packageName: string, packageVersion: string, id: string) => {
    const apiBytes = apiBytesFor(framework);
    const docsBytes = docsBytesFor(framework);
    const variant = {
      ...structuredClone(f.manifest.variants.find(v => v.framework === framework)!),
      packageName, packageVersion,
      api: { path: apiPathFor(framework), sha256: digest(apiBytes), bytes: apiBytes.byteLength },
      docs: { path: docsPathFor(framework), sha256: digest(docsBytes), bytes: docsBytes.byteLength },
    };
    const pkg = {
      ...structuredClone(f.manifest.packages.find(p => p.name === `@company/charts-${framework}`)!),
      name: packageName, version: packageVersion,
    };
    if (framework === 'react') pkg.peerDependencies = { ...pkg.peerDependencies, 'react-dom': '19.3.1' };
    rows.push({
      id,
      snapshot: {
        variant, package: pkg, canRead: true, availability: 'Ready', packageState: 'READY', jobState: 'READY',
        revision: `rev-${id}`, activeProviderVersion: '', index: { state: 'failed', revision: '', providerVersion: '' },
        peerDependencies: pkg.peerDependencies, acceptedCompatibility: [],
        candidate: {
          variantReleaseId: id, variantId: variant.variantId, componentId: variant.componentId, framework,
          packageName: pkg.name, packageVersion: pkg.version, packageSha256: pkg.tarball.sha256, exportName: variant.exportName,
          evidence: [
            { kind: 'api', path: variant.api.path, sha256: variant.api.sha256 },
            { kind: 'docs', path: variant.docs.path, sha256: variant.docs.sha256 },
          ], gaps: [],
        },
      },
    });
  };
  add('vue', '@company/charts-vue', '0.0.10', '00000000-0000-4000-8000-000000000001');
  add('react', '@company/charts-react', '0.0.10', '00000000-0000-4000-8000-000000000002');

  let loads = 0;
  const subjects: string[] = [];
  const store: ComponentQueryStore = {
    async find(filter, subject) {
      loads++;
      // 身份必须由调用方一路传到权威读取：缺 subject 说明接线断裂
      expect(typeof subject).toBe('string');
      expect(subject.length).toBeGreaterThan(0);
      subjects.push(subject);
      const matched = rows.filter(({ snapshot }) =>
        snapshot.candidate.componentId === filter.componentId &&
        snapshot.candidate.framework === filter.framework &&
        snapshot.candidate.packageVersion === filter.packageVersion &&
        (filter.packageName === undefined || snapshot.candidate.packageName === filter.packageName));
      return matched.map(({ snapshot }) => structuredClone(snapshot));
    },
    async artifact(_id, path) {
      const bytes = f.files.get(path);
      if (!bytes) throw new Error(`missing artifact ${path}`);
      return bytes;
    },
  };
  const find = (id: string) => rows.find(row => row.id === id)!;
  return { store, rows, find, add, counts: () => ({ loads }), subjects, apiPathFor, docsPathFor, apiBytesFor, docsBytesFor };
}

const vueQuery = { componentId: 'line', framework: 'vue' as const, packageVersion: '0.0.10', frameworkVersion: '3.5.45', echartsVersion: '6.1.0' };
const reactQuery = { componentId: 'line', framework: 'react' as const, packageVersion: '0.0.10', frameworkVersion: '19.3.1', echartsVersion: '6.1.0', reactDomVersion: '19.3.1' };

describe('GET /v1/matching/components：精确查询与材料校验', () => {
  it('Vue 精确匹配返回 target/api/精确依赖，并保留 COMPATIBILITY_UNVERIFIED', async () => {
    const h = harness();
    const result = await queryComponentMatch(vueQuery, h.store, 'alice');
    expect(result.status).toBe('matched');
    expect(result.query).toEqual(vueQuery);
    expect(result.target).toMatchObject({
      variantReleaseId: '00000000-0000-4000-8000-000000000001', componentId: 'line', framework: 'vue',
      packageName: '@company/charts-vue', packageVersion: '0.0.10', exportName: 'LineChart', exportPath: './line',
      compatibility: { status: 'unverified', recordIds: [] },
    });
    expect(result.api).toMatchObject({ componentId: 'line', framework: 'vue', exportName: 'LineChart', exportPath: './line' });
    // 依赖顺序未在契约中约定：只断言集合完整、无重复、无多余项
    expect(result.exactDependencies).toHaveLength(3);
    expect(result.exactDependencies).toEqual(expect.arrayContaining([
      { name: '@company/charts-vue', version: '0.0.10' },
      { name: 'vue', version: '3.5.45' },
      { name: 'echarts', version: '6.1.0' },
    ]));
    expect(result.gaps.map(g => g.code)).toEqual(['COMPATIBILITY_UNVERIFIED']);
  });

  it('React 精确匹配要求 reactDomVersion 并把它计入精确依赖', async () => {
    const h = harness();
    const result = await queryComponentMatch(reactQuery, h.store, 'alice');
    expect(result.status).toBe('matched');
    expect(result.target!.framework).toBe('react');
    // React 有独立的 API 材料：身份校验必须读到 react 自己的字节
    expect(result.api).toMatchObject({ componentId: 'line', framework: 'react', exportName: 'LineChart', exportPath: './line' });
    expect(result.exactDependencies).toHaveLength(4);
    expect(result.exactDependencies).toEqual(expect.arrayContaining([
      { name: '@company/charts-react', version: '0.0.10' },
      { name: 'react', version: '19.3.1' },
      { name: 'echarts', version: '6.1.0' },
      { name: 'react-dom', version: '19.3.1' },
    ]));
  });

  // 反例在**类型上就是非法的**（缺必填 / 未知字段 / 框架取值非法），不能写成合法的
  // `ComponentMatchQueryV1`。这里显式按 `unknown` 收集，由运行时的
  // `validateComponentMatchQuery` 拒绝——拒绝必须发生在产品侧，而不是靠类型系统。
  const invalidQueries: Array<readonly [string, unknown]> = [
    ['缺 componentId', { ...vueQuery, componentId: undefined }],
    ['缺 packageVersion', { ...vueQuery, packageVersion: undefined }],
    ['缺 frameworkVersion', { ...vueQuery, frameworkVersion: undefined }],
    ['缺 echartsVersion', { ...vueQuery, echartsVersion: undefined }],
    ['未知字段', { ...vueQuery, extra: 'x' }],
    ['范围版本', { ...vueQuery, packageVersion: '^0.0.10' }],
    ['不完整版本', { ...vueQuery, packageVersion: '0.0' }],
    ['latest', { ...vueQuery, packageVersion: 'latest' }],
    ['React 缺 DOM 版本', { ...reactQuery, reactDomVersion: undefined }],
    ['Vue 带 DOM 版本', { ...vueQuery, reactDomVersion: '19.3.1' }],
    ['框架非法', { ...vueQuery, framework: 'angular' }],
  ];
  it.each(invalidQueries)('非法 query 拒绝：%s', async (_label, input) => {
    const h = harness();
    await expect(queryComponentMatch(input as ComponentMatchQueryV1, h.store, 'alice')).rejects.toMatchObject({ code: 'INVALID_SCHEMA', status: 400 });
    expect(h.counts().loads).toBe(0);
  });

  it.each([
    ['无权', (h: ReturnType<typeof harness>) => { h.find('00000000-0000-4000-8000-000000000001').snapshot.canRead = false; }],
    // 真正不存在：删掉目标行让 find 返回空集合。空函数 + 现存 query 只会得到 matched，
    // 那样的「不存在」用例是假通过。
    ['不存在组件', (h: ReturnType<typeof harness>) => { h.rows.splice(0, h.rows.length); }],
    ['非 Ready 包', (h: ReturnType<typeof harness>) => { h.find('00000000-0000-4000-8000-000000000001').snapshot.packageState = 'PENDING'; }],
    ['作业未完成', (h: ReturnType<typeof harness>) => { h.find('00000000-0000-4000-8000-000000000001').snapshot.jobState = 'PUBLISHING'; }],
    ['已废弃', (h: ReturnType<typeof harness>) => { h.find('00000000-0000-4000-8000-000000000001').snapshot.availability = 'DEPRECATED'; }],
    ['peer 不符', (h: ReturnType<typeof harness>) => { h.find('00000000-0000-4000-8000-000000000001').snapshot.peerDependencies.vue = '3.5.44'; }],
    ['跨框架', (h: ReturnType<typeof harness>) => { h.find('00000000-0000-4000-8000-000000000001').snapshot.candidate.framework = 'react'; }],
    ['包摘要被改', (h: ReturnType<typeof harness>) => { h.find('00000000-0000-4000-8000-000000000001').snapshot.package!.tarball.sha256 = 'e'.repeat(64); }],
    ['元数据身份被改', (h: ReturnType<typeof harness>) => { h.find('00000000-0000-4000-8000-000000000001').snapshot.variant!.componentId = 'secret'; }],
  ])('%s与不存在同形 200 gap，不泄露 target/api/依赖', async (_label, change) => {
    const h = harness();
    change(h);
    const result = await queryComponentMatch(vueQuery, h.store, 'alice');
    expect(result.status).toBe('gap');
    expect(result.target).toBeUndefined();
    expect(result.api).toBeUndefined();
    expect(result.exactDependencies).toEqual([]);
    expect(result.gaps.map(g => g.code)).toEqual(['TARGET_UNAVAILABLE']);
    expect(JSON.stringify(result)).not.toContain('@company');
  });

  it('未知组件与私有目标同形返回，不因另一私有目标泄露存在性', async () => {
    const h = harness();
    h.find('00000000-0000-4000-8000-000000000001').snapshot.canRead = false;
    const gapResult = await queryComponentMatch(vueQuery, h.store, 'alice');
    expect(gapResult.status).toBe('gap');
    expect(gapResult.gaps.map(g => g.code)).toEqual(['TARGET_UNAVAILABLE']);
    // 换成一个完全未知的组件：响应形状必须逐字段一致
    const unknown = await queryComponentMatch({ ...vueQuery, componentId: 'does-not-exist' }, h.store, 'alice');
    expect(unknown.status).toBe('gap');
    expect(unknown.gaps).toEqual(gapResult.gaps);
    expect(unknown.target).toBeUndefined();
    expect(unknown.exactDependencies).toEqual([]);
  });

  it('同版本跨包歧义 409，指定 packageName 后唯一命中', async () => {
    const h = harness();
    h.add('vue', '@company/charts-vue-next', '0.0.10', '00000000-0000-4000-8000-000000000003');
    await expect(queryComponentMatch(vueQuery, h.store, 'alice')).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    const scoped = await queryComponentMatch({ ...vueQuery, packageName: '@company/charts-vue' }, h.store, 'alice');
    expect(scoped.status).toBe('matched');
    expect(scoped.target!.packageName).toBe('@company/charts-vue');
  });

  it('不可读目标不参与歧义判定：一个可读一个私有时返回可读目标', async () => {
    const h = harness();
    h.add('vue', '@company/charts-vue-next', '0.0.10', '00000000-0000-4000-8000-000000000003');
    h.find('00000000-0000-4000-8000-000000000003').snapshot.canRead = false;
    const result = await queryComponentMatch(vueQuery, h.store, 'alice');
    expect(result.status).toBe('matched');
    expect(result.target!.packageName).toBe('@company/charts-vue');
  });

  it('两个都不可读时不得退化为 CONFLICT 泄露歧义', async () => {
    const h = harness();
    h.add('vue', '@company/charts-vue-next', '0.0.10', '00000000-0000-4000-8000-000000000003');
    h.find('00000000-0000-4000-8000-000000000001').snapshot.canRead = false;
    h.find('00000000-0000-4000-8000-000000000003').snapshot.canRead = false;
    const result = await queryComponentMatch(vueQuery, h.store, 'alice');
    expect(result.status).toBe('gap');
    expect(result.gaps.map(g => g.code)).toEqual(['TARGET_UNAVAILABLE']);
    expect(result.target).toBeUndefined();
    expect(result.exactDependencies).toEqual([]);
  });

  it.each([
    // 三条都保持 variant.metadata 与 candidate.evidence 一致，只让**读出的字节**对不上，
    // 这样才能走到材料层；否则资格复读先失败，只会得到 TARGET_UNAVAILABLE。
    ['API 材料不存在', async (h: ReturnType<typeof harness>) => {
      const snapshot = h.find('00000000-0000-4000-8000-000000000001').snapshot;
      // evidence 与 metadata 同步改到一个 store 报 NOT_FOUND 的路径。
      // 用 `find(...)!` 显式取出 api 条目再整体替换：不依赖「索引 0 一定是 api」这种隐式假设，
      // 也让 `noUncheckedIndexedAccess` 下的 possibly-undefined 被显式确认。
      const apiEvidence = snapshot.candidate.evidence.find(evidence => evidence.kind === 'api')!;
      snapshot.variant!.api = { path: 'api/line-vue-missing.json', sha256: 'a'.repeat(64), bytes: 1 };
      snapshot.candidate.evidence = snapshot.candidate.evidence.map(evidence =>
        evidence === apiEvidence
          ? { kind: 'api' as const, path: 'api/line-vue-missing.json', sha256: 'a'.repeat(64) }
          : evidence);
      const original = h.store.artifact;
      h.store.artifact = async (id, path) => {
        if (path === 'api/line-vue-missing.json') throw new PlatformError('NOT_FOUND');
        return original(id, path);
      };
    }],
    ['API 摘要/字节不符', async (h: ReturnType<typeof harness>) => {
      const path = h.apiPathFor('vue');
      const original = h.store.artifact;
      h.store.artifact = async (id, requested) => {
        const bytes = await original(id, requested);
        return requested === path ? new Uint8Array([...bytes, 0x00]) : bytes;
      };
    }],
    ['docs 摘要不符（同长度）', async (h: ReturnType<typeof harness>) => {
      const path = h.docsPathFor('vue');
      const original = h.store.artifact;
      h.store.artifact = async (id, requested) => {
        const bytes = await original(id, requested);
        if (requested !== path) return bytes;
        // 长度不变、只改末字节：专门打 digest 校验，而不是字节数校验。
        // `noUncheckedIndexedAccess` 下索引读出可能是 undefined，显式确认非空。
        const flipped = new Uint8Array(bytes);
        flipped[flipped.length - 1] = flipped[flipped.length - 1]! ^ 0xff;
        return flipped;
      };
    }],
  ])('材料损坏/缺失 gap API_UNSUPPORTED：%s', async (_label, change) => {
    const h = harness(); await change(h);
    const result = await queryComponentMatch(vueQuery, h.store, 'alice');
    expect(result.status).toBe('gap');
    expect(result.gaps.map(g => g.code)).toEqual(['API_UNSUPPORTED']);
    expect(result.target).toBeUndefined();
    expect(result.exactDependencies).toEqual([]);
  });

  it('API 身份与 target 不一致时失败关闭，不返回错配材料', async () => {
    const h = harness();
    const wrong = new TextEncoder().encode(JSON.stringify({ ...componentApiFixture('vue'), componentId: 'secret' }));
    const path = h.apiPathFor('vue');
    const original = h.store.artifact;
    h.store.artifact = async (id, requested) => (requested === path ? wrong : original(id, requested));
    const result = await queryComponentMatch(vueQuery, h.store, 'alice');
    expect(result.status).toBe('gap');
    expect(result.gaps.map(g => g.code)).toEqual(['API_UNSUPPORTED']);
  });

  it('包自身依赖与宿主精确版本冲突时 gap DEPENDENCY_CONFLICT', async () => {
    const h = harness();
    h.find('00000000-0000-4000-8000-000000000001').snapshot.package!.dependencies = { echarts: '6.0.0' };
    const result = await queryComponentMatch(vueQuery, h.store, 'alice');
    expect(result.status).toBe('gap');
    expect(result.gaps.map(g => g.code)).toEqual(['DEPENDENCY_CONFLICT']);
    expect(result.target).toBeUndefined();
    expect(result.exactDependencies).toEqual([]);
  });

  it('材料读取期间撤权：返回前复查并清空 target/api/依赖', async () => {
    const h = harness();
    const original = h.store.artifact;
    h.store.artifact = async (...args) => {
      const bytes = await original(...args);
      h.find('00000000-0000-4000-8000-000000000001').snapshot.canRead = false;
      return bytes;
    };
    const result = await queryComponentMatch(vueQuery, h.store, 'alice');
    expect(result.status).toBe('gap');
    expect(result.gaps.map(g => g.code)).toEqual(['TARGET_UNAVAILABLE']);
    expect(result.target).toBeUndefined();
    expect(result.api).toBeUndefined();
    expect(result.exactDependencies).toEqual([]);
  });

  it('材料读取期间被废弃：同样清空，不残留材料', async () => {
    const h = harness();
    const original = h.store.artifact;
    h.store.artifact = async (...args) => {
      const bytes = await original(...args);
      h.find('00000000-0000-4000-8000-000000000001').snapshot.availability = 'DEPRECATED';
      return bytes;
    };
    const result = await queryComponentMatch(vueQuery, h.store, 'alice');
    expect(result.status).toBe('gap');
    expect(result.gaps.map(g => g.code)).toEqual(['TARGET_UNAVAILABLE']);
    expect(result.exactDependencies).toEqual([]);
  });

  it('材料读取期间新增同版本可读发布：必须失败关闭而非沿用首次结果', async () => {
    const h = harness();
    const original = h.store.artifact;
    h.store.artifact = async (...args) => {
      const bytes = await original(...args);
      h.add('vue', '@company/charts-vue-next', '0.0.10', '00000000-0000-4000-8000-000000000003');
      return bytes;
    };
    await expect(queryComponentMatch(vueQuery, h.store, 'alice')).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
  });

  it('基础设施故障不得伪装成 gap', async () => {
    const h = harness();
    h.store.find = async () => { throw new Error('database outage'); };
    await expect(queryComponentMatch(vueQuery, h.store, 'alice')).rejects.toThrow('database outage');
  });

  it('查询是纯读：不创建发布、映射或索引', async () => {
    const h = harness();
    await queryComponentMatch(vueQuery, h.store, 'alice');
    await queryComponentMatch(reactQuery, h.store, 'alice');
    // 每个查询至少做两次权威读取（选择前 + 材料后复查），且没有任何写入语义的调用
    expect(h.counts().loads).toBeGreaterThanOrEqual(4);
    expect(Object.keys(h.store)).toEqual(['find', 'artifact']);
    // 身份一路传到权威读取，未被丢弃
    expect([...new Set(h.subjects)]).toEqual(['alice']);
  });
});

describe('GET /v1/matching/components：原始 query 串解析', () => {
  // `parseComponentMatchQuery` 接收的是**完整 URL**（内部自行截取 `?` 之后的部分），
  // 所以这里统一加 `?` 前缀；传裸 query 串会被当成「无 query」而拒绝，从而假失败。
  const url = (raw: string) => `?${raw}`;
  const ok = (raw: string) => expect(parseComponentMatchQuery(url(raw)).ok).toBe(true);
  const bad = (raw: string) => {
    const result = parseComponentMatchQuery(url(raw));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.every(issue => issue.code === 'INVALID_SCHEMA')).toBe(true);
  };

  it('URL 完全没有 query 串时也必须拒绝', () => {
    expect(parseComponentMatchQuery('/v1/matching/components').ok).toBe(false);
    expect(parseComponentMatchQuery('').ok).toBe(false);
  });

  it('合法一次编码（含 scoped packageName）可查询', () => {
    ok('componentId=line&framework=react&packageVersion=0.0.10&packageName=%40company%2Fcharts-react&frameworkVersion=19.3.1&reactDomVersion=19.3.1&echartsVersion=6.1.0');
  });

  it('URLSearchParams 编码的 scoped packageName 与 + 空格语义一致', () => {
    const params = new URLSearchParams({ componentId: 'line', framework: 'vue', packageVersion: '0.0.10', packageName: '@company/charts-vue', frameworkVersion: '3.5.45', echartsVersion: '6.1.0' });
    const result = parseComponentMatchQuery(`?${params.toString()}`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.packageName).toBe('@company/charts-vue');
  });

  it.each([
    ['重复原始键', 'componentId=line&framework=vue&packageVersion=0.0.10&frameworkVersion=3.5.45&echartsVersion=6.1.0&componentId=bar'],
    ['重复解码后键', 'componentId=line&framework=vue&packageVersion=0.0.10&frameworkVersion=3.5.45&echartsVersion=6.1.0&component%49d=bar'],
    ['未知键', 'componentId=line&framework=vue&packageVersion=0.0.10&frameworkVersion=3.5.45&echartsVersion=6.1.0&debug=1'],
    ['数组化键', 'componentId=line&framework=vue&packageVersion=0.0.10&frameworkVersion=3.5.45&echartsVersion=6.1.0&componentId[]=x'],
    ['嵌套键', 'componentId=line&framework=vue&packageVersion=0.0.10&frameworkVersion=3.5.45&echartsVersion=6.1.0&filter[framework]=vue'],
    ['空值', 'componentId=&framework=vue&packageVersion=0.0.10&frameworkVersion=3.5.45&echartsVersion=6.1.0'],
    ['无等号片段', 'componentId&framework=vue&packageVersion=0.0.10&frameworkVersion=3.5.45&echartsVersion=6.1.0'],
    ['空片段', 'componentId=line&&framework=vue&packageVersion=0.0.10&frameworkVersion=3.5.45&echartsVersion=6.1.0'],
    ['畸形百分号编码', 'componentId=line&framework=vue&packageVersion=0.0.10&frameworkVersion=3.5.45&echartsVersion=6.1.0&packageName=%zz'],
    ['截断百分号编码', 'componentId=line&framework=vue&packageVersion=0.0.10&frameworkVersion=3.5.45&echartsVersion=6.1.0&packageName=%2'],
    ['空 query', ''],
    ['仅问号', '?'],
  ])('拒绝：%s', (_label, raw) => bad(raw));

  it('二次编码不被再次解释', () => {
    const result = parseComponentMatchQuery(url('componentId=line&framework=vue&packageVersion=0.0.10&frameworkVersion=3.5.45&echartsVersion=6.1.0&packageName=%2525company'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some(issue => issue.path === '/packageName')).toBe(true);
  });

  it('百分号编码的等号不会被当成键值分隔符', () => {
    const result = parseComponentMatchQuery(url('componentId=line&framework=vue&packageVersion=0.0.10&frameworkVersion=3.5.45&echartsVersion=6.1.0&packageName=%3Dbad'));
    expect(result.ok).toBe(false);
  });

  it('重复键不取首值/末值：解析结果不得静默收敛', () => {
    const result = parseComponentMatchQuery(url('componentId=line&componentId=bar&framework=vue&packageVersion=0.0.10&frameworkVersion=3.5.45&echartsVersion=6.1.0'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some(issue => /重复/.test(issue.message))).toBe(true);
  });
});

describe('GET /v1/matching/components：原型污染与审查发现的失败边界', () => {
  const VUE_URL = 'componentId=line&framework=vue&packageVersion=0.0.10&frameworkVersion=3.5.45&echartsVersion=6.1.0';
  // 同上：必须传完整 URL，否则会因「无 query」而假失败
  const url = (raw: string) => `?${raw}`;

  it('__proto__ 查询键必须被拒绝，不能被静默丢掉', () => {
    // 直接把解码后的键写进普通 {} 会让 __proto__ 走原型 setter，从而既不留自有键也不进白名单校验
    const result = parseComponentMatchQuery(url(`${VUE_URL}&__proto__=x`));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some(issue => /__proto__|未知|重复/.test(issue.message))).toBe(true);
  });

  it('百分号编码的 __proto__ 键同样必须被拒绝', () => {
    const result = parseComponentMatchQuery(url(`${VUE_URL}&%5F%5Fproto%5F%5F=x`));
    expect(result.ok).toBe(false);
  });

  it('__proto__ 值不得改寫已解析查询对象的原型', () => {
    const result = parseComponentMatchQuery(url(`${VUE_URL}&__proto__=${encodeURIComponent(JSON.stringify({ polluted: true }))}`));
    expect(result.ok).toBe(false);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    if (result.ok) {
      expect(Object.keys(result.value)).not.toContain('__proto__');
      expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
    }
  });

  it('正常 matched 响应必须通过公开运行时校验（target 不得夹带 SearchCandidate 字段）', async () => {
    const h = harness();
    const result = await queryComponentMatch(vueQuery, h.store, 'alice');
    expect(result.status).toBe('matched');
    // 复用 POST 的剥离口径：candidate 上的 gaps 等非 MatchTarget 字段不得进入 target
    expect(Object.keys(result.target!)).not.toContain('gaps');
    expect(validateComponentMatchResponse(result).ok).toBe(true);
  });

  it('材料读取失败叠加撤权：必须同形 TARGET_UNAVAILABLE，不得泄漏目标存在性', async () => {
    const h = harness();
    const id = '00000000-0000-4000-8000-000000000001';
    h.store.artifact = async () => {
      // 读取材料期间被撤权，同时存储返回「材料不存在」
      h.find(id).snapshot.canRead = false;
      throw new PlatformError('NOT_FOUND');
    };
    const result = await queryComponentMatch(vueQuery, h.store, 'alice');
    expect(result.status).toBe('gap');
    expect(result.gaps.map(g => g.code)).toEqual(['TARGET_UNAVAILABLE']);
    expect(result.target).toBeUndefined();
    expect(result.api).toBeUndefined();
    expect(result.exactDependencies).toEqual([]);
  });

  it('可读但 peer 不符的第二包也必须造成跨包歧义 409，不能用资格过滤消除', async () => {
    const h = harness();
    const second = '00000000-0000-4000-8000-000000000003';
    h.add('vue', '@company/charts-vue-next', '0.0.10', second);
    // 第二个包当前可读、状态 Ready，但 peer 与查询不符：歧义判定必须先于资格过滤
    h.find(second).snapshot.peerDependencies.vue = '3.5.44';
    await expect(queryComponentMatch(vueQuery, h.store, 'alice')).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
  });
});
