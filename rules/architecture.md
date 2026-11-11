# 架构与模块边界

## 工作区成员与分层职责

仓库采用 Monorepo + pnpm workspace + Turborepo，固定管理以下 10 个工作区成员及支撑目录：

- `packages/contracts`（`@company/contracts`，`private: true`）：跨工作流共享的协议与契约层（发布 manifest、示例就绪协议、检查报告、API 请求/响应结构与运行时校验器）；保持框架与前端/后端运行环境无关。
- `packages/charts-core`（`@company/charts-core`，公开包）：框架无关的 TypeScript 图表核心，负责数据映射、ECharts option 构建、按需模块注册、主题与格式化、实例生命周期控制与标准事件语义。
- `packages/charts-vue`（`@company/charts-vue`，公开包）：Vue 3 组件与组合函数（SFC、Props/Emits、生命周期与 `KeepAlive` 适配、样式导出），依赖 `@company/charts-core`。
- `packages/charts-react`（`@company/charts-react`，公开包）：React 19 组件与 Hooks（TSX、Props/回调、`StrictMode` Effect 生命周期适配、样式导出），依赖 `@company/charts-core`。
- `packages/component-cli`（`@company/component-cli`，公开包，命令 `component`）：开发者本地 CLI，负责初始化、构建、打包冻结、临时消费者安装、本地浏览器截图、视觉对比、基线确认、产物上传与发布恢复。
- `apps/api`（`@company/platform-api`，`private: true`）：NestJS 12 平台管理与发布 API（默认 Express 适配器，端口 `3000`），负责身份鉴权、上传校验、发布作业协调（PostgreSQL / Verdaccio / MinIO）、资产目录与审计。
- `apps/preview-gateway`（`@company/preview-gateway`，`private: true`）：独立 NestJS 12 静态预览网关（默认 Express 适配器，端口 `3001`），负责在独立域名下按预览授权（preview grant）提供只读静态预览资源；**绝不执行组件构建或运行代码**。
- `apps/gallery`（`@company/gallery`，`private: true`）：React 19 + Vite 平台前端画廊（端口 `5173`），负责组件分类/框架筛选、分框架文档与 API 展示、隔离预览嵌入、网页手动提交与发布任务进度查看。
- `examples/vue`（`@company/example-vue`，`private: true`，端口 `5174`）与 `examples/react`（`@company/example-react`，`private: true`，端口 `5175`）：双框架工作区示例入口，复用共享确定性数据（`examples/fixtures`）与示例就绪协议，供本地预览、冒烟与截图使用。
- `tests/`：契约测试、单元测试、服务 HTTP 集成测试、Playwright 浏览器测试与工作区外真实消费者模板（`tests/consumers` 不作为 workspace 成员）。
- `infra/`：PostgreSQL、Verdaccio、MinIO、OIDC 与预览域名的容器编排、配置与恢复验证定义。
- `scripts/`：固定工具链引导（`bootstrap.ps1`、`pnpm.ps1`）、工作区边界校验（`verify-workspace.ts`）、版本发现（`resolve-versions.mjs`）与验证脚本（`verify.ps1`、`verify-bootstrap.ps1`）。

## 依赖方向与包边界

以下规则由 `scripts/verify-workspace.ts` 自动检查，任何改动不得破坏：

- **工作区成员范围固定**：`pnpm-workspace.yaml` 仅包含 `apps/*`、`packages/*`、`examples/vue`、`examples/react`。未经架构评审并同步更新 `verify-workspace.ts`，不得在 `apps/` 或 `packages/` 下新增未登记目录。
- **图表包单向依赖**：`@company/charts-vue` 与 `@company/charts-react` 依赖 `@company/charts-core`，两个框架包之间严禁互相依赖；`examples/vue` 依赖 `@company/charts-vue`，`examples/react` 依赖 `@company/charts-react`。
- **外部框架与引擎 peer 边界**：组件库将 `vue`、`react`、`react-dom`、`echarts` 作为外部/peer 依赖，产出 ESM、类型声明和样式入口，严禁将框架或完整 ECharts 重复打入组件包产物。
- **服务端安全构建图**：`@company/platform-api`、`@company/preview-gateway` 与 `@company/contracts` 的依赖闭包只能包含自身与 `@company/contracts`；服务端严禁依赖 `@company/charts-*`、`@company/gallery`、`@company/component-cli` 或 `examples/*`。
- **前后端隔离**：`apps/gallery` 只能通过 HTTP 接口与 `@company/contracts` 契约同后端交互，严禁直接导入 `apps/api` 或 `apps/preview-gateway` 的 Nest 模块、控制器或数据库/存储实现。
- **公开包禁止泄漏私有运行时依赖**：仅 `@company/charts-core`、`@company/charts-vue`、`@company/charts-react`、`@company/component-cli` 的 `private` 为 `false`。这四个公开包的 `dependencies` 严禁包含私有包 `@company/contracts`；`component-cli` 如需使用 `contracts` 运行时校验，必须在构建产物中内联，确保工作区外干净消费者可独立安装。
- **禁止跨包源码导入与浮动版本**：跨包引用一律通过包名与 `exports` 导入，禁止通过相对路径直接导入其他包的 `src/`。内部依赖在工作区中统一写 `workspace:*`（`pnpm pack` 时转为精确版本），所有外部依赖必须锁定 `x.y.z` 精确版本，严禁循环依赖。

## 核心领域模型与设计原则

- **包与组件实现分离**：一个 npm 包可以包含多个逻辑组件。数据库中 `components`（逻辑组件）、`variants`（Vue/React 框架实现）、`package_releases`（npm 包版本粒度）与 `variant_releases`（框架实现发布粒度）必须分开建模，严禁将 npm 包版本直接混同为单个组件实现版本。
- **状态正交分离**：`variant_release` 的可用状态（如 `Ready`）、检查报告来源（`cli-auto` 本地自动生成 vs `manual-upload` 网页手动上传）、视觉基线确认状态、AI 检索索引同步状态必须独立存储与展示，不得由 `Ready` 推断“已通过服务端复测或自动视觉回归”。
- **持久化作业协调**：跨 MinIO、Verdaccio、PostgreSQL 的发布流程由 PostgreSQL `release_jobs` 持久化状态机（含唯一幂等键、租约、fencing token 与重试步骤）驱动，不依赖内存态队列或不可恢复的进程内定时器。
- **三人工作流文件边界**：
  - A（SDK）：负责 `packages/charts-*` 与 `examples/*`；
  - B（CLI 与前端）：负责 `packages/component-cli`、`apps/gallery`、消费者与浏览器测试；
  - C（平台与工程）：负责 `apps/api`、`apps/preview-gateway`、`packages/contracts`、`infra/` 及根工具链配置。
  跨工作流接口变更必须先更新 `packages/contracts` 与测试 fixtures，再修改实现方与调用方。
