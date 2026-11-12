# T09 饼图实心渲染覆盖合入 main 验证记录（含一次空合并事故）

日期：2026-11-12。负责人：A（SDK）。合入提交：`e4469ac`（`feat: 把 T09 饼图实心渲染覆盖重新合入 main`），父提交 `c0e81b6`（T06 主分支合并复验）。本记录只验证合入结果，不重写 [T09 第二批验证记录](t09-pie.md)（其末尾已含本次增补记录）。

## 事故经过：一个父提交正确但没有内容的合并提交

第一次在主工作树执行 `git merge --no-ff feat/t09-pie-solid` 时，`.git/index.lock` 已存在（沙箱无法覆盖写入），合并在 `Unable to write index` 处中断，只留下 `MERGE_HEAD` / `MERGE_MODE` / `MERGE_MSG`，索引与工作树都还是 `main` 的内容。随后再次执行 `git merge`，git 判定「合并已在进行中」，直接用**未更新的索引**结结合并，产出 `1161e03`——父提交正确（`6da7e1c` + `130b3e9`）但**树与 `main` 完全相同**的空合并提交。

当时已用 `git reset --mixed 6da7e1c` 回退并在主工作树重新合并得到正确的 `a98efb5`，全部验证也在 `a98efb5` 上跑通。但在这之后，他人在同一共享工作树里基于 `1161e03` / 其后的提交继续推进，T06 经由 `4c48869` 合入 `main`，于是 `main` 的历史里留下了这个空合并提交，而 `a98efb5` 不在 `main` 上。

**后果与为何普通 merge 修不好**：`1161e03` 的第二个父提交正是 `feat/t09-pie-solid` 的尖端 `130b3e9`，git 的祖先判定因此认为本分支「已合入」，在 `main` 上再执行 `git merge feat/t09-pie-solid` 只会得到 `Already up to date`，而 `main` 的树里始终没有这十个文件的内容。

**处理**：在独立的 main worktree 里按显式路径 `git checkout feat/t09-pie-solid -- <十个文件>` 后提交，得到 `e4469ac`。空合并提交 `1161e03` 已进入 `main` 历史且其上叠了 T06 的工作，不做历史重写；它没有改变任何文件内容，唯一的影响就是本次内容缺失。

**教训（两条，都值得记住）**：
1. 合并后必须核对 `git diff --name-only <合并前 main> <合并提交>` 非空，不能只看「merge 提交已生成」。只看提交存在就会漏掉空合并。
2. 沙箱里 `git merge` 报 `Unable to write index` 时，先删 `.git/index.lock` 再重试；绝不能在 `MERGE_HEAD` 残留的状态下再跑一次 `git merge`——它会用旧索引结结合并。

## 合入前的检查

- `feat/t09-pie-solid` 自共同基线 `42045c0` 起 3 个提交（`823edee` RED → `7ba58a8` 示例与钩子 → `130b3e9` 记录与对齐件）；`main` 侧自 `42045c0` 起为 T05 收尾、T06 全部工作与两份复验文档。
- 十个文件在 `main` 侧自 `42045c0` 以来的提交数**全部为 0**，无冲突、无回退风险。
- 包产物零改动：`git diff 42045c0 feat/t09-pie-solid -- packages/` 为空，锁文件未改，三包版本仍为 `0.0.3`。
- 合入后核对：T06 的 `apps/api/src/releases/service.ts`、`packages/contracts/src/api.ts`、`packages/component-cli/src/local/capture.ts`、`tests/platform/releases.test.ts` 均在位；`e4469ac` 相对 `c0e81b6` 恰好改动 10 个文件，全部属于本次增补。

## 合入后的全图验证（实际执行）

环境与仓库锁定工具链一致：Node `26.13.0`、pnpm `12.18.0`、TypeScript `7.0.2`（`charts-vue` 与示例按既有兼容例外用 `6.0.3` + `vue-tsc 3.3.14`）、Vue `3.5.45`、React `19.3.1`、ECharts `6.1.0`、Vitest `5.1.0`、Playwright `1.65.0` + Chromium headless shell。`test:browser` 按既有约定设置 `NEXT_PUBLIC_SITE_URL=https://gallery.test`。源码从 `main` worktree 同步（Windows 检出的 CRLF 行尾），清空 Turbo 缓存与各包 `dist` 后全量构建。

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 锁文件与 `package.json` 一致，无变化 |
| `pnpm exec tsx scripts/verify-workspace.ts` | Workspace verified: 10 members, no cycles, four publishable shells, safe service graph |
| `pnpm build` | 10 tasks successful |
| `pnpm typecheck` | 14 tasks successful + 根 `tsc -p tsconfig.json --noEmit` 通过 |
| `pnpm test` | 23 files / 477 tests passed，4 skipped（`tests/tooling/verify.test.ts` 既有跳过） |
| `pnpm test:browser` | 58 passed |
| `pnpm exec vitest run tests/integration/packed-consumer-frameworks.test.ts` | 9 passed |

- `pnpm test` 23 files / 477 passed：T06 合入后新增 1 file / 14 tests（相对 T05 收尾时的 22 files / 463 passed），本批 `chart-semantics` 为 33 项（新增 `donut: false` 与缺省等价一条）。
- `pnpm test:browser` 58 passed：`component-matrix` 40 项（柱状 13 + 饼图 27，其中实心饼图 12 项为本批新增）+ `core-lifecycle` 4 + `framework-lifecycle` 5 + 其余 9 项。
- 工作区外消费者 9 passed：`./pie` 的 Node 导入、多页构建、真实渲染与点击载荷均通过；产物不含 `FunnelView` / `GaugeView` / `MapView` / `EffectScatter` / `BoxplotView` / `SankeyView`。
- 打包体积护栏（护栏 1 MiB，`test-results/t03-bundle-baseline.json`）：Vue 消费者 JS `657,038` 字节、React `814,522` 字节，CSS 均 `93` 字节，与第二批合并验证记录一致。

## 未覆盖边界

- 本次为 Linux 复现环境验证，源码取自 Windows 检出的 CRLF 工作树。Windows 开发机原生确认（`.\scripts\verify.ps1` / `.\scripts\pnpm.ps1 test` / `test:browser`）仍待执行；饼图专项窄范围命令与预期计数见 [T09 第二批验证记录](t09-pie.md)（`chart-semantics` 33 passed、`component-matrix` 40 passed、`packed-consumer-frameworks` 9 passed）。
- 「空数据 + 控制器重建」未覆盖：zrender 在没有可绘制内容时不创建画布，`single-instance` 与 `renderer-match` 会失败；示例测试先经 `solid` 中转避开。是否放宽 `collectChecks` 需先与 B 对齐。
- 饼图仍不提供 `roseType` / `minAngle` / 自定义内半径与环形间距；scatter 与三个场景组件属 T09 后续批次（另一会话已在 `feat/t09-scatter` 上动工）。
- `charts-core` / `charts-react` 的构建不清空 `dist`，建议后续补清理步骤。
- 推送与 Verdaccio 发布未执行，按 `AGENTS.md` 需另行获得用户授权。另有一个分支 `feat/t04-t06-release-registry` 的尖端是本次增补早期的合并提交 `0560a19`（含当时的合并验证记录），它未经由 `main` 合入；如需清理或继续使用，请 branch 所有者确认，A 侧未改动它。
