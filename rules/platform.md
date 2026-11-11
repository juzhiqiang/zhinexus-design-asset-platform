# 工具链、双框架与运行环境规则

## 运行与支持环境基线

- **本地开发与截图环境**：一期已验证的本地开发、示例运行与 Playwright 截图环境为 **Windows 10/11 x64**（引导脚本兼容 Windows 自带 PowerShell 5.1 非交互模式）。其他操作系统可按相同精确版本自行配置工具链，但在完成独立验证矩阵前，不得声明已验证支持。
- **服务端部署环境**：`apps/api`、`apps/preview-gateway`、PostgreSQL、Verdaccio 与 MinIO 面向 **Linux** 环境部署；服务端只运行平台 API、静态预览网关与三类存储，不安装或运行组件构建器与截图浏览器。

## 固定工具链与编译器分层

- **本地隔离工具链（`.tools`）**：
  - 项目固定 **Node.js `26.13.0`**（`.node-version` 与 `package.json#engines`）、**pnpm `12.18.0`**（`packageManager`）、**Turbo `2.11.10`**。
  - Windows 下通过 `.\scripts\bootstrap.ps1` 自动下载官方 Node 与原生 pnpm 到仓库 `.tools/` 目录，并严格校验 SHA-256 / SHA-512 摘要，不修改系统全局 Node/pnpm。
  - 日常开发与验证命令统一通过 `.\scripts\pnpm.ps1 <args>` 执行；该包装脚本自动将 `.tools` 注入当前进程 `PATH`，并将 `PLAYWRIGHT_BROWSERS_PATH` 指向 `.tools/playwright`。
- **TypeScript 编译器分层**：
  - 根工作区、`apps/gallery`、`packages/charts-*`、`packages/component-cli`、`packages/contracts` 与 `examples/react` 使用 **TypeScript `7.0.2`**。
  - 两个 NestJS 服务（`apps/api`、`apps/preview-gateway`）显式固定 **Nest CLI `12.0.12` + TypeScript `6.0.3`**，启用 `experimentalDecorators` 与 `emitDecoratorMetadata`，确保编译产物具备完整依赖注入元数据。
  - `examples/vue` 的 SFC 类型检查隔离使用 **`vue-tsc 3.3.14` + TypeScript `6.0.3`**（记录于 `docs/verification/vue-typescript-exception.json`）。
  - 升级任一编译器或框架版本时，必须重新验证双编译器兼容性与 Nest DI 元数据。
- **pnpm 工作区约束**：
  - 统一在 `pnpm-workspace.yaml` 中配置 `saveExact: true`、`strictPeerDependencies: true`、`engineStrict: true`、`verifyDepsBeforeRun: false` 及 `allowBuilds: { esbuild: true }`。
  - `.npmrc` 仅保留 npm 通用配置。所有成员共用根 `pnpm-lock.yaml`，日常与 CI 检查一律使用 `pnpm install --frozen-lockfile`。

## Turbo 任务编排与缓存边界

- **脚本约定**：每个工作区成员必须显式定义 `build`、`typecheck`、`dev` 三个脚本，直接调用各自的编译器或开发服务器，严禁在子包脚本中递归调用 `turbo`。
- **前置服务构建**：由于测试与根类型检查直接加载已编译的 Nest 服务产物与声明，根 `typecheck` 与 `test` 脚本均须先执行 `pnpm build:services`。
- **允许缓存的任务**：仅 `build`（输出 `dist/**`）和 `typecheck`（无文件输出）允许使用 Turbo 本地缓存（`--cache=local:rw`）；`globalDependencies` 跟踪 `tsconfig.base.json`、`pnpm-workspace.yaml` 与 `.node-version`。一期不启用远程缓存。
- **严禁缓存的任务**：
  - `dev` 必须配置 `cache: false` 与 `persistent: true`；
  - `test`、`test:browser`、`component`、工作区外 tarball 消费、本地截图、视觉回归比对、产物打包冻结、上传发布、故障恢复演练与基线更新**严禁放入 Turbo 缓存**，每次必须真实运行并产出独立记录。
- **服务端构建白名单**：服务端仅执行 `pnpm build:services`（过滤 `@company/platform-api` 与 `@company/preview-gateway` 及其依赖 `@company/contracts`），不构建前端画廊、图表包或示例。

## 双框架组件与 ECharts 生命周期适配

- **双框架对等实现**：基础图表（折线、柱状、饼图/环图、散点）与场景组件（趋势卡片、排名、占比）均须提供独立的 Vue 3（Composition API / SFC）和 React 19（函数组件 / Hooks）实现，共享 `@company/charts-core` 的数据映射、option 生成与事件语义，按各自框架惯例暴露接口（如 Vue `point-click` 对应 React `onPointClick`）。
- **容器与生命周期安全**：
  - 挂载时检测容器尺寸，零宽高容器须等待 `ResizeObserver` 获得有效尺寸后再初始化 ECharts 实例，避免渲染异常或告警；
  - 组件卸载时必须解除事件监听、断开 `ResizeObserver` 并调用 `dispose()` 销毁实例；
  - Vue 实现必须处理 `KeepAlive` 激活（`onActivated`）时的尺寸同步与重绘；
  - React 实现的 `useEffect` 建立与清理必须兼容 `StrictMode` 下的重复挂载/清理，不得残留失效实例或丢失图表；
  - 数据更新须区分普通增量更新、系列删减（使用稳定 series id 与合理 `replaceMerge` 避免旧系列残留）以及主题/渲染器（Canvas/SVG）切换导致的实例重建。
- **SSR 安全导入边界**：组件包与 `charts-core` 模块顶层严禁直接访问 `window`、`document`、`navigator` 等浏览器全局对象；SSR 宿主导入时只输出容器占位，图表实例仅在客户端挂载阶段创建。
- **按需加载导出**：高频图表须提供明确的子路径导出，内部基于 `echarts/core` 按需注册所需图表、组件与渲染器，并通过打包体积与外部消费者构建验证按需加载效果。

## 确定性截图与视觉环境签名

- **示例就绪协议**：Vue 与 React 示例通过统一的就绪信号（数据加载、字体就绪、容器非零尺寸、ECharts 渲染完成事件）驱动 Playwright 截图；截图模式必须关闭动画并注入固定确定性数据（`examples/fixtures`），严禁仅靠固定 `sleep` 延时截图。
- **环境签名严格匹配**：每次本地截图、检查报告与视觉基线都必须记录完整环境签名（操作系统版本、CPU 架构、Chromium 版本与修订号、字体配置、语言、时区、设备像素比、视口宽高、主题与渲染器）。
- **跨环境不兼容保护**：当运行环境签名与已有基线不一致时，检查器必须返回 `INCOMPATIBLE`，提示开发者在目标环境显式建立或确认对应基线，严禁自动算作通过或通过盲目调大阈值掩盖环境差异。
