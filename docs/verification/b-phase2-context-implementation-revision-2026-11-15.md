# 二期 B1：项目上下文表单修订记录（过期提示与身份残留修复）

- 日期：2026-11-15
- 执行人：B（apps/gallery 负责人）
- Worktree：`C:\Users\10208\.codex\worktrees\b-phase2-matching\zhinexus-design-asset-platform`
- 分支：`feat/b-phase2-matching`
- 性质：仅修 `apps/gallery` 页面与文档口径；**不改测试**（`tests/browser/phase2-context.spec.ts` 由 C 维护，含其新增 2 项独立回归）。不运行 Git、不改其他范围；Windows 验证与提交由 C 负责。

## 1. 背景（宿主首轮验证）

- 27 项表单 + 契约单测通过；gallery 构建通过；原 7 项浏览器全通过。
- C 在 `tests/browser/phase2-context.spec.ts` 追加 2 项独立回归并实跑 RED（共 9 项，7 过 2 失败）：
  1. 输入需求草稿后仍残留 2 处「本地校验通过」旧提示；
  2. 退出再换身份后，上一身份的需求列表仍残留 1 条。

## 2. 根因与修复（仅 `app/(console)/match/page.tsx`）

| 回归 | 根因 | 修复 |
| --- | --- | --- |
| 草稿后旧提示残留 | 需求草稿输入框 `onChange` 只 `setRequirementInput`，未清理 `result` 与 `statusMessage`，导致 `#context-success` 与操作区 `statusMessage` 两处「本地校验通过」残留 | 引入 `clearOutcome()`（同时清 `result` 与 `statusMessage`），草稿输入改走 `onRequirementInput`；所有字段/草稿/增删编辑统一调用 `clearOutcome` |
| 换身份后需求残留 | `handleLogout` 未重置表单状态，组件同一实例跨 登出/登录 保持 `requirements` 等 | `handleLogout` 重置全部项目字段、需求草稿、需求列表、`result`、`statusMessage` 及 `tokenInput` |

新增行为（对齐用户要求）：校验时若存在非空未添加草稿，`handleValidate` 阻止校验并提示「请先添加当前需求」，**保留草稿**（不静默丢失、不自动忽略）。

原有 7 项浏览器用例与 27 项单测不受影响（成功/错误/增删/撤销/无网络请求路径均保持）。

## 3. 文档口径修正（`b-phase2-context-implementation-2026-11-15.md`）

- 第 6 节版本口径：原文「纯实现不单独升版」与规则冲突，改为「`/match` 为对外可见新增功能，功能验收通过后由 C 将 `@company/gallery` 独立升至 `0.0.6`（`chore: 升级版本号至 0.0.6` + `CHANGELOG.md`），不混入本实现提交」。
- 「无 localStorage 写入」改为「不写项目需求，既有登录仍写会话」（`saveSession` 为既有 auth，未改；本页无 fetch、不持久化项目需求）。

## 4. 未覆盖边界

- 检索 / 匹配服务仍未接入；「无匹配网络请求」仅断言未触达检索/匹配端点。
- 「空白需求项拒绝」由单测覆盖；UI 添加器对纯空白输入不加入列表。
- 控制台导航新增链接对既有 `/upload`、`/jobs/*` 为附加渲染，需 C 复跑既有浏览器用例确认无回归。

## 5. 验证交接

本修订为纯页面逻辑修正，未运行 Windows 工具链；请 C 在宿主复跑 `test:browser tests/browser/phase2-context.spec.ts`（预期 9 项全绿）与 `--filter @company/gallery typecheck`。升版由 C 在功能验收后独立执行（gallery `0.0.6`）。
