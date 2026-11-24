# @company/platform-api 更新日志

## [0.1.1] - 2026-11-24

### 新增

- 新增平台自研本地身份服务模块（`apps/api/src/identity/local/*`）与迁移 `013_local_credentials.sql`，在 `PLATFORM_IDENTITY_MODE=local` 下由平台自行签发 ES256 访问令牌、托管密码哈希与首次改密、处理单次授权码与 PKCE S256 校验，并挂载 `/identity` 端点。

### 修复

- 修复本地身份回调 URI 校验拒绝带路径回调的问题，默认 Web 回调改由 `PLATFORM_API_ORIGIN` 推导 `/v1/auth/oidc/callback` 以适配公开画廊与内网管理端双入口；补齐 `rollbackEmptyRegistry` 对 `local_credentials`、`local_authorization_codes`、`local_signing_keys` 的清理。

## [0.0.12] - 2026-11-22

### 新增

- 自管账号目录、组件/包授权与持久化身份操作记录；`/v1/managed-accounts` 成员管理端点只接受部署登记的管理员身份。
- 撤权时序：本地事务先提交账号版本与认证时间下限并作废会话/预览授权，再同步身份服务；创建、恢复与权限扩大在远端确认后才启用。
- 认证端核验签名 `platform_account_version` 与 `auth_time`/`iat`；Web 会话与预览授权保存签发时的账号版本。
- 身份操作处理器按账号串行、独立于请求生命周期、重启可恢复，网络 I/O 不占数据库事务。

### 安全

- 自管主体缺少版本或时间声明失败关闭，未登记主体默认拒绝；同名远端用户不带本账号标记时拒绝接管。
- 身份管理出站限制为固定 realm/HTTPS 地址与部署 CIDR，服务账号只授予 realm 必需角色。

### 未验证

- 真实 Keycloak 集成、浏览器验收与正式部署验收尚未执行。


## [0.0.11] - 2026-11-22

### 新增

- 接入配置草稿、不可变版本、逐项验证证据、活动代数、管理员 CAS 启用与经验证恢复；管理权限独立于业务角色。
- 公司 OIDC Discovery/JWKS、Web PKCE 与 Cookie 会话、CLI S256 回环与候选证据隔离；部署支持受控个人身份绑定、停用及角色限制。
- 受限 HTTPS 固定核验地址并支持公司 CA；预览入口检查与网关活动代数确认。

### 修复

- 验签后及业务写入事务核对认证代数；撤权、旧会话、旧角色授权、遗漏接入配置及过期候选票据失败关闭。鉴权拒绝记录脱敏审计。
