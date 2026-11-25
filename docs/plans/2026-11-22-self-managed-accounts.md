# 自主管理账号与平台自研身份服务实施计划汇编（self-managed-accounts）

> 本文件由 2 篇实施计划按时间序合并而成（2026-11-26，`chore/docs-slim-round3` 分支）。合并范围：`2026-11-22-self-managed-accounts-implementation.md`、`2026-11-23-local-identity-service.md`。每篇原计划以 `### <原文件名>` 为标题**完整保留原文**（标题降两级），git 历史可追溯，信息不灭失。
>
> 两篇的关系：第一篇按已批准设计交付自托管 Keycloak 形态的账号目录、身份同步、撤权时序与画廊后台；第二篇把身份源从 Keycloak 换成平台自研本地身份服务（`PLATFORM_IDENTITY_MODE=local`），并显式记录了因此失效的两条安全不变量（`012_managed_accounts.sql` 顶部「不存密码材料」、「平台被攻破也伪造不出令牌」）。引用「当前身份源」时以第二篇为准。规格见 [`../specs/2026-11-22-self-managed-accounts-design.md`](../specs/2026-11-22-self-managed-accounts-design.md)，部署与试用见 [`../guides/self-managed-accounts.md`](../guides/self-managed-accounts.md)。

## 逐条合并记录

### 2026-11-22-self-managed-accounts-implementation.md

依据 [已批准设计](docs/specs/2026-11-22-self-managed-accounts-design.md)。分支 `feat/self-managed-accounts-impl`，基线 `d700802d`（设计文档提交）。本轮交付账号目录、身份同步、撤权时序、网关核验、infra 身份栈与画廊后台的完整实现。

设计第 2 节列出的技术选择（自托管 Keycloak、关闭公开注册、无 SMTP、超管由部署初始化）由用户于 2026-11-22 确认按全量实施执行；`component-platform-architecture.md` 保持原样，本范围决定记入实施评估第 11 节。

#### 1. 公共契约（C，先收口）

新增 `packages/contracts/src/managed-accounts.ts` 并从 `index.ts` 导出：账号角色、创建/列表/详情/改显示名/改角色/改授权/停用/恢复/重置临时密码/强制重新登录的请求响应结构、同步状态与脱敏审计条目，以及运行时校验。

- 用户名按 ASCII 小写规范化，3–64 位字母、数字、点、下划线、连字符，首位为字母或数字；本身份源内唯一，重复返回 `CONFLICT`。
- 授权只接受精确组件 ID 与精确 npm 包名；通配符、`*`、空串、超长值一律 `INVALID_SCHEMA`。
- 密码字段只存在于瞬时请求契约，响应、审计、操作队列与任何视图都不得回显；策略至少 14 字符。
- `expectedRevision`、`accountVersion` 使用十进制字符串，与 PostgreSQL `bigint` 对齐，不经过 JavaScript 不安全整数。
- 所有对象 `additionalProperties: false`，覆盖「额外字段」反例。

同步生成 `packages/contracts/schemas/api-managed*.schema.json` 并保证 `tests/contracts/api-schema.test.ts` 精确一致。

#### 2. 数据库（C）

新增 `apps/api/migrations/012_managed_accounts.sql` 并登记到 `db/migration-files.ts`：

- `managed_accounts`：随机 UUID、用户名、显示名、角色数组、自身份源 issuer/subject、`desired_revision`、`access_epoch`、`auth_time_floor`、`enabled`、`credentials_set`、`sync_state`、`remote_user_id`、`administrator`、乐观 `version`；用户名与 `(issuer, subject)` 唯一。
- `managed_account_component_grants` / `managed_account_package_grants`：精确 ACL，不引入通配行。
- `identity_operations`：持久化身份操作记录，正文只含非密码字段、主体、期望修订与账号版本；含租约、`fencing_token`、attempts 与 `uncertain` 终态。**不与 `release_jobs` 混表。**

账号变更与业务写事务通过账号行 `SELECT … FOR UPDATE` 协调，锁序固定为先账号行后业务行。

#### 3. 平台 API（C）

新增 `apps/api/src/accounts/`（服务与路由）与 `apps/api/src/identity/`（身份适配器与操作处理器）。

- 路由挂在 `/v1/managed-accounts` 下；只接受已登记的平台管理员身份，`maintainer` 业务角色不授予后台权限；目标为部署登记管理员时拒绝停用、删除、重置密码、撤销全部会话与改角色。
- 自身份源 issuer/realm 来自部署配置，禁止按请求体或前端提供的任意 issuer 调用身份管理 API。
- 每次管理变更校验当前 OIDC 配置代数、管理员状态、目标账号版本与预期修订；并发旧版本返回 `CONFLICT`；成功与失败都写脱敏审计。
- 写请求继续由画廊 Origin 强制（沿用既有 Cookie 中间件），不在页面隐藏操作代替服务端拒绝。
- **收紧顺序**：先在平台事务提交撤权与审计（`access_epoch` 自增、`auth_time_floor` 推进到该事务的当前整秒、按需停用），再进行远端更新与会话登出。远端失败不撤销本地拒绝。
- **放宽顺序**：创建、恢复、权限扩大先在远端完成同步并核验远端主体、角色、启用状态与版本，再在本地最终启用事务里推进 `auth_time_floor` 至该阶段当前整秒；同步期间取得的 token/会话不复活权限。
- 密码设置为独立受保护瞬时操作：入队前自增账号版本并撤销会话，只有远端明确确认且当前操作修订仍匹配才回报「已重置」；结果不确定时保留本地拒绝并回报「待运维核实」，不自动重试、不并发接受新密码。

`apps/api/src/identity/keycloak.ts` 通过 `RestrictedHttps` 访问固定 realm 的 HTTPS 管理端点，禁止重定向与任意 URL；管理服务账号只授予该 realm 必需权限。`apps/api/src/identity/worker.ts` 按账号串行、独立于请求生命周期、重启可恢复，网络 I/O 不占数据库事务。

#### 4. 认证与网关（C）

- `CompanyOidc.authenticate` 对自身份源主体解析 `platform_account_version`（十进制字符串）与 `auth_time`；缺少版本或时间声明失败关闭；未登记主体默认拒绝；bootstrap 负责首个管理员的目录登记。
- `Web session` 与预览授权保存签发时的账号版本；候选登录、CLI 与预览都核验对应版本，禁止从未验证的 JWT 或请求体补填声明。
- 签名 `auth_time` 必须严格大于 `auth_time_floor`，`iat` 不得早于 `auth_time`；同一秒发生的新登录需在下一秒重新认证，不放宽为大于等于。
- `apps/preview-gateway/src/auth.ts` 在授权兑换与资源请求两处核验账号状态与版本，只取得必要只读权限；旧版本拒绝。

#### 5. infra（C）

- `infra/compose.self-managed.yaml`：独立 Compose 项目名、专属端口/卷与私有凭据目录，不复用凭据缺失的共享 G2 栈；入口默认仅本机可达。
- `infra/keycloak/realm-zhinexus.json`：专用 realm、独立 Web/CLI 客户端、`reader`/`publisher`/`maintainer` 业务角色、`platform_account_version` 只读 mapper、`platform_managed_user_id` 只读属性与 API audience。
- `infra/scripts/self-managed-bootstrap.ts`：创建 realm 与客户端、首个管理员与管理服务账号、执行平台迁移、登记管理员 issuer + subject；仅在空的自有栈首次执行，发现已有数据但凭据丢失时拒绝覆盖。初始超管密码随机生成、不写 Git、不打印到工具输出。
- Keycloak 版本与镜像 digest 在实施时按官方来源固定并记录，不使用 `latest`。

#### 6. 画廊（B 侧界面，本轮由执行方一并实现）

`apps/gallery/app/(console)/users/` 与 `app/lib/managed-accounts-client.ts`：导航入口「用户与权限」；列表检索、启用状态筛选与分页；创建账号与设置临时密码拆成两步；「待设置密码」「待运维核实」状态；详情改显示名、业务角色、组件/包权限、停用、恢复、重置临时密码、强制重新登录；非管理员拒绝。用户可见「公司登录」文案在自管部署显示为「账号登录」。

#### 7. 验证

契约反例、HTTP/网关并发、故障恢复、浏览器验收按设计第 8 节逐项执行。本机无 Docker 与凭据时，真实 Keycloak 集成、`tests/platform/**` 与浏览器验收记录为阻塞，不得冒充已完成。

#### 2026-11-22 执行记录

计划 1–6 项已实现并落在 `feat/self-managed-accounts-impl`：contracts（`managed-accounts.ts` + 9 个生成 JSON Schema）、迁移 `012_managed_accounts.sql`、`apps/api/src/accounts` 与 `apps/api/src/identity`、`/v1/managed-accounts` 端点、认证端与网关的账号版本核验、`infra/compose.self-managed.yaml` + `infra/keycloak/realm-zhinexus.json` + `infra/scripts/self-managed.ts`、画廊「用户与权限」后台。

实际命令、退出码、RED → GREEN 与未覆盖边界见 [本轮验证记录](docs/verification/gates-infra.md)，部署与恢复见 [自管账号栈说明](docs/guides/self-managed-accounts.md)。根版本升至 0.0.10，API 0.0.12、画廊 0.0.13、预览网关 0.0.5、CLI 0.0.27。

2026-11-22 已 `--no-ff` 合入 `main`（合并提交 `8ce44290`），合并结果重跑全图与分支一致；`main` 领先 `origin/main` 8 个提交未 push。

**尚未完成**：真实 Keycloak 集成（mapper、首次改密、登录）、`tests/platform/managed-accounts.test.ts` 真实 PostgreSQL 集成、本机浏览器验收、撤权时限实测、正式部署验收。Keycloak 版本与 digest 未固定，compose 失败关闭。设计第 10 节要求的独立 builder check 本轮未派发。

### 2026-11-23-local-identity-service.md

日期：2026-11-23（Asia/Shanghai）；负责人 C / Codex；基线 `be793bb6`（分支 `chore/gallery-design-restoration`，该分支在飞且仅含 `docs/design/**`，与本计划文件范围零重叠）。范围决定见 [实施评估第 12 节](../../component-platform-implementation-assessment.md)。

本轮只做**最小可用**：让真实用户名密码登录链路跑通。refresh 轮换、登录限速与锁定、登录审计明确推后，并作为已知风险记录，不得宣称已具备。

#### 1. 不变部分（方案成立的前提，已逐行核实）

- 认证协议：OIDC authorization code + PKCE + JWT；Web 用 Cookie 会话；CLI 用回环登录。
- claim 契约：`exp`/`sub`/`iat`/`iss`/`aud`/`azp`，自管账号另加 `platform_account_version`、`platform_managed_user_id`、`roles`、`auth_time`。
- `apps/api/src/access/oidc.ts` 与 `apps/api/src/auth/oidc.ts` 共 311 行为 provider 无关校验层：`auth/oidc.ts:67-73` 只认 RS256/ES256、issuer、audience、必需声明 `exp`/`sub`/`iat`，`clockTolerance: 0`；`access/oidc.ts:19-29` 只从 discovery 取 `authorization_endpoint`、`token_endpoint`、`jwks_uri`。**这三项照原 shape 提供，该层零改动。**
- `apps/api/src/identity/adapter.ts` 的 5 方法接口与 `apps/api/src/accounts/service.ts` 不变。
- `component-platform-architecture.md` 保持原样，SHA-256 恒为 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`，每轮复核。

#### 2. 变化部分

- 平台开始保存密码材料：新增迁移，`012_managed_accounts.sql` 顶部「this migration stores no password material」的不变量失效，须在新迁移注释中正式说明，不得默默改。
- 签名密钥与密码哈希同处 API 进程：原「平台被攻破也伪造不出令牌」的安全属性不再成立，用户 2026-11-23 明确接受。缓解仅限短 TTL 与密钥轮换；限速与锁定推后。
- 密码哈希用 Node 核心 `crypto.scrypt`，不引新依赖（沙箱可用磁盘不足 320MB 无法编译原生 argon2；项目规则要求新增依赖按官方来源锁精确版本并留证据）。argon2id 记为升级项。

#### 3. 文件范围

新增：

| 文件 | 职责 |
| --- | --- |
| `packages/contracts/src/local-identity.ts` | 登录、首次改密、令牌响应的 schema 与类型 |
| `apps/api/migrations/013_local_credentials.sql` | 密码材料表、必须改密标记、登录尝试记录表 |
| `apps/api/src/identity/local/password.ts` | scrypt 哈希与常量时间校验 |
| `apps/api/src/identity/local/keys.ts` | RSA 密钥对生成、JWKS 输出、轮换 |
| `apps/api/src/identity/local/tokens.ts` | JWT 签发，产出全部必需声明 |
| `apps/api/src/identity/local/store.ts` | 凭据存储、授权码与 PKCE challenge 绑定 |
| `apps/api/src/identity/local/endpoints.ts` | 授权端点、令牌端点、JWKS、discovery |
| `apps/api/src/identity/local/adapter.ts` | `LocalIdentityAdapter` 实现 5 方法 |
| `apps/api/src/identity/local/password-change.ts` | 首次改密：版本+1、auth_time 下限前移、旧会话与预览授权作废 |

修改：

| 文件 | 改动 |
| --- | --- |
| `apps/api/src/platform.ts` | 用 `LocalIdentityAdapter` 替换 `KeycloakIdentityAdapter`，挂载本地端点 |
| `packages/contracts/src/index.ts`、`src/schemas.ts` | 导出新契约并登记 schema |

退役（单独聚焦提交，不留无声删除）：`apps/api/src/identity/keycloak.ts`、`infra/keycloak/realm-zhinexus.json`、`infra/compose.self-managed.yaml` 的 identity 服务、`infra/scripts/self-managed.ts` 中 Keycloak 专属部分。

#### 4. 端点契约

| 端点 | 方法 | 行为 |
| --- | --- | --- |
| `/.well-known/openid-configuration` | GET | issuer、authorization_endpoint、token_endpoint、jwks_uri、`response_types_supported: ["code"]`、`code_challenge_methods_supported: ["S256"]` |
| `/identity/authorize` | GET | 按 `client_id`/`redirect_uri`/`state`/`code_challenge` 校验后出用户名密码表单；未认证时不得重定向 |
| `/identity/authorize` | POST | 验凭据；失败不透露账号是否存在；成功生成授权码，与 state、`code_challenge`、`redirect_uri`、client 绑定后重定向 |
| `/identity/token` | POST | `grant_type=authorization_code`；验 `code_verifier` 的 S256 与绑定 challenge 一致、授权码一次性、未过期；失败关闭 |
| `/identity/jwks` | GET | 当前签名公钥集 |
| `/identity/password` | POST | 首次改密；改密后推进账号版本与 auth_time 下限 |

授权码一次性、短 TTL（60 秒）、绑定 `redirect_uri` 与 client；`redirect_uri` 必须在部署允许列表内，禁止开放重定向。

##### 部署约束（2026-11-23 实施中发现，影响端点挂载位置）

`apps/api/src/access/oidc.ts:20-25` 对 discovery 与三个端点有硬性要求，本地身份服务必须满足：

- discovery 文档取地址是 `config.issuer` 拼接 `/.well-known/openid-configuration`，且文档里的 `issuer` 字段必须与 `config.issuer` **完全相等**；
- `authorization_endpoint`、`token_endpoint`、`jwks_uri` 三个 URL 必须都是 **https**，且主机名与端口必须命中 `settings.options.outbound` 允许列表中的某条规则；
- JWKS 的 `keys` 数量须在 1–32 之间，且任一 key 不得含 `d` 或 `k` 字段。

因此本地身份端点必须挂在 **API 自己的 HTTPS origin** 上，且该主机名要登记进 OIDC 出站允许列表——API 需要通过 `RestrictedHttps` 能取到自己的 discovery 文档。这是部署配置要求，不是代码可绕过的；本机 HTTP 开发例外需单独确认。


#### 5. 验证结果（2026-11-23 实测）

沙箱可做并已执行：

- **`password.ts`**：真跑 22 条断言全过——正确密码、同长度错密码、大小写变体、首尾空格、未知账号、畸形/外来记录、同密码不同盐、astral 字符绕过长度限制、超长拒绝。实测确认 Node `scrypt` 默认 `maxmem` 为 32MiB，N=2^16 需 64MiB，不显式传 `maxmem` 抛 `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`，故 `maxmem` 由参数算出后显式传入。
- **`keys.ts` + `tokens.ts`**：在隔离目录装 `jose@6.2.17` 后真跑 24 条断言全过——密钥生成、JWKS 形状（EC P-256、无 `d`/`k`、≤32 key）、轮换后旧 key 仍可校验、签出的令牌按 `auth/oidc.ts:67-73` 同套规则（算法、issuer、audience、必需声明、`clockTolerance: 0`）验过，claim 完整，`exp = iat + 300`。
- **`service.ts` + `store.ts` + `adapter.ts` 全链路**：授权→换令牌 39 条断言全过，含错误验证器、授权码重放、client 不匹配、停用账号、重定向白名单外、首次登录强制改密。
- **`tests/unit/local-identity.test.ts`**：该文件本身经最小 vitest 兼容 shim 执行，**72 条断言 0 失败**。

实跑抓出并已修的两个缺陷（语法核对发现不了）：`mint()` 两次调用 `kid()` 导致 JWK 的 `kid` 与行记录不一致；`generateKeyPair` 未传 `extractable: true` 导致 `exportPKCS8` 抛 "CryptoKey is not extractable"。

另有一次转写事故：用正则批量替换测试断言时，非贪婪量词仍跨 70 余行吞掉内容，把测试文件改成 `await expect(X, 'CODE')` 这种**不断言任何东西的假通过**写法。重写文件后复跑才暴露，已记入本轮教训。

##### 5.1 2026-11-23 追加：类型编译错误与 `pnpm dev` 起不来（直接原因）

上表所有「真跑」都是经**剥类型执行器**（esbuild/tsx）跑的，跑通只证明运行时行为正确，**不证明能编译**。用户在宿主执行 `pnpm dev`，`turbo run dev` 对 `@company/platform-api` 走 `nest start --watch`，即 `tsc -p tsconfig.build.json --watch`：`apps/api` 有 16 处编译错误，tsc 报错后 Nest 不启动进程，服务自然起不来。

沙箱用真 `typescript@6.0.3` + 真 `jose@6.2.17` + 真 `@company/contracts` 的 `dist` 复现，四类错误全部位于本轮新增文件：

| 数量 | 位置 | 错误 |
| --- | --- | --- |
| 7 | `service.ts` | `ValidationIssue` 是 `{ code, path, message }` 对象，我按 `[path, message]` 元组写（`[['username', msg]]`） |
| 8 | `password.ts` | `noUncheckedIndexedAccess` 下解构数组元素带 `undefined`（`const [N, r, p, keylen] = parts.slice(1,5).map(Number)`），进入算术即报错 |
| 2 | `controller.ts` | `Record<string, unknown>` 不满足必填字段的 `AuthorizationRequest`/`AuthorizationSubmission` |
| 2 | `keys.ts`、`tokens.ts` | `KeyLike` 在 jose 6.2.17 中不存在（已改名，应用 `CryptoKey`） |

`tests/unit/local-identity.test.ts` 另有 2 处真实错误，会打断根 `typecheck`（根 `tsconfig.json` 的 `include` 含 `tests/**/*.ts`，但**不影响** `pnpm dev`）：内存假库的 `query` 是非泛型函数，不可赋给泛型 `Queryable['query']`（已改为内部 `raw` 返回 `Record<string, unknown>[]` + 一层泛型包装，只在包装处一次断言）；`v[2] === true` 中 `v` 被断言成 `string[]`（已改为从 `values[2]` 读 `unknown` 再比较）。

修复后重测（全部沙箱实测，退出码 0）：

- **整个 `apps/api/src` 类型检查**：以仓库原样的 `apps/api/tsconfig.json`（NodeNext、strict、`verbatimModuleSyntax`、`isolatedModules`、`noUncheckedIndexedAccess`、`experimentalDecorators`）配真 `@company/contracts` dist、真 `@nestjs/*`、`@aws-sdk/*`、`pg`、`jose`、`pngjs` 跑 `tsc`，**0 错误**；同配置 `tsconfig.build.json` emit 亦 **0 错误**，`dist/identity/local/*` 全部产出。
- **行为回归**：把修好的模块用上述 tsc 真实编译成 JS 后重跑全链路，**82 条断言 ALL PASS**（含密码近失配、畸形记录、astral 策略、JWKS 无私密材料、轮换后旧 key 仍可验、令牌按 `auth/oidc.ts` 同套规则验过、错误验证器/授权码重放/client 与 redirect 不匹配/停用账号/首次改密、discovery issuer 精确相等）。
- **仓库测试文件**：`tests/unit/local-identity.test.ts` 经同一 tsc 编译后用 vitest 兼容 shim 执行，**72 条断言 0 失败**。

教训：**剥类型执行器跑通 ≠ 能编译**。本轮 16 处错误中有 4 类是执行期完全看不出来的（类型形状、泛型可赋值性、不存在的导出名、`noUncheckedIndexedAccess`）。凡新增 TS 模块，必须另跑一次真 `tsc` 才算验证过。

沙箱不可做（须记录阻塞，不得以退出码 0 冒充）：根 `typecheck` 与 `build`（无 pnpm、Node v22.23.5 vs 固定 26.13.0、可用磁盘不足 320MB）；`tests/platform/**` 的真实 PostgreSQL 集成；`test:browser` 浏览器验收。`vitest` 与 `typescript` 在沙箱 `node_modules` 中为断链，无法安装。

宿主待跑：

```powershell
.\scripts\pnpm.ps1 typecheck
.\scripts\pnpm.ps1 build
.\scripts\pnpm.ps1 exec vitest run tests/platform/access-oidc.test.ts tests/platform/managed-accounts.test.ts
.\scripts\pnpm.ps1 exec vitest run --config tests/platform/vitest.config.ts tests/platform/access-cookie.test.ts
.\scripts\pnpm.ps1 test:browser
```

判定口径：真实登录成功且令牌含全部必需声明；错误密码与不存在账号返回不可区分响应；授权码重放与 `code_verifier` 不匹配均失败关闭；首次改密后旧令牌与旧会话失效；停用账号拒绝登录。

#### 6. 未覆盖边界与宿主待跑清单

未完成项：`packages/contracts` 尚未新增本地身份服务契约（当前错误码已够用，契约主要用于画廊与 CLI 的类型对齐）；`infra/keycloak`、`infra/compose.self-managed.yaml` 的 identity 服务与 `identity/keycloak.ts` 尚未退役；登录限速与账号锁定、refresh 轮换、登录审计未实现，属已知风险。`tests/platform/**` 的测试以自签 JWT 造令牌，验证「平台收到合规令牌时行为正确」，不验证「本地产出的令牌合规」——后者由 `tests/unit/local-identity.test.ts` 覆盖，但该文件尚未在 vitest 下执行。

宿主待跑（顺序执行，不要并行；上轮 G2 的教训是并行跑类型检查与服务构建会得到退出 1）：

```powershell
.\scripts\pnpm.ps1 typecheck
.\scripts\pnpm.ps1 build
.\scripts\pnpm.ps1 exec vitest run tests/unit/local-identity.test.ts
.\scripts\pnpm.ps1 verify:workspace
```

判定口径：`local-identity.test.ts` 全绿；`typecheck` 与 `build` 退出 0；`verify:workspace` 通过。

端到端仍缺（需真实 HTTPS 入口与浏览器）：真实网页首次改密与登录回跳、CLI PKCE 回环登录、停用成员后旧令牌被拒、撤权时限实测、正式部署验收。这些不在本轮的代码范围内，需在宿主按 `PLATFORM_IDENTITY_MODE=local` 配置后单独排期。

#### 7. 2026-11-24 `main` 合并收口与宿主实测

2026-11-24 在公开画廊与内网管理端拆分（11 成员工作区、`apps/admin`、`014_web_login_target.sql`）之后，将本计划最小实现收口合入 `main`：

- **修复配置校验 Bug 与双入口适配**：`apps/api/src/platform.ts` 原先以 `url.origin !== uri` 拒绝所有带 path 的回调 URI 且默认拼接 `${galleryOrigin}/auth/callback`。现改为与 `packages/contracts/src/access-settings.ts` 一致的规范路径校验（Web 必须为非根路径 HTTPS URL；CLI 允许 HTTPS 或 `http://127.0.0.1:<port>=1024` 环回非根路径；拒绝 userinfo/query/hash/通配符），并在未显式设置 `PLATFORM_IDENTITY_WEB_REDIRECT_URIS` 时默认推导 `${PLATFORM_API_ORIGIN}/v1/auth/oidc/callback`，与公开画廊 / 内网管理端共享的 `CompanyOidc.callback` 对齐。
- **迁移与空库回滚闭环**：`013_local_credentials.sql` 登记于 `012_managed_accounts.sql` 与 `014_web_login_target.sql` 之间；`apps/api/src/db/migrate.ts` 的 `rollbackEmptyRegistry` 补充锁表、空表检查与删除 `local_authorization_codes`、`local_credentials`、`local_signing_keys`。
- **宿主实测结果（Windows x64，Node 26.13.0 / pnpm 12.18.0）**：
  - `.\scripts\pnpm.ps1 install --frozen-lockfile`：exit 0（12 workspace projects）
  - `.\scripts\pnpm.ps1 verify:workspace`：exit 0（11 members, no cycles, four publishable shells, safe service graph）
  - `.\scripts\pnpm.ps1 exec turbo run build --force`：exit 0（11/11 强制执行，0 cached）
  - `.\scripts\pnpm.ps1 typecheck`：exit 0（15/15 包 + 根 `tsc -p tsconfig.json --noEmit`）
  - `.\scripts\pnpm.ps1 verify:deployment`：exit 0（`templateValidated: true`、`environmentValidated: false`、`productionAcceptance: false`）
  - `.\scripts\pnpm.ps1 exec vitest run tests/unit/local-identity.test.ts tests/unit/access-options.test.ts`：exit 0（2 文件，20/20 通过，含新增配置校验与双 origin 接线用例）
  - `.\scripts\pnpm.ps1 exec vitest run --config tests/platform/vitest.config.ts tests/platform/database.test.ts tests/platform/access-oidc.test.ts tests/platform/managed-accounts.test.ts tests/platform/access-cookie.test.ts`：exit 0（4 文件，7/7 通过，含真实 PostgreSQL 迁移与空库回滚）
  - `.\scripts\pnpm.ps1 test`：exit 0（T10 + Vitest 142 文件，2401 通过、2 条件跳过）
- **仍保留的未覆盖边界**：真实 HTTPS 网页首次改密登录、CLI 真实回环登录、登录限速/账号锁定/refresh 轮换/登录审计、Keycloak 退役、`packages/contracts` 本地身份契约导出及生产 G2 外部验收均保持未完成。
