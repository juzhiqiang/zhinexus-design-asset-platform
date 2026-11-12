# C 平台集成与容量验收执行计划

> **For agentic workers:** 使用 executing-plans 按任务执行；行为修改遵循 RED→GREEN，合并前独立审查。

**Goal:** 补齐当前 SDK 在 Windows/真实三存储的发布证据，为 B 提供网页提交后端验收，并交付可重复容量预演。

**Architecture:** 复用当前 Nest API、网关和隔离数据库 harness。容量工具只在开发者本机运行，不进入服务端或 Turbo 缓存；数据、凭证和详细报告留在忽略目录。

**Tech Stack:** 仓库隔离 Node26.13.0 / pnpm12.18.0、Vitest、PostgreSQL、MinIO、Verdaccio、Playwright Chromium。

**Spec:** `2026-11-11-component-platform-implementation.md` T05–T12 与 `2026-11-11-three-person-allocation.md`；本轮用户已批准 C 分工、新分支、合并 main、删除本次分支。

## 约束和审查重点

- 基点 main `eb1d054`，分支 `feat/c-platform-capacity-acceptance`，复用当前独立 C worktree；不修改 A/B 的业务文件。
- 保持单文件50MiB、总提交500MiB限制；100MiB上传采用40+40+20MiB，验证已有分片保留及 API 重启后恢复，不宣称单文件100MiB。
- 200组件/400实现目录样本是隔离DB合成元数据；真实协议发布样本另计，不能把批量seed当作发布400实现。
- p95使用nearest-rank，报告全部失败数、样本数、硬件/回环网络与阈值；不得过滤失败或复用旧报告。
- 上传URL、token、连接字符串不进入报告；身份、预览域及真实业务试点仍属外部验收。
- 保护原架构SHA与主工作区已有修改；不push、不覆盖或删除已发布版本。

## Task 1：当前 main 原生回归

Files: 新增 `docs/verification/c-platform-capacity-2026-11-13.md`，后续更新 `docs/release-acceptance.md`。

- [x] frozen install、verify:workspace、test:infra --no-restart。
- [x] 无缓存build、无缓存typecheck、根tsc、普通test（含真实SDK全量CLI release）。
- [x] test:platform、随后test:browser；记录真实结果及新发现。
- [x] 聚焦提交原生集成证据，不改历史记录。

## Task 2：T07/T08 后端交接验收

Files: 新增 `tests/platform/web-handover.test.ts`；复用 `http-support.ts`、`t06-support.ts`、contracts API类型。

Consumes: `platformHarness`、`workerHarness`、`upload`、`release`、`ReleaseWorker`；真实 `POST /v1/uploads`、`POST /v1/releases` 与精确releaseId目录接口。

- [x] 加入真实HTTP验收：web手动来源、重启/幂等、逐实现缺图/错框架拒绝、精确详情/材料/报告、公私切换。
- [x] 若既有行为已符合则保留通过的验收测试；发现缺陷先观察失败再修复。
- [x] 运行本文件与相关平台回归、记录 B 可用接口和未覆盖的页面行为，聚焦提交。

## Task 3：容量与100MiB分片恢复

Files: `scripts/capacity-metrics.ts`、`scripts/rehearse-capacity.ts`、`tests/unit/capacity-metrics.test.ts`、`tests/platform/capacity.test.ts`、根package.json、README、operations和新增验证记录。

Produces: `rehearse:capacity` 本机命令；独立run目录中的catalog/upload/release报告和summary，失败退出非零。

- [x] 先对统计函数写失败测试：nearest-rank、失败计入分母、非法/空样本拒绝；再实现。
- [x] 真实HTTP量测200组件/400实现、20并发、200请求，p95初始目标500ms；逐响应核对数量/框架/分页。
- [x] 真实S3 multipart累计100MiB；中断一个PUT，重启API，沿用会话/URL/已确认ETag补传；冻结摘要一致，完成可幂等重放。
- [x] 5次合成协议包真实发布，量测PENDING→READY阶段，初始p95目标30s；不含本地构建/截图/上传，不代替生产SLA。
- [x] runner隔离每次报告，记录硬件、网络、样本与限制；测试失败或报告缺失均失败关闭。
- [x] 更新README/operations/验收清单，运行完整验证；对外新增运维命令按规则独立升级根版本和CHANGELOG。

## Task 4：审查、合并及分支删除

- [x] 独立审查本轮diff；重要问题RED→GREEN后全套回归。
- [x] 检查main是否前进、主工作区暂存和已有修改；若有新提交先验证组合树。
- [x] 按已获授权合并main，复验合并结果，当前worktree脱离本次分支后用 `git branch -d` 删除该分支。
- [x] 报告提交、结果、外部门槛；不删除原有分支或其他worktree。

合并提交 `e70a77f` 的代码树与验收分支一致；合并后普通测试552项、verify:workspace及根tsc通过。本次分支已安全删除，当前C工作区保留在main，B工作区保持自身功能分支。完整证据见本轮验证记录；未push，外部门槛继续开放。
