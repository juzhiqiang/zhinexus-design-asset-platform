# 架构与模块边界

## 分层职责

仓库采用 Monorepo + pnpm workspace + Turborepo，固定管理 10 个工作区成员及支撑目录：

- `packages/contracts/`（`@company/contracts`，`private: true`）：跨层共享的协议与契约定义（`ReleaseManifestV1`、`ExampleRef`、`ScreenshotRef`、`EnvironmentV1`、`CheckReportV1`、API 请求/响应结构与运行时 Schema 校验器）；保持环境无关，不得导入前端框架、DOM、ECharts 或 NestJS 模块。
- `packages/charts-core/`（`@company/charts-core`，公开包）：框架无关的 TypeScript 图表核心，负责数据映射、ECharts option 构建、按需模块注册、主题与格式化、实例控制器与标准事件语义；禁止依赖 Vue 或 React。
- `packages/charts-vue/`（`@company/charts-vue`，公开包）：Vue 3 组件与 Composable（SFC、Props/Emits、`KeepAlive` 与生命周期适配、样式导出），依赖 `@company/charts-core`。
- `packages/charts-react/`（`@company/charts-react`，公开包）：React 19 组件与 Hooks（TSX、Props/回调、`StrictMode` Effect 生命周期适配、样式导出），依赖 `@company/charts-core`。
- `packages/component-cli/`（`@company/component-cli`，公开包，命令 `component`）：开发者本地 CLI，负责初始化、构建、`pnpm pack` 冻结、工作区外临时消费者安装、本地 Playwright 截图、视觉对比、基线确认、产物上传与发布恢复。
- `apps/api/`（`@company/platform-api`，`private: true`）：NestJS 12 平台管理与发布 API（默认 Express 适配器，端口 `3000`），负责 OIDC 鉴权、上传会话与文件摘要校验、发布作业协调（PostgreSQL / Verdaccio / MinIO）、资产目录、基线管理与审计。
- `apps/preview-gateway/`（`@company/preview-gateway`，`private: true`）：独立 NestJS 12 静态预览网关（默认 Express 适配器，端口 `3001`），负责在独立注册域名下校验短期预览授权（preview grant）并分发只读静态预览资源；禁止承载组件构建或代码执行逻辑。
- `apps/gallery/`（`@company/gallery`，`private: true`）：React 19 + Next.js 16 App Router 平台前端画廊（端口 `5173`），公开发现页面使用 SSG/ISR 宿主，控制台路由预留 OIDC 登录保护并设置 noindex。负责组件分类/文本/框架筛选、分框架文档与 API 展示、沙箱 `iframe` 隔离预览、网页手动产物提交与任务进度展示；当前目录和上传仅占位，真实数据与权限仍按 T05/T07 验收。
- `examples/vue/`（`@company/example-vue`，`private: true`，端口 `5174`）与 `examples/react/`（`@company/example-react`，`private: true`，端口 `5175`）：双框架工作区示例入口，消费共享确定性数据（`examples/fixtures/`）并实现统一的示例就绪协议。
- `tests/`：契约测试、单元测试、服务 HTTP 集成测试、Playwright 浏览器测试及工作区外消费者模板（`tests/consumers/` 不作为 workspace 成员）。
- `infra/`：PostgreSQL、Verdaccio、MinIO、OIDC 与预览域名的容器编排与基础设施验证配置。
- `scripts/`：本地固定工具链引导（`bootstrap.ps1`、`pnpm.ps1`）、工作区边界检查（`verify-workspace.ts`）、官方版本探测（`resolve-versions.mjs`）及验证脚本（`verify.ps1`、`verify-bootstrap.ps1`）。

## 依赖方向

以下约束由 `scripts/verify-workspace.ts` 强制校验：

- `pnpm-workspace.yaml` 成员范围固定为 `apps/*`、`packages/*`、`examples/vue`、`examples/react`；未经架构评审并同步更新 `verify-workspace.ts`，不得新增未登记工作区包。
- `@company/charts-vue` 与 `@company/charts-react` 单向依赖 `@company/charts-core`，两个框架包之间严禁互相依赖；`examples/vue` 依赖 `@company/charts-vue`，`examples/react` 依赖 `@company/charts-react`。
- 组件包将 `vue`、`react`、`react-dom`、`echarts` 作为外部/peer 依赖声明，不得将框架运行时或完整 ECharts 打入组件产物。
- `@company/platform-api` 与 `@company/preview-gateway` 的依赖闭包仅允许包含自身与 `@company/contracts`；服务端严禁依赖 `@company/charts-*`、`@company/gallery`、`@company/component-cli` 或 `examples/*`。
- `apps/gallery/**` 不得导入 `apps/api/**` 或 `apps/preview-gateway/**`（即使 `import type` 也禁止，前后端契约统一走 `@company/contracts`）。
- 仅 `@company/charts-core`、`@company/charts-vue`、`@company/charts-react`、`@company/component-cli` 的 `private` 为 `false`。公开包的运行时 `dependencies` 严禁包含私有包 `@company/contracts`；`component-cli` 引入契约运行时校验时必须在构建产物中内联。
- 跨包引用只能通过包名与 `exports` 子路径导入，禁止通过相对路径直接导入其他包的 `src/`。
- 工作区内部依赖统一声明为 `workspace:*`（`pnpm pack` 时转为实际精确版本）；外部依赖必须锁定 `x.y.z` 精确版本，严禁出现循环依赖。

## 设计原则

- **包版本与组件实现版本分离**：一个 npm 包可包含多个逻辑组件。数据库中 `components`、`variants`（Vue/React 实现）、`package_releases`（npm 包粒度）与 `variant_releases`（实现发布粒度）必须独立建模，不得将包版本直接混同为单个组件实现版本。
- **状态正交分离**：资产可用状态（`Ready`）、检查报告来源（`local-automatic` vs `manual-upload`）、视觉基线确认状态和检索索引状态独立存储与展示，不得由 `Ready` 推断“已通过服务端复测或自动视觉回归”。
- **持久化作业协调**：跨 MinIO、Verdaccio、PostgreSQL 的发布流程由 PostgreSQL `release_jobs` 状态机（含幂等键、租约、fencing token 与重试检查点）驱动，不依赖不可恢复的内存态队列或定时器。
- **三人工作流职责隔离**：A 负责 `packages/charts-*` 与 `examples/*`；B 负责 `packages/component-cli`、`apps/gallery` 与消费者/浏览器验证；C 负责 `apps/api`、`apps/preview-gateway`、`packages/contracts`、`infra` 与根配置。跨工作流接口调整先同步更新 `packages/contracts` 与 fixtures。
