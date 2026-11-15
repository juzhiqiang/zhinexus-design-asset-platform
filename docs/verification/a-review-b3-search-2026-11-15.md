# 独立只读审查记录：B 工作区二期文本检索页面与客户端（B3）

- 审查时间：2026-11-15
- 审查方式：只读源码与测试审查（未修改 B 工作区任何文件，未在 B 工作区运行构建或测试）
- 被审查工作区：`C:\Users\10208\.codex\worktrees\b-phase2-matching\zhinexus-design-asset-platform`
- 基线：`f7a81712`（`feat: 同步 C 冻结的文本检索请求契约`）之上当前变更：
  - `apps/gallery/app/lib/search-client.ts`
  - `apps/gallery/app/(console)/match/page.tsx`
  - `tests/gallery/search-client.test.ts`
  - `tests/browser/phase2-search.spec.ts`

## 审查结论

**存在已定位的 2 处待修阻断项（C 已定位待修），并额外发现 1 处发起请求前会话复核遗漏（建议一并修复）。**

## 已定位的 2 处待修问题确认

1. **同页改写会话后响应被忽略但未清理 `loading` 状态**
   - 位置：`apps/gallery/app/(console)/match/page.tsx:249`、`L262`
   - 现象：`handleSearch` 在 `await searchCandidates(...)` 返回或捕获异常后，若 `generation !== requestGeneration.current || !isSessionStillCurrent()` 仅直接 `return`。当外部同页改写 `localStorage` 且未触发 `focus`/`storage` 事件时，响应虽被忽略，但页面仍停留在 `searchState = { kind: 'loading' }` 且未回退到登录门，导致 `tests/browser/phase2-search.spec.ts:389`（`#search-loading` 数量为 0）失败。
   - 修复方向：当 `!isSessionStillCurrent()` 成立时（或确认请求代次仍为当前但会话已失效），调用 `invalidateSession()` 回退登录门并重置 `searchState`；若仅因本页新请求/编辑导致 `generation !== requestGeneration.current`，则由新状态接管，静默返回即可。

2. **跨标签页浏览器测试未先导航至同源页面即访问 `localStorage`**
   - 位置：`tests/browser/phase2-search.spec.ts:322-325`
   - 现象：`const other = await context.newPage()` 后直接 `other.evaluate(...)` 写入 `window.localStorage`，此时 `other` 位于 `about:blank` 源，浏览器抛出 `SecurityError`。
   - 修复方向：在 `other.evaluate` 前先 `await other.goto(MATCH_URL)`（或同源任意页面）再改写 `localStorage`。

## 额外发现的遗漏与观察

1. **【中】发起检索请求前未先行复核 `localStorage` 当前会话，可能使用旧 `token` 发出请求**
   - 位置：`apps/gallery/app/(console)/match/page.tsx:210-213, 241`
   - 说明：`handleSearch` 仅在入口检查 React 状态 `if (!session?.token)`，并直到 `await searchCandidates(...)` 返回后的 `L249` 才调用 `isSessionStillCurrent()`。若在点击「搜索候选」之前，同页脚本或另一标签页已清空/切换了 `localStorage` 中的 session（且尚未触发 `focus`/`storage` 回调），`L241` 仍会把旧的 `session.token` 作为 `Bearer` 发出请求。
   - 建议：在 `handleSearch` 发起请求前先读取 `getStoredSession()` 并与当前 `session.token`、`session.subject` 比对；若不一致或已清空，立即调用 `invalidateSession()` 并返回，不发起任何网络请求。

2. **【低】`handleLogout` 与 `resetFormState` 存在重复状态重置代码**
   - 位置：`apps/gallery/app/(console)/match/page.tsx:89-102` vs `L145-161`
   - 说明：`handleLogout` 手动重复了 `resetFormState()` 的全部 `set*` 调用，可直接复用 `clearSession(); invalidateSession();`。

## 其余核对通过项

- **显式请求边界**：`apps/gallery/app/(console)/match/page.tsx:450-488` 使用独立 `type="button"`（`#search-submit`）触发 `handleSearch`，表单输入与「校验项目上下文」均不触发检索请求；`search-client.ts:76-86` 在本地先调用 `validateSearchCandidatesRequest`，非法输入或空白 `query` 不发网络请求（`search-client.test.ts:55-132`）。
- **编辑取消与卸载清理**：`onFramework`/`onFrameworkVersion`/`onEchartsVersion`/`onPackageManager`/`onRequirementInput`/`addRequirement`/`removeRequirement` 均通过 `clearOutcome()` 调用 `cancelInFlight()` 与 `setSearchState({ kind: 'idle' })`（`page.tsx:165-191`）；`onSearchQuery`/`onReactDomVersion` 亦调用 `cancelInFlight()`（`page.tsx:206-207`）；组件卸载清理 `AbortController` 并递增 `requestGeneration`（`page.tsx:72-78`）。
- **取消检查点**：`apps/gallery/app/lib/search-client.ts:62-68, 91, 102, 116` 在请求前、`await fetch` 后、`await response.json()` 后均检查 `signal?.aborted` 并上抛 `AbortError`（`search-client.test.ts:228-338`）。
- **固定错误与不存储**：`search-client.ts:22-27, 49-51, 109-125` 对 401/403、500、非 JSON、契约校验失败均返回固定中文文案，不回显服务端原文、token 或 schema 字段路径；`search-client.ts` 与 `page.tsx` 均不向 `localStorage`/`sessionStorage` 写入查询、上下文或响应（`search-client.test.ts:363-380`）。

## 未覆盖边界

- 本审查严格保持只读，未在 B 工作区执行单元测试、浏览器测试或构建（沿用 C 报告的 51 项单元通过、全仓 10/10 构建通过及 24 通过 / 2 失败浏览器状态）。
- 上述 2 处待修项及建议项修复后，需由 A 复查最终文件再确认收口。
