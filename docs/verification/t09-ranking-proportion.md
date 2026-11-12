# T09 第五批验证记录：双框架排行榜（ranking）与占比（proportion）

日期：2026-11-13。负责人：A（SDK）。分支：`feat/t09-ranking-proportion`（基线 `eb1d054`）。任务定义见 [实现计划 T09](../superpowers/plans/2026-11-11-component-platform-implementation.md)，接口以 [T09 第五批对齐件](../superpowers/specs/2026-11-13-sdk-ranking-proportion-protocol.md) 为准，前序基线见 [柱状图](t09-bar.md)、[饼图](t09-pie.md)、[散点图](t09-scatter.md) 与 [趋势卡片](t09-trend-card.md) 验证记录。

本批完成后 T09 的 7 个逻辑组件（line / bar / pie / scatter / trend-card / ranking / proportion）、14 个框架实现全部齐套。

## 1. 交付内容

- `packages/charts-core`：`ChartType` 扩展为 `'line' | 'bar' | 'pie' | 'scatter' | 'trend-card' | 'ranking' | 'proportion'`；新增 `RankingChartConfig` / `RankingChartOption` / `RankingEntry` / `RankingDirection`、`ProportionChartConfig` / `ProportionChartOption` / `ProportionShare` 与 `src/charts/ranking.ts`（`buildRankingOption` + `computeRanking`）、`src/charts/proportion.ts`（`buildProportionOption` + `computeProportionShares`）；`src/charts/index.ts` 的 `chartTypeOf` / `buildChartOption` 增加两个分支；`ensureChartModules('ranking' | 'proportion', renderer)` 注册 `BarChart` + 网格 / 提示 / `Graphic` + 指定渲染器（单系列不注册图例）。
- 新增共享数据工具与守卫：`sumDefinedValues`（非缺失值之和）、`assertSingleSeries`、`assertUniqueNames`；`pieTotal` 改为复用 `sumDefinedValues`，口径不变。新增 `src/charts/scene-slots.ts`（`textSlot` / `hiddenSlot` / `EMPTY_DISPLAY` / `mutedColor`），趋势卡片的槽位逻辑提取出来供两个新场景复用。
- `packages/charts-vue` / `packages/charts-react`：新增 `Ranking` / `Proportion` 组件、`ranking-chart.types.ts` / `proportion-chart.types.ts`、`ranking.ts` / `proportion.ts` 与 `./ranking` / `./proportion` 子路径导出；`useChart` 的 `CHART_CONFIG_FIELDS` 增加 `ranking: ['direction','limit','title']` 与 `proportion: ['title']`，`defaultConfig` 增加两个分支；新增 `sameRankingConfig` / `sameProportionConfig`；`style.css` 增加 `.charts-ranking` / `.charts-proportion`；charts-vue 的 vite 库入口登记两个新入口。
- 示例：`examples/fixtures/ranking.json`（`default` / `empty` / `missing` / `single` / `updated` / `tied`，`limit` 固定 5）、`examples/fixtures/proportion.json`（`default` / `empty` / `zero-total` / `missing` / `single` / `updated`）；两框架各新增 `ranking.html` / `proportion.html`、`RankingApp` / `ProportionApp`、`ranking-main` / `proportion-main`。
- 消费者：`tests/consumers/{vue,react}` 各新增 `ranking.html` / `proportion.html` 与对应 `src/*App` / `src/*-main`。
- B 侧（A 侧代 B 完成，B 可复核）：`packages/component-cli` 的 `ComponentName` / `COMPONENT_ENTRY_HTML` / `COMPONENT_EXPORT` / 默认 `components` 扩展到 7 组件，`capture.ts` 容器选择器链补两个类名；`tests/integration/cli-bundle.test.ts`、`cli-release.test.ts`、`tests/platform/http-support.ts` 的 `grant()` 三处清单同步。

## 2. 语义约定（本批冻结）

**排行榜**：默认按数值降序（`direction: 'asc'` 反向）；并列（数值相同）共享名次，采用竞赛排名 **1,2,2,4**；并列项之间按原始输入顺序稳定排列；缺失值（null）不入榜也不占名次；`limit` 取前 N 名且**名次在截断前计算**；`limit` 仅正整数生效（正小数向下取整，`0` / 负数 / `NaN` / `undefined` 不截断）；负值原样参与排行；名次写入类目轴标签（`1. 条目`）；统计行展示条目总数，被截断时为 `共 N 项 · 取前 M 名`；空数据显示「暂无数据」。

**占比**：占比 = 值 / 全部条目非缺失值之和；缺失值不进分母；总量为零（全零或全缺失）时展示「暂无数据」、无系列、不产出 `NaN%`；负值抛 `ChartDataError`（与饼图同一规则）；**条目顺序保持输入顺序，占比场景不排序**（需要排序时用排行榜，两个场景的顺序口径因此可对照）；总量行展示参与占比的合计值；不在组件内猜业务指标口径。

**共同守卫**：两个场景都只接受单系列（多系列抛 `ChartDataError`，`path: 'series[1]'`）且条目名称必须唯一（同名条目在类目轴上互相覆盖，抛 `ChartDataError`）。

## 3. 实际执行的验证命令与结果

> 以下命令在 Linux 沙箱复现环境中执行（Node 26.13.0 / pnpm 12.18.0，仓库源码经 `git archive` 取树后 `pnpm install --frozen-lockfile`）。`test:browser` 前已关闭并重启 5173–5176 端口服务。完整日志与打包产物见本目录同批 `*.log` 附件（沙箱内）。

| 命令 | 结果 |
| --- | --- |
| `pnpm build`（清空 `.turbo` 后全量） | 10/10 successful |
| `pnpm typecheck`（含 `build:services`） | 14 successful + root `tsc --noEmit` 通过 |
| `pnpm exec vitest run tests/unit/chart-semantics.test.ts` | 105 passed（既有 68 + 新增 37） |
| `pnpm exec vitest run`（除下述单独运行的文件外全部） | 563 passed / 4 skipped / 1 failed |
| `pnpm exec vitest run tests/integration/packed-consumer-frameworks.test.ts` | 9 passed |
| `pnpm exec vitest run tests/integration/cli-check.test.ts` | 6 passed |
| `pnpm exec vitest run tests/integration/platform-config.test.ts --test-timeout=60000` | 2 passed |
| `pnpm exec playwright test --config tests/playwright.config.ts` | 117 passed（main 基线 89 + 新增 28） |
| `pnpm exec tsx scripts/verify-workspace.ts` | Workspace verified: 10 members, no cycles, four publishable shells, safe service graph |

### 3.1 TDD RED → GREEN

- **RED**：在移除 `ranking.ts` / `proportion.ts` / `scene-slots.ts` 并回退 core 其余改动的基线上运行 `tests/unit/chart-semantics.test.ts`，新增的 37 项全部失败（`buildRankingOption is not a function` / `buildProportionOption is not a function`），既有 68 项不受影响。
- **GREEN**：恢复实现后同文件 105 项全部通过。

### 3.2 cli-bundle 14 变体（分框架两次执行）

`tests/integration/cli-bundle.test.ts` 的单次执行在本沙箱超过单次命令执行上限（约 3 分钟），因此按框架分两次调用同一个 `prepareReleaseBundle`（组件清单与测试完全一致：7 组件 × 1 框架），再用 `validatePlatformBundle` 校验：

| 框架 | 变体 | 报告 | 平台逐导出校验 |
| --- | --- | --- | --- |
| vue | line/bar/pie/scatter/trend-card/ranking/proportion-vue（7） | 7 | 通过 |
| react | line/bar/pie/scatter/trend-card/ranking/proportion-react（7） | 7 | 通过 |

平台校验通过即证明 SDK 0.0.6 新增的 `./ranking` 与 `./proportion` 子路径都已有对应变体声明，不会触发 `ARTIFACT_MISMATCH`。该测试在 Windows 开发机上应能一次跑完（测试自身超时为 300s）。

### 3.3 浏览器矩阵新增用例（28 项）

排行榜 13 项：空数据无系列、缺失值不入榜（5 项而非 6 项）、降序 + 并列名次（经 `categoryLabels()` 断言 `1. 柱状图` / `1. 饼图` / `3. 折线图` / `4. 散点图` / `5. 趋势卡片`，tied 状态断言 `1,1,1,4,5`）、`limit` 截断统计行、更新与单条目、点击载荷一致、双框架载荷等价、React StrictMode 清理重挂载、Vue 重挂载单实例。

占比 15 项：零总量与空数据均展示「暂无数据」且统计行不残留、缺失值不进分母（总量 300 → 280）、条目顺序保持输入顺序、单条目占满总量、点击载荷一致、双框架载荷等价、StrictMode 与重挂载。

## 4. 候选 tarball 摘要（发布链口径）

取树方式：`git archive HEAD | tar -x`（git 权威文件模式，不用 `tar` 同步工作树）；打包方式：`packages/component-cli/src/local/pack.ts` 的 `packPackage()`（`pnpm pack --pack-destination` + `SOURCE_DATE_EPOCH=1700000000`）；`dist` 来自对同一提交态源码的干净构建。连续打包两次摘要一致。

| 包 | 版本 | 字节 | SHA-256 |
| --- | --- | --- | --- |
| `@company/charts-core` | 0.0.6 | 39,921 | `42f9d8f80d7c668493be63ec92439e1e5c363127721a2c313927e3d16034f015` |
| `@company/charts-vue` | 0.0.6 | 6,621 | `90c70ce2f1d36fa1992887c0f513c09b04503595ec27be4d2770c9ebac3d4444` |
| `@company/charts-react` | 0.0.6 | 12,003 | `4c3ff2dba5eba0c918e526887ead25c5b7436b403d94540df046094d0bd30945` |
| `@company/component-cli` | 0.0.6 | 64,887 | `5c5c701774f5019814e8b242d5740b71ccd2bbd5b59e75f72a4a7f533934f9a7` |

## 5. 未覆盖边界与已知限制

- **Windows 原生复验未执行**：Linux 沙箱无法运行 PowerShell 与本地 Playwright Chromium（Windows 版）。可执行清单与回填模板见 [t09-ranking-proportion-windows-native.md](t09-ranking-proportion-windows-native.md)，需用户在 Windows 开发机执行后回填，A 侧不声称 Windows 原生验证已通过。
- **`cli-release` 集成测试失败（既有，非本批回归）**：该测试需要本地 PostgreSQL / MinIO / Verdaccio 基础设施，沙箱内不可用。main 基线同样为 1 failed（`cli-release`）。
- **`platform-config.test.ts` 在沙箱内默认 5s 超时下失败**：属机器速度问题，加 `--test-timeout=60000` 后 2 项全部通过；与 SDK 改动无关。
- **示例就绪探针限制**：占比的 `zero-total` 与 `empty` 渲染结果完全相同（都无系列、都显示「暂无数据」），系列快照不变化，示例运行时的 `arm()` 会等到超时。fixture 因此让这两个状态各自从 `default` 单独进入；后续批次写 fixture 时需注意同一约束。
- **多系列输入被明确拒绝**：排行榜与占比只接受单系列。这与折线 / 柱状 / 饼图 / 散点图（支持多系列）不同，是组合场景的显式约定；若后续需要多条目多分组，应新增场景而不是放宽守卫。
- **README 的 SDK 段落仍未刷新**：自 G0 / T02 起已过期，建议 C 在 T09 收口时统一处理（本批未触碰）。

## 6. 踩坑记录（供后续批次复用）

- **大小写不敏感文件系统上的输出名碰撞**：`ranking.ts` 与 `Ranking.tsx` 会分别产出 `ranking.js` 与 `Ranking.js`，在 Windows / macOS 与部分挂载文件系统上是同一个文件，TypeScript 直接报 `TS5056: ... would be overwritten by multiple input files`。组件文件因此命名为 `RankingChart.vue` / `RankingChart.tsx`（与 `BarChart` / `PieChart` 同模式），导出名仍为 `Ranking` / `Proportion`。
- **沙箱内改名后必须清理旧文件再同步**：用 `tar` / `rsync` 同步源码不会删除目标侧已不存在的文件，改名前的旧源文件会残留并与新文件再次碰撞，产出内容被拼接的损坏 `dist`。本次先用 `rsync -a --delete`（并排除 `.pw-browsers`，否则会把已安装的 Playwright 浏览器删掉）再全量重建。
- **`summarySlots()[1]` 不能写在 `page.evaluate` 里**：`(await page.evaluate(() => hook.summarySlots())[1])` 会把 `[1]` 索引到 Promise 上得到 `undefined`，必须先取回数组再索引。
- **横向条形的测试钩子**：`pointClientPosition` 原本假定 x 为类目轴、y 为数值轴，对横向条形（x 数值轴 / y 类目轴）会返回 NaN 并回退到扇形几何。已泛化为按轴类型判别；点击时坐标落在条形末端，需向左偏移 8px 才能落入条体内部。
