# Zhinexus 组件资产平台

Monorepo + pnpm workspace + Turborepo 组件资产平台。画廊使用 React 19.3.1 + Next.js 16.4.6 App Router，API 与预览网关使用 NestJS 12.4.2；组件侧支持 Vue/React 双框架。现有折线/柱状/饼图 SDK、本地冻结 Bundle 与消费者截图、T05 身份/上传/基线 API，以及 T06 持久化发布 worker。配置并启动独立 worker 后，合法 PENDING 作业可通过三存储校验进入 Ready；未启动 worker 则保留待处理状态。T07 目录/隔离预览后端已提供；当前 SDK 完整 CLI/画廊联调材料及公司 OIDC 等完整验收仍待完成。

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

浏览器测试消费构建后的 `dist`，运行前先 build，并关闭占用 5173–5176 端口的开发服务（5176 用于 React StrictMode 开发态测试）。浏览器安装后可用 `.\scripts\verify.ps1` 顺序重跑全部基础检查。`dev` 同时启动 10 个开发任务，Ctrl+C 停止；Windows 上若停在 shutting down，再按一次 Ctrl+C 结束子任务。其他操作系统可以自行安装同一版本工具链，但尚不在本次验证范围内。

安装脚本支持 Windows 自带的 PowerShell 5.1 非交互执行。修改工具链或下载逻辑后，运行 `.\scripts\verify.ps1 -Bootstrap`：此模式只在独立临时目录中真实下载、校验并探测固定版本，再验证缓存重跑，结束后仅清理该测试目录。此检查需要联网和额外下载，不执行日常安装、构建和测试。

日常 `verify.ps1` 依次执行冻结安装、工作区检查、构建、类型检查、单元/HTTP 测试和浏览器测试；服务构建已由 typecheck/test 的前置步骤覆盖。专项入口按需执行：

| 命令（仓库根目录） | 用途 |
| --- | --- |
| `.\scripts\verify.ps1 -Bootstrap` | 工具链首次下载与缓存重跑 |
| `.\scripts\pnpm.ps1 test:gallery-cache` | 画廊域名切换与 HTTP sitemap 回归，脚本位于 tests/integration |
| `.\scripts\pnpm.ps1 --filter @company/contracts schemas:generate` | 先构建 contracts，再重新生成 JSON Schema；普通 test 检查内容与格式一致性 |
| `.\scripts\pnpm.ps1 versions:resolve` | 刷新官方候选版本报告 |
| `.\scripts\pnpm.ps1 infra:up` / `infra:stop` | 启停隔离本地 PostgreSQL、Verdaccio、MinIO，保留卷和凭证 |
| `.\scripts\pnpm.ps1 test:infra` | 三存储真实写读、权限、精确安装、重启及隔离备份恢复；不缓存 |
| `.\scripts\pnpm.ps1 test:platform` | T05/T06 真 Nest/PG/MinIO/Verdaccio、租约并发、恢复、基线 CAS、真实 SDK 历史材料发布及精确安装；本机执行，不缓存 |
| `.\scripts\pnpm.ps1 --filter @company/platform-api worker` | 独立发布 worker；显式迁移并注入存储/注册表服务凭证后运行，见 API 接入说明 |
| `.\scripts\pnpm.ps1 infra:check-access` | OIDC/独立预览域前置检查；当前缺配置退出 2 |

根 scripts 仅保留工具链安装/调用、统一验证、工作区检查和版本发现。入口迁移与验证见 [脚本整理记录](docs/verification/scripts-maintenance-2026-11-12.md)。

| 入口 | 地址 / 用途 |
| --- | --- |
| 画廊 | `http://127.0.0.1:5173`，空平台入口 |
| Vue 示例 | `http://127.0.0.1:5174`，工作区依赖冒烟 |
| React 示例 | `http://127.0.0.1:5175`，工作区依赖冒烟 |
| API | `http://127.0.0.1:3000/healthz` 存活；`/v1` 接口需配置 OIDC/存储与权限，见 [API 接入](apps/api/README.md) |
| 预览网关 | `http://127.0.0.1:3001/healthz`，仅存活检查 |
| CLI | `.\scripts\pnpm.ps1 component --help`；不支持的业务命令返回非零 |

后端单独构建使用 `.\scripts\pnpm.ps1 build:services`，只含 API、preview-gateway 与 contracts。组件构建、示例运行和截图保持在开发者电脑。根全量 build 用于本地开发，不作为服务端组件执行入口。

## 工作区职责

```text
apps/api                 NestJS 身份/上传/基线 API 与独立 T06 发布 worker
apps/gallery             React 19 + Next.js 16 画廊入口（公开发现页 SSG/ISR，控制台路由预留登录保护）
apps/preview-gateway     NestJS 独立域静态预览网关（短期授权、逐请求撤权与摘要核查）
packages/contracts       私有 V1 运行时契约、错误码、JSON Schema 与合成 fixtures（G1 待 A/B 评审）
packages/charts-core     ECharts 折线/柱状核心
packages/charts-vue       Vue 适配 → core
packages/charts-react     React 适配 → core
packages/component-cli  本地冻结、消费者检查、截图与 Bundle 生成
examples/vue             Vue 工作区示例 → charts-vue
examples/react           React 工作区示例 → charts-react
tests                    基础行为和构建入口的浏览器冒烟
infra                    隔离本地三存储、真实探针与 OIDC/预览域接入检查
```

四个公开包名称沿用 `@company/*`，版本以各自 package.json 为准。examples 消费 workspace 导出；工作区外 tarball 消费与截图由独立测试验证。CLI 内联契约校验，公开包运行时不依赖私有 contracts。

## 工具链与缓存

固定 Node 26.13.0、pnpm 12.18.0、Turbo 2.11.10；根与 React/Next 画廊使用 TypeScript 7.0.2。画廊使用 Next.js 16.4.6 App Router，公开页面可接入 SSG/ISR，上传和发布工作区预留登录后的动态渲染；两个 Nest 应用使用 Nest CLI 12.0.12 与 TypeScript 6.0.3，和 CLI 自带编译器保持一致，启用 decorator metadata。仅 Vue example 的 SFC 检查使用 vue-tsc 3.3.14 + TypeScript 6.0.3；画廊已移除 Vue 工具依赖。当前版本与初始化验证见 [Nest/React 调整记录](docs/verification/nest-react-bootstrap.md) 和 [画廊迁移验证](docs/verification/gallery-next-migration.md)，迁移边界见 [画廊 Next 计划](docs/superpowers/plans/2026-11-11-gallery-next-public-private.md)。

正式构建 gallery 前设置 `NEXT_PUBLIC_SITE_URL` 为站点公开 origin；该值用于 sitemap 和 metadata base，并传入 gallery build。缺少该值时 sitemap 为空。独立运行 build 与浏览器测试时应使用同一环境变量；`verify.ps1` 在未设置时临时使用 `https://gallery.test`，结束后恢复调用者环境。

两个后端均提供 Nest module/controller/service。单独开发执行 `pnpm --filter @company/platform-api dev`，构建后运行 `pnpm --filter @company/platform-api start`；网关替换为 `@company/preview-gateway`。本机请用上述 PowerShell wrapper 替代 `pnpm`。测试加载真实 Nest 编译结果，因此根 `test` 与 `typecheck` 均先执行 `build:services`，确保首次运行时已生成服务代码和类型声明，再执行各自的完整检查。

pnpm 12 的配置放在 `pnpm-workspace.yaml`，包含官方 registry、严格 peer/engine、精确版本及仅允许 esbuild 的安装脚本。`.npmrc` 仅保留 npm 通用配置。所有人使用锁文件安装；新增依赖由 C 收口，不以脚本启动前隐式安装代替冻结安装检查。

build/typecheck 使用本地缓存，dev 不缓存；gallery build 暂不使用 Turbo 输出缓存，避免恢复输出时残留旧域名的 Next 运行时 route-cache。可通过 `.\scripts\pnpm.ps1 test:gallery-cache` 验证 A→B→A 域名切换与当前配置的实际 HTTP sitemap。test、浏览器和 component 命令直接执行。未来消费者、截图、发布、基线接受同样不得缓存。`versions:resolve` 只刷新官方候选发现记录，不更改版本、不证明兼容。

## 开发与分工文档

- [三人分工与必要依赖](docs/superpowers/plans/2026-11-11-three-person-allocation.md)：A SDK、B CLI/画廊、C 平台；前三天任务、依赖图和年底风险。
- [完整实现计划 T01–T17](docs/superpowers/plans/2026-11-11-component-platform-implementation.md)
- [实施评估](component-platform-implementation-assessment.md) / [原始架构](component-platform-architecture.md)
- [本次初始化范围](docs/superpowers/plans/2026-11-11-bootstrap-execution.md)
- [当前 Nest/React 验证](docs/verification/nest-react-bootstrap.md)
- [迁移前初始化验证](docs/verification/bootstrap.md) / [迁移前 Turbo 缓存证据](docs/verification/turbo-baseline.md)
- [独立审查与实施决定](docs/verification/bootstrap-review.md)

2026-11-12：C 已补齐 G1 运行时结构/关联与冻结字节校验、错误码、示例接口、API 消息及合成 fixtures。调用与边界见 [contracts README](packages/contracts/README.md)，命令见 [G1 验证记录](docs/verification/g1-contracts-2026-11-12.md)。G1 仍待 A/B 于 **2026-11-13** 前实际评审回执；G2 五项责任和计划日期见 [评审与接入清单](docs/superpowers/plans/2026-11-12-g1-review-g2-access.md)。

本轮 C 已收口可选 `ComponentExample.states` 与权威 `requiredStates` 清单，并完成本地三存储真实探针，启动方式见 [infra README](infra/README.md)，结果见 [新增验证记录](docs/verification/g2-local-infra-2026-11-12.md)。按用户确认，OIDC 与独立预览域尚未配置，G2/T01 保持开放；本地探针与合成 fixtures 不代替完整组件发布、截图或生产验收。

2026-11-12 T07 C：已交付公开/用户态目录、精确releaseId详情/报告/材料、一次性preview grant和独立静态网关。本地完整回归521普通测试、62真实平台测试、71浏览器测试通过，独立审查问题已修复。接口与部署见 [API](apps/api/README.md)、[网关](apps/preview-gateway/README.md)，证据见 [T07 C验证](docs/verification/t07-catalog-preview-2026-11-12.md)。完整T07/G2/M2仍需公司OIDC、生产独立域和B的真实画廊/八实现联调。

## C 平台运维交付

T07目录/预览后端已合入main；本轮提供脱敏日志、持久化指标、故障演练、三存储隔离备份恢复、部署检查与保留策略。入口与边界见 [quickstart](docs/quickstart.md)、[operations](docs/operations.md)、[release-acceptance](docs/release-acceptance.md)。完整G2/M2/T11/T12仍待公司环境及真实试点验收。

2026-11-13：增加 `.\scripts\pnpm.ps1 rehearse:capacity`，在本机真实三存储上量测200组件/400实现的合成目录、20并发读取、总量100MiB分片恢复及5次协议发布。报告按runId写入 `.tools/operations/capacity/`，失败退出非零；不能替代生产容量或业务试点验收。当前SDK十实现的冻结发布、双框架精确安装与逐资源摘要检查，以及网页手动提交后端交接见 [C本轮验证](docs/verification/c-platform-capacity-2026-11-13.md)。
