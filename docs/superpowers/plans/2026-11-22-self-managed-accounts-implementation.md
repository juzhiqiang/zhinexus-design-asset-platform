# 自主管理账号与权限后台实施计划

依据 [已批准设计](../specs/2026-11-22-self-managed-accounts-design.md)。分支 `feat/self-managed-accounts-impl`，基线 `d700802d`（设计文档提交）。本轮交付账号目录、身份同步、撤权时序、网关核验、infra 身份栈与画廊后台的完整实现。

设计第 2 节列出的技术选择（自托管 Keycloak、关闭公开注册、无 SMTP、超管由部署初始化）由用户于 2026-11-22 确认按全量实施执行；`component-platform-architecture.md` 保持原样，本范围决定记入实施评估第 11 节。

## 1. 公共契约（C，先收口）

新增 `packages/contracts/src/managed-accounts.ts` 并从 `index.ts` 导出：账号角色、创建/列表/详情/改显示名/改角色/改授权/停用/恢复/重置临时密码/强制重新登录的请求响应结构、同步状态与脱敏审计条目，以及运行时校验。

- 用户名按 ASCII 小写规范化，3–64 位字母、数字、点、下划线、连字符，首位为字母或数字；本身份源内唯一，重复返回 `CONFLICT`。
- 授权只接受精确组件 ID 与精确 npm 包名；通配符、`*`、空串、超长值一律 `INVALID_SCHEMA`。
- 密码字段只存在于瞬时请求契约，响应、审计、操作队列与任何视图都不得回显；策略至少 14 字符。
- `expectedRevision`、`accountVersion` 使用十进制字符串，与 PostgreSQL `bigint` 对齐，不经过 JavaScript 不安全整数。
- 所有对象 `additionalProperties: false`，覆盖「额外字段」反例。

同步生成 `packages/contracts/schemas/api-managed*.schema.json` 并保证 `tests/contracts/api-schema.test.ts` 精确一致。

## 2. 数据库（C）

新增 `apps/api/migrations/012_managed_accounts.sql` 并登记到 `db/migration-files.ts`：

- `managed_accounts`：随机 UUID、用户名、显示名、角色数组、自身份源 issuer/subject、`desired_revision`、`access_epoch`、`auth_time_floor`、`enabled`、`credentials_set`、`sync_state`、`remote_user_id`、`administrator`、乐观 `version`；用户名与 `(issuer, subject)` 唯一。
- `managed_account_component_grants` / `managed_account_package_grants`：精确 ACL，不引入通配行。
- `identity_operations`：持久化身份操作记录，正文只含非密码字段、主体、期望修订与账号版本；含租约、`fencing_token`、attempts 与 `uncertain` 终态。**不与 `release_jobs` 混表。**

账号变更与业务写事务通过账号行 `SELECT … FOR UPDATE` 协调，锁序固定为先账号行后业务行。

## 3. 平台 API（C）

新增 `apps/api/src/accounts/`（服务与路由）与 `apps/api/src/identity/`（身份适配器与操作处理器）。

- 路由挂在 `/v1/managed-accounts` 下；只接受已登记的平台管理员身份，`maintainer` 业务角色不授予后台权限；目标为部署登记管理员时拒绝停用、删除、重置密码、撤销全部会话与改角色。
- 自身份源 issuer/realm 来自部署配置，禁止按请求体或前端提供的任意 issuer 调用身份管理 API。
- 每次管理变更校验当前 OIDC 配置代数、管理员状态、目标账号版本与预期修订；并发旧版本返回 `CONFLICT`；成功与失败都写脱敏审计。
- 写请求继续由画廊 Origin 强制（沿用既有 Cookie 中间件），不在页面隐藏操作代替服务端拒绝。
- **收紧顺序**：先在平台事务提交撤权与审计（`access_epoch` 自增、`auth_time_floor` 推进到该事务的当前整秒、按需停用），再进行远端更新与会话登出。远端失败不撤销本地拒绝。
- **放宽顺序**：创建、恢复、权限扩大先在远端完成同步并核验远端主体、角色、启用状态与版本，再在本地最终启用事务里推进 `auth_time_floor` 至该阶段当前整秒；同步期间取得的 token/会话不复活权限。
- 密码设置为独立受保护瞬时操作：入队前自增账号版本并撤销会话，只有远端明确确认且当前操作修订仍匹配才回报「已重置」；结果不确定时保留本地拒绝并回报「待运维核实」，不自动重试、不并发接受新密码。

`apps/api/src/identity/keycloak.ts` 通过 `RestrictedHttps` 访问固定 realm 的 HTTPS 管理端点，禁止重定向与任意 URL；管理服务账号只授予该 realm 必需权限。`apps/api/src/identity/worker.ts` 按账号串行、独立于请求生命周期、重启可恢复，网络 I/O 不占数据库事务。

## 4. 认证与网关（C）

- `CompanyOidc.authenticate` 对自身份源主体解析 `platform_account_version`（十进制字符串）与 `auth_time`；缺少版本或时间声明失败关闭；未登记主体默认拒绝；bootstrap 负责首个管理员的目录登记。
- `Web session` 与预览授权保存签发时的账号版本；候选登录、CLI 与预览都核验对应版本，禁止从未验证的 JWT 或请求体补填声明。
- 签名 `auth_time` 必须严格大于 `auth_time_floor`，`iat` 不得早于 `auth_time`；同一秒发生的新登录需在下一秒重新认证，不放宽为大于等于。
- `apps/preview-gateway/src/auth.ts` 在授权兑换与资源请求两处核验账号状态与版本，只取得必要只读权限；旧版本拒绝。

## 5. infra（C）

- `infra/compose.self-managed.yaml`：独立 Compose 项目名、专属端口/卷与私有凭据目录，不复用凭据缺失的共享 G2 栈；入口默认仅本机可达。
- `infra/keycloak/realm-zhinexus.json`：专用 realm、独立 Web/CLI 客户端、`reader`/`publisher`/`maintainer` 业务角色、`platform_account_version` 只读 mapper、`platform_managed_user_id` 只读属性与 API audience。
- `infra/scripts/self-managed-bootstrap.ts`：创建 realm 与客户端、首个管理员与管理服务账号、执行平台迁移、登记管理员 issuer + subject；仅在空的自有栈首次执行，发现已有数据但凭据丢失时拒绝覆盖。初始超管密码随机生成、不写 Git、不打印到工具输出。
- Keycloak 版本与镜像 digest 在实施时按官方来源固定并记录，不使用 `latest`。

## 6. 画廊（B 侧界面，本轮由执行方一并实现）

`apps/gallery/app/(console)/users/` 与 `app/lib/managed-accounts-client.ts`：导航入口「用户与权限」；列表检索、启用状态筛选与分页；创建账号与设置临时密码拆成两步；「待设置密码」「待运维核实」状态；详情改显示名、业务角色、组件/包权限、停用、恢复、重置临时密码、强制重新登录；非管理员拒绝。用户可见「公司登录」文案在自管部署显示为「账号登录」。

## 7. 验证

契约反例、HTTP/网关并发、故障恢复、浏览器验收按设计第 8 节逐项执行。本机无 Docker 与凭据时，真实 Keycloak 集成、`tests/platform/**` 与浏览器验收记录为阻塞，不得冒充已完成。

## 2026-11-22 执行记录

计划 1–6 项已实现并落在 `feat/self-managed-accounts-impl`：contracts（`managed-accounts.ts` + 9 个生成 JSON Schema）、迁移 `012_managed_accounts.sql`、`apps/api/src/accounts` 与 `apps/api/src/identity`、`/v1/managed-accounts` 端点、认证端与网关的账号版本核验、`infra/compose.self-managed.yaml` + `infra/keycloak/realm-zhinexus.json` + `infra/scripts/self-managed.ts`、画廊「用户与权限」后台。

实际命令、退出码、RED → GREEN 与未覆盖边界见 [本轮验证记录](../../verification/self-managed-accounts-2026-11-22.md)，部署与恢复见 [自管账号栈说明](../../self-managed-accounts.md)。根版本升至 0.0.10，API 0.0.12、画廊 0.0.13、预览网关 0.0.5、CLI 0.0.27。

**尚未完成**：真实 Keycloak 集成（mapper、首次改密、登录）、`tests/platform/managed-accounts.test.ts` 真实 PostgreSQL 集成、本机浏览器验收、撤权时限实测、正式部署验收。Keycloak 版本与 digest 未固定，compose 失败关闭。设计第 10 节要求的独立 builder check 本轮未派发。
