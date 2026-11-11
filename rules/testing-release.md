# 测试、版本与发布规则

## 自动化测试与验证分层

Windows 本机统一使用 `.\scripts\pnpm.ps1 <command>` 运行检查，确保调用 `.tools` 中固定版本的 Node `26.13.0`、pnpm `12.18.0` 与本地 Playwright 浏览器。

- **工作区结构与边界校验（`verify:workspace`）**：
  - 运行 `.\scripts\pnpm.ps1 verify:workspace`（执行 `scripts/verify-workspace.ts`）；
  - 校验 10 个固定工作区成员、无循环依赖、4 个公开包与 6 个私有包的 `private` 边界、内部依赖使用 `workspace:*`、外部依赖锁定 `x.y.z` 精确版本、公开包不依赖私有 `@company/contracts`、服务端构建闭包安全，以及 `turbo.json` 未将 `test` / `test:browser` / `component` 纳入缓存。
- **单元、契约与服务 HTTP 集成测试（`test`）**：
  - 运行 `.\scripts\pnpm.ps1 test`（自动先执行 `pnpm build:services`，再运行 `vitest run`）；
  - NestJS 服务测试必须加载真实编译产物（`dist/`），验证 Decorator Metadata、依赖注入、控制器到服务链路及真实 HTTP 状态码与响应体，不得仅对 mock 函数做断言；
  - `@company/contracts` 测试必须同时覆盖合法样例与反例 fixtures（缺图、错配框架、摘要不匹配、伪造 `cli-auto` 来源、非法路径等）。
- **浏览器冒烟与双框架渲染测试（`test:browser`）**：
  - 运行前先执行 `.\scripts\pnpm.ps1 build`，并关闭占用 `5173–5175` 端口的常驻开发服务，再运行 `.\scripts\pnpm.ps1 test:browser`；
  - 使用本地 Playwright Chromium 验证 React 画廊（`5173`）、Vue 示例（`5174`）与 React 示例（`5175`）的真实产物渲染与交互，以及双框架组件在零尺寸、`ResizeObserver`、`StrictMode`、`KeepAlive`、系列删减和卸载清理下的生命周期行为。
- **工作区外真实消费者验收（T03 / T04 / T11）**：
  - 组件包通过 `pnpm pack` 生成冻结 tarball 后，必须在**工作区外的干净临时目录**（或真实试点项目）中安装该 tarball 或从 Verdaccio 安装已发布包；
  - 验证 `workspace:*` 已转换为实际精确版本、无私有依赖残留、ESM 与子路径按需导入可用、TypeScript 类型声明通过检查、样式入口有效且图表在浏览器中正常渲染；
  - **严禁使用 monorepo 内部 `workspace:*` 链接或源码路径 alias 冒充真实消费者验收**。
- **工具链引导验证（`verify-bootstrap.ps1`）**：
  - 凡修改 `scripts/bootstrap.ps1`、`scripts/pnpm.ps1`、`.node-version` 或根 `packageManager`，必须运行 `.\scripts\verify-bootstrap.ps1`，在独立临时目录中用 Windows PowerShell 5.1 非交互模式真实验证首次下载、哈希校验、版本探测与第二次缓存命中。
- **一键基础检查（`verify.ps1`）**：
  - 日常提交前可运行 `.\scripts\verify.ps1`，按顺序执行 `install --frozen-lockfile`、`verify:workspace`、`build`、`typecheck`、`test`、`test:browser` 与 `build:services`。
  - 注意：`verify.ps1` 通过仅代表工程基线（G0）及已有测试绿灯，**不等于 G1/G2 或未实现的业务任务已完成验收**。

## 产物冻结与三存储发布一致性

- **单一冻结产物贯穿全链路**：
  - 本地流程固定为：`构建 → pnpm pack 冻结 tarball 并计算 SHA-256 → 工作区外临时消费者安装该 tarball → 运行示例并生成確定性截图与静态预览 → 生成携带包摘要与图片摘要的检查报告 → 上传同一份冻结产物`；
  - 截图完成后严禁重新打包；若源码或打包产物发生任何变化，原有截图与检查报告立即失效，必须重新执行安装与截图验证。
- **候选 `charts-core` 与框架包发布顺序**：
  - 当 `@company/charts-core` 有未发布改动时，本地验证阶段可在工作区外临时消费者中通过 `overrides` 指向候选 `charts-core` tarball，但候选 `@company/charts-vue` / `@company/charts-react` 的 `package.json` 必须声明目标正式精确版本，不得改写已冻结的框架包 tarball；
  - 线上发布时必须先完成 `@company/charts-core` 发布并确认 Verdaccio 可达，再发布框架包，并在标记 `Ready` 前执行注册表依赖可达性检查。
- **跨存储状态机与故障恢复**：
  - PostgreSQL、Verdaccio 与 MinIO 之间没有跨系统分布式事务，发布必须通过 PostgreSQL `release_jobs` 持久化步骤推进：`校验上传文件与摘要 → 固化 MinIO 不可变版本资源 → 发布同一份 tarball 到 Verdaccio → 登记 PostgreSQL（package_releases / variant_releases） → 验证包与预览资源均可达后标记 Ready → 写入 index_outbox 异步同步索引`；
  - 任务执行使用租约（lease）与单调递增 `fencing_token` 防止多 worker 并发重入；
  - 当网络超时、终端断开或服务重启导致状态不确定时，恢复逻辑必须先向 MinIO 和 Verdaccio 核对目标版本的存在性与内容摘要：
    - 若远程已存在且 SHA-256 摘要与当前任务完全一致，则直接复用并补齐后续数据库登记；
    - 若远程已存在同名同版本但摘要不一致，立即判定为版本冲突（`CONFLICT`），失败关闭并保留审计记录，**严禁覆盖或删除已发布的 npm 包与 MinIO 资源**。

## 版本号与依赖演进规则

### 版本来源与锁定

- **工具链与工程依赖版本**：
  - 唯一锁定来源为 `.node-version`、各 `package.json` 与根 `pnpm-lock.yaml`；所有外部 npm 依赖必须使用固定精确版本（`x.y.z`），禁止使用 `^`、`~`、`*` 或浮动标签；
  - 运行 `.\scripts\pnpm.ps1 versions:resolve`（`scripts/resolve-versions.mjs`）仅用于从官方源查询最新稳定版并更新 `docs/versions.discovery.json` 候选记录，**不修改已安装版本，也不代表候选组合已通过兼容验证**；
  - MinIO 等容器基础设施必须固定正式 Release 版本与镜像 digest（如 `RELEASE.2025-10-15T17-29-55Z`），不得使用浮动的 `latest` 镜像标签。
- **公开包版本（`@company/*`）**：
  - 仓库内四个公开包（`@company/charts-core`、`@company/charts-vue`、`@company/charts-react`、`@company/component-cli`）在工程骨架阶段版本为 `0.0.0`，不直接向业务发布；
  - 进入正式发布后，各公开包以各自 `package.json` 的 `version` 字段为唯一事实来源，遵循语义化版本 `MAJOR.MINOR.PATCH`。

### 语义化版本递增规则

- **MAJOR**：不向后兼容的破坏性变更。包括删除或重命名已公开的组件导出/子路径、不兼容修改 Props/事件回调载荷、缩减已声明支持的 Vue/React/ECharts 版本范围、或 `@company/contracts` 协议发生不兼容升级。在 `0.x` 阶段，破坏性变更递增 `MINOR`，兼容变更递增 `PATCH`；完成一期验收正式投产时升至 `1.0.0`。
- **MINOR**：向后兼容的新增功能。包括新增基础图表或场景组件、新增可选 Props/主题/事件、新增 CLI 子命令、或经双框架实测扩大 ECharts 兼容版本范围。
- **PATCH**：向后兼容的缺陷修复、生命周期清理修复、样式修正、按需打包体积优化或依赖安全修复。
- **单向不可逆**：一个包版本号一旦发布到 Verdaccio 即永久冻结，不可复用、不可删 tag 重发；发现缺陷时必须递增 `PATCH` 发布新版本，并通过平台将有问题版本标记为 `deprecated`。

### ECharts 持续升级与回退

- 升级 ECharts 候选版本时，必须在本地工作区完成双框架全矩阵验证（构建、类型、按需加载、生命周期、交互与固定环境视觉对比），生成差异报告；
- 只有实测通过的精确版本才可写入 `compatibility_records` 并更新画廊展示的“已验证版本”与公开包 `peerDependencies`；
- 升级记录必须同时保留上一套已验证的组件包版本、ECharts 精确版本及回退步骤，确保业务项目出现回归时可按锁文件确定性回退。
