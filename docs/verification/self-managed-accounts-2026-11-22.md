# 自主管理账号与权限后台 本地验证记录

日期：2026-11-22，Asia/Shanghai。分支 `feat/self-managed-accounts-impl`，基线 `d700802d`，版本升至根 `0.0.10` / API `0.0.12` / 画廊 `0.0.13` / 预览网关 `0.0.5` / CLI `0.0.27`。

设计见 [2026-11-22 自主管理账号设计](../superpowers/specs/2026-11-22-self-managed-accounts-design.md)，实施计划见 [2026-11-22 实施计划](../superpowers/plans/2026-11-22-self-managed-accounts-implementation.md)，部署与恢复见 [自管账号栈说明](../self-managed-accounts.md)。

## 1. 实际执行的命令与结果

沙箱环境：Linux，Node 22.23.5，无 Docker、无 PostgreSQL、无 MinIO；Windows 侧 `node_modules` 符号链接在挂载下不可读。因此本轮在沙箱内自建轻量验证环境（npm 平铺 `node_modules` + 源码 tar 副本 + 手编 `dist`）执行下列命令，**未**使用 Turbo 缓存命中代替结果。

| 命令 | 结果 |
| --- | --- |
| `tsc -p packages/contracts/tsconfig.build.json` | 通过，0 错误 |
| `tsc -p apps/api/tsconfig.json --noEmit` | 通过，0 错误 |
| `tsc -p apps/api/tsconfig.build.json` | 通过，产出 `dist/` |
| `tsc -p apps/preview-gateway/tsconfig.json --noEmit` 与 build | 通过，0 错误 |
| `tsc -p apps/gallery/tsconfig.json --noEmit` | 通过，0 错误 |
| `tsx scripts/verify-workspace.ts` | `Workspace verified: 10 members, no cycles, four publishable shells, safe service graph.` |
| `vitest run tests/contracts` | 20 文件 550 测试全部通过（新增 21 项自管账号契约反例） |
| `vitest run tests/unit` | 22 文件通过、10 文件因沙箱缺 `pnpm` / `@playwright/test` / `vite` / charts 未构建而失败，均为环境限制而非回归 |
| `vitest run tests/gallery` | 通过 |

`tests/unit` 的 10 个失败文件在改动前的同一沙箱基线中同样失败（基线为 13 个失败）；补齐 `yaml` 依赖后其中 3 个转为通过，净失败数下降。逐个核对失败原因：`spawn pnpm ENOENT`、`Cannot find package '@playwright/test'`、`Cannot find package 'vite'`、charts-vue `dist` 未构建，均与本轮改动无关。

## 2. RED → GREEN

- `tests/contracts/managed-accounts.test.ts`：先写测试并运行，21 项因 `normalizeManagedAccountUsername is not a function` 等失败（RED）；实现 `packages/contracts/src/managed-accounts.ts` 后 21 项全部通过（GREEN）。
- `tests/unit/managed-accounts-auth.test.ts`：实现后新增，15 项一次通过（覆盖账号版本、`auth_time`/`iat` 边界、管理员强制与队列约束）。
- `tests/platform/managed-accounts.test.ts`：按真实 PostgreSQL + MinIO 编写，**本轮未执行**（沙箱无 Docker）。

## 3. 期间发现并修复的实现缺陷

1. `ManagedAccountsService.verifiedAccount` 原先按 `accountVersion` / `authTime` 读取声明，而认证链路传入的是原始 JWT 声明 `platform_account_version` / `auth_time` / `iat`，会导致所有自管令牌被拒绝。已改为直接消费签名声明，并由单测固定口径。
2. `packages/component-cli/src/contracts/` 的契约内联镜像缺少 `managed-accounts.ts`，`tests/unit/access-credentials.test.ts` 因此无法加载。已同步镜像并登记到 `scripts/sync-contracts.mjs`。
3. `CompanyOidc.authenticate` 在「未激活任何接入配置」的分支原先完全跳过自管声明核验。已改为同样核验签名账号版本与认证时间，失败关闭。
4. `tests/unit/access-generation.test.ts` 的 fallback 替身只提供 `verify`；`OidcVerifier` 新增 `verifyWithClaims` 后已同步该替身，并补一项「无激活配置仍核验自管声明」的用例。

## 4. 未覆盖边界（不得据本记录声称已完成）

| 项目 | 状态 |
| --- | --- |
| 真实 Keycloak 集成：`platform_account_version` 与 `auth_time` 是否出现在 access token | **未验证**；realm 模板已声明 mapper，`infra/self-managed-versions.json` 记录为待实测 |
| 首次改密（`UPDATE_PASSWORD`）后的登录与 `auth_time` 变化 | **未验证** |
| Keycloak 版本与镜像 digest | **未固定**；compose 通过 `${SELF_MANAGED_KEYCLOAK_IMAGE:?...}` 失败关闭，不拉取 `latest` |
| `tests/platform/managed-accounts.test.ts` 真实 PostgreSQL 集成（含 HTTP/网关并发、故障恢复） | **未执行**，沙箱无 Docker |
| `pnpm test` 根回归（2292+ 用例）、`pnpm build` 全图、`test:browser` | **未执行**，沙箱无 pnpm 与 Playwright 浏览器 |
| 本机浏览器验收（管理员完整成员管理、非管理员拒绝、首次改密回跳、Vue/React 预览、旧授权撤销） | **未执行**，浏览器只能在开发者电脑运行 |
| 撤权时限实测（提交时刻 / 各路径首次拒绝时刻 / 请求结果） | **未实测**；设计第 5 节的生产目标时限仍待部署负责人确认 |
| 正式部署验收、公司部署责任与双业务试点 | **未开始**，独立记账 |

## 5. 合并结果

2026-11-22 以 `--no-ff` 合并入 `main`，合并提交 `8ce44290`（父提交 `b6656819` + `b4ea3cdf`），62 个文件、约 3600 行新增。合并前重查：`main` 仍停在 `b6656819`、主工作树干净、`main` 未被其他 worktree 检出；合并后核对 `git diff --name-only b6656819 8ce44290` 为 62 个文件（非空），逐个确认关键文件已进入合并树。

合并后在合并结果上重跑：contracts / api / gateway / gallery 四项 typecheck 0 错误、`verify:workspace` 通过、`tests/contracts` + `tests/unit` + `tests/gallery` 52 文件通过（950 项断言通过）、10 文件因沙箱缺 `pnpm` / `@playwright/test` / `vite` / charts 构建失败。与合并前分支结果逐项一致，合并未引入差异。

`main` 领先 `origin/main` 8 个提交，**尚未 push**（push 需用户明确授权）。分支 `feat/self-managed-accounts-impl` 与 `feat/self-managed-accounts` 保留未删，是否清理由用户决定。

## 6. 边界与安全自查

- 迁移 `012_managed_accounts.sql` 不存储任何密码材料；`identity_operations` 的 CHECK 约束不含密码类操作，密码设置只能走瞬时受保护请求。
- 账号视图契约（`managed-account-summary/detail/list-response/audit-response`）一律 `additionalProperties: false`，单测覆盖拒绝 `password`、`remoteUserId`、`token`、`secretRef` 等字段。
- 身份管理出站复用 `RestrictedHttps` 的部署白名单、地址固定与平台信任库；服务账号取 realm 内 `manage-users`、`view-users`、`query-users`、`query-groups`、`view-realm`，缺失任一即拒绝授权。
- `infra/gateway/preview-role.sql` 仅新增 `managed_accounts` 的 `SELECT`，网关不获得写权限。
- 本机身份栈凭据、CA 私钥与 TLS 私钥只写入 `.tools/self-managed/`（`.gitignore` 已覆盖 `.tools/`），初始超管密码仅在 bootstrap 控制台打印一次。
