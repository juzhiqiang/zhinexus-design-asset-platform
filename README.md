# Zhinexus 组件资产平台

Zhinexus 用于集中管理、预览、发布和复用企业图表与组件资产。它由三部分组成：面向使用方的公开画廊、供内网运维的管理端与平台 API，以及跑在开发者电脑上的本地 CLI 与工作台。组件以 Vue 3 与 React 19 双框架实现，图表引擎为 ECharts 6，存储使用 PostgreSQL、Verdaccio 与 MinIO。

平台的核心约束是**服务端零执行**：组件构建、依赖安装、自动截图与浏览器验证全部发生在开发者电脑，API 与预览网关只接收和提供已经冻结的预构建产物。

界面实现遵循[前端界面设计规范](design.md)。公开画廊当前的深蓝钛金属视觉风格来自 [gallery.pen](docs/design/gallery.md) 的「介绍首页 · 科技朋克」画板，管理端画板见 [management-api.pen](docs/design/management-api.md)。

## 主要功能

**组件画廊与目录。** 公开画廊提供组件浏览、检索、详情、API 与检查报告查看。公开组件支持匿名隔离预览，无需登录；授权资产库需要有效会话。目录卡片展示对应发布版本与框架的真实截图，优先默认状态，截图不可用时保留目录信息。

**双框架图表 SDK。** 提供折线图、柱状图、饼图、散点图、趋势卡、排行榜和占比图的 Vue/React 实现，由 `@company/charts-core` 承载框架无关的图表核心与兼容策略。

**本地开发工作台。** `juz create/init/dev/preview` 支持从空项目新建或接入已有组件包，覆盖多包索引、React/Vue 切换、源码热更新、参数与数据调试、保存示例及只读冻结预览。本地开发无需登录，也不依赖平台账号。

**发布链路。** `juz package/publish` 在本地完成构建、验证与冻结，由独立 worker 协调 npm 包、预览资源与发布状态；网页入口可导入预构建产物并手动上传截图。已发布版本不可变，冲突与恢复由持久化作业协调。

**组件参数与多场景接入。** 同一份 `api/demo.json` 描述同时服务于普通框架开发、本地工作台、未来的低代码与按标识接入；结构化 schema 与 editor 提示集中在契约中维护，示例只保存值和状态。

**组件查询与装配。** 支持按组件 ID、框架和精确包版本查询，通过显式设计 ID 映射生成装配方案；文本检索用于人工发现候选，不作为精确匹配依据。

**本地工程接入与 MCP。** `component integrate` 提供只读识别、可审查接入计划、受控应用、独立验证、有限修复与恢复；`inspect`/`plan` 不写入目标项目，`apply`/`rollback` 的写入范围只来自本次显式授权。`component mcp serve` 以 stdio 向可信宿主暴露 `inspect_project`、`plan_integration`、`apply_integration`、`verify_integration` 四个工具，其中 apply 与 verify 必须由宿主显式授权，请求自报批准不生效。

**身份与账号。** 支持公司 OIDC 与平台自研身份两种模式。CLI 与网页登录均可使用账号密码、浏览器授权或 Token 三种方式；自托管 JWT 有效期 2 小时，剩余不足 5 分钟时自动续签。自主管理账号栈可自行维护成员、角色、组件与包授权。

## 技术架构

| 模块 | 技术 |
| --- | --- |
| 工程组织 | Monorepo、pnpm workspace、Turborepo |
| 平台画廊 | React 19、Next.js App Router |
| 管理 API 与预览网关 | NestJS、Express |
| 组件 SDK | Vue 3、React 19、ECharts 6 |
| 身份 | 公司 OIDC 或平台自研身份（可接 Keycloak） |
| 存储 | PostgreSQL、Verdaccio、MinIO |

服务端依赖闭包仅包含自身与 `@company/contracts`，不引入图表运行时、画廊、CLI 或示例包。公开包为 `@company/charts-core`、`@company/charts-vue`、`@company/charts-react` 和 `@company/component-cli`；CLI 在构建产物中内联契约校验，公开包运行时不依赖私有契约。画廊与管理端通过 HTTP 与公共契约访问后端。

## 目录结构

```text
apps/api                 身份、上传、目录、基线 API 与独立发布 worker
apps/gallery             公开画廊、组件目录与登录后的授权资产库
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
infra                    本地三存储、自管账号栈与接入检查
docs                     使用、部署、运维与工程文档
design.md                前端界面设计规范
```

CLI 工作区包保持内部名称，通过 `pnpm --filter @company/component-cli pack:juz` 生成独立的 `juz-cli` npm 分发包，可用 `npm install -g <生成的 tgz>` 本地测试；正常安装会自动准备截图所需的 Chromium。实际上传 registry 后才能 `npm install -g juz-cli`；后台导入本地 ZIP 需先解压。

## 本地开发

### 环境要求

Node `>=24.6.0` 与 pnpm `12.18.0`，仓库本轮验证使用 Node `26.13.0`。Windows x64 在仓库根执行：

```powershell
pnpm install --frozen-lockfile
pnpm verify:workspace
pnpm infra:up
pnpm dev:infra-migrate

$env:NEXT_PUBLIC_SITE_URL = 'http://127.0.0.1:5173'
$env:NEXT_PUBLIC_PLATFORM_API_URL = 'http://127.0.0.1:3000'
pnpm build
pnpm dev
```

根 `dev` 通过 `turbo run dev --concurrency=12 --cache=local:rw` 编排 11 个工作区包，先执行上游构建；开发任务不缓存。同一工作区只保留一组开发服务，重新启动前在原终端按 `Ctrl+C` 并等待退出。

### 本机入口

| 入口 | 地址 / 命令 |
| --- | --- |
| 公开画廊 / 授权资产库 | `http://127.0.0.1:5173` / `/library` |
| 内网后台 | `http://127.0.0.1:5177` |
| Vue 示例 | `http://127.0.0.1:5174` |
| React 示例 | `http://127.0.0.1:5175` |
| API 存活检查 | `http://127.0.0.1:3000/healthz` |
| 预览网关存活检查 | `http://127.0.0.1:3001/healthz` |
| 本地工作台 | `http://127.0.0.1:1111` |
| CLI 帮助 | `pnpm component --help` |

自管账号栈使用独立端口：PostgreSQL `25432`、身份服务 HTTPS `29443`。

### 本地身份与发布联调

未显式配置 OIDC 时，API 在非生产且绑定 `127.0.0.1` 的本地模式下使用真实 PostgreSQL 账号、成员权限与接入配置服务。首次启动创建 `admin` / `ZhinexusAdmin!2026`（可用 `PLATFORM_DEV_ADMIN_USERNAME` / `PLATFORM_DEV_ADMIN_PASSWORD` 预先指定），之后账号状态保留，不随重启重置。`PLATFORM_DEV_ADMIN=false` 关闭该入口，生产及 `0.0.0.0` 绑定拒绝启用。数据库凭证缺失时 `pnpm dev` 只发出警告、API 将因拿不到数据库地址而无法工作，`pnpm dev:infra-migrate` 会直接失败；迁移需显式运行。

本地三存储已启动且 `.tools/g2-local/credentials.json` 齐全时，`pnpm dev` 会为 API 配置 PostgreSQL、MinIO 并初始化私有产物桶。发布联调需另开终端运行 `pnpm dev:worker`，该进程独立取得本地 Verdaccio 发布凭证并处理作业。缺少存储凭证时仍可开发其他功能，但启动会提示上传不可用。修改启动配置后须重启开发服务；`healthz` 只表示进程存活，不证明预览资源可读。

若出现 `Port 5175 is already in use`，表示 React 示例端口被占用。用 `Get-NetTCPConnection -State Listen -LocalPort 5175 | Select-Object LocalAddress,LocalPort,OwningProcess` 查询 PID，再用 `Get-Process -Id <PID>` 确认进程并停止旧服务。

### 公开面与内网面分离

画廊原有的 `/upload`、`/jobs/*`、`/match`、`/users`、`/access-settings` 已迁至管理端，同路径在公开画廊返回 404。API 配置 `PLATFORM_GALLERY_ORIGIN` 与 `PLATFORM_ADMIN_ORIGIN` 两个精确来源，两端 `NEXT_PUBLIC_PLATFORM_API_URL` 指向同一 API origin，维持 host-only 会话 Cookie；公网只开放目录、登录与预览必需接口，管理接口按可信网络来源限制。

正式构建画廊时 `NEXT_PUBLIC_SITE_URL` 应设为站点公开 origin，用于 sitemap 与 metadata。仅使用 IPv4 时可为画廊、API 和预览配置不同 HTTPS 端口，见 [IP 分端口部署](docs/guides/preview-ip-port.md)。真实部署还需要 VPN/防火墙、TLS 和源站网络隔离，见 [双入口部署](docs/guides/gallery-admin-deployment.md)。

## CLI 使用

在已有组件项目目录运行。本地开发无需登录；发布前需分配启用分类并通过身份与权限检查。

| 命令 | 用途 |
| --- | --- |
| `juz create <目录> --framework react\|vue\|all` | 创建离线可运行模板 |
| `juz init` | 接入已有组件包，可 `--package` 选择子包 |
| `juz login` | 账号密码、浏览器授权或 Token 登录 |
| `juz dev` | 启动本地工作台（`127.0.0.1:1111`） |
| `juz preview --bundle-dir <目录>` | 只读预览冻结材料 |
| `juz package` | 本地构建、验证冻结产物，生成本地 ZIP |
| `juz publish` | 构建并验证后发布；重试复用已有冻结材料 |
| `component integrate inspect/plan/apply/verify/repair/rollback` | 本地工程只读识别、接入计划、受控应用、验证、有限修复与恢复 |
| `component mcp serve --config <文件>` | stdio MCP 服务 |

三种登录方式：

```powershell
juz login --api-url http://127.0.0.1:3000                       # 终端交互选择
juz login --method password --username <账号>                   # 密码隐藏输入
juz login --method browser                                      # 浏览器授权（S256 PKCE）
juz login --api-url https://api.example.com --token <token>     # 直接使用令牌
```

密码方式首次登录会提示换密；凭证原子写入 `~/.zhinexus`，仅保存验证后的 Token 与 API 地址。HTTP/HTTPS 均可，HTTP 会提示建议使用 HTTPS。

自托管身份签发的 JWT 有效期为 2 小时。CLI 在发布前置检查、上传、轮询、重试及基线等平台请求前检查剩余时间，不足 5 分钟时自动续签并复用新令牌，已保存登录会原子更新。完全过期后重新 `juz login`。外部公司 OIDC 令牌的有效期与续签由其身份源控制，平台不冒签；网页 Cookie 的寿命不超过已验证令牌的剩余有效期。

更多参数与兼容命令见 `juz --help-all`，版本见 `juz --version`。

## 常用验证命令

```powershell
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:browser
```

浏览器测试消费构建后的产物，运行前先执行 `build` 并关闭占用 5173–5177 端口的开发服务；构建与浏览器测试使用相同的 `NEXT_PUBLIC_SITE_URL`。根 `typecheck` 与 `test` 会先构建后端服务。

| 命令（仓库根目录） | 用途 |
| --- | --- |
| `pnpm verify:workspace` | 校验 11 个工作区成员、依赖边界与 Turbo 缓存排除规则 |
| `pnpm verify:docs` | 校验文档死链、失效路径、索引篇数与规则里的版本声明 |
| `pnpm verify:release` | 校验 CHANGELOG 与各包版本一致性及 Git tag 策略 |
| `pnpm build` / `pnpm typecheck` / `pnpm test` / `pnpm test:browser` | 依次执行构建、类型检查、单元与 HTTP 测试、浏览器测试 |
| `pnpm build:services` | 对 API 与预览网关执行构建和类型检查；contracts 经依赖传递先构建 |
| `pnpm test:gallery-cache` | 检查画廊站点域名切换与 sitemap |
| `pnpm test:infra` | 验证三存储读写、权限与备份恢复 |
| `pnpm test:platform` | 自建隔离三存储，验证上传、发布与恢复；需要 Docker 与本机锁定镜像 |
| `pnpm rehearse:backup` / `pnpm rehearse:recovery` | 备份恢复与发布中断恢复演练 |
| `pnpm infra:self-managed:up` / `:stop` / `:credentials` | 启停自管账号栈并查看凭证目录位置 |
| `pnpm preflight:production` | 离线部署模板预检；输出不代表生产可用 |

`build`、`typecheck` 使用本地缓存，画廊和管理端构建输出不进入 Turbo 缓存；测试、消费者安装、截图、发布和基线更新同样不进入 Turbo 缓存。平台测试与浏览器测试应顺序执行，避免重建产物相互影响。

## 发布与运行边界

- 组件构建、示例运行与自动截图在开发者电脑执行；API 与预览网关只接收和提供预构建产物。
- tarball 打包后即冻结，工作区外消费者安装、截图、报告、上传与发布必须绑定同一份产物摘要；产物变化后需重新验证。
- 网页发布要求每个组件的每种框架实现至少关联一张有效手动截图，检查来源强制标记为 `manual-upload`，不得伪造 `local-automatic`。
- 已发布的包与预览资源保持不可变；同名同版本不同摘要报 `CONFLICT` 并失败关闭，发布冲突与恢复由持久化作业协调。
- `Ready` 仅表示包与预览资源可达，检查来源、视觉基线确认与检索索引状态独立维护，不得相互推断。
- 预览通过短期授权在沙箱 iframe 中运行；SSR 宿主仅承诺安全导入与客户端挂载，不提供服务端图表渲染。
- 预览代码不得获取平台凭证或访问管理 API；平台凭证保留在 CLI 侧，不进入页面存储、预览材料或项目子进程环境。

## 自管账号与身份

平台支持两种身份模式：接入公司 OIDC，或使用平台自研身份服务（可再接 Keycloak）。自管账号栈使用独立 Compose 项目、端口与卷，首次启动生成随机凭据、本地 CA 与 IP 证书。本地身份模式（`PLATFORM_IDENTITY_MODE=local`，默认取 `keycloak`）下 `up` 会自动播种首个管理员并失败关闭；Keycloak 模式需在容器起来后执行 `bootstrap`。

```powershell
pnpm infra:self-managed:up                                  # 首次生成凭据；本地身份模式自动播种管理员
pnpm infra:self-managed:bootstrap-local                     # 本地身份模式手动播种
pnpm infra:self-managed:stop
```

成员创建、角色与组件/包授权、停用与恢复均在管理端「成员与权限」完成（部分文档仍沿用旧称「用户与权限」）。停用会立即使已有 Web 会话、CLI token 与预览授权失效，恢复后必须重新登录。恢复只能由部署侧凭保留的凭据与 CA 进行，不提供免认证运维后门。详见[自主管理账号栈与本机试用](docs/guides/self-managed-accounts.md)与[接入设置](docs/guides/access-settings.md)。

## 文档导航

**上手与开发**

- [本地开发与运维准备](docs/guides/quickstart.md)
- [juz 本地工作台实操](docs/guides/juz-workbench.md)
- [组件多场景接入](docs/guides/component-inputs.md)
- [前端界面设计规范](design.md)

**发布与验收**

- [从真实项目发布已有组件](docs/guides/project-publishing.md)
- [发布与恢复操作](docs/guides/publishing.md)
- [上线验收](docs/guides/release-acceptance.md)
- [ECharts 升级与回退](docs/guides/echarts-upgrade.md)

**部署与运维**

- [API 接入说明](apps/api/README.md)、[预览网关说明](apps/preview-gateway/README.md)
- [本地基础设施](infra/README.md)
- [运维说明](docs/guides/operations.md)
- [双入口部署](docs/guides/gallery-admin-deployment.md)、[IP 分端口部署](docs/guides/preview-ip-port.md)
- [自主管理账号栈](docs/guides/self-managed-accounts.md)、[接入设置](docs/guides/access-settings.md)

**契约与工程接入**

- [组件精确查询 API](docs/phases/phase2/component-query-api.md)
- [本地接入计划](docs/phases/phase3/integration-plan.md)、[应用与恢复](docs/phases/phase3/local-project-apply.md)、[验证、有限修复与 MCP](docs/phases/phase3/local-project-verification.md)
- [架构规格](component-platform-architecture.md)与[实施评估](component-platform-implementation-assessment.md)
- [协作规范](AGENTS.md)与[详细工程规则](rules/)

## 版本记录

版本信息与变更记录见 [CHANGELOG.md](CHANGELOG.md)。CLI 版本以 `juz --version` 为准。
