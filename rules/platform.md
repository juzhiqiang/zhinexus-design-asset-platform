# 工具链、双框架与运行环境规则

## 支持矩阵

以 `component-platform-implementation-assessment.md`、`docs/superpowers/plans/2026-11-11-component-platform-implementation.md` 与 `docs/verification/nest-react-bootstrap.md` 为准：

- **本地开发与截图基线**：Windows 10/11 x64（引导脚本支持 Windows 自带 PowerShell 5.1 非交互执行）+ 本地 Playwright Chromium。其他操作系统可按相同精确版本自行配置工具链，但在完成独立验证矩阵前，不得声明已验证支持。
- **服务端运行基线**：Linux 容器/主机环境运行 `apps/api`、`apps/preview-gateway`、PostgreSQL 18.6、Verdaccio 7.1.0、MinIO（固定 `RELEASE.2025-10-15T17-29-55Z` 源码与镜像摘要）。服务端不安装或执行组件构建器与截图浏览器。
- **组件框架与引擎基线**：Vue `3.5.45`、React / ReactDOM `19.3.1`、ECharts `6.1.0`。任何扩大或缩减兼容版本范围的改动，必须同步更新兼容矩阵测试与 `compatibility_records`。

## 固定工具链与编译器分层

- **本地隔离工具链（`.tools/`）**：
  - 仓库固定 **Node.js `26.13.0`**（`.node-version` 与 `package.json#engines`）、**pnpm `12.18.0`**（`packageManager`）、**Turbo `2.11.10`**。
  - `.\scripts\bootstrap.ps1` 自动将官方 Node 与原生 pnpm 下载至 `.tools/` 并校验 SHA-256 / SHA-512 摘要，不修改系统全局环境。
  - Windows 本机统一通过 `.\scripts\pnpm.ps1 <args>` 执行命令；该脚本自动将 `.tools/bin` 与 Node 目录注入当前进程 `PATH`，并将 `PLAYWRIGHT_BROWSERS_PATH` 设为 `.tools/playwright`。
- **TypeScript 双编译器策略**：
  - 根工作区、`apps/gallery`、`packages/charts-*`、`packages/component-cli`、`packages/contracts` 与 `examples/react` 使用 **TypeScript `7.0.2`**。
  - `apps/api` 与 `apps/preview-gateway` 显式固定 **Nest CLI `12.0.12` + TypeScript `6.0.3`**，启用 `experimentalDecorators` 与 `emitDecoratorMetadata`，确保编译产物具备完整依赖注入元数据。
  - `examples/vue` 的 SFC 类型检查隔离使用 **`vue-tsc 3.3.14` + TypeScript `6.0.3`**（兼容例外记录于 `docs/verification/vue-typescript-exception.json`）。
- **pnpm 工作区配置**：
  - `pnpm-workspace.yaml` 固定启用 `saveExact: true`、`strictPeerDependencies: true`、`engineStrict: true`、`verifyDepsBeforeRun: false` 及 `allowBuilds: { esbuild: true }`。
  - `.npmrc` 仅保留 npm 通用配置。所有成员共用根 `pnpm-lock.yaml`，安装依赖一律使用 `--frozen-lockfile`，不以脚本启动前隐式安装代替冻结安装检查。

## Turbo 任务编排与缓存边界

- 各工作区成员显式提供 `build`、`typecheck`、`dev` 脚本并直接调用自身编译器或开发服务器，严禁在子包脚本中递归调用 `turbo`。
- 根 `typecheck` 与 `test` 先执行 `pnpm build:services`，确保首次或干净工作区运行时已生成 Nest 服务的 `dist/` 编译产物与类型声明。
- `build`（输出 `dist/**`）和 `typecheck`（无文件输出）启用本地缓存 `--cache=local:rw`；`dev` 固定 `cache: false`、`persistent: true`。一期不启用远程缓存。
- `test`、`test:browser`、`component`、工作区外 tarball 消费、本地截图、视觉回归、产物冻结、上传发布、故障恢复与基线更新**严禁进入 Turbo 缓存**；若未来包装为 Turbo 任务，必须显式设置 `cache: false`。
- 服务端构建只执行 `pnpm build:services`（过滤 `@company/platform-api` 与 `@company/preview-gateway` 及其依赖 `@company/contracts`），不运行根全量 `pnpm build`。

## 双框架组件与视觉环境适配

- **双框架对等实现**：一期 7 个逻辑组件（折线、柱状、饼图/环图、散点、趋势卡片、排名、占比）共 14 个框架实现，共用 `@company/charts-core` 控制器与 option 逻辑，分别按 Vue 3（SFC / Emits）和 React 19（TSX / Callbacks）惯例暴露 API。
- **生命周期与容器适配**：
  - 挂载时检测容器尺寸，零宽高或隐藏容器须等待 `ResizeObserver` 获得有效尺寸后再初始化或 `resize` ECharts 实例；
  - 卸载时解除全部监听、断开 `ResizeObserver` 并调用 `dispose()`；
  - React 实现须兼容 `StrictMode` 开发态 Effect 重复挂载/清理；Vue 实现须兼容 `KeepAlive` 激活（`onActivated`）后的尺寸恢复；
  - 数据更新须正确处理系列删减（稳定 series id 与合理 `replaceMerge` 防止旧系列残留）及主题/渲染器（`canvas` / `svg`）切换重建。
- **SSR 安全导入**：`charts-core`、`charts-vue`、`charts-react` 模块顶层不得访问 `window`、`document`、`navigator` 等浏览器全局对象；SSR 宿主仅安全导入并在客户端挂载后创建图表实例。
- **确定性截图与 `environmentKey`**：
  - 示例页面通过统一就绪协议（数据、字体、非零尺寸、ECharts 渲染完成信号）关闭动画后触发截图，禁止依赖固定 `sleep`；
  - `environmentKey` 由规范化的 `os/arch/browserVersion/browserRevision/fontDigest/locale/timezone/deviceScaleFactor/renderer/width/height/theme` 计算；被测 `frameworkVersion`、`echartsVersion` 和包版本记录在报告中，不计入 `environmentKey`；
  - 环境签名与基线不一致时返回 `INCOMPATIBLE`，不得自动判为通过；网页手动上传截图的 `environmentKey` 固定为 `unknown-manual`，不得用于建立或更新自动回归基线。
