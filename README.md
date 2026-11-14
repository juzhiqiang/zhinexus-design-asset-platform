# Zhinexus 组件资产平台

Monorepo + pnpm workspace + Turborepo 组件资产平台。画廊使用 React 19.3.1 + Next.js 16.4.6 App Router，API 与预览网关使用 NestJS 12.4.2；SDK 提供折线、柱状、饼图、散点、趋势卡、排名和占比共 14 个 Vue/React 实现。已有冻结 Bundle、消费者截图、网页手动发布、身份/上传/基线 API、持久化发布 worker 与隔离静态预览。合法 PENDING 作业须由独立 worker 通过三存储校验后进入 Ready。

2026-11-14：本地平台专项改为每轮自建随机端口和凭据的三存储环境，无需启动共享 G2。当前 SDK 0.0.10 与画廊手动发布已有本地真实证据；公司 OIDC、生产独立预览域、真实 Vue/React 业务试点仍未验收，不能据此宣布完整 G2/T10/T11/T12 或生产就绪。下一轮分工和集成门槛见 [执行计划](docs/superpowers/plans/2026-11-13-next-round-execution.md)。

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
| `.\scripts\pnpm.ps1 test:platform` | 自建并清理独立三存储，验证 Nest 上传/发布、租约并发、恢复、基线 CAS、SDK 发布和精确安装；需 Docker 与本机锁定镜像，不缓存 |
| `.\scripts\pnpm.ps1 test:t10` | 本地兼容探针的 Node 回归测试；根 `test` 同时执行，不进入 Turbo 缓存 |
| `.\scripts\pnpm.ps1 probe:t10 --bundle <冻结目录> --echarts <精确版本>` | 在工作区外消费者运行双框架类型、构建、SSR、浏览器和视觉探针；无同环境基线时保持 hold |
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

本地 CLI 支持 `component echarts check --bundle <冻结目录> --version <精确版本>` 查询候选，也可用 `--latest`；`component echarts verify` 调用本地兼容探针，只有证据与本次冻结包和候选一致、双框架四维检查齐全时才建议采用。首次无基线的截图留作人工审查输入，复验时通过 `--baseline <证据JSON>` 显式指定；程序退出 0 不替代报告中的 `recommendation`。`check --registry offline` 仅查询冻结支持矩阵，不证明候选来源或实际兼容。当前 `verify` 默认读取工作区 `tests/acceptance/t10-sdk/probe.mjs`，独立安装 CLI 的探针分发尚未验收；可用 `--probe-entry` 指定已有工作区入口。探针不改 SDK peer、不重新 pack 冻结包、不写线上兼容记录。

验收冻结兼容策略时显式设置 `A10_FROZEN_BUNDLE` 为与 `--bundle` 相同的权威目录，再运行 `test:t10` 或根 `test`。没有提供真实冻结目录时，依赖该目录的策略用例明确跳过，不以合成策略替代，也不计为冻结兼容验收通过。完整消费者与浏览器测量仍由 `probe:t10` / `component echarts verify` 执行。

## 工作区职责

```text
apps/api                 NestJS 身份/上传/基线 API 与独立 T06 发布 worker
apps/gallery             React 19 + Next.js 16 画廊入口（公开发现页 SSG/ISR，控制台路由预留登录保护）
apps/preview-gateway     NestJS 独立域静态预览网关（短期授权、逐请求撤权与摘要核查）
packages/contracts       私有 V1 运行时契约、错误码、JSON Schema 与合成 fixtures（G1 待 A/B 评审）
packages/charts-core     ECharts 七类组件核心与兼容策略
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

2026-11-13 后续补验：SDK0.0.6 七组件十四实现已完成 Windows 冻结发布、真实 HTTPS 预览自检、逐材料摘要及 Vue/React 精确 Registry 消费，见 [十四实现验收](docs/verification/c-sdk14-acceptance-2026-11-13.md)。测试支撑支持隔离随机端口设施；共享凭据缺失导致旧完整平台套件仍阻塞，B 的真实网页流程和生产验收继续单列。

2026-11-13 网页联调修复：API 复用 `PLATFORM_GALLERY_ORIGIN` 精确放行画廊的 Bearer/JSON/幂等键跨域请求，配置要求见 [API接入](apps/api/README.md)，RED/GREEN 与边界见 [跨域验证](docs/verification/c-gallery-cors-2026-11-13.md)。MinIO直传与B真实浏览器闭环仍单独验收。

2026-11-13 A SDK 0.0.7 接续：C 已在 Windows 对固定 `f35ebc9` 完成强制构建/类型、外部消费者、67 项展示/核心浏览器及十四实现隔离发布复验，冻结摘要与证据见 [新增原生记录](docs/verification/c-a-sdk007-windows-2026-11-13.md)。兼容策略的三个独立审查问题仍待 A 修复，未标记 T10 完成。

2026-11-13 A SDK 0.0.10 复审收口：C 对固定 `190b60b` 完成 20 项强制构建/类型、379 项单元与契约、十四实现真实发布/HTTPS 预览与双框架精确 Registry 消费；同一冻结包的 TS 6/7 × Bundler/NodeNext 严格消费者及六项公开策略检查全部通过。脚本、摘要、RED/GREEN 与边界见 [0.0.10 原生记录](docs/verification/c-a-sdk0010-windows-2026-11-13.md)。完整 T10、网页流程与外部门槛继续独立验收。

2026-11-13 接续浏览器验证：C 在同一 `190b60b` Windows 归档实跑 185 项全部通过，含十四实现和 56 项主题/渲染器矩阵。结果与范围见 [浏览器新增记录](docs/verification/c-a-sdk0010-browser-2026-11-13.md)；不替代 B 最终网页流程、跨版本视觉或真实业务试点验收。

2026-11-13 C 根测试接续：CLI 发布集成测试改用自有随机端口三存储，消除缺共享凭据的唯一失败；专项通过后根 test 实跑 33 文件/600 项通过。RED/GREEN、清理与边界见 [隔离复验](docs/verification/c-cli-release-isolation-2026-11-13.md)。

2026-11-13 SDK 文档交接：A 修正 SSR 挂载、真实导出与静态类型/运行时边界后，C 原样提取 Vue/React 示例，在真实安装冻结 0.0.10 tarball 的干净消费者中完成六组严格编译。固定摘要、验证方式与未完成边界见 [文档独立复验](docs/verification/c-a-sdk0010-handover-2026-11-13.md)。
