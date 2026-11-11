# 测试与发布规则

## 自动化测试

Windows 本机统一通过 `.\scripts\pnpm.ps1 <command>` 运行检查，使用 `.tools` 中固定的 Node `26.13.0`、pnpm `12.18.0` 与本地 Playwright 浏览器：

- **工作区结构与边界测试（`verify:workspace`）**：运行 `.\scripts\pnpm.ps1 verify:workspace`（`scripts/verify-workspace.ts`），校验 10 个固定成员、无循环依赖、公开包/私有包边界、`workspace:*` 内部协议、外部依赖精确版本锁定、公开包不依赖私有 `@company/contracts`、服务端安全依赖闭包及 Turbo 缓存排除规则。
- **契约、单元与服务 HTTP 测试（`test`）**：运行 `.\scripts\pnpm.ps1 test`（先执行 `pnpm build:services`，再运行 `vitest run`）。
  - `@company/contracts`、核心状态机、摘要计算、环境键计算与错误分类优先使用 Vitest 单元测试，同时覆盖合法样例与反例 fixtures（缺图、错框架、错摘要、伪造 `'local-automatic'` 来源、路径穿越等）。
  - NestJS 服务测试必须加载 `dist/` 真实编译产物，验证依赖注入、控制器到服务链路及真实 HTTP 响应，不得只验证 mock 被调用。
- **浏览器与双框架渲染测试（`test:browser`）**：先执行 `.\scripts\pnpm.ps1 build` 并释放 `5173–5175` 端口，再运行 `.\scripts\pnpm.ps1 test:browser`，验证 React 画廊（`5173`）、Vue 示例（`5174`）、React 示例（`5175`）及双框架组件在零尺寸、`ResizeObserver`、`StrictMode`、`KeepAlive`、系列删减和卸载清理下的真实行为。
- **引导脚本验证（`verify-bootstrap.ps1`）**：修改 `scripts/bootstrap.ps1`、`scripts/pnpm.ps1`、`.node-version` 或 `packageManager` 后，必须运行 `.\scripts\verify-bootstrap.ps1`，在独立临时目录中验证首次下载、哈希校验、版本探测和缓存重跑。

## 外部消费者与环境验收

- **工作区外真实 tarball 消费（T03 / T04）**：组件包执行 `pnpm pack` 生成冻结 tarball 后，必须在工作区外的干净临时消费者项目中安装该 tarball，验证 `workspace:*` 已转为实际精确版本、无私有依赖残留、ESM/类型/样式/子路径按需导出可用，并在此消费者上运行示例与截图。严禁使用工作区内 `workspace:*` 链接或源码 alias 冒充消费者验收。
- **候选 `charts-core` 覆盖与发布顺序**：当 `@company/charts-core` 有未发布改动时，本地临时消费者可通过 `overrides` 解析候选 core tarball，但冻结的框架包 `package.json` 仍须指向正式精确版本；线上发布必须先发布 `charts-core` 并通过注册表依赖可达性检查，再发布 `charts-vue` / `charts-react`。
- **双项目真实试点验收（T11）**：至少一个真实 Vue 项目和一个真实 React 项目从 Verdaccio 安装已发布包，完成类型、构建、交互与视觉验收，并完成发布中断恢复与存储备份恢复演练。

## 版本号规则

### 格式与唯一来源

- 遵循语义化版本 `MAJOR.MINOR.PATCH`：四个公开包（`@company/charts-core`、`@company/charts-vue`、`@company/charts-react`、`@company/component-cli`）以各自 `package.json` 的 `version` 字段为唯一事实来源；平台整体版本以根 `package.json` 的 `version` 为唯一事实来源。
- 当前 `G0` 工程骨架阶段，根包与四个公开包版本均为 `0.0.0`，尚不可作为业务组件发布。
- 外部依赖在 `package.json` 中必须锁定精确版本 `x.y.z`（禁止 `^`、`~`、`*`），与根 `pnpm-lock.yaml` 保持一致。`.\scripts\pnpm.ps1 versions:resolve` 仅刷新 `docs/versions.discovery.json` 官方候选发现记录，不修改已安装版本，也不证明兼容。

### 递增时机

- **MAJOR**：不向后兼容的破坏性变更。包括 `ReleaseManifest` `schemaVersion` 不兼容升级、删除或重命名公开组件导出/子路径、不兼容修改 Props/事件载荷、缩减已验证的 Vue/React/ECharts 支持范围。
- **MINOR**：向后兼容的新能力。包括新增图表或场景组件、新增可选 Props/事件/主题、新增 CLI 命令或 API 端点、经双框架实测扩大 ECharts 兼容版本范围。
- **PATCH**：向后兼容的缺陷修复、生命周期清理修复、样式修正、按需打包优化、依赖与构建配置调整。
- **0.x 阶段（脱离 `0.0.0` 骨架后至 `1.0.0` 前）**：MAJOR 固定为 `0`，破坏性变更升 `MINOR`，兼容变更升 `PATCH`；完成一期验收正式投产时升至 `1.0.0`。
- 纯文档、注释、测试或验证记录变更不单独升版；一次发布周期内同一包的多个提交合并升一次版本。

### 预发布

- 预发布号格式为 `x.y.z-rc.N` 或 `x.y.z-beta.N`，`N` 从 `1` 递增；正式发布去掉后缀，不改前面的 `x.y.z`。
- 不使用 `+build` 构建元数据，确保 tarball 文件名、Git tag 与 `package.json#version` 完全一致。
- 预发布不得作为正式验收通过依据；正式版本必须基于冻结产物重新通过完整验证。

### tag 与不可变发布绑定

- 一个包版本号一旦发布到 Verdaccio 即永久冻结：已发布版本**严禁覆盖、严禁删除重发、严禁修改 tarball 内容**；发现问题时必须递增 `PATCH` 发布新版本，并通过平台将旧版本标记为 `deprecated`。
- 创建或推送 Git tag、触发远程发布均属于 `AGENTS.md` 中的 Push 授权范围，必须先获得用户明确授权。

### 升版提交

- 脱离 `0.0.0` 骨架阶段后，凡涉及对外可见的实质性新增功能（`feat`）或缺陷修复（`fix`）且达到版本升级条件，代理在任务验证通过后主动执行升版并更新 `CHANGELOG.md`，独立成一个提交，不混入业务代码改动。
- Commit message 固定格式：`chore: 升级版本号至 x.y.z`。

### CHANGELOG

- 仓库维护 `CHANGELOG.md`，按版本倒序，节标题格式 `## [x.y.z] - YYYY-MM-DD`，条目使用中文。
- 每节按「新增 / 变更 / 修复 / 移除」分组，只记录对外可见行为、组件 API 与兼容范围变化，不罗列内部重构细节。
- 详细的版本发现证据、构建日志、SHA-256 摘要与环境验收结果记录在 `docs/verification/` 中，`CHANGELOG.md` 只做变更摘要。

## 发布门槛与三存储一致性

- **单一冻结产物贯穿全链路**：`构建 → pnpm pack 冻结 tarball 并计算 SHA-256 → 工作区外消费者安装 → 示例运行与截图 → 生成报告 → 上传同一份 tarball`。截图完成后严禁重新打包；产物变化必须重新验证。
- **跨存储幂等与恢复**：PostgreSQL、Verdaccio、MinIO 之间通过 `release_jobs` 状态机（`FINALIZE_OBJECTS → ENSURE_PACKAGES → REGISTER_ASSETS → CHECK_AVAILABILITY → READY_TX`）、唯一约束、租约（lease）与单调递增 `fencing_token` 协调：
  - 超时或重启恢复时，先核对 MinIO 对象与 Verdaccio 包版本的存在性及 SHA-256 摘要；
  - 摘要一致则跳过重复写入并补齐后续登记；同名同版本摘要不一致则立即标记 `CONFLICT` 并失败关闭，绝不覆盖已有版本。
- **ECharts 升级与回退**：升级 ECharts 候选版本必须在本地完成双框架构建、类型、生命周期与固定环境视觉对比；只有实测通过才可记录 `compatibility_records` 为 `'passed'`，并同时保留上一已验证组合与锁文件回退步骤。
- **本地验证诚实边界**：运行 `.\scripts\verify.ps1` 通过仅证明当前工程基线与已有测试通过；缺少 G1 契约运行时校验、G2 真实基础设施（PostgreSQL / Verdaccio / MinIO / OIDC / 独立预览域）或真实消费者证据时，必须记录阻塞，不得将相关任务标为完成。
