# Gallery Next Public Private Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `apps/gallery` 迁移到 Next.js App Router，为公开组件发现预留可抓取的 SSG/ISR 页面，为登录工作区预留动态私有路由，同时保持 Nest API、双框架 SDK 和 10 个 workspace 成员不变。

**Architecture:** 单一 `apps/gallery` 使用 Next.js 16.4.6、React 19.3.1 和 Node 运行时。 `(public)` 路由组承载公开入口、未来目录和详情页面，输出公开正文及 metadata；`(console)` 路由组承载未来上传/发布/任务页面，统一 noindex 并等待 T05 OIDC 接入。当前没有真实目录契约和 Ready 资产，因此只交付诚实空状态与边界验证，不生成伪造组件资料。

**Tech Stack:** Next.js 16.4.6、React 19.3.1、TypeScript 7.0.2、pnpm workspace、Turborepo、Vitest/Playwright；NestJS API 保持独立。

**Spec:** `docs/superpowers/specs/2026-11-11-gallery-next-public-private-rendering.md`；原始架构规格 `component-platform-architecture.md` 只读。

## Global Constraints

- 工作区仍固定为 10 个成员，`apps/gallery` 包名、端口 `5173` 和 `@company/contracts` 依赖保持。
- 不实现 OIDC、真实目录/详情数据、上传、发布任务或预览授权；这些仍由 T05–T08 和 G2 验收。
- 公开页面只能渲染明确公开 DTO；私有数据不得进入静态 HTML、公开 metadata 或共享缓存。
- `component-platform-architecture.md` 原始字节和 SHA-256 必须保持不变。
- 组件构建、示例运行、截图和预览网关边界不变；Next 只作为平台画廊宿主。
- 依赖必须使用精确版本；本次锁定 Next.js `16.4.6`，并验证与 React 19.3.1 和 Node 26.13.0 的本地构建与运行。

## Review Focus

1. 旧 Vite 入口不能继续被 Turbo 或浏览器测试使用；新入口必须在 5173 正常 build/start。
2. 公开空状态必须出现在初始 HTML，并生成公开 metadata；不能通过客户端挂载后才显示。
3. 控制台空状态必须标记为 noindex，不能进入 sitemap；robots 不屏蔽控制台路径，确保爬虫能够读取 noindex。
4. 后续接入真实目录时，私有字段不能混入公开静态 DTO 或共享缓存；本次通过代码边界和文档约束固定这一点。
5. Next 迁移不能改变 10 个成员、Vue/React example 端口或 Nest 服务依赖闭包。

---

### Task 1: 先固定公开/私有浏览器行为

**Files:**
- Modify: `tests/browser/bootstrap.spec.ts`
- Create: `tests/browser/gallery-rendering.spec.ts`

**Interfaces:** 浏览器访问 `http://127.0.0.1:5173`；公开首页应包含 `Zhinexus 组件资产平台`、公开发现空状态和 `组件目录` 链接；`/upload` 应包含登录后提示且响应 HTML 包含 `noindex` metadata。

- [x] **Step 1: 写失败测试**，断言公开初始 HTML 可见、公开 metadata 存在、控制台页面带 `robots=noindex`，并保留 Vue/React example 原有断言。
- [x] **Step 2: 运行测试确认 RED**。

Run: `.\scripts\pnpm.ps1 exec playwright test tests/browser/bootstrap.spec.ts tests/browser/gallery-rendering.spec.ts --config tests/playwright.config.ts`

Expected: 画廊断言失败，因为当前 Vite 页面没有公开/私有路由和 metadata。

### Task 2: 迁移 `apps/gallery` 到 Next App Router

**Files:**
- Modify: `apps/gallery/package.json`, `apps/gallery/tsconfig.json`
- Create: `apps/gallery/next.config.ts`, `apps/gallery/next-env.d.ts`, `apps/gallery/app/layout.tsx`, `apps/gallery/app/globals.css`, `apps/gallery/app/(console)/layout.tsx`, `apps/gallery/app/(public)/page.tsx`, `apps/gallery/app/(public)/components/page.tsx`, `apps/gallery/app/(public)/components/[slug]/page.tsx`, `apps/gallery/app/(console)/upload/page.tsx`, `apps/gallery/app/robots.ts`, `apps/gallery/app/sitemap.ts`
- Remove: `apps/gallery/index.html`, `apps/gallery/vite.config.ts`, `apps/gallery/src/main.tsx`, `apps/gallery/src/App.tsx`, `apps/gallery/src/styles.css`

**Interfaces:**
- `GET /`：公开页面，输出公开发现空状态和组件目录入口。
- `GET /components`：公开目录空状态，未来接入 Ready/公开 DTO。
- `GET /components/[slug]`：公开详情宿主，当前对未知 slug 返回明确未接入状态，不伪造资产。
- `GET /upload`：控制台占位，公开 HTML 仅显示登录后可用提示，并设置 `robots: { index: false, follow: false }`。
- 控制台 route-group layout 设置 noindex，robots 保持可抓取，sitemap 只列出公开首页与目录入口。

- [x] **Step 1: 添加 Next 依赖和脚本**：`build=next build`、`dev=next dev --hostname 127.0.0.1 --port 5173`、`preview=next start --hostname 127.0.0.1 --port 5173`、`typecheck=tsc -p tsconfig.json --noEmit`；配置 `distDir: 'dist'` 以延续 Turbo 输出约定。
- [x] **Step 2: 实现根 layout 和公开路由**：使用公开 metadata、初始 HTML 空状态和明确的后续 T07 接入说明。
- [x] **Step 3: 实现控制台占位、robots 和 sitemap**：不引入认证假实现，私有路由只展示登录后可用状态并设置 noindex。
- [x] **Step 4: 运行 Task 1 测试确认 GREEN**。

Run: `.\scripts\pnpm.ps1 exec playwright test tests/browser/bootstrap.spec.ts tests/browser/gallery-rendering.spec.ts --config tests/playwright.config.ts`

Expected: 画廊公开/私有边界断言通过，两个 example 断言继续通过。

### Task 3: 同步工作区文档与版本证据

**Files:**
- Modify: `README.md`, `component-platform-implementation-assessment.md`, `docs/superpowers/plans/2026-11-11-component-platform-implementation.md`, `docs/superpowers/plans/2026-11-11-three-person-allocation.md`
- Create: `docs/verification/gallery-next-migration.md`

- [x] **Step 1:** 将当前画廊技术栈、端口、构建入口更新为 Next.js 16.4.6；保留 Vue/React example 和 T07 的真实依赖边界。Nest/React 初始化验证作为历史记录不修改。
- [x] **Step 2:** 记录本次未实现的 T05/T07/G2 范围、实际验证命令和未覆盖边界；不修改原始架构规格。
- [x] **Step 3:** 运行 `.\scripts\pnpm.ps1 verify:workspace`，确认仍是 10 个成员和安全依赖闭包。

### Task 4: 全量验证与聚焦提交

收尾修复范围包括 `turbo.json`、`scripts/verify.ps1`、`scripts/verify-gallery-cache.mjs` 以及 AGENTS/架构/平台规则。gallery build 单独禁用 Turbo 输出缓存，原因和代价见迁移验证记录；不改变其他包的缓存。

- [x] **Step 1:** 运行 `.\scripts\pnpm.ps1 --filter @company/gallery build`。
- [x] **Step 2:** 运行 `.\scripts\pnpm.ps1 --filter @company/gallery typecheck`。
- [x] **Step 3:** 运行 `.\scripts\pnpm.ps1 build`、`.\scripts\pnpm.ps1 typecheck`、相关浏览器测试；若已有失败，记录具体失败而不宣称全绿。最终独立迁移副本的统一验证通过，共享工作区的其他在途任务失败另行记录。
- [x] **Step 4:** 复核 `component-platform-architecture.md` SHA-256、`git diff` 和 `git status`，只提交本任务文件。
- [x] **Step 5:** 创建中文聚焦提交：`feat: 迁移画廊至 Next 公开私有渲染边界`。
