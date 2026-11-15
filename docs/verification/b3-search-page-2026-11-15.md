# 二期 B3：文本检索接入实现与验证交接

- 日期：2026-11-15
- 执行人：B（apps/gallery 负责人）
- Worktree：`C:\Users\10208\.codex\worktrees\b-phase2-matching\zhinexus-design-asset-platform`
- 分支：`feat/b-phase2-matching`
- 契约基线：`f7a81712 feat: 同步 C 冻结的文本检索请求契约`（C 原提交 `95ec3726`，六文件逐 blob 相等）
- 性质：B3 GREEN 实现（仅 `search-client.ts` + `/match/page.tsx` + 本记录）。未做 Git 操作；Windows 验证与提交由 C 负责。

## 1. 交付物

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `apps/gallery/app/lib/search-client.ts` | 新增 | `searchCandidates` 文本检索客户端 |
| `apps/gallery/app/(console)/match/page.tsx` | 改 | 新增检索表单、独立搜索按钮、结果态与取消/忽略语义 |
| `docs/verification/b3-search-page-2026-11-15.md` | 新增 | 本记录 |

未改：契约、根配置（含 C 的 `vitest.config.ts` / `tsconfig.json`）、锁、版本、auth、CSS、既有测试。

## 2. 实现要点

### 2.1 `search-client.ts`

- `POST {apiUrl}/v1/search/candidates`，`authorization: Bearer <token>`、`content-type`/`accept: application/json`；
- 请求体先经契约 `validateSearchCandidatesRequest` 校验，非法输入**本地即拒**、不发请求；发送的是校验后的值；
- `reactDomVersion` 仅在提供且非空白时发送，且为精确版本；不能由 React 版本推断；
- 响应经 `validateSearchCandidatesResponse` 解析，返回既有 `ValidationResult<SearchCandidatesResponse>`；
- 取消语义：传入 `signal` 时以 `AbortError` 原样上抛，**绝不**降级为业务结果；
- 错误一律使用固定文案（`INVALID_INPUT` / `UNAUTHORIZED` / `NETWORK` / `INVALID_RESPONSE`），不回显服务端原文或 token；
- 无任何 `localStorage` / `sessionStorage` 写入。

### 2.2 `/match/page.tsx`（保留 B1 全部行为）

- 新增 `#search-query-input`、`#react-dom-version-input`、`#search-submit`；B1 的 `#context-submit` 与本地校验行为原样保留；
- **只有显式点击「搜索候选」才 POST**；编辑任何字段、本地校验均不触发检索；
- `requirements` 存在未添加草稿时拒绝检索提交，提示「请先添加当前需求」并**保留草稿**；
- 上下文未通过本地校验时拒绝检索并提示，不发起请求；
- 结果态：`#search-loading` / `#search-empty`（「暂无候选」）/ `#search-error` / 命中后挂载 B2 `CandidateResults`；
- **取消并忽略旧响应**：用「请求代次 + `AbortController`」双重守卫。表单任何编辑、退出登录、身份切换、组件卸载均 `cancelInFlight()`（代次 +1 并 abort），迟到响应即使 resolve 也因代次不符被忽略；`AbortError` 静默忽略；
- 卸载清理：`useEffect` 清理函数中代次 +1 并 abort，卸载后迟到响应不得写入状态；
- 退出登录重置全部项目字段、需求草稿/列表、检索输入与结果态；
- 页面顶部提示改为如实说明「文本检索仅覆盖已发布元数据，不提供用途/视觉评分；结果不构成兼容性证明」。

## 3. 测试覆盖对应

- `tests/gallery/search-client.test.ts`（15 例）：请求构造/校验/解析/错误、仅显式调用才 POST、调用前/await fetch 后/await json 后三处取消检查、取消与换身份忽略旧响应、schema 错误不含输入键、不持久化、不回显原始错误或 token。
- `tests/browser/phase2-search.spec.ts`（18 例）：检索表单可见且保留本地校验按钮、只有显式点击才 POST、未添加草稿拒绝提交并保留草稿、空态、鉴权失败、网络/格式失败、**已返回结果后编辑上文字段清理**、请求中编辑 query/增删需求/退出/换身份晚响应不回显、另一标签页 storage 改写会话、focus 复核会话、同页改写会话且未触发 focus、**同页改写 token 后再点击不发请求**、**同 subject 换 token 失效清理**、成功挂载 `CandidateResults`、未登录不暴露检索表单。

## 3.1 取消语义与身份变化修订（宿主复跑回归）

宿主首次复跑 48 项相关测试中 47 通过 1 失败：`search-client.test.ts` 取消用例中延迟 fetch 仍返回结果（`outcome.aborted === false`）。根因是原实现只在 fetch 自身 reject 时才识别取消，依赖 fetch 实现配合 signal。

修订：

- **`search-client.ts`**：新增 `throwIfAborted`，在**发起请求前**、**await fetch 之后**、**await json 之后**三个检查点统一检查；已取消一律以 `AbortError` 抛出，不依赖 fetch 实现是否配合。
- **响应 schema 错误统一固定文案**：`validateSearchCandidatesResponse` 失败时返回固定 `INVALID_RESPONSE` 文案，不再回显含输入键（如 `packageVersion`、`/candidates/0/...`）的 schema 原文。
- **`page.tsx` `clearOutcome` 补齐取消语义**：原先只清本地校验结果；现同时 `cancelInFlight()` 并清空检索态。因此全部上下文字段编辑、需求草稿编辑、需求增删均会取消在途检索并清理其结果，旧响应不得回显。
- **身份变化防护**：新增 `storage` 事件 + `focus` 复核监听。其他标签页改写会话或本页重新聚焦时复核当前会话，若 `subject` 变更或会话被清，则取消在途请求、重置全部项目字段/需求/检索输入与结果态，并回退登录门；旧身份数据不可回显。

对应测试：单测新增 3 例（调用前已取消不发请求、fetch 后取消仍拒、schema 错误不含输入键）；浏览器新增 5 例（已返回结果后编辑上文字段清理、在途时增删需求取消清理、另一标签页 storage 改写会话、focus 复核会话被改写、同页改写会话且未触发 focus 时落地前复核）。浏览器显式请求/loading 均由 `page.route` 可控延迟驱动，不依赖未启动 API 的响应速度。

### 3.2 测试类型与会话复核加固（根 tsc 回归）

根 `tsc` 发现测试编译错误：`phase2-search.spec.ts` 多处 `release?.()`、`search-client.test.ts` 的 `releaseJson?.()` 被 TS 推断为 `never`（闭包赋值不参与控制流分析）。已统一改为初始空函数声明（`let release: () => void = () => {};`、`let releaseJson: () => void = () => {};`）并改为直接调用。

会话复核加固：原先只比对 `subject`，且仅在 `storage`/`focus` 事件中复核。最终实现为 **token 与 subject 双重比对**，提交前直接复核当前会话，响应及异常落地前通过 `isSessionStillCurrent()` 再次复核，覆盖「同页写 localStorage 但尚未触发 focus/storage」的窗口。请求发起时锁定身份快照 `searchIdentity`，取消时一并清除。

### 3.3 失效会话统一清理（宿主浏览器回归）

宿主浏览器 26 项中 24 通过 2 失败，均为真实 RED：

1. `另一标签页改写会话` 用例：`other` 新页面尚未导航到同源，`localStorage` 抛 `SecurityError`。已改为先 `await other.goto(MATCH_URL)` 再用 `evaluate` 写入（不用 `addInitScript`，以免覆盖期望写入的身份）。
2. `同页改写会话且未触发 focus` 用例：响应处 `isSessionStillCurrent()` 为 false 时仅 `return`，未清理，`#search-loading` 仍为 1。

修订：提取 `invalidateSession()`（取消在途 + 重置全部表单/检索状态 + 回退登录门），在三处统一调用：

- **提交前**：`handleSearch` 先从 `getStoredSession()` 取当前会话，与 React 状态 `session` 的 token/subject 比对，失效则 `invalidateSession()` 且**不发请求**；
- **响应落地时**：`isSessionStillCurrent()` 为 false → `invalidateSession()`，绝不留 loading；
- **错误落地时**：同样复核并 `invalidateSession()`。

同时 `storage`/`focus` 复核改为复用 `invalidateSession()`，token 与 subject 双重比对。

新增 2 例浏览器 RED：同页改写 token 后再点击搜索（提交前复核拦截，不发请求、回退登录门）；同 subject 换 token（仍属失效会话，focus 复核清理结果与字段）。既有失败断言全部保留。

## 4. 验证命令（由 C 在宿主 Windows 工具链执行；沙箱不跑固定工具链）

```bash
.\scripts\pnpm.ps1 exec vitest run tests/gallery/search-client.test.ts
.\scripts\pnpm.ps1 --filter @company/gallery typecheck
.\scripts\pnpm.ps1 build
.\scripts\pnpm.ps1 test:browser tests/browser/phase2-search.spec.ts
.\scripts\pnpm.ps1 test:browser tests/browser/phase2-context.spec.ts   # 确认 B1 无回归
.\scripts\pnpm.ps1 exec vitest run tests/gallery/candidate-results.test.ts  # 确认 B2 无回归
```

最终范围：客户端单测 15 例、B3 浏览器 18 例；C 的实际命令、全量结果、独立复查及真实联调见 [验收记录](c-b3-search-acceptance-2026-11-15.md)。

## 5. 未覆盖边界

- 检索服务端（eligibility、PG 索引/outbox、权限复读）由 C3 负责。B 交接时仅完成客户端接入；C 后续真实 HTTP 与画廊联调已在独立验收记录中验证。
- 「编辑/退出/换身份/卸载取消并忽略旧响应」在单元层以 `signal`/代次断言，在浏览器层以迟到响应不挂载断言；未做真实并发/竞态压力测试。
- 未做 `AbortController` 在不支持环境的降级（目标浏览器均为现代 Chromium）。
- 未覆盖 `NEXT_PUBLIC_PLATFORM_API_URL` 多环境配置切换（默认 `http://127.0.0.1:3000`）。
- 检索结果的可访问性细节（焦点管理、live region  announcing）仅用 `role` 标注，未做完整 a11y 审计。

## 6. 版本与提交交接

B3 为对外可见功能（新增检索入口与交互）。按计划「对外 HTTP/UI 达到本批验收后 Gallery 0.0.6→0.0.7」，升版由 C 在验收通过后独立执行（`chore: 升级版本号至 0.0.7` + `CHANGELOG.md`），不混入本实现提交。

建议 C 在宿主提交（聚焦中文；测试由 C 维护）：

```bash
git add apps/gallery/app/lib/search-client.ts "apps/gallery/app/(console)/match/page.tsx"
git commit -m "feat: 接入文本检索客户端与 /match 检索交互"
git add docs/verification/b3-search-page-2026-11-15.md
git commit -m "docs: 记录二期文本检索接入实现与验证交接"
# 验收通过后由 C 独立升版：chore: 升级版本号至 0.0.7
```

Git 身份已配置（`juzhiqiang <1020814597@qq.com>`）。
