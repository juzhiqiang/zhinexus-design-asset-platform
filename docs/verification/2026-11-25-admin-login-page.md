# 后台管理登录页（2026-11-25）

本轮把 `PLATFORM_IDENTITY_MODE=local` 下后台管理的网页登录从「跳到一段 JSON」补成真正的登录页。
分支 `feat/admin-login-page`，基于 `54bf15ca`（main，0.1.6）。

## 1. 缺口定位

点后台任一页的「账号登录」会到 `${API}/v1/auth/oidc/start?target=admin`，`CompanyOidc.start` 再 303 到
发现文档里的 `authorization_endpoint`。本地模式下这个端点就是本进程的 `GET /identity/authorize`，
而它返回的是 `describeAuthorization()` 的 **JSON 描述符**——`service.ts` 的注释自己把这记为
「a known limitation」，即「表单由画廊渲染，本轮不发原生 HTML 登录页」。浏览器拿到这段 JSON 无从下手。
画廊侧同样没有登录页，本轮按用户选择只做后台。

## 2. 做法

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

## 3. 实际执行的验证

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

## 4. 未验证 / 边界

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

## 5. 顺手发现的两处既有问题（未修，不属于本轮范围）

1. `tests/admin/console-render.test.ts` 的「全部画板的类名与 CSS 变量都在 globals.css 中有定义」
   在 HEAD 上就失败：`upload/page.tsx` 与 `categories/page.tsx` 渲染出 `catalog-toolbar`、
   `search-box`，而 `globals.css` 没有这两个类。已用 `git show HEAD:` 取原版复现确认与本轮无关。
2. 同一文件的 `renderPage` 加载器类型写成 `{ default: () => unknown }`，让带 props 的画板
   （`/jobs/[jobId]`）在类型上就不合法，HEAD 上就有 2 条 TS2322/TS2345。本轮因为要加 `/login`
   一并改成 `{ default: unknown }`，这 2 条随之消失。

## 6. 共享工作树提醒

本轮进行中，另一名代理把同一工作树切到了 `feat/juz-browser-install`（0.1.7 + Chromium 自动下载），
我的未提交改动被带到那个分支上。已确认两边文件无交集后 `git checkout feat/admin-login-page` 返回，
改动完整。**提交前必须重新核对分支，不能只信开工时那一次。**
