# T11/T12 C 平台运维执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** 提供可脱敏观测、可重复故障恢复、真实三存储隔离恢复及部署检查工具。

**Architecture:** 复用 T05–T07 的 PostgreSQL 状态机和不可变产物；日志采用字段白名单，指标使用持久化数据与固定枚举标签。演练通过本机隔离服务/代理注入故障；备份冻结写入，恢复到全新隔离实例，逐引用核查包与对象摘要。

**Tech Stack:** 固定 Node 26.13.0 / pnpm 12.18.0、NestJS、PostgreSQL 18.6、Verdaccio 7.1.0、固定源码 MinIO、Docker Compose、Vitest。

**Spec:** `2026-11-11-component-platform-implementation.md` T11/T12；`2026-11-11-three-person-allocation.md` C 职责。用户已授权先合并 T07，再新分支连续执行及最终本地合并。

## Global Constraints

- 当前独立 worktree 复用；B 工作区及 A 分支保持原样。不 push。
- 分支 `feat/t11-t12-platform-operations`；T07 合并提交 `617e967`。
- 服务端不构建、不执行上传组件、不运行浏览器；演练只在开发机运行。
- 已发布包/对象不可覆盖、不可删除重发；恢复只向空实例写入。
- 不停止共享 G2；故障代理与临时容器、DB、bucket 都必须有明确隔离范围。
- OIDC/生产域、真实业务试点、B 的真实材料与画廊联调仍属外部验收，不能标完整 T11/T12 完成。
- 架构文档保持 SHA-256 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。

## Review Focus

1. 任意 URL、JWT、错误消息、查询和标识串不得进入日志；日志接收器失败不能改变发布结果。
2. 指标不能以任务 ID/用户/路径为标签无限增长；DB 不可用时不得返回健康的零积压。
3. 故障恢复需真正跨进程/传输边界，保留同一摘要，不依赖人工改作业行。
4. 备份不完整/损坏、目标非空或源目标相同须失败关闭；不能只验证备份存在。
5. 部署模板必须精确镜像、凭证注入、独立域、读写分离且不能公开存储/运维接口。

### Task 1: 结构化事件与运维指标

**Files:** 新增 `apps/api/src/observability/{events,metrics,http}.ts`；修改 API app/platform/worker/runner；测试 `tests/unit/observability.test.ts` 与 `tests/platform/observability.test.ts`。

**Interfaces:** `PlatformEvents.emit(event)` 仅允许固定事件/错误码、UUID、stage/attempt/duration；`metrics(db)` 提供 Prometheus 文本，运维端点使用单独环境 token。worker 记录阶段耗时、失败及尝试，HTTP 使用服务端 requestId。

- [x] RED：日志注入及sink失败测试；真实HTTP指标拒绝未授权、展示持久队列、失败、缺件、索引积压；worker关联阶段与请求。
- [x] GREEN：实现白名单与有界指标，接入真实HTTP/worker，保留原发布协议。
- [x] 验证 `pnpm.ps1 build:services`、指定 unit/platform 测试、根 tsc，预期全通过；聚焦提交。

### Task 2: 可重复故障恢复演练

**Files:** `scripts/rehearse-recovery.ts`、`tests/platform/platform-acceptance.test.ts`、`tests/platform/fault-proxy.ts`、`docs/acceptance/pilot-report.md`。

**Interfaces:** 通过固定开发机命令执行指定真实服务测试，输出非敏感结构化结果；复用 Task 1 事件/指标及 T06 ReleaseWorker。

- [x] RED：PG/MinIO/Registry断路、上传中断、worker进程终止、响应丢失、索引失败、撤权；恢复后摘要相等、登记不重复、Ready不受索引状态推断。
- [x] GREEN：本地故障代理/子进程运行器与脚本；恢复只用正常重试API/自然租约，不手工更新作业恢复状态。
- [x] 验证 `pnpm.ps1 rehearse:recovery`，预期所有故障场景通过，记录耗时与限制；聚焦提交。

### Task 3: 三存储备份、空实例恢复和一致性验证

**Files:** `infra/scripts/{recovery-stack,backup,consistency}.ts`、`scripts/rehearse-backup.ts`、`tests/unit/backup.test.ts`、相关运维文档。

**Interfaces:** 管理工具仅操作其拥有的隔离栈；备份含 PG dump、Verdaccio 卷、MinIO 卷和摘要清单；恢复验证使用真实 HTTP/S3/PG，检查 manifest、登记、截图/报告/预览与包摘要。

- [x] RED：损坏清单/非空目标/路径越界拒绝；真实 Ready 样本断言恢复后三存储一致。
- [x] GREEN：创建隔离源栈、真实发布、停写备份、独立目标恢复；记录数据量和实际 RTO，保留备份而非修改共享源。
- [x] 验证 `pnpm.ps1 rehearse:backup` 与窄范围测试，预期完整恢复和逐引用检查通过；聚焦提交。

### Task 4: 部署模板、保留策略与交付

**Files:** `infra/compose.production.yaml`、`infra/production/*`、`scripts/verify-deployment.ts`、`apps/api/src/operations/retention.ts`、`docs/{quickstart,publishing,operations,release-acceptance}.md`、README/计划/验证记录。

**Interfaces:** 部署检查分静态模板与显式生产配置检查；缺真实配置失败关闭。保留策略默认上传24h、失败候选30d，可配置，仅生成无已发布引用的候选报告，不自动删除。

- [x] RED：浮动镜像、凭证内联、同站预览域、公开存储端口、不安全命令和保留条件反例。
- [x] GREEN：固定镜像参数模板、服务配置/凭证注入、运行/迁移/回退说明和检查器。
- [x] 验证 frozen install、workspace、无缓存 build/typecheck、根tsc、普通/platform/browser测试、infra、deployment、恢复演练；预期全部本地检查通过，真实生产检查保持待接入。
- [x] 独立整分支审查并修复；平台/API（若网关行为变化则网关）PATCH版本与CHANGELOG单独提交。
- [ ] 本地合并 main，复验合并树，记录commit和未完成外部门槛。详见2026-11-13独立集成记录。

## 进展

- T07 合并前 `test` 25文件/521项通过；合并后复验结果见本轮独立验证记录。旧验证记录不改写。
