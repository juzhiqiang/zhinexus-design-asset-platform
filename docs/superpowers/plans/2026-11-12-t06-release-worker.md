# T06 可恢复发布执行计划

> **For agentic workers:** 使用 executing-plans 在本分支逐任务执行；行为变更先 RED 后 GREEN，最后独立整分支审查。

**Goal:** 将 T05 已验证的 PENDING 作业可靠推进到三存储一致的 Ready，进程中断后可恢复。

**Architecture:** PostgreSQL 是任务、租约、检查点和 outbox 的唯一持久化事实来源；独立 Node worker 属于 platform-api，只读校验/传输冻结字节。MinIO 条件写入不可变对象，Verdaccio HTTP 发布原 tarball，Ready 事务和默认 tag 更新分开恢复。

**Tech Stack:** 仓库固定 Node 26.13.0 / pnpm 12.18.0、NestJS、PostgreSQL、MinIO、Verdaccio；不引入新工作区或图表服务端依赖。

**Spec:** `2026-11-11-component-platform-implementation.md` T06、`2026-11-11-three-person-allocation.md`、只读 `component-platform-architecture.md`。

## Global Constraints

- 从 main `6da7e1c` 建立 `feat/t06-release-worker`，复用已隔离父工作树；完成后按本次授权合并本地 main，不 push。
- 服务端不 install/build/import 上传代码，不执行生命周期，不启动浏览器。注册表仅通过受限 HTTP 传输原 tarball。
- 同名同版本不同摘要 CONFLICT；已发布包/对象不覆盖、不删除重发。
- 包、实现分别建模；Ready、报告来源、基线、索引独立。
- 不改原始架构、历史 SQL 和验证记录；新迁移使用 004，不能覆盖已经存在的 002_package_permissions.sql。
- C 实现本轮平台 worker 及其必需的服务端 registry-client；B 的 CLI 材料、上传命令和消费者入口保持其所有权，后续接入复用此适配器契约。
- 现有完整真实 SDK 0.0.2 冻结材料可作为 T06 三存储验收输入；最新 SDK 缺 pie、占位预览、公司 OIDC/独立域仍单独记为 T04/T05/G2/T07 缺口，不用存储 Ready 冒充 M2。
- 本地配置已在工作树外按 Windows 当前用户 DPAPI 加密备份并校验；保留共享 .tools 和数据卷，不归档或递归删除共享工作树。

## Review Focus

1. 网络结果不确定：npm 接受后断线，必须重读真实字节再继续，不覆盖/删除重发。
2. 过期 worker：旧 fencing token 不得写检查点、失败状态或 Ready；外部操作只允许幂等不可变写。
3. 可达性：缺任意预览资源或公司依赖不得 Ready；占位页面文件存在不证明预览功能可用。
4. 事务失败：Ready、包/实现状态、审计、outbox 必须原子提交；tag 失败不能倒退 Ready。
5. 凭证和不可信元数据：跨 origin 重定向/下载 URL、过大响应、恶意包元数据均失败关闭，不泄漏 token。

## Task 1: 持久化认领、租约与恢复检查点

**Files:** 新建 `apps/api/migrations/004_release_worker.sql`、`apps/api/src/releases/leases.ts`；修改 `db/migrate.ts`、`releases/service.ts`；新增 `tests/platform/release-concurrency.test.ts`。

**Interfaces:** `ReleaseLeases.claim(jobId?): Promise<ReleaseLease | undefined>`；`renew(lease)`、`assert(lease, sql?)`、`checkpoint(lease, stage)`，token 用 PostgreSQL bigint 字符串，所有回写检查租约和 token。

- [x] 并发 claim 仅一人成功；过期可重认领、token 增加；旧 worker 续租/检查点拒绝；实际运行 RED。
- [x] 增加 retry_count/next_attempt_at/missing_artifacts，短事务 SKIP LOCKED，网络不持行锁；默认租约 60 秒，每 20 秒续期。
- [x] 5 次自动重试延迟 5/15/45/120/300 秒加抖动；耗尽保留 RETRY_WAIT，人工 retry 重置自动预算并保留检查点。
- [x] 运行真实 PG 专项及迁移往返，GREEN 后聚焦提交。

## Task 2: 不可变发布适配器与依赖顺序

**Files:** 新建 `releases/{registry-client,artifact-store,availability}.ts`、`tests/integration/release-registry.test.ts`、`tests/platform/dependency-order.test.ts`。

**Interfaces:** `ensurePackage(ref, frozenBytes, candidateTag)` 返回 published/already-identical；`verifyPackage(ref)` 实际下载并校验；`checkAvailability(manifest)` 返回缺失项。

- [x] 写失败测试：同版本异摘要、发布后超时、重定向/外部 tarball URL、超限响应、core 缺失、依赖拓扑；运行 RED。
- [x] 固化 `releases/<jobId>/<artifact.path>` 私有对象并核对字节；已存在只允许相同内容。上传会话过期不影响已经接受作业读取冻结副本。
- [x] 读取 npm package.json 作为数据，HTTP PUT 同一压缩 tarball，初始使用 candidate tag；公司依赖先于框架包发布并验证可获取。
- [x] 运行适配器测试、真实 MinIO/Verdaccio 测试，GREEN 后提交。

## Task 3: Worker、Ready 事务与独立 tag 恢复

**Files:** 新建 `releases/{worker,state-machine,tags,runner}.ts`、`index/outbox.ts`；修改 API package.json 和作业状态读取；新增 `tests/platform/release-recovery.test.ts`。

**Interfaces:** `ReleaseWorker.runOnce(jobId?)`、`advanceRelease(lease)`；Ready 写入 outbox，默认 tag 工作独立持久化；进程停止不依赖 CLI。

- [x] 写失败测试：对象固化后中断、npm 成功响应丢失、Ready 事务异常、并发 worker、旧 token 回写、缺文件/依赖、tag 重试、索引独立；运行 RED。
- [x] 按 FINALIZE_OBJECTS → ENSURE_PACKAGES → REGISTER_ASSETS → CHECK_AVAILABILITY → READY_TX 推进；复用 T05 预登记行，不重复创建实现。
- [x] Ready 事务写 package/variant/job 状态、审计、outbox 与 tag 待办。tag 使用每包串行协调，重读当前目标；失败保留待办，不能影响 Ready。
- [x] 独立 worker 入口支持启动/优雅关闭和故障后续租/重认领；环境配置缺失失败关闭。
- [x] 真实三存储与进程中断恢复通过后提交。

## Task 4: 验收、文档、版本与合并

- [x] 重放历史真实 SDK tarball/截图/报告，经过真实 T05 上传 → worker → Ready → 注册表下载摘要核对/双框架精确安装；标清历史证据重放。
- [x] 运行 `scripts/pnpm.ps1 test:platform`、`test:infra`、`infra:check-access`；最后一项现有外部阻塞保持记录。
- [x] `$env:TURBO_FORCE='true'; .\scripts\verify.ps1`：冻结安装、workspace、无缓存 build/typecheck、单元/HTTP/消费者/浏览器通过。
- [x] 独立整分支代码审查，重要问题 RED→GREEN 修复；原始架构摘要检查。
- [x] README、API README、分工/实施计划追加当前结果，新建 `docs/verification/t06-release-worker-2026-11-12.md`。
- [x] 平台根与 API 兼容功能升到 0.0.2，CHANGELOG 独立中文升版提交。
- [ ] 检查 main 并行变更并保留无关修改，合并后运行相关验证，报告提交与外部缺口；不 push。

## 实施补充：真实注册表边界

Verdaccio 7.1.0 的 `@verdaccio/store/build/lib/storage-utils.mjs` 中 normalizePackage 在缺 latest 时按版本排序补出 latest。初始发布请求严格仅含 candidate tag，但首次包 metadata 的默认版本仍可在 Ready 前可见；这属于原计划已区分的注册表读权限边界，客户端无法通过删除 tag 消除合成值。平台以 Ready 控制目录/推荐，未新增注册表访问网关。

默认 tag 的 HTTP 请求无法携带 PostgreSQL fencing token，因此单靠 advisory lock 不承诺外部线性一致。按独立审查补充：目标选最高 Ready SemVer，成功后每 60 秒读取核对实际值，失败 5 秒后重试；旧请求晚到可恢复，短暂偏离仍可能存在。预发布按既有 SemVer 优先级排序，不作为正式一期验收通过依据。
