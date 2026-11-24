# Zhinexus 组件资产平台

Zhinexus 用于集中管理、预览、发布和复用企业图表与组件资产，提供组件画廊、Vue/React 双框架 SDK、本地 CLI，以及发布与静态预览服务。

可编辑 pen.dev 设计稿分为两个独立文件：[管理控制台](docs/design/management-api.md)（六张桌面画板）与 [组件画廊](docs/design/gallery.md)（四张桌面画板及预览，含科技朋克风介绍首页概念稿）。

## 主要功能

- **组件画廊**：浏览和检索组件，查看组件详情、API、检查报告与隔离预览。
- **双框架 SDK**：提供折线图、柱状图、饼图、散点图、趋势卡、排行榜和占比图的 Vue/React 实现。
- **资产发布**：支持 CLI 提交冻结 Bundle，以及网页上传预构建产物和手动截图；由独立 worker 协调包、预览资源与发布状态。
- **组件查询与装配**：按组件 ID、框架和精确包版本查询，通过显式设计 ID 映射生成装配方案；文本检索用于人工发现候选。
- **本地项目接入**：支持工程识别、接入计划、受控应用与恢复、本地验证、有限修复和 stdio MCP。

## 技术架构

| 模块 | 技术 |
| --- | --- |
| 工程组织 | Monorepo、pnpm workspace、Turborepo |
| 平台画廊 | React、Next.js App Router |
| 管理 API 与预览网关 | NestJS、Express |
| 组件 SDK | Vue 3、React 19、ECharts 6 |
| 存储 | PostgreSQL、Verdaccio、MinIO |

## 目录结构

```text
apps/api                 身份、上传、目录、基线 API 与独立发布 worker
apps/gallery             公开画廊与登录后的授权资产目录
apps/admin               内网发布、任务、账号和配置管理端
apps/preview-gateway     短期授权的静态预览网关
packages/contracts       私有运行时契约、错误码与 JSON Schema
packages/charts-core     图表核心与兼容策略
packages/charts-vue      Vue 适配
packages/charts-react    React 适配
packages/component-cli   本地构建、冻结、检查、截图与工程接入工具
examples/vue             Vue 工作区示例
examples/react           React 工作区示例
tests                    单元、集成、消费者与浏览器测试
infra                    本地存储环境与接入检查
docs                     使用、部署、运维与工程文档
```

公开包为 `@company/charts-core`、`@company/charts-vue`、`@company/charts-react` 和 `@company/component-cli`。CLI 内联契约校验，公开包运行时不依赖私有 `@company/contracts`。画廊通过 HTTP 和公共契约访问后端。

## 本地开发（Windows x64）

在仓库根目录直接使用系统安装的 Node `>=24.6.0` 与 pnpm `12.18.0` 执行以下命令：

```powershell
pnpm install --frozen-lockfile
pnpm verify:workspace

$env:NEXT_PUBLIC_SITE_URL = 'http://127.0.0.1:5173'
$env:NEXT_PUBLIC_PLATFORM_API_URL = 'http://127.0.0.1:3000'
pnpm build
pnpm dev
```

开发服务使用以下本机入口：

| 入口 | 地址 / 命令 |
| --- | --- |
| 公开画廊 / 授权资产库 | `http://127.0.0.1:5173` / `/library` |
| 内网后台 | `http://127.0.0.1:5177` |
| Vue 示例 | `http://127.0.0.1:5174` |
| React 示例 | `http://127.0.0.1:5175` |
| API 存活检查 | `http://127.0.0.1:3000/healthz` |
| 预览网关存活检查 | `http://127.0.0.1:3001/healthz` |
| CLI 帮助 | `pnpm component --help` |

根 `dev` 通过 `turbo run dev --concurrency=12 --cache=local:rw` 编排 11 个工作区包，先执行上游构建；开发任务不缓存。同一工作区只保留一组开发服务，重新启动前在原终端按 `Ctrl+C` 并等待退出。

若出现 `Port 5175 is already in use`，表示 React 示例端口已被占用。用 `Get-NetTCPConnection -State Listen -LocalPort 5175 | Select-Object LocalAddress,LocalPort,OwningProcess` 查询 PID，再用 `Get-Process -Id <PID>` 确认进程，在对应终端停止旧服务。其他开发端口同理。排查与实测见 [开发启动验证](docs/verification/2026-11-24-dev-startup.md)。

API 的业务接口需要配置 OIDC、存储和访问权限；完整联调还需启动独立发布 worker。配置与启动方式见 [API 接入说明](apps/api/README.md)、[预览网关说明](apps/preview-gateway/README.md) 和 [本地基础设施](infra/README.md)。

正式构建画廊时，`NEXT_PUBLIC_SITE_URL` 应设置为站点公开 origin，用于 sitemap 与 metadata；`NEXT_PUBLIC_PLATFORM_API_URL` 应指向管理 API，API 需允许画廊的精确 Origin。仅使用 IPv4 时，可以为画廊、API 和预览配置不同 HTTPS 端口，见 [IP 分端口部署](docs/guides/preview-ip-port.md)。

画廊原有的 `/upload`、`/jobs/*`、`/match`、`/users`、`/access-settings` 已迁至管理端，同路径在公开画廊返回 404。API 配置 `PLATFORM_GALLERY_ORIGIN` 与 `PLATFORM_ADMIN_ORIGIN` 两个精确来源。两端的 `NEXT_PUBLIC_PLATFORM_API_URL` 指向同一 API origin，维持 host-only 会话 Cookie；公网只开放目录、登录与预览必需接口，管理接口按可信网络来源限制。真实部署需要 VPN/防火墙、TLS 和源站网络隔离，见 [双入口部署](docs/guides/gallery-admin-deployment.md)。

## 常用验证命令

```powershell
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:browser
```

浏览器测试消费构建后的产物，运行前先执行 `build`，并关闭占用 5173–5177 端口的开发服务。构建和浏览器测试使用相同的 `NEXT_PUBLIC_SITE_URL`。根 `typecheck` 与 `test` 会先构建后端服务。

| 命令（仓库根目录） | 用途 |
| --- | --- |
| `.\scripts\verify.ps1` | 顺序执行冻结安装、工作区检查、构建、类型检查、单元/HTTP 测试与浏览器测试 |
| `.\scripts\verify.ps1 -Bootstrap` | 在隔离临时目录验证工具链首次下载、校验与缓存重跑 |
| `pnpm build:services` | 仅构建 API、预览网关及 contracts |
| `pnpm test:gallery-cache` | 检查画廊站点域名切换与 sitemap |
| `pnpm infra:up` / `pnpm infra:stop` | 启停本地 PostgreSQL、Verdaccio 与 MinIO |
| `pnpm test:infra` | 验证三存储读写、权限与备份恢复 |
| `pnpm test:platform` | 自建隔离三存储，验证上传、发布与恢复；需要 Docker 和本机锁定镜像 |

`build`、`typecheck` 使用本地缓存，画廊和管理端构建输出不进入 Turbo 缓存；测试、消费者安装、截图、发布和基线更新不进入 Turbo 缓存。平台测试与浏览器测试应顺序执行，避免重建产物相互影响。

## 发布与运行边界

- 组件构建、示例运行和自动截图在开发者电脑执行；API 与预览网关只接收和提供预构建产物。
- tarball 打包后冻结，工作区外消费者安装、截图、报告、上传与发布必须绑定同一份产物摘要；产物变化后需重新验证。
- 网页发布要求每个组件的每种框架实现至少关联一张有效手动截图，检查来源标记为 `manual-upload`。
- 已发布的包与预览资源保持不可变，发布冲突及恢复由持久化作业协调。
- `Ready` 仅表示包与预览资源可达，检查来源、视觉基线确认和检索索引状态独立维护。
- 预览通过短期授权在沙箱 iframe 中运行；SSR 宿主仅支持安全导入与客户端挂载。

## 文档导航

- [本地开发与运维准备](docs/guides/quickstart.md)
- [发布与恢复操作](docs/guides/publishing.md)
- [运维说明](docs/guides/operations.md)与[上线验收](docs/guides/release-acceptance.md)
- [组件精确查询 API](docs/phases/phase2/component-query-api.md)
- [本地接入计划](docs/phases/phase3/integration-plan.md)、[应用与恢复](docs/phases/phase3/local-project-apply.md)、[验证、有限修复与 MCP](docs/phases/phase3/local-project-verification.md)
- [ECharts 升级与回退](docs/guides/echarts-upgrade.md)
- [架构规格](component-platform-architecture.md)与[实施评估](component-platform-implementation-assessment.md)
- [协作规范](AGENTS.md)与[详细工程规则](rules/)

## 版本记录

版本信息与变更记录见 [CHANGELOG.md](CHANGELOG.md)。
