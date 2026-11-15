# 二期 B2：候选响应解析与纯展示组件实现与验证交接

- 日期：2026-11-15
- 执行人：B（apps/gallery 负责人）
- Worktree：`C:\Users\10208\.codex\worktrees\b-phase2-matching\zhinexus-design-asset-platform`
- 分支：`feat/b-phase2-matching`
- 契约基线：`dcb4d52e feat: 原样接入 C 二期候选响应公共契约`（C 原提交 `e0a7f5ee`，12 文件逐 blob 相等）
- 性质：B2 GREEN 实现（严格限定 4 个文件：两个实现 + 已交测试 + 本记录）。未做 Git 操作、未改其他文件；Windows 验证与提交由 C 负责。

## 1. 交付物

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `apps/gallery/app/lib/candidate-results.ts` | 新增 | `parseCandidateResults(input)` 复用契约校验器 |
| `apps/gallery/app/(console)/match/CandidateResults.tsx` | 新增 | 纯展示组件（显式 `import React`） |
| `tests/gallery/candidate-results.test.ts` | 新增（上轮 RED，C 已就地修正） | 23 例，导入上述两模块 |
| `docs/verification/b-phase2-candidate-results-2026-11-15.md` | 新增 | 本记录 |

C 在测试内的两项修正已保留、未覆盖：以 `createRequire(new URL('../../apps/gallery/package.json', import.meta.url))` 从 gallery 声明边界加载 `react` / `react-dom/server`；HTML 转义用例改为断言「无真实 `<img` 标签且存在 `&lt;img` 文本」。根 `tsconfig.json` 的 `jsx: react-jsx` 为 C 的改动，未触碰。

## 2. 实现要点

- **`parseCandidateResults`**：直接返回 `validateSearchCandidatesResponse(input)`。契约校验器已把非 JSON / 非法输入规整为 `{ ok: false, issues }`，故对外承诺「不抛原始异常」。未自定义公共 DTO、未重写校验规则。
- **`CandidateResults`**：纯展示，仅渲染已通过校验的 `SearchCandidatesResponse`。
  - 根 `#candidate-results`；`candidates` 为空时渲染 `#candidate-empty`「暂无候选」，且不输出任何 `.candidate-card`；
  - 每候选一张 `.candidate-card`：`exportName`、`packageName@packageVersion`、框架标签、`componentId`/`variantId`/`variantReleaseId`；
  - 兼容：`verified` → 「已验证」并列出 `recordIds`；`unverified` → 「未验证」；
  - 证据：`kind`、`path` 纯文本、截图附 `source`；不生成链接、不拼存储地址；
  - 评分分栏：「文本评分」必显；「用途评分」「视觉评分」仅在有值时显；缺 `visual` 显「未提供视觉评分」；不补 0、不合并为单一相似度；
  - 候选级与响应级 `gaps` 均展示；全部文本经 React 转义。
- 组件**未挂载**到在线 `/match`，不发请求、不持久化、不构造证据 URL。

### 2.1 框架标签修订（宿主复跑回归）

宿主首次运行结果：**原 23 项测试全部通过**（C 已在 `vitest.config.ts` 补 oxc JSX runtime，解决 Next `jsx: preserve` 下根 Vitest 不编译 TSX 的问题；根配置仍由 C 维护）。

C 新增第 24 项回归「框架标签只展示响应提供的框架，不猜测框架主版本」并实跑 **RED**：`Candidate` 契约只含 `framework`，**不含** `frameworkVersion`，而组件原先把可见标签写死为「Vue 3」/「React 19」，等于猜测了框架主版本。

修订：可见标签改为 `Vue` / `React`，仅反映真实 `framework` 值，不推导任何版本。未改动 C 的测试断言与根配置；测试头注释由「两个实现文件尚未创建」改为历史 RED 阶段说明。待 C 复跑确认 GREEN。

## 3. 样式说明（范围内无 CSS 文件）

B2 允许改动范围不含 `globals.css`，故组件沿用语义类名 + 控制台既有行内样式约定（与 `(console)/upload/page.tsx`、`(console)/match/page.tsx` 一致）。样式细化留给后续接入批：随组件挂载与画廊样式体系统一处理。

## 4. 验证命令（由 C 在宿主 Windows 工具链执行；沙箱不跑固定工具链）

```bash
.\scripts\pnpm.ps1 exec vitest run tests/gallery/candidate-results.test.ts
.\scripts\pnpm.ps1 --filter @company/gallery typecheck
.\scripts\pnpm.ps1 typecheck   # 根 tsconfig 已含 jsx: react-jsx，覆盖 tests/**/*.ts 对该 .tsx 的解析
```

预期：23 例全绿。实际结果由 C 记录；未满足项不得标记完成。

## 5. 未覆盖边界

- 组件未接入 `/match` 页面，也未接入任何检索服务；「无请求」仅由「静态渲染输出不含 `<a `/`href=`/`http`」佐证，不等于运行期网络审计。
- 未做运行期浏览器验证（本批不挂载路由）；接入批需补 Playwright 可见文本与交互断言。
- 「形状校验不证明证据真实性、不证明兼容性」由契约保证；本组件不做额外真实性判断。
- 组件样式为行内过渡方案，尚未纳入画廊样式体系。
- 候选数据的真实来源（服务端检索）尚未交付；`tests/fixtures/search.ts` 为合成 fixture，非发布资产或评估观测。

## 6. 版本与提交交接

B2 组件未对外接入（不挂载路由、无对外可见行为变化），按计划「未对外接入的组件不触发重复 Gallery 升版」——本批**不升版**、不改 `CHANGELOG.md`；接入真实检索服务时再统一升版。

建议 C 在宿主提交（聚焦中文；测试由 C 维护）：

```bash
git add apps/gallery/app/lib/candidate-results.ts "apps/gallery/app/(console)/match/CandidateResults.tsx"
git commit -m "feat: 实现候选响应解析与纯展示组件"
git add docs/verification/b-phase2-candidate-results-2026-11-15.md
git commit -m "docs: 记录二期候选展示组件实现与验证交接"
```

Git 身份已配置（`juzhiqiang <1020814597@qq.com>`）。
