# T09 第二批饼图合并主分支验证记录

日期：2026-11-12。负责人：A（SDK）。合并提交：`1fde33e`（`merge: 合并 T09 第二批饼图/环形图与柱状图 Windows 原生复验清单`，父提交 `9c355ca` T04 第二批完整发布材料与 `bdfe23c` T09 第二批饼图）。本记录只验证合并结果，不重写 [T09 第二批验证记录](t09-pie.md)、[T09 第一批验证记录](t09-bar.md) 与 [T04 第二批记录](t04-cli-check-2026-11-12.md)。

## 合并前的冲突与契约检查

- 两侧自共同基线 `acb0a27` 各前进：`main` 侧 3 个提交（`33b49df` ReleaseManifestV1 与冻结 Bundle 生成、`47010e9` 升版、`9c355ca` 合并提交），`feat/t09-pie` 侧 8 个提交（`60e0653` RED → `ae1588e` core → `5c77f3f` 双框架 → `d02be5c` 示例 → `c08ce88` 消费者 → `4ba6a56` 类型对齐 → `bbc7ef3` 升版 → `bdfe23c` 验证记录）。
- 按文件求交集：**零交集**。`main` 侧改动集中在 `packages/component-cli/**`、`tests/unit/release-bundle.test.ts`、`tests/unit/release-fingerprint.test.ts`、`tests/integration/cli-bundle.test.ts` 与 `tests/consumers/{vue,react}/src/BarApp.*`；`feat/t09-pie` 侧改动集中在 `packages/charts-*/**`、`examples/**`、`tests/consumers/{vue,react}/{pie.html,src/PieApp.*,src/pie-main.*,vite.config.ts}` 与三个测试文件。合并无冲突。
- 合并后核对：T04 侧新增的 `packages/component-cli/src/local/manifest.ts`、`tests/unit/release-bundle.test.ts` 均存在且为 T04 提交内容；`tests/consumers/{vue,react}/src/BarApp.*` 保留 T04 的就绪协议改造；`feat/t09-pie` 侧交付全部在位。
- 契约一致性：`@company/contracts` 两侧均未改动；示例就绪协议（`ComponentExample` / `CheckResult`）形状未变。四个公开包版本为 `charts-core` / `charts-vue` / `charts-react` `0.0.3`（本批升版）与 `component-cli` `0.0.3`（T04 升版）。

## 合并后的全图验证（实际执行）

环境与仓库锁定工具链一致：Node `26.13.0`、pnpm `12.18.0`、TypeScript `7.0.2`（`charts-vue` 与示例按既有兼容例外用 `6.0.3` + `vue-tsc 3.3.14`）、Vue `3.5.45`、React `19.3.1`、ECharts `6.1.0`、Vitest `5.1.0`、Playwright `1.65.0` + Chromium headless shell。`test:browser` 按既有约定设置 `NEXT_PUBLIC_SITE_URL=https://gallery.test`。

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 锁文件与 `package.json` 一致，无变化 |
| `pnpm exec tsx scripts/verify-workspace.ts` | Workspace verified: 10 members, no cycles, four publishable shells, safe service graph |
| `pnpm build` | 10 tasks successful（清空 Turbo 本地缓存后执行） |
| `pnpm typecheck` | 14 tasks successful + 根 `tsc -p tsconfig.json --noEmit` 通过 |
| `pnpm test` | 18 files / 246 tests passed，4 skipped |
| `pnpm test:browser` | 46 passed |
| `pnpm exec vitest run tests/integration/packed-consumer-frameworks.test.ts` | 9 passed |

- `pnpm test` 18 files / 246 passed = T09 第二批分支单独验证时的 16 files / 236 passed + T04 第二批的 `tests/unit/release-bundle.test.ts` 与 `tests/integration/cli-bundle.test.ts`（新增 2 files / 10 tests）。T04 的 `cli-check` 6 项、`tests/contracts/*`、`tests/infra/*` 与 T09 的 `chart-semantics` 32 项在同一构建下同时通过。
- `pnpm test:browser` 46 passed = T03/T09 的 31 项 + T09 第一批柱状图 13 项 + 本批饼图 15 项，另含 T04 的 `capture-ready` 3 项（合计口径与 `t09-main-merge-2026-11-12.md` 的 31 项到 46 项的增量一致）。
- **产物一致性**：合并后重新 `pnpm pack` 得到的三个 tarball 摘要与 `feat/t09-pie` 分支上记录的 0.0.3 摘要**逐字节相同**，证明合并未改变任何组件产物：`charts-core` `22,992` 字节 / `8507eb712781a50dfff9135162b455ca6463fcc93dcb62b070e2a9a7117647a3`；`charts-vue` `4,663` / `d7a20cd8e8a82827d72c4654ac8981d86aa8738db22a1db467f47b5ceeb87a48`；`charts-react` `8,359` / `bbd1c34c37f3e0de415e3c21173b916768e147a6137cf7a14b01a8b6fac83757`。
- 打包体积护栏（护栏 1 MiB，记录于 gitignored 的 `test-results/t03-bundle-baseline.json`）：Vue 消费者 JS `657,038` 字节、React 消费者 JS `814,522` 字节，CSS 均 `93` 字节。相对分支单独验证时的 `655,769` / `813,253` 增量约 1.3 KB，来自 `main` 侧 T04 对 `tests/consumers/{vue,react}/src/BarApp.*` 的就绪协议改造，非本批引入。

## 未覆盖边界

- 本次为 Linux 复现环境验证。Windows 开发机原生确认（`.\scripts\pnpm.ps1 test` / `test:browser`）仍待执行，命令清单与预期结果见 [柱状图 Windows 原生复验清单](t09-bar-windows-native.md) 第四节与 [T09 第二批验证记录](t09-pie.md) 的「未覆盖边界与后续」。
- `test:infra` 需要本地 PostgreSQL / Verdaccio / MinIO 容器，本环境不具备，未执行；`tests/infra/*` 仅覆盖不依赖真实容器的部分。
- 饼图的实心（非环形）渲染、`roseType` / `minAngle` / 自定义内半径未实现也未验证；scatter 与三个场景组件属 T09 后续批次。
- 合并由 A 侧代理在共享工作树的 `main` 分支上执行（执行前确认 `git status` 干净、当前分支为 `main`）；推送与 Verdaccio 发布未执行，按 `AGENTS.md` 需另行获得用户授权。
