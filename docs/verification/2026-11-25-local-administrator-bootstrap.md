# 后台创建账号能力核查与本地管理员引导（2026-11-25）

日期：2026-11-25（Asia/Shanghai）。基线 `bb2f5ad0`（`main`）。诉求：「后台管理可以创建账号 需要加上这个功能」。

## 1. 结论：功能已在代码里，卡点在部署层

`apps/admin/app/users/page.tsx` 的「用户与权限」画板**已具备完整创建账号能力**：新成员登记表单（用户名 / 显示名 / 业务角色 / 组件授权 / 包授权）与「创建账号」按钮（第 288 行），经 `app/lib/managed-accounts-client.ts` 的 `createManagedAccount` 打到 `POST /v1/managed-accounts`；API 侧 `apps/api/src/accounts/routes.ts` 已注册 `@Post() @HttpCode(201) create`，`apps/api/src/accounts/service.ts:210` 的 `create()` 写 `managed_accounts` 并入队 `identity_operations`；迁移 `012_managed_accounts.sql`、`013_local_credentials.sql`、`015_component_categories.sql` 齐全；`LocalIdentityAdapter` 与 `KeycloakIdentityAdapter` 两个身份适配器都在；`docs/design/management-api.pen` 画板 05 也画了「新成员登记 / 创建账号」，`tests/admin/console-render.test.ts:171` 断言了「创建账号」。创建之后的设置临时密码、改显示名、角色、停用、恢复、强制重新登录、操作记录同样齐全。

它在任何可运行配置下都用不了，原因有三层，全部在仓库内可查：

1. `apps/api/src/platform.ts:154` 只在 `PLATFORM_SELF_MANAGED_ISSUER` 存在时构造 `platform.accounts`；缺这一项时 `runManaged` 抛 `INFRA_UNAVAILABLE`（`platform.ts:238`），控制台只能显示「账号服务暂时不可用，请稍后重试。」。`infra/compose.production.yaml` 通篇没有这个变量，仓库里也没有 `.env`。
2. 唯一能建出首个平台管理员的 `infra/scripts/self-managed.ts` 的 `bootstrap()` 是 **Keycloak 专属**：它先取 master realm 令牌、创建 realm、轮换服务账号密钥，再调 Keycloak  admin REST 建用户。
3. 那个栈**根本起不来**：`infra/compose.self-managed.yaml` 要求 `${SELF_MANAGED_KEYCLOAK_IMAGE:?...}`，而 `infra/self-managed-versions.json` 的 `keycloak.image` 是 `null`、`status` 为 `pending-official-verification`，`infra/scripts/self-managed.ts:18` 因此不注入该变量，compose 按设计失败关闭。

`docs/plans/2026-11-23-local-identity-service.md` 第 44 行要求退役这些 Keycloak 专属部分，第 122 与 152 行记录「尚未退役 / 保持未完成」。于是 `PLATFORM_IDENTITY_MODE=local` 这条已实现、已单测的身份服务**没有播种入口**：没有任何管理员能被建出来，`requireAdministrator`（`accounts/service.ts:66`）永远抛 `FORBIDDEN`，后台创建账号永远不可用。这正是诉求描述的现象。

## 2. 本轮改动

新增 `infra/scripts/self-managed.ts` 的 `bootstrap-local` 子命令（Keycloak 无关，只连数据库）：

- `assertSelfManagedIssuer`：issuer 必须 https 且无 userinfo/query/fragment，与 `platform.ts` 同一套形状，API 会拒的 issuer 在这里也播不下去。
- `localAdministratorPresent`：按 issuer 查是否已有管理员，一个 issuer 只允许一个管理员。
- `seedLocalAdministrator`：写 `administrator=true, enabled=true, awaiting_activation=false, credentials_set=true, sync_state='synced'`、`remote_user_id` 取账号自身 id（本地模式 `LocalIdentityAdapter.createAccount` 返回的 id 就是 `managedUserId`）的管理员行；按 `LocalIdentityStore.putCredential` 同样的 upsert 写 `local_credentials` 且 `must_change=true`；补一条审计事件。
- 先跑 `migrateRegistry`（幂等、按 sha256 防改写），空栈一条命令即可；只以 `{ databaseUrl }` 构造 `Platform`，不让无关部署配置挡住播种；临时口令只在 stdout 打印一次。
- `package.json` 增加 `infra:self-managed:bootstrap-local`；命令分发加上与 `infra/scripts/local.ts` 相同的主模块守卫，使模块可被测试导入而不会启动基础设施。

配套：`docs/guides/self-managed-accounts.md` 新增 §3.1 本地身份模式路径；`tests/infra/self-managed-bootstrap.test.ts` 新增 6 条断言。

## 3. 沙箱已实测

沙箱无 pnpm / Docker / PostgreSQL / 浏览器，`node_modules` 内 `vitest` 与 `tsx` 是指向断链的符号链接，可用磁盘仅 169 MB。采用的两项替代都有记录：

- **测试执行**：用 Node 22.23.5 原生 `--experimental-strip-types` 跑一份自写的 vitest 兼容垫片（`describe` / `it` / `expect`，匹配器全部真实断言，失败即抛）。结果 `6 passed, 0 failed, 6 total`。垫片只在本机 `/tmp`，不进仓库。
- **类型检查**：仓库锁定的 TypeScript 7.0.2 在 Linux 无可执行文件，按既有偏差用 `typescript@6.0.3`，配置逐项复刻 `tsconfig.base.json`（NodeNext、strict、`verbatimModuleSyntax`、`isolatedModules`、`noUncheckedIndexedAccess`、`resolveJsonModule`），`typeRoots` 指向实体 `@types/node@26.6.6`。`infra/scripts/self-managed.ts` 与 `tests/infra/self-managed-bootstrap.test.ts` 合计 **0 错误**。

**变异测试**（证明测试不是假通过）：把 `must_change` 改 false、`enabled` 改 false、删掉 `local_credentials` 写入、issuer 校验放宽到允许 http、`remote_user_id` 不绑账号 id、guard 查询去掉 issuer 条件——六项各自被对应断言抓到（5 passed / 1 failed 或 4 passed / 2 failed），每次改后都已复原并与仓库文件 `diff` 一致。

## 4. 沙箱不可做（不得以退出码 0 冒充）

根 `typecheck` 与 `build`（无 pnpm、Node 22.23.5 vs 固定 26.13.0、磁盘不足）；`tests/platform/**` 的真实 PostgreSQL 集成；`bootstrap-local` 对真实库的播种；`test:browser`；端到端登录。宿主待跑：

```powershell
.\scripts\pnpm.ps1 typecheck
.\scripts\pnpm.ps1 exec vitest run tests/infra/self-managed-bootstrap.test.ts
.\scripts\pnpm.ps1 build
.\scripts\pnpm.ps1 exec vitest run --config tests/platform/vitest.config.ts tests/platform/managed-accounts.test.ts
```

## 5. 静态核查发现、本轮未改的两处缺陷

这两处会阻断本地模式的网页登录，均只在仓库内静态比对得出，**未在运行时复现**，需宿主确认后再排期：

1. **令牌 `sub` 与账号查找键不一致。** `apps/api/src/identity/local/store.ts:40` 的 `account()` 与 `:57` 的 `loginCandidate()` 都把 `platform_subject` 当作 `subject` 返回，`identity/local/service.ts:134` 用它签令牌，于是令牌 `sub` = `managed_accounts.platform_subject`；而 `apps/api/src/accounts/service.ts:59` 的 `resolveSelfManaged()` 与 `:434` 的合成 principal 都按 `managed_accounts.subject` 查找。这两列取值不同（`create()` 里 `subject` 是随机 UUID，`platform_subject` 是 `'oidc:'+sha256(issuer+subject)`），`verifiedAccount()` 会因此抛 `UNAUTHENTICATED`。现有测试抓不到：`tests/unit/local-identity.test.ts` 的假库 `Account` 类型（第 30 行）根本没有 `subject` 列，`tests/platform/managed-accounts.test.ts` 用真库但造的是 Keycloak 形状的 principal。注意 `revokeSessions` 需要的是 `platform_subject`（`oidc_sessions.principal->>'subject'` 存的是它），所以不能简单地改列名，要分开返回两个字段。
2. **本地 token 端点不返回 `id_token`。** `apps/api/src/identity/local/service.ts:123` 的 `token()` 只返回 `access_token`，而 `apps/api/src/access/oidc.ts:139` 要求 `tokens.id_token` 是字符串，否则网页回调直接失败关闭。这一点与实施计划第 135 行「真实网页首次改密与登录回跳仍缺」一致，属已知未完成项，本轮不扩大范围。

## 6. 状态

`bootstrap-local` 的播种逻辑已在沙箱跑过并做过变异测试；从「建出管理员」到「在浏览器里用管理员创建成员」的端到端链路**未验证**，在 §5 两处确认前不能声称后台创建账号已可用。

---

# 追加：2026-11-25 本地网页登录契约修复

用户随后确认「默认需要提供一个管理员账号去分配」，并选择「建栈时自动播种」+「两处登录契约缺陷都修」。本轮在上一条结论之后做完三件事。

## A. 建栈时自动播种

`infra/scripts/self-managed.ts` 的 `up` 在建完容器后调用 `seedOnStackUp()`：仅当 `PLATFORM_IDENTITY_MODE=local`（默认值与 `platform.ts` 一致取 `keycloak`）时播种首个管理员，因此未配置本地身份模式时 `up` 行为与之前完全一致。已有管理员打印 `SELF_MANAGED_ADMINISTRATOR_PRESENT` 并跳过；播种失败让 `up` 失败关闭——声称成功却没有管理员的栈比起不来更糟。播种逻辑抽成 `seedFirstLocalAdministrator({ strict })`，用重载区分两种调用方：独立命令 `bootstrap-local` 传 `strict: true`，已有管理员即报错，避免操作者误以为刚刚轮换了唯一管理员的凭据；`up` 传 `strict: false`，把这当作正常的已播种情况。

## B. 令牌 `sub` 与账号查找键对齐

`LocalIdentityStore.account()` 与 `loginCandidate()` 现在分别返回 `subject`（`managed_accounts.subject`，令牌 `sub` 用）和 `platformSubject`（`managed_accounts.platform_subject`，会话与预览授权用）。`identity/local/service.ts` 用 `subject` 签令牌，`identity/local/adapter.ts` 的 `revokeSessions` 改用 `platformSubject`——因为 `access/oidc.ts` 把平台主体存进 `oidc_sessions.principal`，`preview/service.ts` 也把平台主体存进 `preview_grants.subject`，撤权必须按平台主体删。两个字段分开返回，而不是把某一列改名，正是因为这两类消费者要的不是同一个值。

## C. 本地身份服务补发 `id_token`

`access/oidc.ts:139-141` 要求 token 响应里有 `id_token`，按 `exp/iat/sub/nonce` 校验、audience 为 web client，并比较 `sub` 与 access token 一致、`nonce` 与 attempt 里生成的一致。本轮：

- 新增迁移 `016_local_identity_nonce.sql`，给 `local_authorization_codes` 加 `nonce` 列（默认空串，保证可对存量表执行；授权码只活 60 秒，存量行早已过期；空 nonce 只能来自迁移前的行，会在平台的 nonce 比对处失败关闭）。
- `AuthorizationRequest` 增加可选 `nonce`，`request()` 校验为 43 位 base64url；**畸形 nonce 报错而不是静默丢弃**——丢掉它会让网页回调拿到一个验不通过的令牌，比 400 难查得多。CLI 回环流程不发 nonce，因此保持可选。
- `tokens.ts` 新增 `issueIdToken`，只签 `sub/aud/iss/exp/iat/nbf/jti/nonce`：平台从 access token 读 roles、账号版本与 auth_time，在浏览器可见的 id_token 里重复它们只会扩大暴露面。
- `token()` 仅在授权码带了 nonce 时签发 id_token，CLI 路径响应不变（`packages/component-cli/src/commands/login.ts:53` 只校验 `access_token` 与 `token_type`，多一个字段无影响）。
- `controller.ts` 的 GET/POST `authorize` 透传 `nonce`。

## D. 沙箱已实测

- **`tests/unit/local-identity.test.ts` 真跑 23/23 通过**。这条值得单独说明：该文件第 11 行 import 了 `platform.ts`，会连带拖进 pg、@aws-sdk、@nestjs 一整棵依赖树，而 9p 挂载下 `node_modules` 的顶层与包内相对符号链接全部断裂。沙箱里的做法是把 `apps/api/src` 与 `packages/contracts` 复制到 `/tmp`，用绝对符号链接指向 `.pnpm` 里的实体包，缺一个补一个迭代 12 轮补齐 pg 与 aws-sdk 闭包，再写一个把 `.js` 相对导入改写到 `.ts` 的 ESM resolver，用 `node --experimental-transform-types` 跑。断言用的是自写 vitest 兼容垫片，匹配器全部真实断言。测试文件本体是仓库原文件，只改了导入扩展名。
- **变异测试 6 项全被抓到**：令牌 `sub` 用回 `platform_subject`、撤权改用身份主体、不签发 id_token、CLI 路径也签发 id_token、id_token 的 aud 用错、授权码不携带 nonce——每项都让对应新断言失败（1 至 4 条不等），每次改后都与仓库文件 `diff` 一致。
- **`tests/infra/self-managed-bootstrap.test.ts` 6/6 通过**（重构后复跑）。
- **类型检查**：用 `typescript@6.0.3`（仓库锁定的 7.0.2 在 Linux 无可执行文件，沿用既有偏差）+ `paths` 指向实体 `jose` 与 contracts 声明，按 `tsconfig.base.json` 逐项复刻严格配置，覆盖 `identity/local/*`、`identity/adapter.ts`、`errors.ts`、两个测试文件与 `self-managed.ts`：**改动范围内 0 错误**。全程序另有 35 个错误，全部位于我未改动的文件，且全是 `pg`/`@aws-sdk`/`@company/contracts/preview` 无法解析级联出的 TS7006/TS2307/TS18046；同一配置跑改动前的基线，同类错误同样存在。
- 期间类型检查真抓到两个缺陷：`seedFirstLocalAdministrator({strict:true})` 的返回值收窄不了导致 `seeded.username` 报 TS2339（改用重访解决），以及重载插入时多写了一行实现签名造成 TS1005。

## E. 仍未验证

`apps/api` 全量 `typecheck` 与 `build`（无 pnpm、Node 22.23.5 vs 固定 26.13.0）；`tests/platform/**` 的真实 PostgreSQL 集成；修好 `sub` 与 `id_token` 之后的**真实网页登录回跳与首次改密**（需要真实 HTTPS 入口与浏览器）；CLI 真实 PKCE 回环。宿主待跑：

```powershell
.\scripts\pnpm.ps1 typecheck
.\scripts\pnpm.ps1 build
.\scripts\pnpm.ps1 exec vitest run tests/unit/local-identity.test.ts tests/infra/self-managed-bootstrap.test.ts
.\scripts\pnpm.ps1 exec vitest run --config tests/platform/vitest.config.ts tests/platform/managed-accounts.test.ts
.\scripts\pnpm.ps1 test:browser
```

判定口径：管理员能用临时口令登录并在首次登录时改密；网页回调拿到含正确 `nonce` 与 `sub` 的 id_token；CLI 回环登录不因新增 id_token 而回归；停用成员后已有会话与预览授权立即失效，且按平台主体删除。
