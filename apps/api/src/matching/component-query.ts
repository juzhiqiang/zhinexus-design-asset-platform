import {
  validateComponentMatchQuery, validateComponentMatchResponse,
  type AcceptedCompatibilityRecord, type ComponentMatchQueryV1, type ComponentMatchResponseV1,
  type MatchGap, type MatchTarget, type PackageRef, type ProjectContext, type VariantRef,
} from '@company/contracts';
import type { Database } from '../db/database.js';
import type { ArtifactStore } from '../storage/artifact-store.js';
import { PlatformError } from '../errors.js';
import { CatalogService } from '../catalog/service.js';
import { searchRevision, type SearchRow } from '../search/current.js';
import { eligibleRelease, type CurrentCandidateSnapshot } from '../search/eligibility.js';
import { readApi, resolveRelease, type Eligible, type MatchContext, type MaterialRepository } from './materials.js';

/**
 * 二期 P1：`GET /v1/matching/components` 组件标识精确查询。
 *
 * 边界（与 `docs/specs/2026-11-16-phase2-query-completion-design.md` 一致）：
 * - 无 body；查询字段全部来自 `ComponentMatchQueryV1`，React 必须精确 `reactDomVersion`，Vue 禁止；
 * - **权威 SQL 查询** components/variants/package_releases/variant_releases 与当前权限，
 *   参数化、不依赖文本 Top-50、不依赖索引状态、不按组件命名拼接；
 * - 先应用 `catalog_can_read` 再判断可读目标歧义：私有目标的存在不得泄露，
 *   两个都不可读时同形 `TARGET_UNAVAILABLE`，绝不退化为 `CONFLICT`；
 * - 不可读 / 不存在 / 非 Ready / 已废弃 / peer 不满足 → 200 gap `TARGET_UNAVAILABLE`；
 * - API/docs 缺失或摘要/格式不符 → 200 gap `API_UNSUPPORTED`；依赖无法形成一致方案 →
 *   200 gap `DEPENDENCY_CONFLICT`；同条件多个当前可读发布 → 409 `CONFLICT`（`packageName` 可消歧）；
 * - 首次选择后与材料读取后**各复查一次**当前目标集合、权限、禁用、Ready/废弃与新增歧义；
 *   中途撤权/禁用/废弃一律清空 target/api/exactDependencies；
 * - 缺已接受兼容证据时仍返回 `matched`，保留 `compatibility.status='unverified'` 与
 *   `COMPATIBILITY_UNVERIFIED`；GET 不返回设计绑定 gaps；
 * - 纯查询：不创建发布、映射或索引，不运行上传代码，不加载 SDK 运行时代码。
 */

/** 查询 filter：由 HTTP 适配器从**原始 query 串**解析后传入，杜绝框架 query 对象丢重复键。 */
export type ComponentQueryFilter = Omit<ComponentMatchQueryV1, 'packageName' | 'reactDomVersion'> & {
  packageName?: string | undefined;
  reactDomVersion?: string | undefined;
};

/** 权威目录读取 seam：实现只用参数化 SQL；测试可注入内存快照。 */
export type ComponentQueryStore = {
  find(filter: ComponentQueryFilter, subject: string): Promise<CurrentCandidateSnapshot[]>;
} & MaterialRepository;

const UNAVAILABLE_MESSAGE = '目标当前不可用，请核对配置及访问条件';
const API_UNSUPPORTED_MESSAGE = '该版本的 API 或文档材料不可用于查询';
const DEPENDENCY_CONFLICT_MESSAGE = '目标包与宿主精确依赖无法形成一致方案';
const CONFLICT_MESSAGE = '同一查询条件匹配多个当前可读发布，请补充 packageName 以消除歧义';

function unavailable(): MatchGap[] {
  return [{ code: 'TARGET_UNAVAILABLE', message: UNAVAILABLE_MESSAGE }];
}

/** 由查询构造仅供资格复读使用的 ProjectContext（响应不回传 context）。 */
function eligibilityContext(query: ComponentMatchQueryV1): ProjectContext {
  return {
    framework: query.framework,
    frameworkVersion: query.frameworkVersion,
    echartsVersion: query.echartsVersion,
    packageManager: 'pnpm',
    requirements: [],
  };
}

/** 目标包 + 宿主精确依赖合并；同名版本不一致即无法形成一致方案。 */
function exactDependenciesOf(query: ComponentMatchQueryV1, pkg: Eligible['pkg']): { name: string; version: string }[] | null {
  const required: Array<{ name: string; version: string }> = [
    { name: pkg.name, version: pkg.version },
    { name: query.framework, version: query.frameworkVersion },
    { name: 'echarts', version: query.echartsVersion },
    ...(query.framework === 'react' ? [{ name: 'react-dom', version: query.reactDomVersion! }] : []),
    ...Object.entries(pkg.dependencies).map(([name, version]) => ({ name, version })),
  ];
  const merged = new Map<string, string>();
  for (const dependency of required) {
    const existing = merged.get(dependency.name);
    if (existing !== undefined && existing !== dependency.version) return null;
    merged.set(dependency.name, dependency.version);
  }
  return [...merged.entries()].map(([name, version]) => ({ name, version }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function gapResponse(query: ComponentMatchQueryV1, gaps: MatchGap[]): ComponentMatchResponseV1 {
  return { schemaVersion: 1, query, status: 'gap', exactDependencies: [], gaps };
}

/**
 * 从当前可读集合中选出唯一目标。
 *
 * **歧义判定先于资格过滤**：同一选择条件下只要有多个当前可读发布（`canRead`）就 409，
 * 不因为其中一个 peer 不符、非 Ready 或已废弃就把它过滤掉——那样会把真实的跨包歧义
 * 掩盖成一次成功匹配，也让「指定 packageName 才能消歧」失去意义。
 * peer / Ready / 废弃 / 状态只在唯一目标确定之后，用于判定该目标本身是否可用；
 * 不可用即同形 `TARGET_UNAVAILABLE`，不泄露是哪一个条件不满足。
 */
function selectTarget(snapshots: readonly CurrentCandidateSnapshot[], request: MatchContext):
  | { kind: 'target'; item: Eligible }
  | { kind: 'unavailable' }
  | { kind: 'conflict' } {
  const byPackage = new Map<string, CurrentCandidateSnapshot[]>();
  for (const snapshot of snapshots) {
    if (!snapshot.canRead) continue;
    const name = snapshot.package?.name ?? snapshot.candidate.packageName;
    byPackage.set(name, [...(byPackage.get(name) ?? []), snapshot]);
  }
  if (byPackage.size === 0) return { kind: 'unavailable' };
  const entries = [...byPackage.entries()];
  // 跨包歧义，或同一包名出现多条发布记录：都视为无法唯一定位
  if (entries.length > 1 || entries[0]![1].length > 1) return { kind: 'conflict' };
  const snapshot = entries[0]![1][0]!;
  const item = resolveRelease(request, snapshot.candidate.variantReleaseId, snapshot);
  if (!item) return { kind: 'unavailable' };
  return { kind: 'target', item };
}

export async function queryComponentMatch(query: ComponentMatchQueryV1, store: ComponentQueryStore, subject: string): Promise<ComponentMatchResponseV1> {
  const checked = validateComponentMatchQuery(query);
  if (!checked.ok) throw new PlatformError('INVALID_SCHEMA', checked.issues);
  const fixed = structuredClone(checked.value);
  const request = { context: eligibilityContext(fixed), ...(fixed.reactDomVersion ? { reactDomVersion: fixed.reactDomVersion } : {}) };

  // 1. 权威查询 + 权限：先取当前集合，再在可读集合内判定歧义
  const first = await store.find(fixed, subject);
  const initial = selectTarget(first, request);
  if (initial.kind === 'unavailable') return gapResponse(fixed, unavailable());
  if (initial.kind === 'conflict') throw new PlatformError('CONFLICT');

  // 2. 材料读取（CatalogService 内部会再次复核权限与逐字节摘要）
  const item = initial.item;
  const api = await readApi(item.candidate.variantReleaseId, item, store);

  // 3. 返回前复查：撤权、禁用、废弃、版本/元数据变更或新增歧义都必须失败关闭。
  //    **这一步必须先于任何材料结论**：否则「读材料期间被撤权 + 材料恰好读失败」
  //    会因为先看到 API_UNSUPPORTED 而泄露目标存在性——不可用与材料不可用必须同形。
  const last = await store.find(fixed, subject);
  const rechecked = selectTarget(last, request);
  if (rechecked.kind === 'unavailable') return gapResponse(fixed, unavailable());
  if (rechecked.kind === 'conflict') throw new PlatformError('CONFLICT');
  const current = rechecked.item;
  if (current.revision !== item.revision || current.candidate.variantReleaseId !== item.candidate.variantReleaseId) {
    return gapResponse(fixed, unavailable());
  }

  // 4. 只有复查通过后，材料结果才允许成为对外结论
  if (!api) return gapResponse(fixed, [{ code: 'API_UNSUPPORTED', message: API_UNSUPPORTED_MESSAGE }]);

  // 5. 精确依赖：目标包与宿主版本必须形成一致方案
  const exactDependencies = exactDependenciesOf(fixed, current.pkg);
  if (!exactDependencies) return gapResponse(fixed, [{ code: 'DEPENDENCY_CONFLICT', message: DEPENDENCY_CONFLICT_MESSAGE }]);

  // 6. target 逐字段构造，**不 spread candidate**：`gaps`、截图 evidence 等检索字段
  //    不是 MatchTarget 的成员，带进去会被严格（additionalProperties:false）校验拒收。
  const target: MatchTarget = {
    variantReleaseId: current.candidate.variantReleaseId,
    variantId: current.candidate.variantId,
    componentId: current.candidate.componentId,
    framework: current.candidate.framework,
    packageName: current.candidate.packageName,
    packageVersion: current.candidate.packageVersion,
    packageSha256: current.candidate.packageSha256,
    exportName: current.candidate.exportName,
    exportPath: api.exportPath,
    evidence: (['api', 'docs'] as const).map(kind => ({ kind, path: current.variant[kind].path, sha256: current.variant[kind].sha256 })),
    compatibility: { status: current.candidate.compatibility.status, recordIds: [...current.candidate.compatibility.recordIds] },
    examples: current.variant.examples.map(example => ({ id: example.id, previewEntry: example.previewEntry })),
    styleExport: api.styleExport,
    readyMethod: api.readyMethod,
    notes: [...api.notes],
  };
  const gaps: MatchGap[] = current.candidate.compatibility.status === 'unverified'
    ? [{ code: 'COMPATIBILITY_UNVERIFIED', message: '缺少该精确版本组合的已接受兼容记录' }]
    : [];
  const response: ComponentMatchResponseV1 = { schemaVersion: 1, query: fixed, status: 'matched', target, api, exactDependencies, gaps };
  const validated = validateComponentMatchResponse(response);
  if (!validated.ok) throw new PlatformError('INTERNAL_ERROR');
  return validated.value;
}

/** 权威 SQL 读取：只按组件/框架/精确包版本（可选包名）定位，不使用文本检索或索引。 */
async function findCandidates(db: Database, filter: ComponentQueryFilter, subject: string): Promise<CurrentCandidateSnapshot[]> {
  // 数据库列均为 NOT NULL，这里用非可选类型描述行形状；`CurrentCandidateSnapshot` 的
  // `variant`/`package` 是检索快照语义（允许缺失），不能拿来给 SQL 行定型。
  type CandidateRow = {
    id: string; variant_id: string; component_id: string; framework: 'vue' | 'react'; category: string;
    name: string; version: string; sha256: string; metadata: VariantRef;
    package_metadata: PackageRef; availability: 'PENDING' | 'Ready' | 'DEPRECATED';
    package_state: 'PENDING' | 'READY'; job_state: string; can_read: boolean; accepted: AcceptedCompatibilityRecord[];
  };
  const rows = (await db.query<CandidateRow>(`SELECT vr.id,vr.variant_id,v.component_id,v.framework,c.category,
      p.name,p.version,p.sha256,vr.metadata,p.metadata AS package_metadata,vr.availability,
      p.state AS package_state,j.state AS job_state, catalog_can_read(c.id,$4) AS can_read,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'compatibilityId',e.id,'variantReleaseId',e.variant_release_id,'packageName',e.package_name,
        'packageVersion',e.package_version,'packageSha256',e.package_sha256,'framework',e.framework,
        'frameworkVersion',e.framework_version,'echartsVersion',e.echarts_version,
        'candidateIntegrity',e.candidate_integrity,'candidateSource',e.candidate_source,'status',e.status,
        'evidenceSha256',e.evidence_sha256,'createdAt',to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY e.id)
        FROM compatibility_evidences e WHERE e.variant_release_id=vr.id),'[]'::jsonb) AS accepted
    FROM variant_releases vr JOIN variants v ON v.id=vr.variant_id
    JOIN components c ON c.id=v.component_id JOIN package_releases p ON p.id=vr.package_release_id
    JOIN release_jobs j ON j.id=p.job_id
    WHERE c.id=$1 AND v.framework=$2 AND p.version=$3 AND ($5::text IS NULL OR p.name=$5)`,
    [filter.componentId, filter.framework, filter.packageVersion, subject, filter.packageName ?? null])).rows;
  return rows.map(row => ({
    variant: row.metadata, package: row.package_metadata, canRead: row.can_read,
    availability: row.availability === 'PENDING' ? 'Pending' : row.availability,
    packageState: row.package_state, jobState: row.job_state as 'READY',
    // 与 `search/current.ts` 同一 revision 构造：任一元数据变化都会让返回前复查失败关闭
    revision: searchRevision(row as unknown as SearchRow), activeProviderVersion: '',
    index: { state: 'pending' as const, revision: '', providerVersion: '' },
    peerDependencies: row.package_metadata.peerDependencies, acceptedCompatibility: row.accepted,
    candidate: {
      variantReleaseId: row.id, variantId: row.variant_id, componentId: row.component_id, framework: row.framework,
      packageName: row.name, packageVersion: row.version, packageSha256: row.sha256, exportName: row.metadata.exportName,
      evidence: [
        { kind: 'api' as const, path: row.metadata.api.path, sha256: row.metadata.api.sha256 },
        { kind: 'docs' as const, path: row.metadata.docs.path, sha256: row.metadata.docs.sha256 },
        ...row.metadata.screenshots.map(s => ({ kind: 'screenshot' as const, path: s.image.path, sha256: s.image.sha256, source: s.source })),
      ], gaps: [],
    },
  }));
}

export class ComponentQueryService {
  constructor(private readonly db: Database, private readonly store?: ArtifactStore) {}
  /** HTTP 入口：`input` 为已由原始 query 串解析出的查询对象。 */
  async query(input: unknown, subject: string): Promise<ComponentMatchResponseV1> {
    const checked = validateComponentMatchQuery(input);
    if (!checked.ok) throw new PlatformError('INVALID_SCHEMA', checked.issues);
    const catalog = new CatalogService(this.db, this.store);
    return queryComponentMatch(checked.value, {
      find: (filter, actor) => findCandidates(this.db, filter, actor),
      /**
       * GET 专用的静态材料读取 seam。
       *
       * `ArtifactStore.read` 对「对象不存在」抛 `UPLOAD_INCOMPLETE`(409)、对「对象大于
       * 期望字节数」抛 `LIMIT_EXCEEDED`(413)——这两类在语义上都只是**材料不可用**，
       * 但共享的 `readApi`（`POST /v1/matching/plans` 也在用）只把 `NOT_FOUND` /
       * `DIGEST_MISMATCH` 视为材料不可用。若不在这里收口，GET 会把它们原样抛成 409/413，
       * 而且异常会**早于返回前复查**退出，等于跳过复查（撤权叠加材料失败时泄露存在性）。
       *
       * 因此只在这一层把这两类规范化为 `NOT_FOUND`：`readApi` 照旧返回 null → 走
       * `API_UNSUPPORTED`，末次复查一定先执行。**不改共享 `readApi`、不改 POST 语义、
       * 不改 `ArtifactStore` 全局行为**；`INFRA_UNAVAILABLE` 等基础设施故障原样上抛，
       * 仍以 503 结束，不伪装成业务缺口。
       */
      artifact: async (id, path) => {
        try {
          return (await catalog.artifact({ releaseId: id }, path, subject)).bytes;
        } catch (error) {
          if (error instanceof PlatformError && (error.code === 'UPLOAD_INCOMPLETE' || error.code === 'LIMIT_EXCEEDED')) {
            throw new PlatformError('NOT_FOUND');
          }
          throw error;
        }
      },
    }, subject);
  }
}
