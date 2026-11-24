# 画廊公开 / 内网管理端拆分：独立安全边界审查

> 历史基线（2026-11-24）：本文为 Claude 桌面端在拆分集成前的只读审查，保留当时发现与未执行声明。“当前代码”“尚未实现”不表示最终集成状态。双 origin/target、前端拆分与私有目录、真实 Nginx 测试均已随后落地；最终以 [集成验证记录](2026-11-24-gallery-admin-split.md) 和 [部署指南](../guides/gallery-admin-deployment.md) 为准。

审查范围：`feat/gallery-admin-ingress` 工作树上 `D:\project` 同一提交内容的**只读**审查，加上本文件所属的入口模板实现说明。审查未修改任何 API、前端、根配置、锁文件或既有文档；本文件与 `infra/gateway/{gallery-public,admin-internal}.conf`、`docs/guides/gallery-admin-deployment.md`、`tests/infra/gallery-admin-ingress.test.ts` 是本任务唯一写入范围。
结论先行：**技术侧的数据边界基本是对的，问题集中在三处——公网入口根本没有可验证的制品、公开页把硬编码样例冒充成 Ready 资产、以及 API 只认一个浏览器 Origin 导致「公开画廊」与「内网管理」在当前代码里无法同时成立。** 第三点必须由 API 子任务先落地（`PLATFORM_ADMIN_ORIGIN` + 登录 target 绑定），否则入口模板只能保护「公网看不到管理 UI」，保护不了「公网不能写管理 API」。

## 阅读约定

- 「静态核查」= 已读到源码 / 迁移 / 配置原文并引用行号。本报告**没有任何运行时执行**：未启动服务、未跑测试、未发 HTTP 请求。凡未执行的部分，文中一律写「未执行」，不写成已验证。
- 「推断」= 由代码结构推导、未在运行时证实。
- 严重度：P0 = 拆分上线前必须解决；P1 = 上线前应解决或有明确缓解；P2 = 记录并排期。

---

## P0-1 公网入口在仓库里没有任何制品，「白名单只开放浏览/登录/预览」目前不可执行也不可验证

静态核查：`apps/api/src/server.ts:6` 在 `PLATFORM_BIND_HOST=0.0.0.0` 时绑 `0.0.0.0`；`infra/compose.production.yaml:15` 正是该值，且 api 服务挂在 `networks: [backend, edge, egress]`（同文件 12 行）。`infra/gateway/` 只有 `preview.conf` 与 `preview-ip.conf`，两者都 `proxy_pass` 到 `127.0.0.1:3001`，没有任何面向 3000 或前端的反代/TLS 配置。`infra/compose.production.yaml` 的 services 也只有 api / worker / preview-gateway / postgres / verdaccio / minio，没有 gallery、没有 admin、没有 ingress。

推断：也就是说「公网入口白名单」「API 源站不直接公网暴露」「管理 API 只经内网」这三条当前**完全依赖仓库之外的边缘配置**，仓库内没有可复现、可测试的对应物。`tests/platform/access-ingress.test.ts` 只覆盖预览网关入口，不覆盖 API 入口。

最小实现（本任务已交付）：`infra/gateway/gallery-public.conf` 用「精确 `location =` + 受约束正则」表达公开白名单，其余 `/v1/`、`/identity/`、`/internal/` 一律 `return 404`；内部写路径（`releases`/`uploads`/`baselines`/`search`/`matching`/`access-settings`/`managed-accounts`、`variant-releases/:id/deprecate`、`auth/oidc/candidate*`、`/internal/`）在同一 API hostname 上按可信网络来源门控，`geo` 块 `default 0` fail-closed。`infra/gateway/admin-internal.conf` 只在内网 listener 上提供 admin 5177，并显式 404 `/v1/`、`/identity/`、`/internal/`，避免形成第二个 API 入口。

验收用例：见下文「验收用例」第 1–3 组；行为矩阵在 `tests/infra/gallery-admin-ingress.test.ts`。

## P0-2 公开画廊把硬编码样例冒充成 Ready / local-automatic / accepted / indexed

静态核查：`apps/gallery/app/lib/catalog.ts:8-265` 的 `OFFICIAL_COMPONENTS` 对 line / bar / pie / scatter 共 8 个 variant 全部硬编码 `availability:'Ready'`、`reportSource:'local-automatic'`、`baselineStatus:'accepted'`、`indexStatus:'indexed'`、`packageVersion:'0.0.4'`、`verifiedAt:'2026-11-12T10:00:00Z'`，无任何 API 读取。

`getComponentDetail(slug)`（`catalog.ts:352-376`）**先**查 `OFFICIAL_COMPONENTS`，命中即返回，API 完全不参与。因此 `/components/line|bar|pie|scatter` 与数据库 `components.public`、`variant_releases.availability` 无关，恒定渲染成已发布、已自动验证、基线已接受、已索引。

`getCatalogComponents()`（`catalog.ts:296-347`）在 API 可达时用硬编码条目**整体替换** API 结果（`const known = OFFICIAL_COMPONENTS.find(...); if (known) items.push(known)`），所以 API 的真实 `packageVersion` / 状态同样被 0.0.4 常量覆盖。`(public)/components/page.tsx:11-12` 还额外传一份 `allowFallback` 数据，`CatalogViewer.tsx:120-129` 提供一个无需登录的「浏览官方预置资产规范」按钮，点一下即展示这 4 个假 Ready 资产。

这与已签规格直接冲突。`docs/specs/2026-11-11-gallery-next-public-private-rendering.md` 第 28 行原文：「本次没有真实目录契约或 Ready 资产，公开入口只保留诚实的空状态，不使用伪造组件或兼容性信息充当索引内容。」`rules/architecture.md` 的「状态正交分离」与 `AGENTS.md` 的「Ready 与可信度状态分离」同向。拆分计划第 19 行也重申：「gallery 公开页面不得把静态示例的版本/检查状态伪装为实时 Ready 资产；演示若保留必须独立明确标记，不绕过目录授权。」

更糟的是测试给了虚假保证：`tests/browser/gallery-rendering.spec.ts:35` 标题是「component detail paths stay unavailable until public catalog data exists」，实际只请求 `/components/not-published` 并断言 404；把 `line/bar/pie/scatter` 在库里改成 `public=false` 甚至清库，该测试仍然全绿。同文件 `:52-55` 断言状态看板显示 `local-automatic` / `accepted` / `indexed` / `@company/charts-vue@0.0.4`，`:98-124` 断言 4 张硬编码卡片——即测试主动锁定了这个冒充行为。另外 `tests/playwright.config.ts` 的 webServer 只起 5173/5174/5175/5176，**不起 API**，所以这些浏览器断言全部跑在硬编码数据上。

最小实现：公开目录与详情只认 `GET /v1/components` 与公开详情的真实响应；API 不可达时返回诚实空态，不提供 fallback 列表开关；演示数据若要保留，放到明确标注为「示例规范、非平台资产」的独立路由，并在该路由输出 `noindex`。同步把 `gallery-rendering.spec.ts` 改成「库内非公开 ⇒ 详情 404」的真实断言（需要测试 harness 起一个可注入的 API stub，而不是不起 API）。

验收用例：见第 4–6 组。

## P0-3 任何非硬编码的新组件，公开详情页会 500 而不是 404

静态核查：`getComponentDetail` 对 API 命中但不属于四个硬编码 id 的组件返回 `variants: []` 与 `defaultVariant: null as unknown as ComponentVariantMeta`（`catalog.ts:369-370`）。`lib/types.ts:39-47` 把 `variants` 与 `defaultVariant` 都声明为非空。`ComponentDetailViewer.tsx:18-21` 三级回退全空 ⇒ `activeVariant === null`，`:25` 读 `activeVariant.framework` 抛 TypeError。`as unknown as` 绕过编译期检查，SSR 渲染期崩溃 ⇒ 500。

影响：公开目录列表（`getCatalogComponents` 为未知组件合成了一个 `defaultVariant`）会渲染卡片并链接到详情，点进去就是 500。新资产一旦获准公开，公开画廊立刻坏掉。

最小实现：`getComponentDetail` 对无法映射到完整 `ComponentVariantMeta` 的 API 结果返回 `null`（走 `notFound()`），或把 `defaultVariant` 改为可选并在 viewer 里显式处理空态。

## P0-4 API 只有一个浏览器 Origin，公开画廊与内网管理端当前无法同时成立

静态核查：`apps/api/src/platform.ts:27-33` 的 `validateGalleryOrigin` 只接受**一个** origin，`PlatformOptions` 里只有 `galleryOrigin?: string`，`environmentOptions()` 也没有任何 `PLATFORM_ADMIN_ORIGIN`。这一个值被四处消费：

| 消费点 | 位置 | 加 admin 后的后果 |
| --- | --- | --- |
| CORS allowlist | `app.ts:48-52`，`origin: (o,cb)=>cb(null, o === platform.galleryOrigin)` | admin origin 的浏览器响应被拦；反过来 gallery origin 仍可调全部管理写接口 |
| CSRF Origin 比对 | `app.ts:37-47` | 同上；且这是 Cookie 通道的唯一 CSRF 防线 |
| OIDC 回调跳转 | `access/oidc.ts:150,159` | 登录后永远回 `galleryOrigin + '/upload'` |
| 预览 `platformOrigin` | `platform.ts:120-123`，`galleryOrigin !== preview.platformOrigin` 直接抛 `INVALID_SCHEMA` | 复用该字段会再次触发冲突 |

还有一条硬约束：`access/service.ts:103` 与 `access/oidc.ts:130` 都要求 `webRedirectUri === apiOrigin + '/v1/auth/oidc/callback'`，`validateAccessOptions`（`access/service.ts:39`）同样校验。**公司 IdP 只会往这一个 URL 回调**，所以网页登录必须落在单一 API hostname 上，会话 cookie 也必须由那个 hostname 签发。

现状的方向正好是反的：公开来源（gallery）拥有全部 API 能力，未来的内网来源（admin）会被 CORS 挡死。`tests/unit/api-cors.test.ts:35-42` 明确锁定了单 origin 行为，加第二个 origin 必须同步改这个测试。

最小实现（属 API 子任务范围，本任务不改）：把 `galleryOrigin` 演进为 `browserOrigins: string[]`，CORS 与 CSRF 都按集合精确比对；`oidc_attempts` 增加服务端绑定的登录 target（gallery / admin），回调按绑定值跳转，**不接受浏览器自报的 return URL**；候选验证固定回 admin。

验收用例：见第 7–9 组。

## P0-5 登录回调硬编码 `/upload`，而 `/upload` 正在搬去 admin

静态核查：`access/oidc.ts:159` 普通网页登录成功后 `return { location: this.settings.galleryOrigin + '/upload', cookie: ... }`；`:150` 候选流程 `return { location: this.settings.galleryOrigin + '/access-settings?candidate=passed' }`。`oidc_attempts` 插入（`:118`）的字段是 `state_hash,browser_hash,revision,generation,candidate,verifier,nonce,expires_at`，只有布尔 `candidate`，没有「哪个前端发起的」标识。

后果：`/upload` 移走后，从画廊登录会被 303 到一个不存在的路由。若为了修它而加一个 `returnTo`/`redirect` 查询参数且不做同源白名单，就等于在 OIDC 之后引入开放重定向。

最小实现：`GET /v1/auth/oidc/start?target=gallery|admin`（计划第 16 行已定），target 在服务端校验后写入 `oidc_attempts`，回调只按绑定值跳 `galleryOrigin + '/library'` 或 `adminOrigin + '/upload'`；缺省 gallery；未知 target 拒绝；候选始终回 admin `/access-settings`。入口侧配套：`/v1/auth/oidc/start` 与 `/callback` 必须在公网白名单内（登录入口本就公开），`/v1/auth/oidc/candidate` 与两个 `candidate-*` 只能内网发起。

验收用例：见第 7、10 组。

---

## P1-6 画廊没有 `middleware.ts`，控制台页面只做客户端门

静态核查：`apps/gallery` 下不存在 `middleware.ts`（`app/` 与 `src/` 都没有）。五个 console 页面首行都是 `'use client'`，唯一门是 `useEffect` 调 `loadCompanySession()`。匿名访客仍然拿到 console 外壳与导航 HTML——`tests/browser/gallery-rendering.spec.ts:14-20` 自己就断言匿名 `GET /upload` 返回含「登录后开放」的 HTML。

这不是越权（API 是真实闸门，`platform.run` / `runAdministrator` 都会重新鉴权），但违反规格第 27 行的自述「仅隐藏客户端控件不算访问控制」的精神，并且把内网路径结构暴露给公网抓取器。`(console)/layout.tsx:4-9` 已设 `index:false, follow:false`，`robots.ts:7` 却是 `allow: '/'` 且没有 `disallow`，`sitemap.ts` 只产出 `''` 与 `/components`（这条是干净的）。

最小实现：入口层对已知 console 路径直接 404（拆分计划第 15 行已定「gallery 旧管理路由返回 404，不向公众泄露内网 URL」）；`robots.ts` 增加 `disallow` 覆盖 console 与未来的 `/library`；`/library`、`/library/[releaseId]` 必须输出 `noindex`，否则登录后私有资产的 slug 会进公开 metadata。

验收用例：见第 11–13 组。

## P1-7 登出不能撤掉 Bearer JWT；公司 OIDC 签发的 token 只能连座禁用

静态核查：`POST /v1/auth/oidc/logout`（`access/auth-routes.ts:61-66`）只 `DELETE FROM oidc_sessions WHERE token_hash=$1`，不写 `disabled_subjects`、不动 `auth_time_floor`。`CompanyOidc.authenticate` 的 `Bearer` 分支（`access/oidc.ts:79-87`）只做 JWKS 验签 + `identity_bindings` 查表，唯一否决点是 `finish() → restricted()`（`:43-47`）里的 `disabled_subjects` 与 `subject_role_restrictions`。

需要修正一个容易夸大的说法：**自管账号路径的 Bearer token 是可以撤回的。** `accounts/service.ts` 的 `tighten()` 会 `auth_time_floor = GREATEST(auth_time_floor, now)`、`DELETE FROM oidc_sessions`、撤销 `preview_grants`、清 `oidc_start_tickets`，而 `access/oidc.ts:65` 会因 `Number(row.auth_time) <= Number(account.auth_time_floor)` 直接判 `UNAUTHENTICATED`。所以准确结论是：**公司 OIDC（非自管）签发的 Bearer JWT 在登出后无法撤回，只能连座禁用整个 subject；自管账号的可以。**

叠加 `apps/gallery/app/lib/auth.ts`：`saveSession()`（`:58-72`）把原始 JWT 写进 `localStorage['zhinexus_console_auth']`；`loadCompanySession()`（`:10-19`）在 `/v1/auth/oidc/session` 返回非 OK、结构不符**或抛错**（网络错误 / 超时 / CORS 失败）时都回退到 `getStoredSession()`。所以 API 不可达时，控制台会显示一个 API 其实不认的陈旧身份（`(console)/upload/page.tsx:55-57`、`(console)/match/page.tsx:73-75` 都是先同步 `setSession(getStoredSession())`）。`tests/browser/access-settings.spec.ts:74-84` 只覆盖了「API 可达时 Cookie 优先」，没覆盖「API 不可达时陈旧 token 冒充已登录」。

最小实现：登出时对自管账号走 `tighten` 等效路径（或至少把该 subject 的 `oidc_sessions` 全清并抬 `auth_time_floor`）；公司 OIDC 部署下明确「Bearer JWT 不可撤回」并在文档里要求改用 Cookie 会话；`loadCompanySession()` 的失败回退改为「无会话」，不要用陈旧 localStorage token 冒充已登录；`saveSession()` 保留为显式的手动凭证通道，但在文档中标注其不可撤回与 XSS 暴露面。

验收用例：见第 14–16 组。

## P1-8 本地身份服务的口令端点若跟随「登录所需」上公网，就是把猜解入口挂到公网

静态核查：`apps/api/src/identity/local/controller.ts` 的 `/identity/authorize`（GET 描述表单 / POST 提交用户名口令并 303）、`/identity/token`、`/identity/jwks`、`/identity/.well-known/openid-configuration`、`/identity/password`（首次登录更换临时凭证）全部**无鉴权**。当 `PLATFORM_IDENTITY_MODE=local` 时，浏览器登录流程确实要走到 `authorize` 与 `token`（`platform.ts:62` 注释说明 issuer 就在 API origin 上）。

最小实现：入口模板默认对 `/identity/` 一律 404（fail-closed）；部署指南给出 local 模式必须显式打开的五个精确 location，并强制叠加 `limit_req` 与失败锁定；keycloak 模式下保持 404。内部入口则完整放通 `/identity/`。

验收用例：见第 17 组。

---

## P2-9 公开页硬编码陈旧版本与内网 registry 地址

静态核查：`ComponentDetailViewer.tsx:146` 公开渲染 `npm config set @company:registry http://127.0.0.1:14873/`——HTTP 且 loopback（`infra/README.md` 表格确认 14873 是本机 Verdaccio）。同页 `:26-27` 用硬编码 `packageVersion` 拼「精确版本安装命令」，公开指导用户装 0.0.4。另一个自查才发现的矛盾：详情页状态看板显示硬编码 Ready，而同屏 `EchartsCompatibility`（`:224` → `lib/echarts-compatibility.ts:40,48,57`）是**匿名直连真实 API** 的，组件未公开时会渲染「尚无公开发布，未验证兼容性」——同一页面自相矛盾。

## P2-10 拆分会先撞两个工程闸门

静态核查：`scripts/verify-workspace.ts:25` 对 `apps/`、`packages/` 下每个目录断言必须在硬编码 `expected` 表内，建 `apps/admin` 会抛 `Unreviewed workspace directory: apps/admin`。`scripts/verify-deployment.ts:18` 把 services 钉成 `['api','worker','preview-gateway','postgres','verdaccio','minio']`，13-14 行的 `networks` 映射也逐服务钉死，新增 gallery/admin 服务会同时报 `Unexpected service topology` 与 `unexpected network access`；`tests/unit/deployment.test.ts:10-13` 的负向用例会随模板变化失效。`turbo.json` 只有 `@company/gallery#build` 的包级条目，admin 需要同款条目与自己的 `NEXT_PUBLIC_*` env 清单。

## P2-11 规格与设计稿已就拆分达成一致，但旧规格文本未修订

静态核查：`docs/specs/2026-11-11-gallery-next-public-private-rendering.md` 第 5 行「用户确认按页面及数据范围区分公开和登录内容，不拆分成两个独立前端应用」，第 19 行把「不新增第二个画廊应用」列为非目标。而 `docs/plans/2026-11-24-gallery-admin-split.md:9` 明确「此决策修订固定 10 成员的历史工程约束」，`docs/design/management-api.md` 也已按管理控制台单独出稿。即：拆分已获授权，但旧规格文本仍是相反表述，`AGENTS.md` 的「唯一事实来源」会让人无所适从。建议在规格文档加一条指向拆分计划的修订说明（属 Codex 文档收口范围）。

---

## 已经核查为稳固的部分（不必重复审查）

`catalog_can_read`（`apps/api/migrations/005_catalog.sql:5-12`）的公开/私有切分是对的：`actor IS NULL` 只给 `c.public`，非公开必须命中 `component_permissions` 的 `can_read OR can_publish OR can_maintain`，且被禁 subject 连公开资产也读不到。`catalog/routes.ts:11-19` 用 `originalUrl.startsWith('/v1/me/')` 分流，公开路径传 `subject = null`。`catalog/service.ts:55` 的 `PlatformError('NOT_FOUND', [], subject !== null)` 第三参数名是 `authorizationDenied`，`errors.ts` 与 `http.ts` 的 `ErrorFilter` 都不读它，**它只影响审计事件记哪个 code，不改变 HTTP 响应**——匿名与已登录未授权拿到的都是 404 + 相同 body，不存在存在性披露（这一点比初判更强，但机制解释与初判不同）。`catalog/service.ts:84-87` 的 artifact 读取做了对象键/摘要/字节数三重核对后再复读一次 `find()`。预览 grant（`preview/service.ts`）5 分钟过期、记 `account_version`、`tighten` 时统一撤销、iframe 在 ip-port 模式用 `allow-scripts` 不透明源。`RestrictedHttps` 对 OIDC 出网做 hostname/port/CIDR 钉死。`access/service.ts` 的 generation + evidence 15 分钟窗口模型完整。`compose.production.yaml` 的只读/降权/无端口暴露/摘要钉死由 `verify-deployment.ts` 强制。

---

## 验收用例与已有测试路径

既有可复用测试：

| 关注点 | 路径 |
| --- | --- |
| CORS 单 origin 现状（加 admin 必改） | `tests/unit/api-cors.test.ts` |
| Cookie 通道 CSRF 403 + 审计不落凭证 | `tests/platform/access-cookie.test.ts` |
| 预览入口真实 Nginx 行为（本任务测试的写法范本） | `tests/platform/access-ingress.test.ts` |
| 公开/私有目录、404 语义、撤权即时生效、禁用 subject | `tests/platform/catalog.test.ts:12-87` |
| 目录身份与报告来源独立 | `tests/platform/catalog-identity.test.ts`、`catalog-reports.test.ts` |
| 出网钉死 | `tests/integration/access-network.test.ts` |
| JWT 验签/伪造/渠道声明 | `tests/integration/auth.test.ts` |
| 接入设置 generation/evidence/审计 | `tests/platform/access-settings.test.ts`、`tests/platform/access-oidc.test.ts` |
| 预览授权与沙箱 | `tests/platform/preview.test.ts`、`preview-ip-port.test.ts`、`tests/browser/gallery-preview-grants.spec.ts` |
| 自管账号与强制登出 | `tests/platform/managed-accounts.test.ts`、`tests/unit/managed-accounts-auth.test.ts` |
| 部署模板与环境变量 | `tests/unit/deployment.test.ts`、`tests/unit/production-preflight.test.ts` |
| 工作区成员与依赖方向 | `scripts/verify-workspace.ts`（`pnpm verify:workspace`） |
| 公开/私有渲染边界（需按 P0-2 重写） | `tests/browser/gallery-rendering.spec.ts` |
| 控制台登录门（需补 API 不可达用例） | `tests/browser/access-settings.spec.ts` |

新增（本任务）：`tests/infra/gallery-admin-ingress.test.ts`——配置语义守卫（无 Docker 也执行）+ 真实 Nginx 代理行为矩阵（需 Docker）。

建议新增（属其他负责人范围，此处仅列用例）：

1. 公网入口访问 `/upload`、`/users`、`/access-settings`、`/match`、`/jobs/*` 返回 404；未知路由、`%2e%2e`、`%2f`、双斜杠、伪造 `X-Forwarded-For` / `Forwarded` / `X-Forwarded-Host` 不放行。
2. 公网入口对 `POST /v1/releases`、`POST /v1/uploads`、`POST /v1/baselines`、`POST /v1/variant-releases/:id/deprecate`、`/v1/access-settings*`、`/v1/managed-accounts*`、`POST /v1/search/candidates`、`POST /v1/matching/plans` 一律 403 且上游未收到请求；换成可信网络来源则放行但仍需鉴权。
3. API 源站 3000 不可从公网直接寻址；只有入口 hostname 可达。
4. 库内 `components.public=false` 时 `/components/<slug>` 返回 404；`public=true` 且 `availability='Ready'` 时返回 200 且状态来自 API 而非常量。
5. 停掉 API 时公开目录显示诚实空态，不出现四个预置组件，不出现 Ready / local-automatic / accepted / indexed。
6. 新发布且获准公开的组件（非 line/bar/pie/scatter）详情页返回 200 而非 500。
7. `GET /v1/auth/oidc/start?target=admin` 登录后落在 admin `/upload`；`?target=gallery` 落在 gallery `/library`；缺省 gallery；`?target=evil` 与任意 `returnTo` 被拒绝。
8. admin origin 的 CORS 预检被允许、gallery origin 也被允许、相似子域 / 不同端口 / `null` / 预览 origin 被拒绝（扩展 `tests/unit/api-cors.test.ts`）。
9. admin origin 携带 Cookie 的 POST 被接受；一个不在白名单的 origin 携带 Cookie 的 POST 返回 403（扩展 `tests/platform/access-cookie.test.ts`）。
10. 候选登录只能从内网发起；公共回调能消费已绑定 state，但绑定为 admin 的 attempt 不会把浏览器送回 gallery。
11. 画廊旧管理路由 404，且响应体不含任何内网 hostname。
12. `/library` 与 `/library/[releaseId]` 输出 `noindex`，不出现在 `sitemap.xml`。
13. `robots.txt` 对 console 与 `/library` 有 `disallow`。
14. 登出后 Cookie 会话立即可用性消失（`oidc_sessions` 行已删）。
15. 登出后此前保存的 Bearer JWT 仍可用 ⇒ 记录为已知缺口或按 P1-7 修复后转为不可用。
16. `disable` / `force-logout` 后，同一 subject 的 Cookie 会话、Bearer JWT（自管）、未消费 preview grant 全部失效。
17. local 身份模式下 `/identity/password` 在公网入口被 `limit_req` 限流；keycloak 模式下 `/identity/*` 在公网入口 404。
18. 无权限账号（有 reader 角色但无 `component_permissions`）读私有资产 404；有权限可读；撤权后立即可读性消失。

---

## 入口层补充发现（本任务范围）

### P1-12 `?revision=` 是管理员级候选配置入口，路径白名单挡不住

静态核查：`apps/api/src/access/auth-routes.ts:22-27` 的 `GET /v1/auth/oidc/start` 接受 `@Query('revision')`，且 `if (revision) await this.platform.runAdministrator(...)`；`access/oidc.ts:110-121` 的 `start(candidate, expectedGeneration)` 会拿这个 revision 去查 `access_revisions` 并用它的配置发起登录。`GET /v1/auth/oidc/cli`（同文件 `:52-56`）同样接受 `revision` 并走 `runAdministrator`，`cliMetadata(revision)` 返回候选配置。

也就是说：**只做路径白名单不够，`/v1/auth/oidc/start?revision=<uuid>` 会落到管理员门后面**。API 侧有 `runAdministrator` 兜底，但公网入口不应该提供这个入口。

已交付：`gallery-public.conf` 对 `$args`（原始未解码查询串）做字面量比对，`/v1/auth/oidc/start` 只放行「无参数」「`target=gallery`」和「`target=admin`（仅可信来源）」；`revision=`、`rev%69sion=`、`revision=a&revision=b`、`target=gallery&revision=...`、`target=evil`、`TARGET=gallery`、重复 `target`、任意 `redirect`/`return` 全部拒绝。回调只放行 `code`/`state`/`iss`/`session_state` 四键。`/v1/auth/oidc/cli` 整体移出公网白名单（画廊不调用它），只在可信来源可达。

### P1-13 同一路径的 GET 公开、POST 是管理写操作

静态核查：`apps/api/src/compatibility/controller.ts:13-24` 的 `POST /v1/variant-releases/:id/compatibility` 走 `platform.run(auth,'baseline',...)`，即 maintainer 角色；而同路径的 `GET`（`:26-36`，非 `/v1/me/` 分支）传 `subject = null`，匿名可读。

已交付：compatibility 单独一个 location（必须排在通用 variant 读正则之前，nginx 按出现顺序取首个命中的正则），用 `map "$request_method:$public_api_trusted_network"` 让 GET/HEAD/OPTIONS 公网可达、POST 只在可信来源可达。其余公开读路径一律 `limit_except GET HEAD OPTIONS { deny all; }`。两个 Next.js location 不设方法限制——App Router Server Actions 是 POST。

### P1-14 `/v1/me/components` 是私有目录的读取入口，不能漏

`apps/gallery` 登录后要读 `/v1/me/components`（拆分计划第 13 行）。它在通用 variant 读正则的覆盖范围之外（路径是 `/v1/me/components`，不以 `variant` 开头），必须单独列名。**初稿漏了它**，已补为 `location = /v1/me/components`。

### P2-15 穿越检查不能扫查询串

初稿用 `map $request_uri` 直接匹配 `%2f` / 反斜杠，会把 `?path=docs%2Fline-vue.md`（合法材料查询）和 OIDC 的 `code` / `iss` 值一起拒掉。已改为两段式：先用 `~^(?<public_path>[^?]*)` 把路径切出来，再只对路径做穿越检查；查询串交给各端点自己的策略。

### P2-16 两个 Next.js 前端不能被 `limit_except` 打断

`limit_except` 用在 `location /`（画廊 / 管理端）会把 Next.js App Router 的 Server Action POST 打死。已确认两个前端 location 不设方法限制，并在守卫里断言这一点。

---

## 本任务交付物与执行情况

| 文件 | 内容 |
| --- | --- |
| `infra/gateway/gallery-public.conf` | 公网入口：画廊 hostname + 唯一 API hostname；`/v1/` 精确白名单 + 默认拒绝；方法策略；查询串策略；只查路径的穿越检查；内部写路径按可信网络来源门控；转发头覆盖；不含查询串的日志格式 |
| `infra/gateway/admin-internal.conf` | 内网入口：admin hostname + **同一个** API hostname；整体按可信网络来源门控；显式 404 `/v1/`、`/identity/`、`/internal/`，避免形成第二个 API 入口 |
| `tests/infra/gallery-admin-ingress.test.ts` | 4 条失效安全守卫（无 Docker 也执行）+ 8 条真实 Nginx 代理行为测试（需 Docker，固定镜像 `nginx@sha256:124b44bf…`） |
| `docs/guides/gallery-admin-deployment.md` | 单 hostname 决策依据、白名单表、查询串策略表、替换清单、本地身份模式决定、前置条件、运行命令与边界 |
| `docs/verification/gallery-admin-security-review.md` | 本报告 |

**已执行**（沙箱内，无 Docker、无 nginx）：

- `vitest run tests/infra/gallery-admin-ingress.test.ts` → 4 passed / 8 skipped（8 条行为测试因无 Docker 跳过）。
- 括号配平与 location 计数核对两个模板。
- 按 nginx「精确 → 最长前缀 → 按顺序首个正则」规则模拟 28 条 URI 的路由决定，与部署指南表格一致（含 compatibility 必须先于通用 variant 读）。

**未执行**（沙箱无 Docker / 无 nginx，需在 Windows 宿主复跑）：

- `nginx -t` 语法校验。
- 全部 8 条真实代理行为测试（TLS 握手、真实 HTTPS 请求、可信 / 不可信两个容器、上游观察转发头）。
- 任何服务启动、构建或集成验证。

**测试写法说明**：行为测试用两个只差可信来源 CIDR 的容器，把网络门控的放行与拒绝两条分支都跑真实请求；上游是 `node:http` 服务（因为 `proxy_pass http://`），TLS 客户端是 `node:https`；`IncomingHttpHeaders` 取自 `node:http`。守卫刻意保持很小——它检查的每一条都能在 Part 2 找到对应的真实行为覆盖，它只负责抓住那些在宿主导机上难以阅读的失败（括号失衡、漏 server_name、location 重新定义转发头）。
