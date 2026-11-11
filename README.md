# Zhinexus 组件资产平台

Monorepo + pnpm workspace + Turborepo 工程骨架。平台画廊使用 React 19.3.1 + Next.js 16.4.6 App Router，API 与预览网关使用 NestJS 12.4.2（默认 Express 适配器）；组件侧保留 Vue/React 双框架。当前交付包含 10 个包、协议草案、健康检查、CLI help/version 与示例入口。真实目录数据、上传、发布、图表控制器、真实包消费与截图验证尚待后续任务实现。

## 开始开发（Windows x64）

在仓库根目录执行。首次运行会从官方源下载并校验项目固定的 Node/pnpm 到 `.tools`，不修改全局安装；需能够访问 npm、Node 和 Playwright 下载源。

```powershell
.\scripts\bootstrap.ps1
.\scripts\pnpm.ps1 install --frozen-lockfile
.\scripts\pnpm.ps1 verify:workspace
.\scripts\pnpm.ps1 build
.\scripts\pnpm.ps1 typecheck
.\scripts\pnpm.ps1 test
.\scripts\pnpm.ps1 exec playwright install chromium
.\scripts\pnpm.ps1 test:browser
.\scripts\pnpm.ps1 dev
```

浏览器测试消费构建后的 `dist`，运行前先 build，并关闭占用 5173–5175 端口的开发服务。浏览器安装后可用 `.\scripts\verify.ps1` 顺序重跑全部基础检查。`dev` 同时启动 10 个开发任务，Ctrl+C 停止；Windows 上若停在 shutting down，再按一次 Ctrl+C 结束子任务。其他操作系统可以自行安装同一版本工具链，但尚不在本次验证范围内。

安装脚本支持 Windows 自带的 PowerShell 5.1 非交互执行。修改工具链或下载逻辑后，运行 `.\scripts\verify-bootstrap.ps1`：它会在独立临时目录中真实下载、校验并探测固定版本，再验证缓存重跑，结束后仅清理该测试目录。此检查需要联网和额外下载，不包含在日常 `verify.ps1` 中。

| 入口 | 地址 / 用途 |
| --- | --- |
| 画廊 | `http://127.0.0.1:5173`，空平台入口 |
| Vue 示例 | `http://127.0.0.1:5174`，工作区依赖冒烟 |
| React 示例 | `http://127.0.0.1:5175`，工作区依赖冒烟 |
| API | `http://127.0.0.1:3000/healthz`，仅存活检查 |
| 预览网关 | `http://127.0.0.1:3001/healthz`，仅存活检查 |
| CLI | `.\scripts\pnpm.ps1 component --help`；不支持的业务命令返回非零 |

后端单独构建使用 `.\scripts\pnpm.ps1 build:services`，只含 API、preview-gateway 与 contracts。组件构建、示例运行和截图保持在开发者电脑。根全量 build 用于本地开发，不作为服务端组件执行入口。

## 工作区职责

```text
apps/api                 NestJS 平台 API（目前仅 healthz）
apps/gallery             React 19 + Next.js 16 画廊入口（公开发现页 SSG/ISR，控制台路由预留登录保护）
apps/preview-gateway     NestJS 静态预览网关（目前仅 healthz）
packages/contracts       私有协议类型草案，未实现运行时校验
packages/charts-core     ECharts 共享核心包壳
packages/charts-vue       Vue 适配包壳 → core
packages/charts-react     React 适配包壳 → core
packages/component-cli  公开 CLI 包壳
examples/vue             Vue 工作区示例 → charts-vue
examples/react           React 工作区示例 → charts-react
tests                    基础行为和构建入口的浏览器冒烟
infra                    基础设施待办与责任边界
```

四个公开包名称沿用 `@company/*` 约定，版本为 `0.0.0`，尚不可作为业务组件发布。examples 目前通过 workspace 包 exports 消费，**不是** T03 的工作区外 tarball 验收。CLI 暂不使用 contracts 运行时代码；未来引入时须内联，避免发布私有运行时依赖。

## 工具链与缓存

固定 Node 26.13.0、pnpm 12.18.0、Turbo 2.11.10；根与 React/Next 画廊使用 TypeScript 7.0.2。画廊使用 Next.js 16.4.6 App Router，公开页面可接入 SSG/ISR，上传和发布工作区预留登录后的动态渲染；两个 Nest 应用使用 Nest CLI 12.0.12 与 TypeScript 6.0.3，和 CLI 自带编译器保持一致，启用 decorator metadata。仅 Vue example 的 SFC 检查使用 vue-tsc 3.3.14 + TypeScript 6.0.3；画廊已移除 Vue 工具依赖。当前版本与初始化验证见 [Nest/React 调整记录](docs/verification/nest-react-bootstrap.md) 和 [画廊迁移验证](docs/verification/gallery-next-migration.md)，迁移边界见 [画廊 Next 计划](docs/superpowers/plans/2026-11-11-gallery-next-public-private.md)。

正式构建 gallery 前设置 `NEXT_PUBLIC_SITE_URL` 为站点公开 origin；该值用于 sitemap 和 metadata base，并传入 gallery build。缺少该值时 sitemap 为空。独立运行 build 与浏览器测试时应使用同一环境变量；`verify.ps1` 在未设置时临时使用 `https://gallery.test`，结束后恢复调用者环境。

两个后端均提供 Nest module/controller/service。单独开发执行 `pnpm --filter @company/platform-api dev`，构建后运行 `pnpm --filter @company/platform-api start`；网关替换为 `@company/preview-gateway`。本机请用上述 PowerShell wrapper 替代 `pnpm`。测试加载真实 Nest 编译结果，因此根 `test` 与 `typecheck` 均先执行 `build:services`，确保首次运行时已生成服务代码和类型声明，再执行各自的完整检查。

pnpm 12 的配置放在 `pnpm-workspace.yaml`，包含官方 registry、严格 peer/engine、精确版本及仅允许 esbuild 的安装脚本。`.npmrc` 仅保留 npm 通用配置。所有人使用锁文件安装；新增依赖由 C 收口，不以脚本启动前隐式安装代替冻结安装检查。

build/typecheck 使用本地缓存，dev 不缓存；gallery build 暂不使用 Turbo 输出缓存，避免恢复输出时残留旧域名的 Next 运行时 route-cache。可通过 `.\scripts\pnpm.ps1 exec node scripts/verify-gallery-cache.mjs` 验证 A→B→A 域名切换与当前配置的实际 HTTP sitemap。test、浏览器和 component 命令直接执行。未来消费者、截图、发布、基线接受同样不得缓存。`versions:resolve` 只刷新官方候选发现记录，不更改版本、不证明兼容。

## 开发与分工文档

- [三人分工与必要依赖](docs/superpowers/plans/2026-11-11-three-person-allocation.md)：A SDK、B CLI/画廊、C 平台；前三天任务、依赖图和年底风险。
- [完整实现计划 T01–T17](docs/superpowers/plans/2026-11-11-component-platform-implementation.md)
- [实施评估](component-platform-implementation-assessment.md) / [原始架构](component-platform-architecture.md)
- [本次初始化范围](docs/superpowers/plans/2026-11-11-bootstrap-execution.md)
- [当前 Nest/React 验证](docs/verification/nest-react-bootstrap.md)
- [迁移前初始化验证](docs/verification/bootstrap.md) / [迁移前 Turbo 缓存证据](docs/verification/turbo-baseline.md)
- [独立审查与实施决定](docs/verification/bootstrap-review.md)

下一步是 G1 协议冻结及 G2 基础设施验证，同时开始 T02 与 CLI/消费者设施；不要因骨架通过测试而将整个 T01 标记完成。
