# 公司登录与预览接入设置

管理员在画廊 `/access-settings` 分别管理公司登录和预览入口。每次保存生成不可重复使用的草稿 ID；保存、验证、启用和恢复都携带期望活动代数。编辑后需重新保存和验证。API 依据部署登记的 issuer/subject 校验管理员，业务 maintainer 不自动获得管理权限。

## 部署接入

先执行 API 的全部现有迁移（当前 001–011），API 与网关连接同一数据库。保持 `PLATFORM_GALLERY_ORIGIN`、`PLATFORM_API_ORIGIN` 和初始 `PLATFORM_PREVIEW_*` 为部署可信边界。初始 OIDC JWT/JWKS 环境继续作为首次管理入口，其 JWKS 同样使用公司 CA、DNS/CIDR 白名单和固定地址的受限 HTTPS。后台版本启用后以 `access_active` 的活动指针决定运行行为；之后部署遗漏接入配置会拒绝启动／认证，不能恢复旧环境认证通道。

API 部署以下变量；JSON 只包含非密钥字段：

- `PLATFORM_ACCESS_ADMINISTRATORS`：`[{"issuer":"https://公司身份入口","subject":"管理员 subject"}]`。切换 issuer 前，先在部署清单登记新 issuer 的真实管理员身份。
- `PLATFORM_ACCESS_OUTBOUND`：`[{"hostname":"公司身份主机","port":443,"networks":["批准的 IPv4/IPv6 CIDR"]}]`。元数据、JWKS、令牌端点及预览入口必须在此清单。DNS 返回的所有地址必须被批准；请求固定到核验地址，不跟随重定向。预览允许单级 `*.预览注册域` 主机规则。
- `PLATFORM_ACCESS_INITIAL_OIDC`：可选的首次网页登录配置，结构同 `OidcAccessConfig`。包含 issuer、audience、独立 Web/CLI client ID、Web 回调、CLI 回环、roleClaim 和 reader/publisher/maintainer 映射。
- `PLATFORM_OIDC_SECRET_<引用名>`：Web 客户端密钥。页面只存 `secretRef`；不得把密钥填写到 JSON、报告或 Git。可选公司 CA 由 `PLATFORM_ACCESS_CA_FILE` 指向部署挂载的 PEM 信任文件。
- API、网关共同配置 `PLATFORM_PREVIEW_DEPLOYMENT_ID`，用于核对实际网关。此标识公开且不作为身份凭证。

生产模板已传递非密钥设置变量。CA 文件和 `PLATFORM_OIDC_SECRET_*` 按公司的挂载/密钥注入方式增加到 API 容器。画廊的 `NEXT_PUBLIC_PLATFORM_API_URL` 指向 API 外部入口，CORS 只允许部署登记的画廊。Web session Cookie 为 Secure/HttpOnly；写操作检查画廊 Origin。平台令牌不会写入正常网页登录的浏览器存储。

Web 回调必须为 `${PLATFORM_API_ORIGIN}/v1/auth/oidc/callback`。CLI 公开客户端配置 HTTP `127.0.0.1` 的高位回环端口与非根回调路径，两客户端必须不同。Discovery 必须支持 code 和 S256；签名算法限制 RS256/ES256。Web 回调验证 state、浏览器绑定、nonce、issuer、audience、客户端、真实签名与同一 subject，兑换后仅服务端保存会话。

## 验证与启用

1. 保存公司登录草稿，运行 Discovery/JWKS 和密钥引用检查。
2. 通过页面的候选网页登录入口使用专用真实测试账号。页面以当前管理员凭证换取有效 60 秒的一次性随机票据，再进入 API 授权跳转；不会把管理员令牌或公司授权地址放到页面返回数据中。票据在配置切换、到期、消费或管理员停用后拒绝。候选登录只记录检查结果，不签发正式平台会话。
3. 在本机已通过环境变量 `ZHINEXUS_API_TOKEN` 提供管理员凭证后运行 `component login --api-url <API origin> --candidate <草稿 ID>`。CLI 实际打开公司授权页面，通过 S256 和回环回调兑换令牌，API 验证候选 CLI 身份和角色。候选令牌不能调用正式发布 API。
4. Web、CLI、业务角色及管理员登录检查通过后启用。每项证据分别记录时间与活动代数，必须在当前代数的 15 分钟内取得；网络复查不能刷新登录证明。恢复旧公司入口前也需重新取得该入口的 Web、CLI 和管理员登录证明。正式登录使用 `component login --api-url <API origin> [--credential-file <用户私有文件>] [--ca-file <公司 CA 文件>]`。正常 CLI 登录还调用受保护 session API，并将令牌保存在用户 `.zhinexus/session.local`；重复登录原子替换该文件，不会打印令牌。已有发布命令显式 `--token` 和 `ZHINEXUS_API_TOKEN` 仍兼容。

公司撤权保持独立检查项，不以登录成功或旧令牌过期代替。公司身份同步需更新 `disabled_subjects`、`subject_role_restrictions` 和已有组件/包授权边界。每次受保护请求和预览资源访问核对当前活动代数与权限。新 issuer/subject 默认分配独立权限主体；只允许运维显式迁移单个人的授权。

正常 CLI 登录保存的凭证由发布、恢复发布、作业状态和基线命令自动消费：显式 `--token` 优先，其次已有环境变量，最后读取完全匹配 API origin 且未过期的私有文件。API 地址同样可从已保存登录读取。使用自定义 `--credential-file` 时，为后续命令设置 `ZHINEXUS_CREDENTIAL_FILE`。API 重定向被拒绝，不能把凭证发送到其他入口；JWT 到期检查只用于提前提示，真实认证仍由 API 执行。画廊优先当前公司 Cookie 会话，手动令牌作为兼容入口。

预览域模式检查至少两个实际 Ready 实现的 `r-<variant-release-id>.<预览域>` 主机，核对 DNS、可信 TLS/SAN、路由和网关标识。IP 模式使用同 IPv4 的独立 HTTPS 端口和不透明沙箱。入口必须过滤 Cookie 和 Authorization；检查使用非秘密 canary 验证过滤。`/access-probe` 提供公开网关标识和已读取的活动代数，拒绝携带凭证的请求，不执行组件。启用后有界重探网关；无法确认时页面保持等待网关确认。连接失败时未执行的 TLS／路由检查显示待验，不伪报通过。

域名入口只保留唯一有效的 `__Host-preview` Cookie，并过滤其他 Cookie 和全部 Authorization；重复预览 Cookie 拒绝使用。`/access-probe` 和 IP 入口过滤全部凭据，IP 入口禁止返回 Set-Cookie。使用 [域名模板](../infra/gateway/preview.conf)、[IP 模板](../infra/gateway/preview-ip.conf) 和 [网关数据库授权](../infra/gateway/preview-role.sql)，保留 Host 的非默认端口。旧预览 grant 缺少角色来源，在迁移 011 后需要重新申请；后续 grant 按签发时的有效角色检查撤销。

启用和恢复生成新的活动代数，旧预览 grant/session 与旧 Web session 不会因回退而恢复。画廊按授权的 mode 选择 iframe 沙箱；后台切换无需重建画廊。DNS、证书、监听和入口过滤由运维预先部署。页面明确显示 API 已启用与网关确认代数是否一致。

网关数据库身份需要只读访问 `access_active`、`access_revisions`、`subject_role_restrictions`，以及原预览/发布/授权表；仅允许更新 `access_active.gateway_generation`、兑换 grant 和写入预览审计，禁止修改 config、generation、活动/草稿指针或身份授权。具体数据库账号/授权由部署 DBA 配置，不把 API 全权限身份复用给网关。

## 部署侧操作与恢复

受控命令不注册 HTTP 路由。使用部署私有 JSON 文件和运维操作者标识，运行：

```powershell
$env:PLATFORM_ACCESS_OPERATOR = '登记的运维操作者'
.\scripts\pnpm.ps1 --filter @company/platform-api exec node dist/operations/access-settings.js --file <私有操作文件>
```

支持精确正文（额外字段拒绝）：

```json
{"action":"bind","issuer":"https://新身份入口","identitySubject":"同一人的新 subject","platformSubject":"明确迁移的原权限主体"}
{"action":"disable","platformSubject":"待停用权限主体","disabled":true}
{"action":"restrict-role","platformSubject":"待撤销角色的权限主体","role":"publisher","denied":true}
{"action":"restore","section":"preview","expectedGeneration":"当前活动代数","revision":"曾启用的有效版本 UUID"}
```

身份映射目标唯一，避免把多个人的权限合并到同一主体；不会批量按同名 subject 迁移。同一权限主体只接受一次受控绑定，再次跨 issuer 绑定会被唯一约束拒绝；替换既有绑定需另行设计身份核对与旧身份退役流程，本轮不提供自动覆盖。恢复重新探测目标入口，并拒绝未验证、未曾启用或版本已过期的目标。公司登录恢复前需完成恢复目标管理员的候选登录验证。身份源不可用且没有有效验证时，操作失败关闭，不直接修改数据库指针。所有成功操作记录 `deployment:<操作者>` 审计。

迁移 010 为旧草稿增加逐项证据，但不把旧状态标志伪造为新登录证明。配置正文与版本身份、启用历史和接入审计受数据库不可变触发器保护；检查状态可以追加更新。管理和业务写入事务还核验认证时的 OIDC 代数，拒绝验证期间切换身份配置的旧请求。过期或旧代数证明在页面显示待验。失败启用／恢复记录接入审计；管理员、回调和会话的鉴权拒绝记录脱敏 `AUTH_DENIED`，不记录 code/state/票据/令牌。

## 验收记录

本机测试使用隔离 IdP、TLS 与三存储。生产 G2 仍须提交真实公司 Web/CLI 登录、专用账号实际停用/角色移除、既有 token/Web session/preview grant 拒绝时延、公司管理员认可的目标时限，以及生产逐发布 DNS/TLS 和双框架浏览器证据。见 [本轮验证](verification/g2-access-settings-2026-11-22.md)。
