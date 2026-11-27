# 本地三存储与接入检查（C / T01 / G2）

当前没有公司 OIDC 和生产独立预览域。三存储、业务迁移及发布状态机已有本地验证，完整 G2 与生产验收仍开放。历史接入计划见 [G1/G2 清单](../docs/plans/2026-11-22-g2-access-acceptance.md)，早期设施证据见 [本地设施验证](../docs/verification/gates-infra.md)。

2026-11-22 新增 [G2 五项逐项实测记录](../docs/verification/gates-infra.md)：隔离本机三存储三轮完成真实写读、权限、精确安装、进程重启与恢复，OIDC/目标预览仍未配置。共享凭证缺失时可通过 `exec vitest run --config tests/platform/vitest.config.ts tests/platform/g2-storage-acceptance.test.ts` 创建自有隔离环境验收，须先执行 `build:services`，不会改动共享 Compose 数据。每轮脱敏报告位于 `.tools/operations/g2-acceptance/<runId>/report.json`，同目录 `.npmrc` 含消费凭证，不得整体分享。

暂无公司资源时，可先运行 `pnpm preflight:production` 完成离线模板预检。报告列出缺失变量与外部待验收项，始终 `productionAcceptance:false`；资源缺失的报告退出码为 2，pnpm 包装的外层退出码为 1。配置齐全后加 `--environment` 校验实际环境变量；该命令仍不发出网络请求。两个服务导出后运行 `verify:service-staging <staging>` 检查实际发布材料。完整命令、退出码和适用边界见 [运维部署准备](../docs/guides/operations.md#部署准备)。

## 独立平台专项（2026-11-14）

`test:platform` 和 `rehearse:recovery` 通过 Vitest global setup 创建带唯一所有权标签的 `RecoveryStack`，使用随机回环端口和随机凭据。服务配置通过 Vitest 内存上下文传入 worker；未注入时直接失败，不读取共享 `.tools/g2-local/credentials.json`。测试结束验证容器/卷所有权后清理自有资源；`rehearse:backup` 的源/目标也各自独立。共享 Compose 数据不参与这些测试。测试中模拟的 OIDC 与预览域不能替代真实接入。

干净工作树缺少 `.tools/g2-local/images.json` 时，只探测 `versions.json` 指定的本机 MinIO 标签，核对 `linux/amd64` 及源码 revision、release、source 标签，然后以不可变 image ID 原子登记。已有登记优先使用且同样核查；坏登记或不匹配镜像失败关闭，不覆盖已有记录。此检查核对本机镜像元数据，不是供应链签名证明。缺少镜像时先执行 `infra:up` 构建锁定源码；这一步会启动共享本地设施，平台专项本身不会隐式执行它。

```powershell
pnpm test:platform
pnpm rehearse:recovery
pnpm rehearse:backup
```

## 启动与验证

要求 Windows x64、Docker Desktop 的 Linux 容器、项目固定工具链和冻结依赖。首次构建需访问 Docker Hub、GitHub codeload 与 Go 模块源，可能耗时数分钟。

```powershell
pnpm install --frozen-lockfile
pnpm infra:up
pnpm test:infra
pnpm infra:check-access
# 需要停止时执行；保留数据和凭证
pnpm infra:stop
```

| 设施 | 本机地址 | 固定版本 / 用途 |
| --- | --- | --- |
| PostgreSQL | `127.0.0.1:15432` | 18.6；用户和库均为 `zhinexus` |
| Verdaccio | `http://127.0.0.1:14873` | 7.1.0；`g2publisher` 写入，`g2reader` 只读 |
| MinIO | `http://127.0.0.1:19000` | RELEASE.2025-10-15T17-29-55Z；S3 API，关闭控制台 |

启动仓库开发服务时运行根目录 `pnpm dev`。它会在未显式设置 `PLATFORM_DATABASE_URL` 时，从 `.tools/g2-local/credentials.json` 为本地 API 注入 PostgreSQL 连接配置；没有显式 S3 变量且 `minioUser` / `minioPassword` 齐全时，同时接入本地 MinIO 并初始化私有桶 `zhinexus-local-artifacts`。仅有数据库凭证时仍可启动其他开发任务，但会警告上传不可用；部分 MinIO 凭证则直接报错。显式环境变量优先，部分 S3 配置也不会与本地密钥混用；生产环境不自动读取本地存储凭证。新数据库需要迁移时，先执行 `pnpm dev:infra-migrate`，再启动开发服务。迁移仍是显式操作，不会随 `infra:up` 或 API 启动自动执行。

发布联调另开终端运行 `pnpm dev:worker`，复用同一数据库、桶和本地注册表；本地自动登录还需原 `publisherPassword`，也可显式提供注册表地址和 token。发布 token 仅在独立 worker 的进程环境中使用，不打印、不保存，也不传给前端。worker 需要已有的服务编译产物。API 健康接口正常不代表存储已接入或 worker 已启动；修改启动配置后需要重启原开发进程。

若现有 Compose 数据卷仍在但 `.tools/g2-local` 凭证缺失或不完整，请从受保护备份恢复原凭证。`infra:up` 会为避免覆盖已有数据而拒绝生成新凭证；不要给旧服务生成替代密码，也不要删除或重建数据卷来绕过该检查。无法恢复时，另建不同端口与数据卷的隔离测试设施，并显式配置对应的 S3 与注册表变量。

所有端口仅绑定回环地址；Compose 项目固定为 `zhinexus-g2`，三个命名卷独立于其他项目。命令只启动、重启或停止本项目，不删除卷。PostgreSQL/MinIO 管理凭证仅供本地设施探针，后续 API 业务账号和最小权限需在 T05 中单独实现。

`infra:up` 首次生成随机凭证到 Git 忽略目录 `.tools/g2-local/`，通过 Compose secrets 注入。再次启动复用凭证和卷；发现已有卷但缺凭证时拒绝初始化。请保管这个目录，不要把密码、token、`.npmrc` 或备份贴入提交、日志或群聊。Windows 文件继承当前用户 ACL；这套本机 HTTP/凭证方案不用于共享主机或生产环境。

镜像、源码和构建器摘要见 [versions.json](versions.json)。MinIO 从固定 commit 和校验过的源码包本地构建，使用本次实际 image ID 启动，ID 保存在被忽略的 `images.json`；不采用浮动旧镜像。C 维护本地构建；生产维护、漏洞处置和部署仍需单独明确。

## 探针实际覆盖

`test:infra` 直接运行，不进入 Turbo 缓存，也不隐含在日常 `verify.ps1` 中。每轮创建唯一探针 ID，逐项失败即返回非零：

- PostgreSQL 真实版本、表写读、唯一约束、备份；恢复到独立临时数据库后核对载荷摘要，仅移除该恢复数据库。
- 私有 S3 桶真实字节往返和匿名 403；备份恢复到新对象键。
- 每次 S3 操作（含响应体读取）设置 15 秒上限；超时取消请求、关闭响应流，进入失败报告并释放互斥锁。
- 发布账号登录，将无代码的探针包打包一次，发布唯一包名的 `1.0.0`；只读账号在工作区外干净目录精确安装，禁用生命周期脚本。
- 匿名读取和只读账号写入必须拒绝。重复提交相同 tarball 时绕过 npm 本地版本预检查，必须得到 Verdaccio 的真实 HTTP 409；再次下载并核对 SHA-256，不删除重发。
- 重启本项目三个服务，验证 PostgreSQL、S3 与注册表原数据保持一致。

每轮报告、冻结 tarball 与备份位于 `.tools/g2-local/runs/<runId>/`。探针表、对象和已发布测试包保留以便复核；运行次数增加会累积数据。报告不包含密码或 token，但同目录的消费配置含临时凭证，不应整体分享。探针不运行组件或截图，不等于 T03/T04 冻结组件验收，也不等于 T06 跨存储作业一致性或 T11 全存储灾难恢复。

启动、停止和探针共用 `operation.lock` 互斥。正常成功或异常会释放；进程被强制终止可能留下锁。先确认没有本项目启动/停止/探针进程在运行，再仅移除空目录 `.tools/g2-local/operation.lock` 后重试；不要删除凭证或数据卷。命令只打印阶段和脱敏错误，敏感子进程输出不会原样回显。

## OIDC 与独立预览域

默认 [access.example.json](access.example.json) 两项为 `null`。当前 `infra:check-access` 返回退出码 **2** 和 `g2Ready: false`，表示尚未配置。

资源准备好后，把不含秘密的配置写入 `.tools/g2-local/access.json`，例如：

```json
{
  "oidc": {
    "issuer": "https://identity.example.com/realm",
    "webClientId": "gallery",
    "cliClientId": "component-cli"
  },
  "preview": {
    "platformOrigin": "https://gallery.example.com",
    "apiOrigin": "https://api.example.com",
    "previewOrigin": "https://r-probe.example-assets.net"
  }
}
```

以上是占位地址，须替换为实际资源；必须同时提供画廊和管理 API origin，不接受 HTTP、URL 内凭证、query/hash，预览须与画廊及管理 API 的注册域均不同。

如按用户授权启用 IP 预览，在 `preview` 对象中添加 `"mode": "ip-port"`，填写同一 IPv4 的三个 HTTPS origin，并给预览配置专用端口。接入检查验证目标入口 TLS，具体配置见 [IP 预览部署](../docs/guides/preview-ip-port.md)。

```powershell
$env:G2_ACCESS_CONFIG = '.tools/g2-local/access.json'
pnpm infra:check-access
Remove-Item Env:G2_ACCESS_CONFIG
```

退出 **0** 仅表示两项前置检查成功：OIDC discovery 的 issuer/authorization-code/PKCE S256 和公开 JWKS 结构、画廊/API/独立预览 origin 的 DNS/TLS 可达。退出 **1** 表示配置或请求失败，**2** 表示有项未配置。结果写入 `.tools/g2-local/access-result.json`，失败也会覆盖旧结果；任何情况下 `g2Ready` 都为 `false`。

仍须交付：OIDC 网页/CLI 客户端注册、真实登录/回调/角色拒绝与撤销；独立域 wildcard DNS/TLS、逐发布 origin、preview-grant 和浏览器沙箱隔离。当前工具不能证明这些已完成，C 不代填 A/B 业务回执。

T11/T12补充：rehearse:backup 使用独立 zhrec-UUID 容器/卷完成真实三存储备份与空目标恢复。共享G2可运行 test:infra --no-restart，报告明确省略共享重启项；默认test:infra仍会重启。配置、备份保密与未验收边界见 [operations](../docs/guides/operations.md)。
