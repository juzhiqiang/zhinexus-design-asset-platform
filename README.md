# Zhinexus 组件资产平台

Monorepo + pnpm workspace + Turborepo 工程骨架。当前交付的是可开发基线：10 个包、协议草案、API/预览网关健康检查、CLI help/version、Vue/React 示例入口。上传、发布、图表控制器、真实包消费与截图验证尚待后续任务实现。

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
apps/api                 平台 API（目前仅 healthz）
apps/gallery             Vue 画廊入口
apps/preview-gateway     静态预览网关（目前仅 healthz）
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

固定 Node 26.13.0、pnpm 12.18.0、Turbo 2.11.10；根 TypeScript 7.0.2。Vue SFC 检查因 vue-tsc/volar 的编译器 API 约束，仅在 gallery 与 Vue example 内固定 TypeScript 6.0.3、vue-tsc 3.3.14。两种编译器均已验证；该兼容例外和官方证据见 [初始化记录](docs/verification/bootstrap.md)。

pnpm 12 的配置放在 `pnpm-workspace.yaml`，包含官方 registry、严格 peer/engine、精确版本及仅允许 esbuild 的安装脚本。`.npmrc` 仅保留 npm 通用配置。所有人使用锁文件安装；新增依赖由 C 收口，不以脚本启动前隐式安装代替冻结安装检查。

build/typecheck 使用本地缓存，dev 不缓存；test、浏览器和 component 命令直接执行。未来消费者、截图、发布、基线接受同样不得缓存。`versions:resolve` 只刷新官方候选发现记录，不更改版本、不证明兼容。

## 开发与分工文档

- [三人分工与必要依赖](docs/superpowers/plans/2026-11-11-three-person-allocation.md)：A SDK、B CLI/画廊、C 平台；前三天任务、依赖图和年底风险。
- [完整实现计划 T01–T17](docs/superpowers/plans/2026-11-11-component-platform-implementation.md)
- [实施评估](component-platform-implementation-assessment.md) / [原始架构](component-platform-architecture.md)
- [本次初始化范围](docs/superpowers/plans/2026-11-11-bootstrap-execution.md)
- [初始化验证](docs/verification/bootstrap.md) / [Turbo 缓存证据](docs/verification/turbo-baseline.md)

下一步是 G1 协议冻结及 G2 基础设施验证，同时开始 T02 与 CLI/消费者设施；不要因骨架通过测试而将整个 T01 标记完成。
