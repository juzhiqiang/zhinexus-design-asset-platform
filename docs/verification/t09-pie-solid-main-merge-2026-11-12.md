# T09 饼图实心渲染覆盖合并主分支验证记录

日期：2026-11-12。负责人：A（SDK）。合并提交：`a98efb5`（`merge: 合并 T09 饼图实心渲染覆盖`，父提交 `6da7e1c` 主分支复验与本地配置恢复结果与 `130b3e9` 实心饼图渲染覆盖记录）。本记录只验证合并结果，不重写 [T09 第二批验证记录](t09-pie.md)（其末尾已含本次增补记录）与 [T09 第二批合并验证记录](t09-pie-main-merge-2026-11-12.md)。

## 合并前的冲突与契约检查

- 两侧自共同基线 `42045c0`（T05 合并）各前进：`main` 侧 1 个提交（`6da7e1c`，只改 `docs/superpowers/plans/2026-11-12-t05-platform.md` 与 `docs/verification/t05-final-2026-11-12.md`）；`feat/t09-pie-solid` 侧 3 个提交（`823edee` RED → `7ba58a8` 示例与钩子 → `130b3e9` 记录与对齐件）。
- 按文件求交集：**零交集**。本批改动集中在 `examples/fixtures/pie.json`、`examples/{vue,react}/src/{PieApp.*,example/runtime.ts}`、`tests/browser/component-matrix.spec.ts`、`tests/browser/framework-lifecycle.spec.ts`、`tests/unit/chart-semantics.test.ts` 与两份文档。合并无冲突。
- 包产物零改动：`git diff 42045c0 feat/t09-pie-solid -- packages/` 为空，锁文件未改，三包版本仍为 `0.0.3`；`@company/contracts` 两侧均未改动，示例就绪协议（`ComponentExample` / `CheckResult`）形状未变。
- 合并后核对：T05 侧的 `apps/api/**`、`packages/contracts/**`、`tests/platform/**`、`tests/fixtures/releases/t05-verified-sdk/**` 全部在位；`main` 侧 `6da7e1c` 的两份文档在位；本批交付全部在位（`examples/fixtures/pie.json` 含 `solid` 状态族、两个 `runtime.ts` 含 `sectorRadii`）。

## 合并过程中的一次事故与恢复

第一次执行 `git merge --no-ff` 时，`.git/index.lock` 已存在（沙箱无法覆盖写入），合并在「Unable to write index」处中断，只留下 `MERGE_HEAD` / `MERGE_MODE` / `MERGE_MESSAGE`，工作树与索引都还是 `main` 的内容。随后再次执行 `git merge`，git 认为合并已在进行中，直接用**未更新的索引**结结了合并，产出 `1161e03`——一个父提交正确但**树与 `main` 完全相同**的空合并提交。

处理：先留证三份他人未提交改动的 SHA-256，再 `git reset --mixed 6da7e1c`（只回退 HEAD 与索引，不动工作树），核对三份哈希不变后重新 `git merge --no-ff`，得到正确的 `a98efb5`。空合并提交 `1161e03` 变为不可达，未推送、未影响任何分支。

**教训**：合并后必须核对 `git diff --name-only <合并前 main> <合并提交>` 非空，不能只看「merge 提交已生成」。另注意本次会话期间他人在同一共享工作树里改动了 `packages/component-cli/src/local/capture.ts` 与 `tests/consumers/{vue,react}/vite.config.ts`（内容是为三者各加一行 `base: './'` 一类配置），这三份未提交改动**未被卷入、未被暂存、未被还原**，合并前后 SHA-256 一致。

## 合并后的全图验证（实际执行）

环境与仓库锁定工具链一致：Node `26.13.0`、pnpm `12.18.0`、TypeScript `7.0.2`（`charts-vue` 与示例按既有兼容例外用 `6.0.3` + `vue-tsc 3.3.14`）、Vue `3.5.45`、React `19.3.1`、ECharts `6.1.0`、Vitest `5.1.0`、Playwright `1.65.0` + Chromium headless shell。`test:browser` 按既有约定设置 `NEXT_PUBLIC_SITE_URL=https://gallery.test`。源码从主工作树同步（工作树为 Windows 检出的 CRLF 行尾），清空 Turbo 缓存与各包 `dist` 后全量构建。

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 锁文件与 `package.json` 一致，无变化 |
| `pnpm exec tsx scripts/verify-workspace.ts` | Workspace verified: 10 members, no cycles, four publishable shells, safe service graph |
| `pnpm build` | 10 tasks successful |
| `pnpm typecheck` | 14 tasks successful + 根 `tsc -p tsconfig.json --noEmit` 通过 |
| `pnpm test` | 22 files / 463 tests passed，4 skipped（`tests/tooling/verify.test.ts` 既有跳过） |
| `pnpm test:browser` | 58 passed |
| `pnpm exec vitest run tests/integration/packed-consumer-frameworks.test.ts` | 9 passed |

- `pnpm test` 22 files / 463 passed：T05 合入后的全部测试 + 本批 `chart-semantics` 32 → 33（新增 `donut: false` 与缺省等价一条）。
- `pnpm test:browser` 58 passed：`component-matrix` 40 项（柱状 13 + 饼图 27，其中实心饼图 12 项为本批新增）+ `core-lifecycle` 4 + `framework-lifecycle` 5 + `bootstrap` / `capture-ready` / `contracts-runtime` / `gallery-rendering` 共 9 项。
- **产物一致性**：合并后重新 `pnpm pack` 得到 `charts-core` `22,960` 字节 / `60137946311b2dbdae4f2747279c5daa02283318b5bdf0dbc64ea3ba8d51de30`、`charts-vue` `4,663` / `d7a20cd8e8a82827d72c4654ac8981d86aa8738db22a1db467f47b5ceeb87a48`、`charts-react` `8,323` / `913dd8443d4b9385679b19a1a274913b59310296ca9e1c7a2f2ad45c6da702a6`，与分支单独验证时的三个摘要逐字节相同。与第二批记录的 `22,992` / `8,359` 相差 32 / 36 字节，成因已在 [T09 第二批验证记录的增补一节](t09-pie.md) 中逐项排除并记录，最大的嫌疑是第二批当时的 `dist` 残留（`charts-core` / `charts-react` 的构建不清空 `dist`）。
- 打包体积护栏（护栏 1 MiB，记录于 gitignored 的 `test-results/t03-bundle-baseline.json`）：Vue 消费者 JS `657,038` 字节、React `814,522` 字节，CSS 均 `93` 字节，与第二批合并验证记录的数字完全一致。

## 未覆盖边界

- 本次为 Linux 复现环境验证，且源码取自 Windows 检出的 CRLF 工作树。Windows 开发机原生确认（`.\scripts\verify.ps1` / `.\scripts\pnpm.ps1 test` / `test:browser`）仍待执行；饼图专项窄范围命令与预期计数见 [T09 第二批验证记录](t09-pie.md) 的「未覆盖边界与后续」（`chart-semantics` 33 passed、`component-matrix` 40 passed、`packed-consumer-frameworks` 9 passed）。
- 「空数据 + 控制器重建」这一组合未覆盖：zrender 在没有可绘制内容时不创建画布，此时 `single-instance` 与 `renderer-match` 两项自检会失败；示例测试先经 `solid` 中转以避开。是否放宽 `collectChecks` 的判定需先与 B 对齐（会改变 CLI 依赖的协议语义）。
- 饼图仍不提供 `roseType` / `minAngle` / 自定义内半径与环形间距；scatter 与三个场景组件属 T09 后续批次。
- `charts-core` / `charts-react` 的构建不清空 `dist`（`tsc` 不删除已消失入口的产物），建议后续补清理步骤；`charts-vue` 的 `scripts/build.mjs` 已清理并注释了原因。
- 推送与 Verdaccio 发布未执行，按 `AGENTS.md` 需另行获得用户授权；`origin/main` 仍为 `6da7e1c`。
