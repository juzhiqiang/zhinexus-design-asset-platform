# 画廊与内网管理端拆分实施计划

**Goal:** 按 2026-11-24 用户授权，将公开画廊（包含登录后有权限才能读取的内部资产）与只部署在内网的管理平台拆为两个独立前端，并完成验证、聚焦提交和本地 main 合并。

**Architecture:** `apps/gallery` 保留 5173；新增私有包 `apps/admin`（`@company/admin`，5177）。两个 Next.js 应用独立构建、导航、样式、发布，共用 API 3000、契约与既有身份体系；预览网关 3001 保持隔离。工作区从 10 增至 11 个成员。公网入口只代理明确允许的目录/详情/材料/身份/预览路由；管理页面和管理 API 路由只经内网入口提供，真实发布仍需配置公司 VPN/防火墙/TLS。

**Tech Stack:** 沿用 React 19.3.1、Next.js 16.4.6、NestJS 12.4.2、Node 26.13.0、pnpm 12.18.0、Turbo 2.11.10；不新增运行时依赖。

**Spec:** 用户在本对话明确授权拆分、委派反重力与 Claude 桌面端、验收提交并合并 main。此决策修订固定 10 成员的历史工程约束；原始 `component-platform-architecture.md` 字节保持不变。当前分支上的本地身份服务、设计稿和其他未提交工作不纳入本任务。

## 访问与接口决定

- 公开目录继续使用 `/v1/components` 与公开详情；内部目录使用 `/v1/me/components` 和 `/v1/me/variant-releases/:id`。是否可读完全由现有 `catalog_can_read` 和有效身份决定，登录不自动授予全部内部资产权限。
- gallery 新增 `/library` 和 `/library/[releaseId]` 作为登录后的目录/详情入口；私人数据仅客户端取得，不进入公开 HTML、metadata、sitemap 或共享缓存。登出/401/403 清除页面中的私人数据。
- `/upload`、`/jobs/[jobId]`、`/match`、`/users`、`/access-settings` 从 gallery 移至 admin，admin 首页引导到发布控制台。gallery 旧管理路由返回 404，不向公众泄露内网 URL。
- 两个前端各自持有小型 auth helper；不跨包相对导入源码。admin 登录入口固定 `GET /v1/auth/oidc/start?target=admin`；gallery 使用 `?target=gallery`。缺省 target 为 gallery。拒绝未知 target/任意 return URL；候选配置验证始终返回 admin。
- API 新增精确配置 `PLATFORM_ADMIN_ORIGIN`，校验 HTTPS 或开发环回 HTTP；CORS/CSRF 仅允许明确 gallery/admin origin。两者共享身份服务，OIDC attempt 持久化 target 后回跳 gallery `/library` 或 admin `/upload`，候选验证回 admin `/access-settings`；不信任浏览器自报权限。
- 内部资产维持现有默认非公开和逐组件授权；本次不自动公开任何数据库资产，不部署生产入口。
- gallery 公开页面不得把静态示例的版本/检查状态伪装为实时 Ready 资产；演示若保留必须独立明确标记，不绕过目录授权。

## 所有权与执行顺序

1. **Codex（C/架构与集成）**：本计划、根工作区登记/Turbo/锁文件、规则与 README、版本号、集成验收、最终提交与 main 合并。独立 integration worktree 从 main 开始，保护原工作树。
2. **反重力（B/前端）**：独立 worktree 内 `apps/admin/**`、`apps/gallery/**`、相关 `tests/gallery/**`、`tests/browser/**` 和 `tests/acceptance/component-query-gallery.spec.ts`；迁移页面、内部目录和客户端鉴权、相应 RED/GREEN；不改根配置/锁文件/API/contracts。
3. **API 实现代理（C 子任务）**：独立 worktree 内 `apps/api/src/{app.ts,platform.ts,access/**}`、新增迁移 `014_web_login_target.sql` 与迁移清单（013 为用户在途身份服务预留）、API 单元/平台测试；实现双 origin 与受约束登录目标，不改 root/contracts/frontend。
4. **Claude 桌面端（部署/独立审查）**：先只读安全审查，随后独立 worktree 内 `infra/gateway/gallery-public.conf`、`infra/gateway/admin-internal.conf`、`docs/guides/gallery-admin-deployment.md`、`tests/infra/gallery-admin-ingress.test.ts`，提供精确白名单/默认拒绝、真实配置验证。报告审查缺口，不修改其他工作。

## 验证重点

- 公开入口访问管理页面与管理 API 失败；未知路由、路径编码、伪造 Origin/转发头不能放行。
- 未登录不返回内部资产；无权限账号不可读；有权限账号可读；登出/撤权后不能继续显示或取得内部数据。
- OIDC 目标服务端绑定、恶意返回地址拒绝；两 origin 精确 CORS/CSRF；安全 Cookie 与一次性 PKCE 保持不变。
- 前端管理迁移保留上传逐实现截图校验、任务、权限/设置和匹配功能；页面、静态 HTML 和 sitemap 路由边界清晰。
- Turbo dev 启动 11 包，服务端 build 图仍仅 API/网关/contracts；构建、类型检查和 tests 实际执行，不能拿缓存当新增验收证据。

## 检查清单

- [x] 各实现先写失败测试，确认预期 RED，再做最小实现并验证 GREEN。
- [x] 更新工作区登记与必要文档，运行固定工具链 frozen install / verify:workspace。
- [x] 强制实际执行完整 build、typecheck；运行根 test 与浏览器测试（先释放本次测试端口，不任意终止用户服务）。
- [x] 运行 API 登录/目录与公网入口专项测试；外部部署验收如无法运行如实记录。
- [x] 独立审查并解决实际问题，新增本次验证记录；检查架构 SHA-256 与工作区既有改动。
- [x] 代码/文档聚焦提交；管理路由删除与默认回跳改变按破坏性变更升 root/gallery/API 至 0.1.0，新增 admin 为 0.0.1，提供明确迁移说明；独立升版提交。
- [x] 在干净 main worktree 合并已验证分支，保留原用户工作树；不执行未经授权的 push。
