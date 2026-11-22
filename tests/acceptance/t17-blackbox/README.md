# T17 冻结 CLI / MCP 黑盒验收

本目录只从仓库外安装冻结的 `@company/component-cli` tarball，再以独立 Node 子进程驱动 `dist/bin.js`。测试不导入 CLI 源码，不使用 `workspace:` 链接或源码 alias。冻结 tarball 在安装前、用例间与结束时校验同一 SHA-256；npm 安装禁用生命周期脚本，并使用空白用户/全局 npm 配置。

当前工作树还包含安装包身份校验、receipt 规范化/敏感字段保护、冻结 tarball SHA-256 / semver / npm CLI 路径 preflight、`verify` / `repair` 缺少输入时拒绝、MCP stdio 工具清单及 CLI/MCP `inspect` 对照用例。安装时会从冻结 tarball 核对 `package/package.json` 和 `package/dist/bin.js`，并要求 npm 安装后的入口字节与 tarball 内入口完全一致；每个用例结束也会复核 tarball 与已安装入口摘要。支架回归和输入校验可独立运行；产品用例需提供真实冻结包及固定 Node/npm 工具链。
集成用临时项目和 npm 冻结包消费者仅在仓外创建；测试结束时，只有真实路径与本次 `.t17-owner.json` 标记都匹配才清理。独立证据目录保留用于审查。

目录包含两个独立入口：原有 `vitest.config.ts` 保留安装、合成契约和边界探针；新增 `live-vitest.config.ts` 使用真实本地 PostgreSQL / Verdaccio / MinIO / API 和有效宿主 grant，验证冻结 CLI 的实际接入、浏览器行为、视觉、MCP 取消及 CLI/MCP 语义对照。两个入口的证据范围应分别报告。

## 真实本地成功链：live 入口

`live.spec.ts` 的五个用例为 Vue × CLI、Vue × MCP、React × CLI、React × MCP 四条独立成功链，以及四链语义对照。它从仓库外目标工程启动已安装 CLI；MCP 使用真实 `@modelcontextprotocol/client` SDK 和 stdio transport，调用 `inspect_project`、`plan_integration`、`apply_integration`、`verify_integration`，不导入 CLI 产品源码。实际覆盖如下：

- 四条链均从真实本地 API 获取已发布实现和已接受的兼容记录，以独立的 LineChart API/MatchPlan 字面量校验后实际安装依赖、生成模块、执行原生类型检查和构建，并在本地 Chromium 对真实 SVG 数据点点击一次、核对事件计数。
- 视觉基线来自同一外部消费者内单独直接导入 SDK 的参考页；生成页另行观察。浏览器加载字节、构建产物 SHA-256、source map 和模块图共同证明参考页未导入生成模块、生成页确实导入了它；报告五类检查、依赖守卫、精确版本、环境和视觉 PASS 均另作断言。
- Vue/React 各有真实行为反例（预期事件数设为 2，实际为 1）；断言失败后修复因没有合法 recipe 停止且源码不变。MCP 对实际有效 plan/spec 的无 grant apply/verify 请求必须拒绝且源码不变。该反例不表示已覆盖全部修复分类或有界自动重试。
- 真实 MCP SDK AbortSignal 发送 `notifications/cancelled`，观察原生 Node 父、子、孙三个标记进程及实际父子关系，断言它们在关闭 MCP 服务前均已退出；随后服务仍能 `listTools` / `inspect` 且协议无错误。它直接证明这三个进程的退出，不扩写为逐一观察所有 npm/cmd 中间进程。
- 四链对照独立核对生成源码摘要、依赖、改动、检查和环境语义；npm 生命周期标记始终不存在。每条链与附加拒绝、反例、取消、对照结果分别保存带摘要 receipt。

前置为固定 Windows Node `26.13.0` / npm `11.20.0`、项目包装器 pnpm `12.18.0`、可用 Docker Desktop、本地 Playwright Chromium 与已构建的服务产物。`prepareT17LocalServices` 每轮创建新的 owner 标记与 Docker label，真实发布同一冻结 SDK，使用本地签名 OIDC 身份，经真实 `/compatibility` API 接受**原样历史真实探针**并返回新的兼容记录 ID；manifest 的 `reportId` 不能冒充已接受记录。历史探针日期为 2026-11-16，来自当时安装的 CLI `0.0.11`，其类型/构建/SSR 和 56 张 PNG 均校验，绝不标为本轮 CLI 新生成的探针。

以下命令复用已冻结产物，不执行 pack。live 当前固定 SDK manifest SHA-256 为 `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`，更换 SDK 必须重新建立证据，不能仅修改摘要使测试通过。缺少任一输入、工具、浏览器或 Docker 都应失败，不能 skip。`scripts/pnpm.ps1` 配置本地浏览器目录；直接调用 Vitest 时必须另行设置 `PLAYWRIGHT_BROWSERS_PATH`。

```powershell
.\scripts\pnpm.ps1 build:services
$freeze = Get-Content .tools/sdk-label-acceptance-8929ffb81fcf4c90b98352c5f8afbed1/sdk-freeze.json -Raw | ConvertFrom-Json
$env:T17_D_SDK_BUNDLE = $freeze.root
$env:T17_D_COMPATIBILITY_EVIDENCE = (Resolve-Path .tools/sdk-label-acceptance-8929ffb81fcf4c90b98352c5f8afbed1/adopt/probe-evidence-adopt.json).Path
$env:T17_D_COMPATIBILITY_SHA256 = 'c61820814884126a3b8869b69079c7b3c286afd5e26acdd282b94f749c159cc7'
$env:T17_D_CLI_TARBALL = 'D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/cli-0.0.20-b8cafdf7-dc09-424a-bcc4-f36023f7916d/company-component-cli-0.0.20.tgz'
$env:T17_D_CLI_SHA256 = '8d56d87e9cc832562c096ba8cd16504ffb5104e688ca8a3df9436447df6c4252'
$env:T17_D_CLI_VERSION = '0.0.20'
$env:T17_D_NPM_CLI = (Resolve-Path '.tools/node-v26.13.0-win-x64/node_modules/npm/bin/npm-cli.js').Path
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/acceptance/t17-blackbox/live-vitest.config.ts')
```

服务/历史兼容证据前置可独立运行；该入口只需要上述 `T17_D_SDK_BUNDLE`、`T17_D_COMPATIBILITY_EVIDENCE`、`T17_D_COMPATIBILITY_SHA256`：

```powershell
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/acceptance/t17-blackbox/live-prerequisites-vitest.config.ts')
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/acceptance/t17-blackbox/live-unit-vitest.config.ts')
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/acceptance/t17-host/local-services.test.ts')
```

2026-11-20 本轮冻结 CLI `0.0.20` 的完整 live 为 **5/5 passed**（405.72 秒，exit 0）；同一冻结包的 legacy 安装与边界入口为 **5/5 passed**（70.66 秒，exit 0）。本轮 support 为 **7/7 passed**、preflight 为 **4/4 passed**、live 支持单测为 **2/2 passed**。四条真实链的 spec 均使用既定 `maxDiffPixelRatio=0.001`、`pixelThreshold=0.1`，验证结果均为 passed、视觉均为 PASS。完整命令、输入与边界见 [本轮独立记录](../../../docs/verification/phase3-t17.md)。稳定归档为：

```text
D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/blackbox-live-0.0.20-4c17068513014bbb9c596a3b0da01177
D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/blackbox-installed-0.0.20-8e254e018b2540e78599701c7f4ae9dd
```

live 归档保留 12 份 receipt、四链输出及图片、运行日志、退出码与最终清理记录。原/复制 receipt、spec 基线、报告引用产物和 SDK manifest 中全部 199 个文件均重新打开校验摘要与字节；包含 audit 自身的 148 个文本文件 JWT 形态扫描为 0 命中。legacy 归档的 5 份 receipt 同样复核，11 个文本文件扫描为 0 命中。live cleanup 为 passed、cleanupFailures 为 0，四条链齐备；本轮临时工程、安装 CLI 与 recovery 根已移除，按本轮 owner label 独立检查残留容器/卷均为 0。没有手动清理旧失败根。两入口只证明各自注明的范围，不能合计为更多成功接入链。

以下保留此前 `.19` 的历史记录；该轮显式视觉阈值为 `0.002`，不能替代上述 `.20` 在 `0.001` 下的本轮结果。

2026-11-20 实测冻结 CLI `0.0.19` 的完整 live 为 **5/5 passed**（607.06 秒，exit 0）；独立服务前置为 **1/1 passed**，live 支持单测 **2/2 passed**，本地服务单测 **6/6 passed**。稳定、已复核摘要的证据在仓库外：

```text
D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/blackbox-live-0.0.19-ff3e14e7-d6b6-46bd-93cf-c26971fb6a89
```

保留 `files/` 内 12 份独立 receipt、四链输出与图片、`live-receipts.json`、`live-final-cleanup.json` 和 `retained-evidence-audit.json`。本轮 audit 已重验原/复制 receipt、冻结 CLI 和 SDK 199 个文件；证据复制排除 npm 缓存及配置，145 个保留文本文件的 JWT 形态扫描为 0 命中。cleanup 为 passed，四链齐备、cleanupFailures 为 0，临时工程与安装 CLI 已删除，按本轮 label 独立复查残留容器/卷均为 0。每次新运行仍必须检查本轮 cleanup，而不能引用这次结果替代。

该成功只表示本地合成业务工程、隔离基础设施、本地签名 OIDC 和指定冻结包的可复核验收；不代表公司/生产 OIDC、生产 G2、真实业务项目接入、全部修复策略或 T17 整体已完成。服务端只校验、存储和发布预构建产物；构建、浏览器和截图均在开发机执行。

## Legacy 安装与边界入口

`installed.spec.ts` 的 MCP 无授权用例使用 contracts 校验过的 plan、apply result、verification spec，确认拒绝码和拒绝前后项目快照一致；`plan_integration` 用例调用未许可 endpoint 并断言 `ENDPOINT_NOT_ALLOWED`，保存 D05 证据。这些保留为合成契约与边界探针，单独通过不代表真实接入成功。

在 PowerShell 中先构建服务端测试所需的本地产物，然后显式设置冻结输入：

```powershell
.\scripts\pnpm.ps1 build:services
$env:T17_D_CLI_TARBALL = 'D:\artifacts\company-component-cli.tgz'
$env:T17_D_CLI_SHA256 = '<冻结 tarball 的 SHA-256>'
$env:T17_D_CLI_VERSION = '<冻结 tarball 中的精确版本>'
$env:T17_D_NPM_CLI = 'D:\tools\node-v26.13.0-win-x64\node_modules\npm\bin\npm-cli.js'
.\scripts\pnpm.ps1 exec vitest run --config tests/acceptance/t17-blackbox/vitest.config.ts
```

调用者应先完成 `pnpm pack`，计算摘要后冻结该文件；验收期间不得重新打包或替换 tarball。套件要求 Node `26.13.0` 与该 Node 发行版内的 npm `11.20.0`，global setup 核验包摘要、包版本和工具路径；缺失输入直接失败，不允许 skip。此 legacy 入口不会启动 PostgreSQL、Verdaccio 或 MinIO，其通过结果只覆盖上述安装与边界用例。测试临时工程和证据必须创建在仓库外。

支架本身可在不启动服务的情况下验证：

```powershell
.\scripts\pnpm.ps1 exec vitest run --config tests/acceptance/t17-blackbox/support.vitest.config.ts
.\scripts\pnpm.ps1 exec vitest run --config tests/acceptance/t17-blackbox/preflight.vitest.config.ts
```
