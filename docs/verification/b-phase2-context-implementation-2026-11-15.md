# 二期 B1：项目上下文本表单实现与验证交接

- 日期：2026-11-15
- 执行人：B（apps/gallery 负责人）
- Worktree：`C:\Users\10208\.codex\worktrees\b-phase2-matching\zhinexus-design-asset-platform`
- 分支：`feat/b-phase2-matching`
- 基线：C 契约提交 `35dcc2e1`（`packages/contracts/src/project-context.ts`，contract `e8248fb3`）
- 性质：B1 GREEN 实现（仅 `apps/gallery` 内新增/局部改动 + 两个测试 + 本记录）；不接检索/匹配，不伪造 API/匹配结果。Windows 命令、审查与提交由 C 负责；版本与 README 由 C 收口。

## 1. 交付物（本批改动）

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `apps/gallery/app/lib/project-context-form.ts` | 新增 | `buildProjectContext(fields)` 纯转换 |
| `apps/gallery/app/(console)/match/page.tsx` | 新增 | `/match` 项目上下文本地表单（`'use client'`） |
| `apps/gallery/app/(console)/layout.tsx` | 改 | 控制台导航新增 `/match` 入口（清晰可达） |
| `apps/gallery/app/globals.css` | 改 | 追加 `.console-nav*` 与 `.match-*` 局部样式（含 `≤640px` 响应式，防手机溢出） |
| `tests/gallery/phase2-context.test.ts` | 新增（上轮 RED） | 单测：`buildProjectContext` 行为 |
| `tests/browser/phase2-context.spec.ts` | 新增（上轮 RED，本轮修） | 浏览器：`/match` 行为 |
| `docs/verification/b-phase2-context-implementation-2026-11-15.md` | 新增 | 本记录 |

未触碰：`packages/contracts`、根配置/锁/版本、`auth`、README、其他 worktree/主仓库；无 merge/push/发布/凭证操作。

## 2. 关键设计

- **`buildProjectContext`（白名单 + 复用契约校验）**：仅纳入已提供（非 `undefined`）字段；缺必填字段时不塞 `undefined`（避免 `assertJson` 以根路径报错），从而让 `validateProjectContext` 返回对应字段路径的「必填缺失」。`echartsVersion` `trim` 后为空则省略、非空才纳入；`requirements` 原样纳入，空白单项由契约 `text` 规则拒绝、空数组允许。返回 `ValidationResult<ProjectContext>`。
- **`/match` 页面**：复用控制台既有会话门（`getStoredSession`/`saveSession`，仅展示）；原生 `select`/输入；需求增删；任意字段/草稿/增删编辑即清理校验结果与提示（撤销过期成功/错误）；校验时存在非空未添加草稿则阻止并提示「请先添加当前需求」且保留草稿；登出重置全部项目字段/草稿/列表/结果与 `tokenInput`；字段错误经 `aria-invalid` + `aria-describedby` 绑定；持久展示「匹配服务尚未接入」；无 `fetch`，不写项目需求、既有登录仍写会话；框架/版本初始为空、不猜测默认版本。

## 3. 浏览器测试修正（宿主 RED 反馈）

宿主 RED 实况：单测因缺 `project-context-form` 模块失败；Playwright 页面 404，「未登录提示」等失败（1 失败 / 1 中断 / 4 未跑），「noindex」用例被 404 页面自带 noindex 误判通过。修正：每个 `/match` 用例补 `expect(response?.status()).toBe(200)`（登录门用例同样 200），并在注释如实记录 RED 实况（不说所有用例都失败）。

## 4. 验证命令（由 C 在宿主 Windows 工具链执行；沙箱不跑固定工具链）

```bash
# 类型检查
.\scripts\pnpm.ps1 --filter @company/gallery typecheck
# 单测（RED→GREEN）
.\scripts\pnpm.ps1 exec vitest run tests/gallery/phase2-context.test.ts
# 浏览器（需先 build，释放 5173–5175）
.\scripts\pnpm.ps1 --filter @company/gallery build
.\scripts\pnpm.ps1 test:browser tests/browser/phase2-context.spec.ts
```

预期：单测 9 例全绿；浏览器 7 例全绿（`/match` 返回 200、noindex、登录门、门内校验/增删/撤销成功态、无检索/匹配网络请求）。实际结果由 C 记录；未满足项不得标记完成。

## 5. 未覆盖边界

- 检索 / 匹配服务（Candidate/MatchPlan/search API）未接入，本批不生成候选；「无匹配网络请求」用例仅断言未触达检索/匹配端点。
- 「空白需求项拒绝」由单测直接构造数组覆盖；UI 添加器对纯空白输入不加入列表（UX 防护），故浏览器不单独覆盖空白项拒绝路径。
- 控制台导航新增链接对既有 `/upload`、`/jobs/*` 页面为附加渲染；相关既有浏览器用例（manual-release / web-upload / gallery-rendering）需由 C 复跑确认无回归。

## 6. 版本与提交交接

`/match` 为对外可见新增功能，达到升版条件：由 C 在功能验收通过后，将 `@company/gallery` **独立**升至 `0.0.6`（`chore: 升级版本号至 0.0.6` 并更新 `CHANGELOG.md`），**不**与本实现提交混列。本实现/测试/记录提交本身只含业务与文档改动。

建议 C 在宿主提交（聚焦中文；测试由 C 维护）：

```bash
git add apps/gallery/app/lib/project-context-form.ts "apps/gallery/app/(console)/match/page.tsx" "apps/gallery/app/(console)/layout.tsx" apps/gallery/app/globals.css
git commit -m "feat: 实现 /match 项目上下文本地校验表单"
# 测试（C 维护，含其新增回归）与记录由 C 一并提交：
#   docs: 记录二期项目上下文本表单实现、修订与验证交接
# 功能验收通过后由 C 独立升版：
#   chore: 升级版本号至 0.0.6（@company/gallery package.json + CHANGELOG.md）
```

Git 身份已配置（`juzhiqiang <1020814597@qq.com>`）。
