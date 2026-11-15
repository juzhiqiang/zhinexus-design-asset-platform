# 独立只读审查记录：C 工作区二期文本检索接入与索引（C3）

- 审查时间：2026-11-15
- 审查方式：只读源码、Migration 与测试审查（未修改 C 工作区任何文件，未在 C 工作区运行构建或测试）
- 被审查工作区：`C:\Users\10208\.codex\worktrees\c-phase2-search\zhinexus-design-asset-platform`
- 基线：`95ec3726`（`feat: 增加明确查询与宿主版本的检索请求契约`）之上当前未提交变更：
  - `apps/api/migrations/008_search.sql`
  - `apps/api/src/db/migrate.ts`、`apps/api/src/db/migration-files.ts`、`apps/api/src/app.ts`
  - `apps/api/src/search/current.ts`、`apps/api/src/search/service.ts`、`apps/api/src/search/routes.ts`
  - `apps/api/src/index/search-indexer.ts`、`apps/api/src/index/search-runner.ts`
  - `tests/platform/search.test.ts`

## 审查结论

**无阻断项。**

## 核对清单与源码证据

1. **权限批次复读与 HTTP 安全头**
   - `apps/api/src/search/routes.ts:8-13`：`POST /v1/search/candidates` 设置 `Cache-Control: no-store` 与 `X-Robots-Tag: noindex, nofollow`，通过 `this.platform.run(auth, 'read', ...)` 强制 Bearer 鉴权、`read` 角色与禁用主体拦截（测试覆盖：`tests/platform/search.test.ts:23-24, 30-31, 51-52`）。
   - `apps/api/src/search/service.ts:23-28`：先执行首轮 `loadCurrentCandidates` + `filterEligibleCandidates`，随后对 `eligibleIds` 执行第二轮批次快照查询 `loadCurrentCandidates(this.db, [...eligibleIds], subject)` + `filterEligibleCandidates`；单条 SQL 语句（`apps/api/src/search/current.ts:25-37`）对全部候选共享同一语句快照，拦截检索期间提交的撤权或元数据变更（测试覆盖：`tests/platform/search.test.ts:98-113`）。

2. **revision 与 providerVersion 一致性**
   - `apps/api/src/search/current.ts:6, 18-22`：`SEARCH_PROVIDER = 'metadata-text-v1'`；`searchRevision` 基于 `id, variantId, componentId, framework, category, name, version, sha256, variant, package` 的 `canonicalJson` 计算 SHA-256。
   - `apps/api/src/search/service.ts:17-20`：SQL `WHERE` 条件校验 `p.state='READY' AND j.state='READY' AND vr.availability='Ready' AND catalog_can_read(c.id,$2) AND v.framework=$3 AND o.state='indexed' AND d.provider_version=$4`。
   - `apps/api/src/search/current.ts:39-41`：映射 `o.state`（`'indexed'` -> `'ready'`、`'failed'` -> `'failed'`、其余 -> `'pending'`）、`d.revision` 与 `d.provider_version`，配合 `eligibility` 在元数据变更或 `provider_version` 过期时失败关闭（测试覆盖：`tests/platform/search.test.ts:53-60`）。

3. **outbox 原子性、并发抢占与失败重试**
   - `apps/api/migrations/008_search.sql:1-10`：`search_documents` 以 `variant_release_id` 为主键并约束 `revision` 为 64 位小写 hex，带 GIN `tsvector('simple', body)` 生成列；`release_outbox` 新增 `search_attempted_at timestamptz`（与 `release_jobs` Ready 状态解耦）；`apps/api/src/db/migration-files.ts:4` 与 `migrate.ts:8` 已同步登记。
   - `apps/api/src/index/search-indexer.ts:10-15`：在事务中使用 `FOR UPDATE OF o SKIP LOCKED` 抢占 `j.state='READY'` 且 `(o.state IN ('pending','failed') OR $2)` 的任务，按 `o.search_attempted_at NULLS FIRST, o.created_at, o.job_id` 排序，避免并发重复消费与失败任务饿死（测试覆盖：`tests/platform/search.test.ts:61-63`）。
   - `apps/api/src/index/search-indexer.ts:16-36`：通过 `SAVEPOINT search_build` 保护整批 `search_documents` 写入；任一校验失败时 `ROLLBACK TO SAVEPOINT search_build`，并将 `release_outbox.state` 设为 `'failed'`、更新 `search_attempted_at=now()`，保证 `search_documents` 无半成品残留，修复后可重试恢复（测试覆盖：`tests/platform/search.test.ts:69-82`）。

4. **服务端零执行与凭据安全**
   - `search-indexer.ts`、`search-runner.ts`、`current.ts`、`service.ts`、`routes.ts` 仅依赖 `@company/contracts` 与服务端内部模块，无组件代码导入/执行、无 `child_process`、无服务端浏览器调用。
   - `apps/api/src/index/search-runner.ts:20-22`：异常仅输出固定提示 `Search worker failed; inspect index state without exposing credentials.`，不暴露数据库连接凭据。

## 非阻断观察与未覆盖边界

- **非阻断观察**：`apps/api/src/search/service.ts:27-28` 在 `eligibleIds.size === 0` 时仍会发起一次空数组 `loadCurrentCandidates(this.db, [], subject)` 查询（结果为空 Map，不影响正确性，后续可按需短路）。
- **未覆盖边界**：A 本次保持只读，未在 C 工作区执行构建与 PostgreSQL 集成测试；真实线上部署环境与大规模语料 GIN/子串查询性能表现待后续运行验证。
