# 二期 B 审计：画廊 / 控制台 / 表单 / 测试只读审计与上下文表单接入边界

- 日期：2026-11-15
- 执行人：B（SDK/CLI/画廊负责人一方的只读审计代理）
- Worktree：`C:\Users\10208\.codex\worktrees\b-phase2-matching\zhinexus-design-asset-platform`
- 分支：`feat/b-phase2-matching`
- 审计基点 HEAD：`fa24ab525e5945e7096ed816a83f11962ba5f000`
- 性质：**只读审计 + 单一文档交付**。未写任何页面、未自定义公共 DTO、未伪造 API 或匹配结果；未修改其他文件、主仓库、其他 worktree；未执行 merge/push/发布/凭证操作。

> **2026-11-15 交接更新**：C 已交付 `ProjectContext` 公共契约（contract `e8248fb3`，原样合入 B 为 `35dcc2e1`，13 文件 blob 一致）。本批据此转入 B1：先写 `tests/gallery/phase2-context.test.ts` 与 `tests/browser/phase2-context.spec.ts` 两个 RED 测试、不写实现，待宿主确认 RED 后再实现页面。

> 关联任务：T13（完整档案、兼容过滤与多模态检索）、T14（设计稿解析、装配方案与离线评估）属二期；本审计为二期「设计稿匹配 / 上下文表单」在画廊侧的落地做边界盘点。**本批范围仅限 `ProjectContext` 本地表单**：开工只依赖 C 交付的 `ProjectContext` 类型 + 运行时校验；检索 / 匹配服务（`Candidate` / `MatchPlan` / search API）属后续完整集成的验收依赖，不在本批、也不阻塞本批。本批按 B1 先写 RED 测试、不写实现；不自定义公共 DTO、不伪造 API/匹配结果。

---

## 0. 审计范围与方法

依据 `AGENTS.md` 与 `rules/`（architecture / platform / security / testing-release / code-review）执行只读审计，聚焦四项：

1. gallery 的 React 19 + Next.js 16 App Router 路由结构（公开 / 私有渲染边界）；
2. `(console)` 控制台路由的保护机制现状；
3. 表单（网页手动发布工作区）与可复用库函数的实现模式；
4. 画廊相关测试的入口与组织方式。

读取的关键文件：`AGENTS.md`、`rules/{architecture,platform,security,testing-release,code-review}.md`、`docs/superpowers/plans/2026-11-11-component-platform-implementation.md`（T13/T14/T15–T17 章节）、`docs/superpowers/plans/2026-11-11-three-person-allocation.md`、`docs/superpowers/plans/2026-11-11-gallery-next-public-private.md`，以及 `apps/gallery/**` 全部源文件、`packages/contracts`（确认无 `project-context` / `match-plan`）、`tests/**`（确认无 search/matching/parseDesign/createMatchPlan 引用）。

未运行构建/测试（沙箱为 Linux 且仓库工具链锁定 Windows 固定 Node 26.13.0 / pnpm 12.18.0，见 `AGENTS.md` 验证要求）；测试入口以「命令 + 入口文件」形式交付，由宿主侧执行。

---

## 1. 环境与 Git 路径限制（交接给 C 在宿主代验与提交）

### 1.1 沙箱访问 worktree 的路径限制

该 worktree 的 `.git` 文件内容为 `gitdir: D:/project/zhinexus-design-asset-platform/.git/worktrees/zhinexus-design-asset-platform5`，admin dir 内 `gitdir` 回指针又是 Windows 路径 `C:/Users/10208/.codex/worktrees/b-phase2-matching/zhinexus-design-asset-platform/.git`。这些是宿主绝对路径，在 Linux 沙箱内无法解析，直接执行 `git` 报 `not a git repository`。

只读 git 可通过显式路径驱动（admin dir 位于主仓库挂载内、可访问）：

```
WT=<沙箱内 B worktree 挂载>
GD=<沙箱内主仓库挂载>/.git/worktrees/zhinexus-design-asset-platform5
git --git-dir="$GD" --work-tree="$WT" -c safe.directory='*' --no-optional-locks <cmd>
```

读操作为避免 git 刷新 index 时创建 `index.lock`，一律加 `--no-optional-locks`。

### 1.2 沙箱删除限制

挂载目录内 `unlink`（`rm`）返回 `Operation not permitted`，但写入（touch/write）成功。这意味着 `git status` 的「仅刷新」锁可能被创建后无法清理而残留。因存在上述 Windows/Linux 路径与删除限制，且遵从「不修改挂载/权限」，**本次不在沙箱内执行 commit**，改由 C 在宿主代验与提交（命令见第 9 节）。

### 1.3 探针临时文件（已清理，请 C 复核）

审计初期为探测可写性创建过三个临时文件，均在用户「保留并上报」的指示到达**之前**已删除；现无残留，未触碰其他对象，未修改 `.git` 配置或 worktree 指针：

| 临时文件 | 宿主路径 | 状态 |
| --- | --- | --- |
| B worktree 根 `.__wtest` | `C:\Users\10208\.codex\worktrees\b-phase2-matching\zhinexus-design-asset-platform\.__wtest` | 已删除 |
| 主仓库对象 `.__wtest` | `D:\project\zhinexus-design-asset-platform\.git\objects\.__wtest` | 已删除 |
| 陈旧 `index.lock`（git status 刷新残留） | `D:\project\zhinexus-design-asset-platform\.git\worktrees\zhinexus-design-asset-platform5\index.lock` | 已删除 |

复核命令（宿主）：在 B worktree 执行 `git status`，除预期未跟踪的 `.tools`（固定工具链目录，按 `AGENTS.md` 严禁提交）外应为干净；确认上述三路径不存在。

---

## 2. Gallery React/Next 路由审计

`apps/gallery`（`@company/gallery`，`private: true`，端口 `5173`）为 Next.js 16.4.6 App Router，`next.config.ts` 设 `distDir: 'dist'`。路由按「公开 / 私有」分为两个 route group：

**公开组 `app/(public)/`（SSG/ISR 宿主，服务端组件）：**

- `page.tsx`：公开首页。
- `components/page.tsx`：`async` 服务端组件，`await getCatalogComponents()` 取真实数据、`getCatalogComponents({ allowFallback: true })` 取预置回退，交给客户端 `CatalogViewer`；导出 `metadata`（title/description）。
- `components/[slug]/page.tsx`：`async` 服务端组件 + `generateMetadata`，`getComponentDetail(slug)` 为空时 `notFound()`（对未知 slug 返回 404，不伪造资产）；交给客户端 `ComponentDetailViewer`。
- 客户端 viewer：`components/CatalogViewer.tsx`、`components/[slug]/ComponentDetailViewer.tsx`。详情页预览 `iframe` 的 `src` 取 `effectivePreviewUrl = grantUrl || activeVariant.previewUrl`（`ComponentDetailViewer.tsx` 第 42 行）：**优先** `requestPreviewGrant(variantId)` 返回的短期授权 `bootstrapUrl`（独立 preview-gateway 源），**回退** `activeVariant.previewUrl`；`sandbox="allow-scripts allow-same-origin"`。`previewUrl` 里的 `127.0.0.1:5174` / `127.0.0.1:5175`（见 `catalog.ts`）只是本地示例 dev server，**并非**生产独立注册域验收路径。故 `tests/browser/gallery-rendering.spec.ts` 中断言的 `src=127.0.0.1:5174/index.html` 属本地无 API 时的回退分支，生产应走 preview-grant `bootstrapUrl`。

**私有组 `app/(console)/`（noindex，客户端组件）：**

- `layout.tsx`：仅导出 `metadata`（`robots: { index: false, follow: false }`），直接返回 `children`。
- `upload/page.tsx`：网页手动发布工作区（T08），`'use client'`。
- `jobs/[jobId]/page.tsx`：发布作业跟踪页，`'use client'`，用 React 19 `use(params)`，轮询 `fetchReleaseJob` 到 `http://127.0.0.1:3000`。

**爬虫边界：** `app/robots.ts`、`app/sitemap.ts`；sitemap 仅列公开首页与 `/components`，控制台路径（如 `/upload`）被排除。该边界由 `tests/browser/gallery-rendering.spec.ts` 断言（控制台 HTML 含 `noindex`、sitemap 不含 `/upload`）。

> 二期「设计稿匹配」若产生**可公开**的结果展示，应复用 `(public)/components/[slug]/page.tsx` 的「服务端组件 + 客户端 viewer」模式，且只渲染公开 DTO（`2026-11-11-gallery-next-public-private.md` 明确：私有数据不得进入静态 HTML / 公开 metadata / 共享缓存）。

---

## 3. Console 保护审计

现状是「**占位式保护**」，尚无真实 OIDC：

- `(console)/layout.tsx` 只设 `noindex`，不做任何重定向或鉴权网关；没有 Next middleware、没有服务端会话。
- 控制台页面在客户端自建登录门：`upload/page.tsx` 依 `getStoredSession()`（`app/lib/auth.ts`）判断，无会话则渲染「粘贴 Bearer Token」登录表单，登录成功（`saveSession`）后才渲染发布工作区；`jobs/[jobId]/page.tsx` 同样在无 token 时显示「未登录或未找到凭证」。
- `app/lib/auth.ts`：`parseTokenPayload` 仅做 JWT payload 解码用于展示（注释明确「安全性由服务端 Bearer 鉴权强制校验」，`auth.ts` 第 8–11 行）；会话存于 `localStorage`（键 `zhinexus_console_auth`）；提供 `getStoredSession` / `saveSession` / `clearSession`。
- API 基址可配置：`upload/page.tsx` 支持 `?apiUrl=` 查询参数与 `localStorage('zhinexus_api_url')`，默认 `http://127.0.0.1:3000`。

与 `2026-11-11-gallery-next-public-private.md` 一致：「不实现 OIDC… 控制台路由预留登录保护并设置 noindex」「不引入认证假实现」。真实鉴权依赖 `rules/security.md` 要求的服务端 Bearer + OIDC 体系（T05/G2 验收项，尚未接入）。上下文表单属于控制台功能，直接复用该「`'use client'` + `getStoredSession` 门 + `(console)` noindex」模式即可，无需新建保护机制。

---

## 4. 表单模式审计（网页手动发布工作区为样板）

`app/(console)/upload/page.tsx`（约 950 行，`'use client'`）是画廊最完整的表单实现，可作为上下文表单的模板。其结构：

- 状态簇：`session`、`tokenInput`、`apiUrl`、`manifest`、`filesMap`、`validation`、`fileIssues`、`activeJobId`、`jobState`、`uploadProgress`、`statusMessage`、`isSubmitting`、`pendingResumeKey`。
- 四个 `useEffect`：① 初始化鉴权 / apiUrl / 断点恢复检测；② 动态断点恢复资格核验（按 `session.subject` 与 `apiUrl` 变更做 fail-closed 检查，重算 manifest 摘要防篡改）；③ 变体截图与文件完整性校验（含代际取消保护）；④ 发布作业轮询。
- 处理器：登录 / 退出、单实现截图上传、批量关联截图、删除截图、导入外部 manifest、导入本地产物文件、恢复未完成发布、提交发布（提交前对 manifest 与 filesMap 快照**同步重跑**真实校验，缺图/哈希异常即阻断，严禁吞错）。
- 渲染分支：未登录 → 登录表单；已登录 → 逐实现截图必检表 + 阻断报警区 + 导入操作栏 + 提交区 + 进度条 + 作业轮询看板。

**可复用纯库 `app/lib/uploads/manifest-form.ts`：**

- `computeBrowserSha256`（Web Crypto SHA-256）。
- `sanitizeWebManifest`：强制 `channel: 'web'`、截图 `source: 'manual-upload'` + `environmentKey: 'unknown-manual'`、剥离 `reportId`、清空 `reports`、`compatibility.status` 降为 `candidate`——从结构上杜绝伪造 `local-automatic` / `passed`。
- `parseAndValidateImportedManifest`：显式校验 `schemaVersion === 1`、`channel ∈ {web, cli}`，调用契约 `validateManifest` 两遍（原始结构 + 网页清单）。
- 网络封装：`createUploadSession` / `uploadFileBytes` / `uploadPartBytes` / `completeUploadSession` / `submitReleaseJob` / `fetchReleaseJob`（统一 `authorization: Bearer <token>`，失败抛错不吞错）。
- `validateUploadFiles`：逐文件核对路径存在、`byteLength`、SHA-256 及共享大小上限（图片 10MB / tarball 50MB / 总计 500MB）。
- `executeWebUploadWorkflow`：完整发布时序，**依赖注入** `options.api` 与 `options.storage`（配 `createMemoryStorage`），固定幂等键、fail-closed 恢复、摘要防篡改——这一 DI 设计是其可被单元测试的关键（见第 5 节）。

**校验库 `app/lib/uploads/screenshot-validation.ts`：** `validateVariantScreenshots`（逐实现必检 `SCREENSHOT_REQUIRED`、框架错配 `SCREENSHOT_VARIANT_MISMATCH`、摘要不符 `DIGEST_MISMATCH`、来源防伪 `SOURCE_FORBIDDEN`）与 `createManualScreenshotRef`（强制 manual-upload / unknown-manual）。

**DTO 边界（关键）：** 画廊从不自定义公共 DTO。`ReleaseManifestV1` / `VariantRef` / `PackageRef` / `ArtifactRef` / `ScreenshotRef` / `Framework` / `ApiMessages` / `UPLOAD_LIMITS` / `manifestDigest` / `validateManifest` 全部从 `@company/contracts` 导入。`app/lib/types.ts` 只定义**展示层视图模型**（`ComponentCatalogItem` / `ComponentVariantMeta` / `ComponentPropSpec` / `ComponentEventSpec`）。数据层 `app/lib/catalog.ts`：`OFFICIAL_COMPONENTS`（line/bar/pie/scatter @0.0.4）是展示回退数据，仅在 `allowFallback`（客户端「浏览官方预置资产规范」）时使用；`getCatalogComponents` 以 API 为先（`fetchComponentsFromApi` → `GET /v1/components`，1.5s 超时、`cache: 'no-store'`），API 不可达返回 `[]`（诚实空态）；预览授权经 `requestPreviewGrant`（`POST /v1/preview-grants`）。

---

## 5. 测试入口审计

- `apps/gallery/package.json` **没有 `test` 脚本**（仅 `build` / `typecheck` / `dev` / `preview`）。画廊不使用包内单元测试运行器；逻辑测试放在仓库级 `tests/`。
- **表单/库逻辑（Vitest）**：`tests/unit/web-upload-workflow.test.ts` 直接 import 画廊纯函数 `../../apps/gallery/app/lib/uploads/manifest-form.js` 与 `screenshot-validation.js`，借 DI（`options.api` / `options.storage` / `createMemoryStorage`）与 fixture（`tests/fixtures/t05-artifacts.ts` 的 `pngBytes`）在 Node 环境测完整工作流。这是画廊表单逻辑的既有测试范式。
- **浏览器行为（Playwright）**：`tests/browser/gallery-rendering.spec.ts` 断言公开初始 HTML 与 metadata、控制台 `noindex`、sitemap 排除、详情页沙箱 iframe 与框架切换、目录筛选。相关还有 `tests/browser/{bootstrap,web-upload-real-e2e,manual-release,...}.spec.ts`、`tests/acceptance/web-upload-*.spec.ts`、`tests/integration/upload-validation.test.ts`。
- **缓存专项**：`tests/integration/gallery-cache.mjs`（画廊 build 单独禁用 Turbo 输出缓存的回归）。

宿主侧入口命令（`AGENTS.md` / `rules/testing-release.md`）：

| 目的 | 命令 |
| --- | --- |
| 画廊类型检查 | `.\scripts\pnpm.ps1 --filter @company/gallery typecheck` |
| 画廊表单逻辑单测 | `.\scripts\pnpm.ps1 exec vitest run tests/unit/web-upload-workflow.test.ts` |
| 全量契约/单元/服务测试 | `.\scripts\pnpm.ps1 test`（先 `build:services`） |
| 浏览器测试 | `.\scripts\pnpm.ps1 build` 后 `.\scripts\pnpm.ps1 test:browser`（需先释放 5173–5175） |
| 画廊缓存回归 | `.\scripts\pnpm.ps1 test:gallery-cache` |

> 说明：以上命令需在宿主 Windows 固定工具链下运行；沙箱未执行（见第 1、0 节）。

---

## 6. 真实接入点（上下文表单 / 匹配结果落地位置）

以下为画廊侧**已存在**、上下文表单可直接复用的接入点（本次均未改动，仅标注）：

- **路由落地**：新增 `apps/gallery/app/(console)/match/page.tsx`（或 `design-match/page.tsx`），`'use client'`、`getStoredSession` 门控，`noindex` 由 `(console)/layout.tsx` 继承——与 `upload/page.tsx`、`jobs/[jobId]/page.tsx` 同构。
- **纯逻辑库（本批）**：新增 `apps/gallery/app/lib/project-context-form.ts`，对齐 `app/lib/uploads/manifest-form.ts` 的「纯函数 + 校验/fetch 封装 + DI（options.api/storage）」组织，便于 Node 单测；后续匹配批次再增 `matching.ts`。
- **DTO 来源**：提交体必须是 C 交付的 `ProjectContext`（自 `@company/contracts` 导入），**不得**在画廊重定义；画廊仅在 `app/lib/types.ts` 增加展示层视图模型。
- **检索/匹配调用（后续完整集成，非本批）**：届时仿 `catalog.ts` 的 `fetchComponentsFromApi`（超时 + `no-store` + 失败返回空/缺口，绝不返回伪造候选），封装对 C 的 search/match 端点调用。
- **校验**：**直接导入 C 在 `@company/contracts` 提供的 `ProjectContext` 运行时校验**，不在画廊自写公共 `validateProjectContext`；表单层只做缺字段 / 未知约束的显式缺口提示（对齐 T13「缺已验证组合时标明未验证，不能伪称兼容」）。
- **公开结果展示（如需要）**：复用 `(public)/components/[slug]/page.tsx` 服务端组件 + 客户端 viewer，只渲染公开 DTO。
- **沙箱预览**：匹配命中项的隔离预览继续走 `requestPreviewGrant` + 独立域 `iframe`。

---

## 7. 上下文表单实施清单（本批 = ProjectContext 本地表单；后续完整集成另列）

**本批范围（先明确）**：本批只交付 `ProjectContext` 本地表单（采集 + 本地校验 + 诚实空态 / 缺口展示），**不接**检索 / 匹配。开工仅依赖 C 的 `ProjectContext` 类型 + 运行时校验落入 `@company/contracts`（已由 C 于 `35dcc2e1` 原样合入）；`Candidate` / `MatchPlan` / search API 是后续完整集成的验收依赖，**不阻塞本批**（`rules/architecture.md`：跨工作流接口先更新契约与 fixtures；画廊不得 `import type` 后端模块）。

- [ ] **契约先行（本批仅 ProjectContext）**：从 `@company/contracts` 引入 `ProjectContext={framework,frameworkVersion,echartsVersion?,packageManager,requirements:string[]}` 及 C 的运行时校验函数；输入用契约校验（`rules/security.md`：输入默认不可信，禁止仅 `as` 断言）。**不在画廊自定义公共 DTO、不另写公共 `validateProjectContext`**；匹配响应类型（`Candidate` / `MatchPlan`）属后续批次。
- [ ] **页面骨架**：`app/(console)/match/page.tsx`，`'use client'` + `getStoredSession` 门控 + 继承 `(console)` noindex；apiUrl 配置、状态/进度、禁用至合法、fail-closed，均对齐 `upload/page.tsx`。
- [ ] **表单字段**：仅收集 `ProjectContext` 定义字段；框架/版本/包管理器用受控选择，`requirements` 为可增删字符串列表；缺失与未知进入显式 `gaps`，不静默填默认值。
- [ ] **纯逻辑 + DI（本批本地表单）**：新增 `app/lib/project-context-form.ts`，仅做表单状态归一与「导入 C 校验」的封装；`options.storage` 等按需注入以便单测。**不写** `searchCandidates` 等检索调用——那属后续完整集成批次。
- [ ] **诚实边界（本批）**：缺失 / 未知 / 越界的 `ProjectContext` 字段进入显式缺口，不静默填默认值、不伪造任何匹配或候选；后续接入检索后再处理「服务不可用 → 可重试态」与命中项字段展示。
- [ ] **TDD**：先写失败测试（RED）——缺必填字段阻断、未知框架/版本/包管理器拒绝、`requirements` 为空提示、导入 C 校验对非法输入返回错误；再最小实现（GREEN）。
- [ ] **测试落点**：单测 `tests/unit/*`（import 画廊表单纯函数 `.js`，仿 `web-upload-workflow.test.ts`）；浏览器 `tests/browser/*`（仿 `gallery-rendering.spec.ts`）；经既有入口运行（第 5 节）。
- [ ] **版本与文档**：纯验证/文档变更不升版（`rules/testing-release.md`）；若产生对外功能再按语义化版本单独 `chore` 升版并更新 `CHANGELOG.md`。

**后续完整集成清单（不在本批；待 C 交付检索/匹配服务与 `Candidate` / `MatchPlan` / search API 契约并合入 `@company/contracts` 后再排期）**：接入 `searchCandidates` / `parseDesign` / `createMatchPlan`；消费 `Candidate`（`variantReleaseId`、精确包版本、证据、截图来源、兼容状态、排名分解）与 `MatchPlanV1`（区域、精确依赖、参数/事件映射、布局调整、置信度与 `gaps`）；公开结果展示复用 `(public)/components/[slug]/page.tsx` 服务端组件 + 客户端 viewer（只渲染公开 DTO）；命中项预览继续走 `requestPreviewGrant` 的 `bootstrapUrl` + 独立域沙箱 `iframe`；索引/服务不可用时返回明确缺口与可重试态，绝不伪造候选。

---

## 8. 未接入边界（现状盘点，均未实现）

- **`ProjectContext` 契约已合入（本批唯一开工依赖，已满足）**：`packages/contracts` 现含 `project-context.ts`（C 于 `35dcc2e1` 原样合入，contract `e8248fb3`，13 文件 blob 一致）；画廊可直接 `import { ProjectContext, validateProjectContext } from '@company/contracts'`。审计时「契约缺失」的开工门槛已消除。
- **检索 / 匹配服务未交付（后续完整集成的验收依赖，不阻塞本批）**：`apps/api/src` 无 `search` / `matching` 目录；全仓 grep `parseDesign|createMatchPlan|searchCandidates|MatchPlan` 无命中。`Candidate` / `MatchPlan` / search API 尚未提供，本批本地表单不依赖它们。
- **设计稿匹配页面缺失**：画廊无任何 match / design 页面。注意 T14 计划写的 `apps/gallery/src/pages/DesignMatch.vue` 是**迁移前旧路径**——当前画廊是 Next.js App Router（`app/` 目录、React、无 `src/pages`、无 `.vue`）；落地应改为 `app/(console)/...` 下的 React 页面（见第 6 节）。此为计划文档与现状的偏差，已记录，交由计划维护方（C）后续校正。
- **OIDC 鉴权未接入**：控制台保护仅为 noindex + 客户端粘贴 Token 门；无 middleware / 服务端会话 / OIDC 回调（T05/G2 验收项）。
- **目录数据诚实空态**：`getCatalogComponents` 在 API 不可达时返回 `[]`；`OFFICIAL_COMPONENTS`（@0.0.4）是展示回退、非匹配事实来源。
- **G2 外部条件未就绪**：真实 OIDC、独立预览域 / TLS 等未配置（`2026-11-11-three-person-allocation.md` 记录 G2 目标未完成）。

---

## 9. 交付与提交交接

- **唯一改动文件**：`docs/verification/b-phase2-matching-2026-11-15.md`（本文件）。已只读核对该文件为工作区唯一新增/变更（除预期未跟踪的 `.tools` 外无其他改动）。
- **提交方式**：因第 1 节所述 Windows/Linux 路径与沙箱删除限制，遵从「由 C 在宿主代验与提交，不修改挂载/权限」，本次**不在沙箱执行 commit**。请在宿主 B worktree（分支 `feat/b-phase2-matching`）执行：

```bash
git add docs/verification/b-phase2-matching-2026-11-15.md
git commit -m "docs: 记录二期画廊/控制台/表单/测试只读审计与上下文表单接入边界"
```

- **版本**：纯文档 / 验证记录变更，按 `rules/testing-release.md` 不单独升版、不改 `CHANGELOG.md`。
- **Git 身份**：仓库已配置 `juzhiqiang <1020814597@qq.com>`（与历史提交一致），无需额外设置。

---

## 附：规则符合性自检

- 只读审计，未写页面、未自定义公共 DTO、未伪造 API/匹配结果（第 0、6、7 节）。
- 唯一可写文件为指定验证文档；未触碰其他文件、主仓库 `.git` 配置 / worktree 指针、其他 worktree（第 1.3、9 节）。
- 未执行 merge / push / 发布 / 凭证操作；提交交宿主（第 1.2、9 节）。
- 变更如涉及后续实现，将按 `rules/code-review.md` 顺序（服务端零执行 / 预览隔离 → 产物可追溯与逐实现截图 → 三存储一致性 → 双框架生命周期 → 工作区边界 → 测试真实性 → 敏感信息与基线文档）逐项复核。
