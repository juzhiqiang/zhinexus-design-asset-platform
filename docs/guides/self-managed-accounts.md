# 自主管理账号栈与本机试用

本说明配合 [自主管理账号设计](../specs/2026-11-22-self-managed-accounts-design.md) 与 [验证汇编](../verification/self-managed-accounts.md)。它描述平台自行维护身份源时的部署、初始化、试用与恢复步骤，不替代正式部署验收。

## 1. 与共享 G2 栈的边界

自主管理账号使用**独立的 Compose 项目** `zhinexus-self-managed`、独立端口（PostgreSQL `25432`、身份服务 HTTPS `29443`）、独立卷（`self_managed_postgres`、`self_managed_identity`）和私有凭据目录 `.tools/self-managed/`。它不复用 `infra/compose.yaml`（项目 `zhinexus-g2`）的凭据缺失共享栈，两者可同时运行。

`.tools/` 已在 `.gitignore` 中；凭据、CA 私钥、TLS 私钥与服务账号密钥只存在于本机，严禁写入 Git、日志或检查报告。

## 2. 启动与停止

```powershell
pnpm infra:self-managed:up      # 首次会生成随机凭据、本地 CA 与 IP 证书
pnpm infra:self-managed:stop    # 停止并移除容器，卷与凭据保留
pnpm infra:self-managed:credentials   # 仅打印凭据目录位置，不打印内容
```

首次 `up` 会在空栈上生成 PostgreSQL 密码、Keycloak bootstrap 管理员密码、本地 CA 与覆盖访问 IP 的服务器证书。若发现已有卷但没有 `state.json`，脚本拒绝覆盖并提示走恢复流程——**有卷无凭证时不得重置数据**。

Keycloak 版本与镜像 digest 由 `infra/self-managed-versions.json` 固定；该文件当前为 `pending-official-verification`，未固定前 compose 通过 `${SELF_MANAGED_KEYCLOAK_IMAGE:?...}` **失败关闭**，不会静默拉取 `latest`。

## 3. 首次初始化

```powershell
$env:PLATFORM_SELF_MANAGED_HOST = '127.0.0.1'      # 实际访问 IP，证书 SAN 必须覆盖它
$env:PLATFORM_API_ORIGIN        = 'https://127.0.0.1:3000'
$env:PLATFORM_GALLERY_ORIGIN    = 'https://127.0.0.1:5173'
pnpm infra:self-managed:bootstrap
```

bootstrap 会：创建 `zhinexus` realm 与 `zhinexus-web` / `zhinexus-cli` / `zhinexus-api` 客户端；轮换 `zhinexus-identity-admin` 服务账号密钥并只授予 `manage-users`、`view-users`、`query-users`、`query-groups`、`view-realm`（缺失任一即拒绝，不扩大授权）；创建首个平台管理员（随机临时密码、`UPDATE_PASSWORD` 首次改密、`platform_managed_user_id` 与 `platform_account_version` 只读属性）；执行平台迁移；按 issuer + subject 把该管理员登记进 `managed_accounts`（`administrator=true`）。

bootstrap **仅在空的自有栈首次执行**；realm 已存在即拒绝。临时密码只在控制台打印一次，需立即交给管理员并完成首次改密。

平台 API 侧需要以下环境变量（都由部署注入，不接受请求提供）：

| 变量 | 含义 |
| --- | --- |
| `PLATFORM_SELF_MANAGED_ISSUER` | 自管 realm issuer，例如 `https://127.0.0.1:29443/realms/zhinexus` |
| `PLATFORM_IDENTITY_BASE_URL` | 固定 realm 基址，例如 `https://127.0.0.1:29443/realms/zhinexus` |
| `PLATFORM_IDENTITY_ADMIN_CLIENT_ID` | realm 内服务账号 client id |
| `PLATFORM_IDENTITY_ADMIN_SECRET_REF` | 服务账号密钥引用名，实际值取 `PLATFORM_IDENTITY_ADMIN_SECRET_<REF>` |
| `PLATFORM_ACCESS_ADMINISTRATORS` | 部署登记的管理员 issuer + subject 列表 |
| `PLATFORM_ACCESS_OUTBOUND` | 身份服务出站白名单（hostname / port / CIDR） |

## 3.1 本地身份模式（`PLATFORM_IDENTITY_MODE=local`，无 Keycloak）

平台自研身份服务（迁移 `013_local_credentials.sql`）把口令材料放在平台自己的库里，且**没有任何 HTTP 管理面**，因此 Keycloak 的 `bootstrap` 无法为它创建管理员；没有管理员，`requireAdministrator` 会拒绝全部托管账号请求，后台「用户与权限」的创建账号就不可用。本地模式用单独一条命令补这一步：

```powershell
$env:PLATFORM_SELF_MANAGED_ISSUER = 'https://127.0.0.1:3000/identity'   # 与 API 所用同一值
$env:PLATFORM_DATABASE_URL        = 'postgres://zhinexus:<password>@127.0.0.1:25432/zhinexus'
pnpm infra:self-managed:bootstrap-local
```

必填只有上表两项：issuer 必须是 https 且不带 userinfo/query/fragment（与 `apps/api/src/platform.ts` 同一套校验），数据库地址指向自有栈的 PostgreSQL。可用 `PLATFORM_SELF_MANAGED_ADMIN_USERNAME`（默认 `platform-admin`）与 `PLATFORM_SELF_MANAGED_ADMIN_DISPLAY_NAME`（默认 `平台管理员`）覆盖默认值。引导只连数据库，不校验其他部署配置，避免无关配置挡住播种。

**`pnpm infra:self-managed:up` 已经会自动做这一步**：建完容器后，若 `PLATFORM_IDENTITY_MODE=local`（默认取 `keycloak`，与 `platform.ts` 同一套默认值）就播种首个管理员，因此新栈不需要第二条命令。已有管理员时打印 `SELF_MANAGED_ADMINISTRATOR_PRESENT` 并跳过；播种失败则让 `up` 失败关闭——一个声称成功却没有管理员的栈比起不来的栈更糟。仍想手动执行时用 `pnpm infra:self-managed:bootstrap-local`，它对已有管理员报错而不是跳过，避免误以为刚刚轮换了唯一管理员的凭据。

命令会：先执行平台迁移（幂等，按校验和防改写）；同一 issuer 下已有管理员即拒绝；写入 `administrator=true, enabled=true, awaiting_activation=false, credentials_set=true, sync_state='synced'` 且 `remote_user_id` 取账号自身 id 的管理员行；按 `LocalIdentityStore.putCredential` 同样的 upsert 写入 `local_credentials` 且 `must_change=true`；补一条审计事件。**临时口令只在 stdout 打印一次**，不落库、不写仓库、不进日志——库里只有 scrypt 摘要。

之后按既有环境启动 API（`PLATFORM_IDENTITY_MODE=local` + 同一 issuer + Web/CLI 回调），用临时口令在管理端登录，首次登录强制改密，即可进入「用户与权限」创建成员。

网页登录现在有真实的登录页：`/v1/auth/oidc/start?target=admin` 不再把浏览器送到返回 JSON 描述符的 `GET /identity/authorize`，而是送到管理端 `${PLATFORM_ADMIN_ORIGIN}/login`，页面把同一组授权参数放回表单隐藏域，凭据以一次普通表单 POST 直接提交到 `${API}/identity/authorize`。凭据输错或账号停用时，该端点 303 回登录页并带一个封闭集合的 `reason`；首次登录必须在同一次提交里换掉临时口令，页面会因此多渲染一个新密码字段。前提是浏览器到 API origin 的 `/identity/` 可达——`infra/gateway/gallery-public.conf` 的公网边缘模板仍按设计 404 `/identity/`，自管栈的 API 直接跑在宿主上，不经该模板。详见 [登录页验证记录](../verification/self-managed-accounts.md#2026-11-25-admin-login-pagemd)。

本地模式**尚未实测**的链路（见 `docs/verification/self-managed-accounts.md#2026-11-25-local-administrator-bootstrapmd`）：真实网页登录回跳与首次改密、CLI PKCE 回环。本轮已按静态比对修掉两处会阻断网页登录的契约缺陷——本地身份服务签令牌的 `sub` 取 `platform_subject` 而平台按 `managed_accounts.subject` 查找、token 端点不返回 `id_token`——但均只在沙箱单测层验证，未在真实 HTTPS 入口与浏览器中跑通。登录页本身同样只在沙箱单测层与生产构建层验证，未在真实浏览器里走过一次完整登录。

## 4. 从初始化到验收的试用步骤

1. 客户端信任 `.tools/self-managed/ca-certificate.pem`，**不关闭证书校验**。
2. 管理员登录画廊，进入「用户与权限」，用 bootstrap 打印的临时密码完成首次改密。
3. 创建成员：输入用户名、显示名、角色，可选组件与包授权。重复用户名返回冲突；未设置密码的账号显示「待设置密码」且不能登录。
4. 为成员设置临时密码，成员用「账号登录」进入自托管身份服务页面完成首次改密后返回画廊。
5. 授权发布：给成员授予组件与包 ACL，确认只有同时满足角色、组件 ACL 与包 ACL 才能发布。
6. 查看预览：确认预览授权绑定签发时的账号版本。
7. 停用成员：确认已有 Web 会话、CLI token 与预览授权立即失效；恢复后必须重新登录，停用前的凭据不复活权限。
8. 恢复成员：确认远端会话登出与账号版本更新完成后才可登录。

## 5. 恢复

超级管理员丢失密码或服务凭据时，只允许部署侧恢复：停止容器 → 用保留的 `.tools/self-managed/` 凭据与 CA 直接操作身份服务 → 重新核对账号版本与已失效凭据 → 重新开放账号。**不新增免认证 HTTP 运维后门，不清理共享持久卷。**

备份须覆盖平台数据库、身份服务数据库与部署密钥，并按受控方式保管；恢复后重新核对账号版本，确认旧凭据已失效。

## 6. 未验证项

以下项目在本轮**未实测**，不能据本说明声称已完成：Keycloak 版本与镜像 digest；`platform_account_version` 与 `auth_time` 是否确实出现在 access token；首次改密后的登录与 `auth_time` 变化；realm 管理服务账号的最小角色集；真实浏览器验收与正式部署验收；`pnpm infra:self-managed:bootstrap-local` 与 `up` 自动播种对真实 PostgreSQL 的写入；修好 `sub` 与 `id_token` 之后的真实网页登录回跳。相关证据按设计第 8 节单独记录。
