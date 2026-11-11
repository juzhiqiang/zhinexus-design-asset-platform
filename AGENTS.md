# AGENTS.md

本文件是项目 AI 协作开发的核心规则入口。所有代理必须遵守核心约束，并按任务类型读取 `rules/` 中的详细规则。不得假设文件、脚本或功能一定存在；先检查当前仓库实际内容。

## 项目概述

本项目用于构建 **Zhinexus 组件资产平台（公司图表与组件资产平台）**，采用 **Monorepo + pnpm workspace + Turborepo** 工程架构。平台前端画廊使用 **React 19.3.1 + Next.js 16.4.6 App Router**，管理 API 与静态预览网关使用 **NestJS 12.4.2**（默认 Express 适配器）；组件侧同时支持 **Vue 3.5.45 与 React 19.3.1 双框架**，图表引擎采用 **ECharts 6.1.0**，存储层采用 **Verdaccio、PostgreSQL、MinIO**。

- 原始架构规格：`component-platform-architecture.md`
- 实施评估与总体计划：`component-platform-implementation-assessment.md`
- 完整实现计划（T01–T17）：`docs/superpowers/plans/2026-11-11-component-platform-implementation.md`
- 三人分工与排期计划：`docs/superpowers/plans/2026-11-11-three-person-allocation.md`
- 验证记录与技术栈调整证据：`docs/verification/nest-react-bootstrap.md`
- 画廊 Next 迁移与公开/私有渲染边界：`docs/verification/gallery-next-migration.md`
- 详细工程规则：`rules/`

## 唯一事实来源

- 架构设计与业务流程以 `component-platform-architecture.md` 为基线（**原架构文档保持原样，严禁修改其内容或破坏其 SHA-256**）。
- 用户确认的技术栈调整（Monorepo + pnpm workspace + Turborepo、NestJS 后端、React 平台前端）及任务拆解以 `component-platform-implementation-assessment.md`、`docs/superpowers/plans/2026-11-11-component-platform-implementation.md` 和 `docs/verification/nest-react-bootstrap.md` 为准。
- 当前团队分工（A：SDK、B：CLI/画廊、C：NestJS 平台）与并行依赖以 `docs/superpowers/plans/2026-11-11-three-person-allocation.md` 为准。
- 迁移前的 Fastify 初始化记录（`docs/superpowers/plans/2026-11-11-bootstrap-execution.md`、`docs/verification/bootstrap.md`）仅供历史追溯，不得作为当前后端框架依据。
- 如果实现细节与架构规格、实施计划或公共契约冲突，以架构规格和实施计划为准；先停止冲突部分并请求范围决策。

## 任务执行流程

1. 按实现计划（`T01–T17`）与三人分工计划（`G0/G1/G2` 门槛及一期 `T01–T12`）选择前置依赖已满足的任务；严格区分**开工依赖**与**验收依赖**（stub 或类型草案仅帮助开工，不能替代真实产物与服务验证完成验收）。
2. 修改代码前，先阅读实现计划、分工文档、`packages/contracts` 契约定义和相关 `rules/` 规则，确认负责人（A：SDK、B：CLI/画廊、C：平台）、依赖和文件范围。
3. 按 TDD 执行：有行为变更的任务先新增或更新失败测试（RED），确认预期失败后再实现最小且合理的方案（GREEN），并运行相关类型检查、构建和验证命令。
4. 允许最多 4 个互不冲突的任务同时处于 `in_progress`；只有前置契约已对齐、文件所有权不重叠且接口约定明确时才可并行。
5. 每个并行任务必须指定唯一负责人；负责人只修改分配的文件，根 `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`turbo.json` 与 `packages/contracts` 由 C 统一收口维护，禁止手工拼接多份锁文件。
6. 发现文件冲突或契约不一致时暂停冲突部分，先同步更新 `packages/contracts` 与 fixtures，由工程负责人（C）协调，不得互相覆盖修改。
7. 标记任务或门槛完成前，必须记录实际执行的验证命令、结果证据及未覆盖边界；不得因工程骨架（G0）通过测试就将完整任务（如 T01）标记为完成。
8. 凡涉及对外可见的实质性新增功能（`feat`）或缺陷修复（`fix`），脱离 `0.0.0` 骨架阶段并达到触发版本升级条件时，必须按语义化版本规则升级对应 `package.json` 版本号并同步更新 `CHANGELOG.md`，单独作为 `chore: 升级版本号至 x.y.z` 提交，无需用户逐次提醒。
9. 如果当前目录是 Git 仓库，在每个任务或子任务边界创建聚焦提交。
10. 不得重写已完成任务的历史验证记录；返工或补充验证应新增独立记录。

## 不可违反的约束

- **本地构建与服务端零执行边界**：组件构建、示例运行、自动截图与视觉对比必须在开发者电脑（本地 CLI + 本地 Playwright Chromium）执行；**服务端（`apps/api`、`apps/preview-gateway`）严禁构建组件、严禁执行上传的组件代码、严禁启动截图浏览器**。
- **产物冻结与全链路摘要一致**：CLI 与网页双入口均提交预构建产物。`pnpm pack` 生成候选 tarball 后即冻结；截图必须来自工作区外干净消费者实际安装的同一份 tarball。截图完成后严禁重新打包，同一份 tarball SHA-256 摘要必须贯穿安装、截图、报告、上传与发布；产物变化必须重新验证。
- **网页手动提交逐实现必检**：网页发布必须手动上传截图，每个待发布逻辑组件的每个框架实现（Vue / React）至少关联一张有效展示截图；缺图或错配框架必须在前端和 API 两端同时拒绝，且来源强制标记为 `manual-upload`，不得伪造 `local-automatic` 自动验证记录。
- **双框架对等与独立建模**：一期同时支持 Vue 3 与 React 19，图表引擎采用 ECharts 6。`package_releases`（npm 包版本粒度）与 `variant_releases`（组件框架实现粒度）独立建模；某一实现通过验证不代表另一实现自动通过。SSR 宿主只承诺安全导入与客户端挂载，不提供服务端图表渲染。
- **已发布版本不可变与幂等恢复**：Verdaccio 已发布版本严禁覆盖、严禁删除重发；MinIO 已发布版本资源保持不可变。跨存储（MinIO / Verdaccio / PostgreSQL）通过 PostgreSQL `release_jobs` 持久化状态机、唯一约束、租约与 fencing token 协调恢复；同名同版本不同摘要必须报 `CONFLICT` 并失败关闭。
- **Ready 与可信度状态分离**：资产 `Ready` 仅表示包与预览资源均可达，与检查报告来源（`local-automatic` vs `manual-upload`）、视觉基线确认状态、检索索引状态严格独立，不得混用或相互推断。
- **静态预览隔离**：静态预览必须通过独立注册域名与 `preview-gateway` 按短期授权（preview grant）提供只读静态资源，在访问者浏览器的沙箱 `iframe` 中隔离运行；预览代码严禁获取平台凭证或访问管理 API。
- **固定工具链与精确依赖**：Windows x64 本地开发使用项目 `.tools` 隔离的固定 Node `26.13.0` 与 pnpm `12.18.0`（通过 `.\scripts\bootstrap.ps1` 与 `.\scripts\pnpm.ps1` 执行，不修改全局安装）。外部依赖锁定精确版本（`saveExact: true`）；最新依赖组合若存在冲突，必须明确报告并适配或记录兼容例外，严禁静默回退旧版本。
- **保留工作区与基线文档**：保留用户当前工作区中的已有修改，未经授权不得 `git reset`、`git checkout --` 或丢弃无关变更；`component-platform-architecture.md` 必须保持原始字节不变。

## 核心架构约束

- 工作区固定管理 10 个成员：`apps/api`、`apps/gallery`、`apps/preview-gateway`、`packages/contracts`、`packages/charts-core`、`packages/charts-vue`、`packages/charts-react`、`packages/component-cli`、`examples/vue`、`examples/react`。
- 服务端依赖白名单：`@company/platform-api` 与 `@company/preview-gateway` 的依赖闭包仅允许包含自身与 `@company/contracts`，严禁依赖图表运行时、画廊、CLI 或示例包（由 `scripts/verify-workspace.ts` 与 `pnpm build:services` 强制保障）。
- 公开包与私有包边界：仅 `@company/charts-core`、`@company/charts-vue`、`@company/charts-react`、`@company/component-cli` 为公开包（`private: false`），其余成员均为 `private: true`。公开包的运行时 `dependencies` 严禁依赖私有包 `@company/contracts`（CLI 引入契约校验时须在构建产物中内联）。
- 模块间只通过包名与 `exports` 引用，禁止跨包通过相对路径导入其他包的 `src/`；前端画廊 `apps/gallery` 通过 HTTP 接口和 `@company/contracts` 契约与后端交互，不得导入 NestJS 服务端模块。
- Turborepo 只负责仓库内 `build`、`typecheck`、`dev` 任务编排；`test`、`test:browser`、`component`、外部消费者安装、截图、基线更新与线上发布作业严禁进入 Turbo 缓存。
- 详细边界见 `rules/architecture.md` 和 `rules/platform.md`。

## 规则按需读取

开始任务时按类型读取对应规则，不要无差别加载全部规则：

| 任务类型 | 必须读取 |
|---|---|
| 工作区成员、模块拆分、包依赖方向、前后端/SDK 边界或数据模型设计 | `rules/architecture.md` |
| 工具链引导、TypeScript/Nest/Vue 编译器、Turbo 缓存、双框架生命周期或视觉环境签名 | `rules/platform.md` |
| 产物上传校验、静态预览网关、沙箱隔离、OIDC 鉴权、存储安全或敏感凭证 | `rules/security.md` |
| 单元/HTTP/浏览器测试、外部消费者验收、产物冻结、三存储发布一致性或版本管理 | `rules/testing-release.md` |
| 代码审查、重构或质量门禁 | `rules/code-review.md` |
| 多种类型同时涉及 | 读取所有对应规则 |
| 简单文案、注释或局部配置修改 | 只读取相关文件和配置 |

如果任务要求的规则文件不存在，不得声称已读取；涉及架构性变更时先补齐规则，或明确记录限制。

## 验证要求

- Windows 本机优先使用 `.\scripts\pnpm.ps1 <command>` 执行工作区命令，确保使用 `.tools` 中固定版本的 Node `26.13.0`、pnpm `12.18.0` 及本地 Playwright 浏览器目录。
- 开发过程中运行当前任务对应的窄范围测试（如 `.\scripts\pnpm.ps1 verify:workspace`、指定 Vitest 测试文件或单包构建）。
- 根 `typecheck` 与 `test` 均先执行 `build:services`（生成 Nest 服务编译产物与声明文件）；运行 `test:browser` 前必须先完成 `build` 并关闭占用 `5173–5175` 端口的开发服务。
- 声明任务完成前，运行该任务列出的全部验证命令（基础工程检查可运行 `.\scripts\verify.ps1`；修改引导脚本须额外运行 `.\scripts\verify-bootstrap.ps1`）。
- 不得基于假设、Turbo 缓存命中或部分输出报告成功；必须在验证记录或任务文档中记录实际通过结果。如果必需的外部检查（如 G2 的 PostgreSQL / Verdaccio / MinIO / OIDC）无法运行，记录阻塞原因，并保持对应任务状态为未完成。

## 文档与规则维护

- 原始架构文档 `component-platform-architecture.md` 作为立项基准保持只读不改；用户确认的范围、技术栈或协议变更先更新 `component-platform-implementation-assessment.md`、`docs/superpowers/plans/` 和 `@company/contracts`，再实施代码变更。
- 对外可见行为、协议结构、工作区成员、构建脚本或兼容范围变化后，同步更新 `README.md`、实施计划、验证记录和必要的交付说明。
- 规则放在 `rules/` 中按主题维护；`AGENTS.md` 保留入口和不可违反的核心约束，避免多处复制详细规则。
- `CLAUDE.md` 等工具专属入口只维护工具特有约定，并引用本文件，不复制项目通用规则。
- 新源码必须放入职责对应的 `apps/*`、`packages/*`、`examples/*`、`tests/*` 或 `scripts/*` 目录，不在仓库根目录随意添加源码文件。

## Git 提交规范

- **行尾统一**：仓库通过 `.gitattributes`（`* text=auto eol=lf`，`*.ps1` / `*.cmd` 为 `crlf`）管理行尾；不得删除或绕过该配置，也不要把工作区行尾差异当作改动提交。
- **分支命名**：Bug 修复使用 `fix/<问题描述>`，新功能使用 `feat/<任务或功能描述>`（如 `feat/t02-core`、`feat/t04-cli`、`feat/t05-platform`），工程调整使用 `chore/<描述>`，遵循仓库现有约定。
- **Commit Message**：必须使用中文，说明修改内容与目的。推荐格式：`<类型>: <修改目的>`，例如 `feat: 实现折线图核心控制器与生命周期清理`、`fix: 修复服务类型检查前置构建顺序`。
- **分批提交**：按独立功能、Bug 修复或子任务拆分 commit；每个 commit 对应一个明确目的，避免混入无关修改。
- **自动升级版本号**：脱离 `0.0.0` 工程骨架阶段后，只要修改内容包含对外的实质性功能新增（`feat`）或缺陷修复（`fix`）且达到触发发布条件，必须自动按语义化版本规则递增对应版本号（当前 `0.x` 阶段兼容变更递增 PATCH，破坏性变更递增 MINOR）并同步 `CHANGELOG.md`，独立成一个 `chore: 升级版本号至 x.y.z` 提交，无需用户逐次提醒。
- **并行协作**：并行任务在独立分支或 worktree 中实施；合并前检查文件冲突、契约一致性和完整验证结果（触碰公共包时运行全图检查）。
- **AI 提交权限**：任务或子任务完成且相关验证通过后，可以主动执行 `git add` 和 `git commit`，无需逐次征求用户同意。
- **暂存与安全**：提交前检查 `git status`、`git diff` 和暂存区；优先明确指定文件，禁止混入用户已有修改。严禁提交 `.tools/`、`node_modules/`、`.turbo/`、`dist/`、`test-results/`、密钥、`.env`、`*.local` 或其他敏感数据。
- **Push 授权**：任何 `git push`（包括新建远程分支、推送标签及推送已有提交）都必须先获得用户明确授权，不得默认执行。
- **其他操作边界**：未经用户明确授权，不执行合并、强制推送、重置、清理工作区等可能覆盖或丢失用户修改的操作；不得绕过 Git hooks。
- **结果报告**：每次提交后报告 commit hash、提交目的及验证结果；任务结束时汇总提交记录和未完成事项。
