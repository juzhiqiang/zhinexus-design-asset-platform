# T09 第四批趋势卡片：合并 main 与全图验证记录

日期：2026-11-12。负责人：A（SDK）。分支：`feat/t09-trend`（10 个提交）合入 `main`。任务定义见 [实现计划 T09](../superpowers/plans/2026-11-11-component-platform-implementation.md)，接口以 [T09 第四批对齐件](../superpowers/specs/2026-11-12-sdk-trend-card-protocol.md) 为准，分支期验证见 [T09 第四批验证记录](t09-trend-card.md)。

本记录覆盖三件事：把 `feat/t09-trend` 合并回 `main`、在**合并结果**上重跑全图验证、以及合并暴露出的一个跨团队缺陷（B 侧 `component-cli` 不认趋势卡片）的修复过程。

## 1. 合并前的冲突预检

合并在独立 worktree 中进行，未触碰主工作树。**合并前 main 又前进了一次**：分支基线是 `3bbf687`，第一次预检时 main 在 `9fe210f`（T04 / T06 已合入），真正合并前 main 已到 `89d2511`（T07 画廊前端 UI 与隔离预览交互已合入）。两次都重新做了冲突预检：

- `merge-base(main, feat/t09-trend)` = `3bbf687`（两次相同）。
- `git diff --name-only 3bbf687 main` 与 `git diff --name-only 3bbf687 feat/t09-trend` 求交集，得 **2 个文件**：`tests/consumers/vue/vite.config.ts` 与 `tests/consumers/react/vite.config.ts`。
- 逐文件比对两侧 diff：main 侧只在配置对象顶部加 `base: './'`，T09 侧只在 `rollupOptions.input` 里加 `'trend-card': 'trend-card.html'`，**两块改动不相交**，判定可三方干净合并。
- 两侧均无删除文件（`--diff-filter=D` 为空），因此源码同步可以用 tar 覆盖而不必清理旧文件。
- T07 的 14 个文件与分支改动**零交集**，因此第二次合并同样无冲突。

## 2. 合并执行与结果核对

第一次合并在 worktree 分支 `feat/t09-trend-merge` 上完成，产出合并提交 `a925248`（父 `9fe210f` + `928eac1`），零冲突。随后 main 前进到 `89d2511`，为避免在历史里留下第二个合并节点，改在 worktree 分支 `feat/t09-trend-main` 上把 `feat/t09-trend-merge` 合入新 main，得到**最终合并提交 `8439a8d`**（父 `89d2511` + `3d34325`）。两次合并均按既有纪律做了三项核对：

- **非空核对**（防历史空合并事故）：`git diff --name-only 89d2511 8439a8d` 得 **58 个文件**，非空。
- **双侧改动都在位**：两个消费者 `vite.config.ts` 中 `base: './'`（main 侧）与 `'trend-card': 'trend-card.html'`（T09 侧）同时存在。
- **对方交付未被回退**：T04/T06 的 `packages/component-cli/src/local/manifest.ts`、`tests/unit/release-bundle.test.ts`、`tests/integration/cli-bundle.test.ts` 与 T07 的 `apps/gallery/app/lib/catalog.ts`、`CatalogViewer.tsx`、`tests/browser/gallery-rendering.spec.ts` 均在位；三个 SDK 包版本均为 0.0.5。

## 3. 合并结果上的全图验证

环境与仓库锁定工具链一致：Node `26.13.0`、pnpm `12.18.0`、TypeScript `7.0.2`（`charts-vue` 与示例按既有兼容例外用 `6.0.3` + `vue-tsc 3.3.14`）、Vue `3.5.45`、React `19.3.1`、ECharts `6.1.0`、Vitest `5.1.0`、Playwright `1.65.0` + Chromium headless shell。`test:browser` 按既有约定设置 `NEXT_PUBLIC_SITE_URL=https://gallery.test`。以下命令在合并提交 `a925248` 上实际执行（清空 Turbo 本地缓存后）：

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 锁文件与 `package.json` 一致，无变化 |
| `pnpm exec tsx scripts/verify-workspace.ts` | Workspace verified: 10 members, no cycles, four publishable shells, safe service graph |
| `pnpm build` | 10 tasks successful |
| `pnpm typecheck` | 14 tasks successful + 根 `tsc -p tsconfig.json --noEmit` 通过 |
| `pnpm test` | 23 passed / **2 failed** / 1 skipped，537 passed / 4 skipped |
| `pnpm test:browser` | 86 passed |
| `pnpm exec vitest run tests/integration/packed-consumer-frameworks.test.ts` | 9 passed |
| `pnpm exec vitest run tests/integration/packed-consumer.test.ts` | 1 passed |

两个失败一个为既有环境依赖、一个是本次合并引入的真实缺陷，分见下两节。

### 3.1 既有环境依赖失败（非回归）

`tests/integration/cli-release.test.ts` 在 `localCredentials`（`tests/platform/support.ts`）抛 `Run infra:up before test:platform; real storage is required`，即需要本地 PostgreSQL / Verdaccio / MinIO（`test:infra`，C 侧 G2 范围）。它在生成 Bundle 之前就中断，与本次改动无关。

### 3.2 合并引入的缺陷：平台拒绝趋势卡片 Bundle

`tests/integration/cli-bundle.test.ts` 失败，报：

```
ARTIFACT_MISMATCH: npm runtime component subpath has no declared implementation
```

成因是两条线的叠加：SDK 0.0.5 新增 `./trend-card` 子路径导出；同时 main 的 T04 把 `component-cli` 的 `ComponentName` 扩展到 `line | bar | pie | scatter`，使平台校验路径被真正走到。`apps/api/src/uploads/validator.ts` 的规则是：运行时包 exports 中每个解析为 JavaScript 的子路径（不含聚合根 `.` 与纯 CSS / JSON 目标）都必须有 `variant.exportPath` 与之对应。该测试以 `components: ['line','bar','pie','scatter']` 生成 8 个变体，`./trend-card` 无人声明，于是被拒。在分支基线 `3bbf687` 上 SDK 为 0.0.4、无该子路径，所以分支期全绿——**这是合并才暴露的跨团队缺口**，不是分支期遗漏。

## 4. 缺陷修复（RED → GREEN）

按用户授权由 A 侧代 B 补齐 `component-cli` 的趋势卡片支持。RED 提交 `93f31c6`（`test: 要求发布 Bundle 覆盖趋势卡片变体（RED）`），实测 RED 为 `expect(result.ok).toBe(true)` 失败——CLI 直接拒绝 `trend-card` 这个组件名。GREEN 提交 `70138d2`（`feat: component-cli 发布材料覆盖趋势卡片并加固子路径护栏`），改动 5 个文件：

- `packages/component-cli/src/local/manifest.ts`：`ComponentName` 增加 `'trend-card'`；入口文件名、命名导出与中文描述由三层嵌套三元改为查表 `COMPONENT_ENTRY_HTML` / `COMPONENT_EXPORT`；默认 `components` 增加 trend-card。
- `packages/component-cli/src/local/capture.ts`：容器尺寸探测选择器链补 `.charts-trend-card`。
- `tests/integration/cli-bundle.test.ts`：被测组件扩展到 5 × 2 = 10 变体，并新增**回归护栏**——遍历 `charts-vue` / `charts-react` exports 中每个 JS 子路径，断言都有对应变体。
- `tests/integration/cli-release.test.ts`、`tests/platform/http-support.ts`：组件清单同步到 trend-card（`requireComponents` 按 `variant.componentId` 逐项校验发布权限，`grant` 必须 seed 该组件行，否则即便 infra 就绪也会 FORBIDDEN）。

护栏做了两次反向验证：把 trend-card 从被测清单去掉，测试失败；给 `charts-vue` 临时注入一个无人接管的 `./ranking` 子路径，测试以 `@company/charts-vue 导出的 ./ranking 没有对应变体，平台会以 ARTIFACT_MISMATCH 拒绝 Bundle` 失败——后者正是显式清单覆盖不到、只有护栏能挡住的情形。两次临时改动均已还原并核对字节一致。

修复后在最终提交 `70138d2` 上重跑：

| 命令 | 结果 |
| --- | --- |
| `pnpm exec tsx scripts/verify-workspace.ts` | Workspace verified: 10 members, no cycles, four publishable shells, safe service graph |
| `pnpm build` | 10 tasks successful |
| `pnpm typecheck` | 14 tasks successful + 根 `tsc` 通过 |
| `pnpm test` | 24 passed / **1 failed** / 1 skipped，**538 passed** / 4 skipped |
| `pnpm test:browser` | 86 passed |
| `packed-consumer-frameworks` + `packed-consumer` | 9 + 1 = 10 passed |

唯一剩余失败仍是第 3.1 节的 infra 依赖，与代码无关。按既有顺序约束，`test:browser` 会清空 `test-results/`，因此先跑浏览器测试、再单独跑消费者 vitest 文件以恢复打包体积基线。

## 4.1 component-cli 版本与 CHANGELOG

`component-cli` 从 0.0.4 升至 0.0.5（0.x 兼容变更按规则升 PATCH），新增 `CHANGELOG.md` 的 `[0.0.5]` 条目。锁文件不受影响：`pnpm-lock.yaml` 对 workspace importer 只记录依赖、不记录自身版本，`pnpm install --frozen-lockfile` 实测通过。

## 4.2 最终提交上的全图验证

main 前进到 `89d2511` 后重新合并，并在最终提交上重跑全图（该提交含 T07 画廊改动，因此浏览器计数比分支期多 3 项）：

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 锁文件与 `package.json` 一致，无变化 |
| `pnpm exec tsx scripts/verify-workspace.ts` | Workspace verified: 10 members, no cycles, four publishable shells, safe service graph |
| `pnpm build` | 10 tasks successful |
| `pnpm typecheck` | 14 tasks successful + 根 `tsc -p tsconfig.json --noEmit` 通过 |
| `pnpm test` | 24 passed / **1 failed** / 1 skipped，**538 passed** / 4 skipped |
| `pnpm test:browser` | **89 passed** |
| `packed-consumer-frameworks` + `packed-consumer` | 9 + 1 = 10 passed |

三个 SDK 包 tarball 摘要与第 5 节表格完全一致，未因 `component-cli` 升版变化。唯一失败仍为第 3.1 节的 infra 依赖。

## 5. 候选 tarball 摘要复核（含一处勘误）

三个 SDK 包的 `package.json` 与 `CHANGELOG.md` 在分支与合并结果间 blob 完全一致，因此重新打包核对：

| 包 | 版本 | 字节 | SHA-256 |
| --- | --- | --- | --- |
| `@company/charts-core` | 0.0.5 | 30,260 | `cfc198d43b0114527ecd99ff4418497d5b0253fbcf4179e0ba5fe1da6a27393c` |
| `@company/charts-vue` | 0.0.5 | 5,692 | `b209aac6ef7f221b6cb08d8d3ae0573af3e0cacafc069a8e640fced18d348c9d` |
| `@company/charts-react` | 0.0.5 | 10,296 | `40ead94a8820f1e96de22e620a4d1650949ab2e108b0f6939baf3b412ad8c7f1` |

`charts-core` 与 `charts-react` 与分支期记录一致；`charts-vue` 差 4 字节，已定位：分支期记录的 5,696 字节取自分支工作树中 `src/style.css` 带 CRLF 的工作区文件（旧 `copyFile` 构建脚本原样复制，4 个 CRLF 行多出 4 字节），而 git 中的 blob 是 560 字节纯 LF，main 的 T04 又把构建脚本改为强制 LF。因此**可按提交状态稳定复现的摘要是 5,692 / `b209aac6…`**，[对齐件第 5.1 节](../superpowers/specs/2026-11-12-sdk-trend-card-protocol.md) 与 [分支期验证记录](t09-trend-card.md) 的表格已同步更正并加注说明。

打包体积护栏（护栏 1 MiB，记录于 gitignored 的 `test-results/t03-bundle-baseline.json`）：Vue 消费者 JS `685,438` 字节、React 消费者 JS `843,215` 字节，CSS 均 `128` 字节——与分支期记录一致，未因 CRLF 归一化变化。

## 6. 合并后状态与未覆盖边界

- **`main` 尚未快进**：最终合并提交 `8439a8d` 在 worktree 分支 `feat/t09-trend-main` 上（其第二父提交链为 `a925248` → `93f31c6` → `70138d2` → `3d34325`，即分支期成果 + 缺陷修复 + 验证记录）。全程未在主工作树执行任何 git 操作——两次动手前主工作树分别停在别人的分支且带有未提交改动、以及带有未提交的 `apps/gallery/app/globals.css`，因此按 `AGENTS.md` 未代为快进。需要由仓库负责人在主工作树执行：

  ```
  git merge --ff-only feat/t09-trend-main
  ```

  主工作树当前有未提交改动，执行前请先确认其状态；快进后 `feat/t09-trend`、`feat/t09-trend-merge`、`feat/t09-trend-main` 三个分支与两个 scratch worktree 均可清理（提交已进 main 历史）。
- `tests/platform/**` 被 `vitest.config.ts` 排除在 `pnpm test` 之外，只在 `test:infra` 就绪后由 `test:platform` 运行；本次对 `tests/platform/http-support.ts` 的改动（`grant` seed trend-card）**未能在本环境实测**，需在 infra 就绪后复跑 `test:platform` 确认。
- `tests/integration/cli-release.test.ts` 同样受 infra 限制，本次只做了组件清单与变体数的机械同步，其在 infra 就绪后的通过情况待验。
- Windows 开发机原生确认（`.\scripts\verify.ps1`）仍未执行；趋势卡片与散点图的原生复验清单分别见 [T09 第四批](t09-trend-card-windows-native.md) 与 [T09 第三批](t09-scatter-windows-native.md)。
- T09 后续批次（ranking / proportion）按同一模式扩展；新增图表子路径时的固定动作（SDK 子路径 + CLI 两张查表 + 三处测试清单）已记入 [图表组件与材料交接清单第 7 节](t09-chart-component-handover.md)。
