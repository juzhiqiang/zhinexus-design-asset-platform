# 自主管理账号、本地身份服务与后台登录验证汇编（self-managed-accounts）

> 本文件由 2 篇逐次验证记录按时间序合并而成（2026-11-26，`chore/docs-slim-round3` 分支）。合并范围：`2026-11-25-local-administrator-bootstrap.md`、`2026-11-25-admin-login-page.md`。每篇原记录以 `### <原文件名>` 为标题**完整保留原文**（标题降两级），git 历史可追溯，信息不灭失。
>
> 两篇的关系：第一篇先给出「后台创建账号功能早已在代码里、卡在没有首个管理员播种入口」的结论，交付 `bootstrap-local` 与建栈自动播种，并修掉令牌 `sub` 与账号查找键不一致、本地 token 端点不返回 `id_token` 两处登录契约缺陷；第二篇在其之上把网页登录从「跳到一段 JSON」补成真正的后台登录页。第一篇 §5 静态核查发现的两处缺陷，已由第一篇「追加」节与第二篇共同关闭。
>
> 一条贯穿两篇的不变事实：**原始架构文档 `component-platform-architecture.md` 的 SHA-256 始终为 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`**。两篇的沙箱结论均**不含**真实 PostgreSQL 集成、真实浏览器登录与端到端首次改密，这些边界到合并时仍未关闭，不得以退出码 0 冒充。

## 逐条合并记录

### 2026-11-25-local-administrator-bootstrap.md

日期：2026-11-25（Asia/Shanghai）。基线 `bb2f5ad0`（`main`）。诉求：「后台管理可以创建账号 需要加上这个功能」。

#### 1. 结论：功能已在代码里，卡点在部署层

`apps/admin/app/users/page.tsx` 的「用户与权限」画板**已具备完整创建账号能力**：新成员登记表单（用户名 / 显示名 / 业务角色 / 组件授权 / 包授权）与「创建账号」按钮（第 288 行），经 `app/lib/managed-accounts-client.ts` 的 `createManagedAccount` 打到 `POST /v1/managed-accounts`；API 侧 `apps/api/src/accounts/routes.ts` 已注册 `@Post() @HttpCode(201) create`，`apps/api/src/accounts/service.ts:210` 的 `create()` 写 `managed_accounts` 并入队 `identity_operations`；迁移 `012_managed_accounts.sql`、`013_local_credentials.sql`、`015_component_categories.sql` 齐全；`LocalIdentityAdapter` 与 `KeycloakIdentityAdapter` 两个身份适配器都在；`docs/design/management-api.pen` 画板 05 也画了「新成员登记 / 创建账号」，`tests/admin/console-render.test.ts:171` 断言了「创建账号」。创建之后的设置临时密码、改显示名、角色、停用、恢复、强制重新登录、操作记录同样齐全。

它在任何可运行配置下都用不了，原因有三层，全部在仓库内可查：

1. `apps/api/src/platform.ts:154` 只在 `PLATFORM_SELF_MANAGED_ISSUER` 存在时构造 `platform.accounts`；缺这一项时 `runManaged` 抛 `INFRA_UNAVAILABLE`（`platform.ts:238`），控制台只能显示「账号服务暂时不可用，请稍后重试。」。`infra/compose.production.yaml` 通篇没有这个变量，仓库里也没有 `.env`。
2. 唯一能建出首个平台管理员的 `infra/scripts/self-managed.ts` 的 `bootstrap()` 是 **Keycloak 专属**：它先取 master realm 令牌、创建 realm、轮换服务账号密钥，再调 Keycloak  admin REST 建用户。
3. 那个栈**根本起不来**：`infra/compose.self-managed.yaml` 要求 `${SELF_MANAGED_KEYCLOAK_IMAGE:?...}`，而 `infra/self-managed-versions.json` 的 `keycloak.image` 是 `null`、`status` 为 `pending-official-verification`，`infra/scripts/self-managed.ts:18` 因此不注入该变量，compose 按设计失败关闭。

实施计划汇编 [`docs/plans/2026-11-22-self-managed-accounts.md`](./self-managed-accounts.md) 中「2026-11-23-local-identity-service.md」小节要求退役这些 Keycloak 专属部分，并记录「尚未退役 / 保持未完成」。于是 `PLATFORM_IDENTITY_MODE=local` 这条已实现、已单测的身份服务**没有播种入口**：没有任何管理员能被建出来，`requireAdministrator`（`accounts/service.ts:66`）永远抛 `FORBIDDEN`，后台创建账号永远不可用。这正是诉求描述的现象。

#### 2. 本轮改动

新增 `infra/scripts/self-managed.ts` 的 `bootstrap-local` 子命令（Keycloak 无关，只连数据库）：

- `assertSelfManagedIssuer`：issuer 必须 https 且无 userinfo/query/fragment，与 `platform.ts` 同一套形状，API 会拒的 issuer 在这里也播不下去。
- `localAdministratorPresent`：按 issuer 查是否已有管理员，一个 issuer 只允许一个管理员。
- `seedLocalAdministrator`：写 `administrator=true, enabled=true, awaiting_activation=false, credentials_set=true, sync_state='synced'`、`remote_user_id` 取账号自身 id（本地模式 `LocalIdentityAdapter.createAccount` 返回的 id 就是 `managedUserId`）的管理员行；按 `LocalIdentityStore.putCredential` 同样的 upsert 写 `local_credentials` 且 `must_change=true`；补一条审计事件。
- 先跑 `migrateRegistry`（幂等、按 sha256 防改写），空栈一条命令即可；只以 `{ databaseUrl }` 构造 `Platform`，不让无关部署配置挡住播种；临时口令只在 stdout 打印一次。
- `package.json` 增加 `infra:self-managed:bootstrap-local`；命令分发加上与 `infra/scripts/local.ts` 相同的主模块守卫，使模块可被测试导入而不会启动基础设施。

配套：`docs/guides/self-managed-accounts.md` 新增 §3.1 本地身份模式路径；`tests/infra/self-managed-bootstrap.test.ts` 新增 6 条断言。

#### 3. 沙箱已实测

沙箱无 pnpm / Docker / PostgreSQL / 浏览器，`node_modules` 内 `vitest` 与 `tsx` 是指向断链的符号链接，可用磁盘仅 169 MB。采用的两项替代都有记录：

- **测试执行**：用 Node 22.23.5 原生 `--experimental-strip-types` 跑一份自写的 vitest 兼容垫片（`describe` / `it` / `expect`，匹配器全部真实断言，失败即抛）。结果 `6 passed, 0 failed, 6 total`。垫片只在本机 `/tmp`，不进仓库。
- **类型检查**：仓库锁定的 TypeScript 7.0.2 在 Linux 无可执行文件，按既有偏差用 `typescript@6.0.3`，配置逐项复刻 `tsconfig.base.json`（NodeNext、strict、`verbatimModuleSyntax`、`isolatedModules`、`noUncheckedIndexedAccess`、`resolveJsonModule`），`typeRoots` 指向实体 `@types/node@26.6.6`。`infra/scripts/self-managed.ts` 与 `tests/infra/self-managed-bootstrap.test.ts` 合计 **0 错误**。

**变异测试**（证明测试不是假通过）：把 `must_change` 改 false、`enabled` 改 false、删掉 `local_credentials` 写入、issuer 校验放宽到允许 http、`remote_user_id` 不绑账号 id、guard 查询去掉 issuer 条件——六项各自被对应断言抓到（5 passed / 1 failed 或 4 passed / 2 failed），每次改后都已复原并与仓库文件 `diff` 一致。

#### 4. 沙箱不可做（不得以退出码 0 冒充）

根 `typecheck` 与 `build`（无 pnpm、Node 22.23.5 vs 固定 26.13.0、磁盘不足）；`tests/platform/**` 的真实 PostgreSQL 集成；`bootstrap-local` 对真实库的播种；`test:browser`；端到端登录。宿主待跑：

```powershell
.\scripts\pnpm.ps1 typecheck
.\scripts\pnpm.ps1 exec vitest run tests/infra/self-managed-bootstrap.test.ts
.\scripts\pnpm.ps1 build
.\scripts\pnpm.ps1 exec vitest run --config tests/platform/vitest.config.ts tests/platform/managed-accounts.test.ts
```

#### 5. 静态核查发现、本轮未改的两处缺陷

这两处会阻断本地模式的网页登录，均只在仓库内静态比对得出，**未在运行时复现**，需宿主确认后再排期：

1. **令牌 `sub` 与账号查找键不一致。** `apps/api/src/identity/local/store.ts:40` 的 `account()` 与 `:57` 的 `loginCandidate()` 都把 `platform_subject` 当作 `subject` 返回，`identity/local/service.ts:134` 用它签令牌，于是令牌 `sub` = `managed_accounts.platform_subject`；而 `apps/api/src/accounts/service.ts:59` 的 `resolveSelfManaged()` 与 `:434` 的合成 principal 都按 `managed_accounts.subject` 查找。这两列取值不同（`create()` 里 `subject` 是随机 UUID，`platform_subject` 是 `'oidc:'+sha256(issuer+subject)`），`verifiedAccount()` 会因此抛 `UNAUTHENTICATED`。现有测试抓不到：`tests/unit/local-identity.test.ts` 的假库 `Account` 类型（第 30 行）根本没有 `subject` 列，`tests/platform/managed-accounts.test.ts` 用真库但造的是 Keycloak 形状的 principal。注意 `revokeSessions` 需要的是 `platform_subject`（`oidc_sessions.principal->>'subject'` 存的是它），所以不能简单地改列名，要分开返回两个字段。
2. **本地 token 端点不返回 `id_token`。** `apps/api/src/identity/local/service.ts:123` 的 `token()` 只返回 `access_token`，而 `apps/api/src/access/oidc.ts:139` 要求 `tokens.id_token` 是字符串，否则网页回调直接失败关闭。这一点与实施计划第 135 行「真实网页首次改密与登录回跳仍缺」一致，属已知未完成项，本轮不扩大范围。

#### 6. 状态

`bootstrap-local` 的播种逻辑已在沙箱跑过并做过变异测试；从「建出管理员」到「在浏览器里用管理员创建成员」的端到端链路**未验证**，在 §5 两处确认前不能声称后台创建账号已可用。

---

### 追加：2026-11-25 本地网页登录契约修复

用户随后确认「默认需要提供一个管理员账号去分配」，并选择「建栈时自动播种」+「两处登录契约缺陷都修」。本轮在上一条结论之后做完三件事。

#### A. 建栈时自动播种

`infra/scripts/self-managed.ts` 的 `up` 在建完容器后调用 `seedOnStackUp()`：仅当 `PLATFORM_IDENTITY_MODE=local`（默认值与 `platform.ts` 一致取 `keycloak`）时播种首个管理员，因此未配置本地身份模式时 `up` 行为与之前完全一致。已有管理员打印 `SELF_MANAGED_ADMINISTRATOR_PRESENT` 并跳过；播种失败让 `up` 失败关闭——声称成功却没有管理员的栈比起不来更糟。播种逻辑抽成 `seedFirstLocalAdministrator({ strict })`，用重载区分两种调用方：独立命令 `bootstrap-local` 传 `strict: true`，已有管理员即报错，避免操作者误以为刚刚轮换了唯一管理员的凭据；`up` 传 `strict: false`，把这当作正常的已播种情况。

#### B. 令牌 `sub` 与账号查找键对齐

`LocalIdentityStore.account()` 与 `loginCandidate()` 现在分别返回 `subject`（`managed_accounts.subject`，令牌 `sub` 用）和 `platformSubject`（`managed_accounts.platform_subject`，会话与预览授权用）。`identity/local/service.ts` 用 `subject` 签令牌，`identity/local/adapter.ts` 的 `revokeSessions` 改用 `platformSubject`——因为 `access/oidc.ts` 把平台主体存进 `oidc_sessions.principal`，`preview/service.ts` 也把平台主体存进 `preview_grants.subject`，撤权必须按平台主体删。两个字段分开返回，而不是把某一列改名，正是因为这两类消费者要的不是同一个值。

#### C. 本地身份服务补发 `id_token`

`access/oidc.ts:139-141` 要求 token 响应里有 `id_token`，按 `exp/iat/sub/nonce` 校验、audience 为 web client，并比较 `sub` 与 access token 一致、`nonce` 与 attempt 里生成的一致。本轮：

- 新增迁移 `016_local_identity_nonce.sql`，给 `local_authorization_codes` 加 `nonce` 列（默认空串，保证可对存量表执行；授权码只活 60 秒，存量行早已过期；空 nonce 只能来自迁移前的行，会在平台的 nonce 比对处失败关闭）。
- `AuthorizationRequest` 增加可选 `nonce`，`request()` 校验为 43 位 base64url；**畸形 nonce 报错而不是静默丢弃**——丢掉它会让网页回调拿到一个验不通过的令牌，比 400 难查得多。CLI 回环流程不发 nonce，因此保持可选。
- `tokens.ts` 新增 `issueIdToken`，只签 `sub/aud/iss/exp/iat/nbf/jti/nonce`：平台从 access token 读 roles、账号版本与 auth_time，在浏览器可见的 id_token 里重复它们只会扩大暴露面。
- `token()` 仅在授权码带了 nonce 时签发 id_token，CLI 路径响应不变（`packages/component-cli/src/commands/login.ts:53` 只校验 `access_token` 与 `token_type`，多一个字段无影响）。
- `controller.ts` 的 GET/POST `authorize` 透传 `nonce`。

#### D. 沙箱已实测

- **`tests/unit/local-identity.test.ts` 真跑 23/23 通过**。这条值得单独说明：该文件第 11 行 import 了 `platform.ts`，会连带拖进 pg、@aws-sdk、@nestjs 一整棵依赖树，而 9p 挂载下 `node_modules` 的顶层与包内相对符号链接全部断裂。沙箱里的做法是把 `apps/api/src` 与 `packages/contracts` 复制到 `/tmp`，用绝对符号链接指向 `.pnpm` 里的实体包，缺一个补一个迭代 12 轮补齐 pg 与 aws-sdk 闭包，再写一个把 `.js` 相对导入改写到 `.ts` 的 ESM resolver，用 `node --experimental-transform-types` 跑。断言用的是自写 vitest 兼容垫片，匹配器全部真实断言。测试文件本体是仓库原文件，只改了导入扩展名。
- **变异测试 6 项全被抓到**：令牌 `sub` 用回 `platform_subject`、撤权改用身份主体、不签发 id_token、CLI 路径也签发 id_token、id_token 的 aud 用错、授权码不携带 nonce——每项都让对应新断言失败（1 至 4 条不等），每次改后都与仓库文件 `diff` 一致。
- **`tests/infra/self-managed-bootstrap.test.ts` 6/6 通过**（重构后复跑）。
- **类型检查**：用 `typescript@6.0.3`（仓库锁定的 7.0.2 在 Linux 无可执行文件，沿用既有偏差）+ `paths` 指向实体 `jose` 与 contracts 声明，按 `tsconfig.base.json` 逐项复刻严格配置，覆盖 `identity/local/*`、`identity/adapter.ts`、`errors.ts`、两个测试文件与 `self-managed.ts`：**改动范围内 0 错误**。全程序另有 35 个错误，全部位于我未改动的文件，且全是 `pg`/`@aws-sdk`/`@company/contracts/preview` 无法解析级联出的 TS7006/TS2307/TS18046；同一配置跑改动前的基线，同类错误同样存在。
- 期间类型检查真抓到两个缺陷：`seedFirstLocalAdministrator({strict:true})` 的返回值收窄不了导致 `seeded.username` 报 TS2339（改用重访解决），以及重载插入时多写了一行实现签名造成 TS1005。

#### E. 仍未验证

`apps/api` 全量 `typecheck` 与 `build`（无 pnpm、Node 22.23.5 vs 固定 26.13.0）；`tests/platform/**` 的真实 PostgreSQL 集成；修好 `sub` 与 `id_token` 之后的**真实网页登录回跳与首次改密**（需要真实 HTTPS 入口与浏览器）；CLI 真实 PKCE 回环。宿主待跑：

```powershell
.\scripts\pnpm.ps1 typecheck
.\scripts\pnpm.ps1 build
.\scripts\pnpm.ps1 exec vitest run tests/unit/local-identity.test.ts tests/infra/self-managed-bootstrap.test.ts
.\scripts\pnpm.ps1 exec vitest run --config tests/platform/vitest.config.ts tests/platform/managed-accounts.test.ts
.\scripts\pnpm.ps1 test:browser
```

判定口径：管理员能用临时口令登录并在首次登录时改密；网页回调拿到含正确 `nonce` 与 `sub` 的 id_token；CLI 回环登录不因新增 id_token 而回归；停用成员后已有会话与预览授权立即失效，且按平台主体删除。

### 2026-11-25-admin-login-page.md

本轮把 `PLATFORM_IDENTITY_MODE=local` 下后台管理的网页登录从「跳到一段 JSON」补成真正的登录页。
分支 `feat/admin-login-page`，基于 `54bf15ca`（main，0.1.6）。

#### 1. 缺口定位

点后台任一页的「账号登录」会到 `${API}/v1/auth/oidc/start?target=admin`，`CompanyOidc.start` 再 303 到
发现文档里的 `authorization_endpoint`。本地模式下这个端点就是本进程的 `GET /identity/authorize`，
而它返回的是 `describeAuthorization()` 的 **JSON 描述符**——`service.ts` 的注释自己把这记为
「a known limitation」，即「表单由画廊渲染，本轮不发原生 HTML 登录页」。浏览器拿到这段 JSON 无从下手。
画廊侧同样没有登录页，本轮按用户选择只做后台。

#### 2. 做法

登录页放在 `apps/admin/app/login/page.tsx`（用户选择：页面在后台内，视觉按后台现有设计令牌）。
`.pen` 没有登录画板，所以这是全新 UI，只复用既有原语（`access-panel`/`zn-field`/`zn-input`/
`zn-btn-primary`、接入设置分区的 Command Motif、Aurora 外壳）。

页面是**服务端组件、零客户端脚本**：从自己的 query 读授权参数，校验形状后原样放回表单隐藏域，
凭据用一次普通表单 POST 直接提交到 `${platformApiOrigin}/identity/authorize`。选原生 POST 而不是
`fetch`，是因为成功后要靠浏览器自己走完 `303 → /v1/auth/oidc/callback → /upload` 这条链：
回调在该链上写 `__Host-platform` Cookie，只有浏览器亲自导航才能把它落到 API origin 上。
`fetch` 跟跳转会因最终响应缺 CORS 头而失败，`redirect:'manual'` 又读不到跨源 `Location`。

API 侧两处配套改动：

- `CompanyOidc.start`：`target=admin` 且即将发送给浏览器的授权端点**正是**本地身份服务发布的那个时，
  改为 303 到 `${adminOrigin}/login` 并带上同一组 OIDC 参数。Gallery 目标、公司 issuer 的部署、
  没有本地身份的部署全部保持原样（`adminLogin` 只在 `platform.localIdentity` 存在时传入）。
- `POST /identity/authorize` 的失败路径：对浏览器表单导航（`Accept: text/html`）返回 303 回登录页，
  带封闭集合的 `reason` 与规范化用户名；其他客户端照旧收 JSON 错误。回跳 URL 由
  `identity/local/login-page.ts` 构造，每个字段都按服务端同一套形状复验，畸形即丢弃。

首次登录改密没有单独做一套 UI：播种出来的管理员 `must_change=true`，服务端在**同一次提交**里要求
`new_password`，所以登录页在 `reason=first-login` 时多渲染一个新密码字段（策略：至少 12 个字符，
不得与当前口令相同——与 `password.ts` 的 `assertPasswordPolicy` 一致，不虚构字符类别要求）。

#### 3. 实际执行的验证

沙箱（Linux，Node 22.23.5，真实 vitest 5.1.0 + vite 7 + 真实 `jose`/`@nestjs/common`/`react`）：

| 验证 | 命令 | 结果 |
| --- | --- | --- |
| 新增 API 侧测试 | `vitest run tests/unit/admin-login-page.test.ts` | 23/23 通过 |
| 新增后台渲染测试 | `vitest run tests/admin/login-page.test.ts` | 16/16 通过 |
| 导航/设计令牌回归 | `vitest run tests/admin/design-system.test.ts` | 15/15 通过 |
| 画板渲染回归 | `vitest run tests/admin/console-render.test.ts` | 6/7（见 §5 既有失败） |
| 本地身份服务回归 | `vitest run tests/unit/local-identity.test.ts` | 23/23 通过 |
| 四件合计 | 同上一次跑 | 83 通过 / 1 失败（既有） |
| 类型检查（API 侧 5 个文件 + 新测试） | `tsc -p tsconfig.api.json` | 0 错 |
| 类型检查（后台 3 个文件 + 3 个测试） | `tsc -p tsconfig.admin.json` | 0 错（另 3 条为沙箱缺 next 类型存根） |
| 后台生产构建 | `next build`（Turbopack，含 TypeScript 检查） | 通过，`/login` 为 ƒ 动态渲染 |

**变异测试 13 项，全部被抓到**（每次只改一处、跑完还原并与仓库逐字节核对）：

| 变异 | 结果 |
| --- | --- |
| 授权端点不再区分浏览器表单（一律回跳） | CAUGHT（2 失败） |
| 回跳 URL 把口令一起带上 | CAUGHT（3 失败） |
| 所有拒绝都算凭据错误（丢掉 first-login） | CAUGHT（2 失败） |
| 畸形字段不再被丢弃 | CAUGHT（5 失败） |
| `start` 不再看 target（画廊也跳登录页） | CAUGHT（1 失败） |
| `start` 不再核对授权端点（公司 issuer 也跳） | CAUGHT（1 失败） |
| 控制器不再回跳（一律抛 JSON 错误） | CAUGHT（2 失败） |
| 登录表单改成 GET（口令进 URL） | CAUGHT（1 失败） |
| 登录页不再渲染隐藏的授权参数 | CAUGHT（2 失败） |
| 登录页不再校验入口参数 | CAUGHT（4 失败） |
| 未知 reason 不再回退到保守文案 | CAUGHT（1 失败） |
| 首次登录不再渲染新密码字段 | CAUGHT（1 失败） |
| 侧栏把 `/login` 高亮成上传发布 | CAUGHT（1 失败） |

测试过程中被测试抓到两个真实缺陷，均已修：`discovery()` 漏删 `const base` 导致
`ReferenceError`（`local-identity.test.ts` 抓到）；未知 `reason` 不渲染任何提示，与注释承诺的
「退回到最保守的提示」不符（新增测试抓到）。另有两处测试自身取值错误（`'tooshort'` 是 8 位，
本就在服务端 `{8,512}` 合法区间内）已改为真畸形值。

#### 4. 未验证 / 边界

- **没有跑过真实浏览器登录**：沙箱无 PostgreSQL、无 Docker、无 TLS 入口，`tests/browser/**` 与
  `tests/platform/**` 本轮均未执行。首次改密、回调写 Cookie、`/upload` 落地的完整链路仍待宿主实测。
- **画廊侧仍无登录页**：`target=gallery` 依旧 303 到 `/identity/authorize` 那段 JSON。用户本轮只选后台。
- **公网边缘模板仍 404 `/identity/`**：`infra/gateway/gallery-public.conf` 三处
  `location /identity/ { return 404; }` 是有意的，注释写明「本地身份服务不在本模板内，部署它需要
  单独评审过的入口与测试」。因此在该部署形态下，登录页的表单 POST 会拿到 404——这与改动前一致
  （那段 JSON 同样到不了浏览器），不是本轮引入或修好的问题。自管栈的 API 直接以
  `PLATFORM_IDENTITY_MODE=local` 跑在宿主上，不经该模板，所以那里可用。要把本地身份模式搬到公网边缘，
  需要单独一轮入口评审。
- `apps/api` 全量 typecheck/build、`tests/platform/**` 真 PG 未跑。
- `POST /identity/authorize` 的浏览器分支只在单测层验证，未在真实 Nest 路由里跑过。

#### 5. 顺手发现的两处既有问题（未修，不属于本轮范围）

1. `tests/admin/console-render.test.ts` 的「全部画板的类名与 CSS 变量都在 globals.css 中有定义」
   在 HEAD 上就失败：`upload/page.tsx` 与 `categories/page.tsx` 渲染出 `catalog-toolbar`、
   `search-box`，而 `globals.css` 没有这两个类。已用 `git show HEAD:` 取原版复现确认与本轮无关。
2. 同一文件的 `renderPage` 加载器类型写成 `{ default: () => unknown }`，让带 props 的画板
   （`/jobs/[jobId]`）在类型上就不合法，HEAD 上就有 2 条 TS2322/TS2345。本轮因为要加 `/login`
   一并改成 `{ default: unknown }`，这 2 条随之消失。

#### 6. 共享工作树提醒

本轮进行中，另一名代理把同一工作树切到了 `feat/juz-browser-install`（0.1.7 + Chromium 自动下载），
我的未提交改动被带到那个分支上。已确认两边文件无交集后 `git checkout feat/admin-login-page` 返回，
改动完整。**提交前必须重新核对分支，不能只信开工时那一次。**
