# T09 第四批验证记录：双框架趋势卡片（trend-card）

日期：2026-11-12。负责人：A（SDK）。分支：`feat/t09-trend`。任务定义见 [实现计划 T09](../superpowers/plans/2026-11-11-component-platform-implementation.md)，接口以 [T09 第四批对齐件](../superpowers/specs/2026-11-12-sdk-trend-card-protocol.md) 为准，前序基线见 [柱状图](t09-bar.md)、[饼图](t09-pie.md)、[散点图](t09-scatter.md) 验证记录。

本批交付趋势卡片——T09 计划中的第一个「组合场景」：在单一图表实例内组合数值摘要（当前值 / 前期值 / 变化）与迷你趋势线（sparkline），复用 T02 起的数据与事件约定。ranking / proportion 属 T09 后续组合场景，不在本记录范围内。

## 交付内容

- `packages/charts-core`：`ChartType` 扩展为 `'line' | 'bar' | 'pie' | 'scatter' | 'trend-card'`；新增 `TrendCardConfig` / `TrendCardOption` / `TrendSummary` 与 `src/charts/trend-card.ts`（`buildTrendCardOption` + `computeTrendSummary`）；`src/charts/index.ts` 的 `chartTypeOf` / `buildChartOption` 增加 `'trend-card'` 分支；`ensureChartModules('trend-card', renderer)` 注册 `LineChart` + 网格 / 提示 / 图例 / `Graphic` + 指定渲染器。
- `packages/charts-vue` / `packages/charts-react`：新增 `TrendCard.vue` / `TrendCard.tsx`、`trend-card-chart.types.ts`、`trend-card.ts` 与 `./trend-card` 子路径导出；`useChart` 的 `CHART_CONFIG_FIELDS` 增加 `'trend-card': ['title', 'previousValue']`，`defaultConfig('trend-card') = { chart: 'trend-card' }`；新增 `sameTrendCardConfig`；`style.css` 增加 `.charts-trend-card`；`charts-vue` 的 vite 库入口登记 `trend-card`。
- 示例：`examples/fixtures/trend-card.json`（`default` / `empty` / `missing` / `single` / `updated` / `down`，`previousValue` 固定为 160 且只随数据变化，保证空状态经 `update` 到达而不重建控制器）、`examples/vue/trend-card.html` + `src/TrendCardApp.vue` + `src/trend-card-main.ts`、`examples/react/trend-card.html` + `src/TrendCardApp.tsx` + `src/trend-card-main.tsx`；两框架 `src/example/runtime.ts` 的测试钩子新增 `summarySlots()`（读回 graphic 槽位文本，`ignore` 槽位为 `null`）。
- 消费者：`tests/consumers/{vue,react}` 各新增趋势卡片页面，`tests/integration/packed-consumer-frameworks.test.ts` 覆盖 `./trend-card` 的 Node 导入、`dist/trend-card.js` 存在性、多页构建、真实渲染与点击载荷。
- 测试：`tests/unit/chart-semantics.test.ts` 新增 21 项趋势卡片语义（`computeTrendSummary` 6 项 + option 构建 15 项）；`tests/browser/component-matrix.spec.ts` 新增 15 项双框架矩阵。
- 版本：三包 0.0.4 → 0.0.5（0.x 兼容变更 PATCH），`CHANGELOG.md` 同步；锁文件不变。

## TDD 过程

按 RED → GREEN 执行。RED 提交为 `9ecf854`（`test: 新增趋势卡片数值语义与 option 构建失败用例`），实测 RED 为 `computeTrendSummary is not a function` / `buildTrendCardOption is not a function`（20 failed / 47 passed），确认后逐域实现转 GREEN。

| 目标 | RED 实测 | GREEN 实测 |
| --- | --- | --- |
| `tests/unit/chart-semantics.test.ts` | 20 failed（`buildTrendCardOption` / `computeTrendSummary is not a function`） | 68 passed |
| `tests/browser/component-matrix.spec.ts --grep trend-card` | 15 failed（`/trend-card.html` 未注册，画布计数为 0） | 15 passed |
| `tests/integration/packed-consumer-frameworks.test.ts` | 缺 `./trend-card` 入口、`dist/trend-card.js`、`trend-card.html` 与点击载荷 | 9 passed（该文件共 9 项，趋势卡片在既有项内扩展覆盖；与 `packed-consumer.test.ts` 合计 10 项） |

RED 后进入 GREEN 时发现一个**实现缺陷**（见「关键行为证据」末条）：数值摘要的 graphic 元素在状态切换时会残留上一次的文本。修复提交为 `2a02bae`，并补了单测与浏览器回归用例；该缺陷也说明「构建新 option 的单测」覆盖不到「同一实例上多次 setOption 的合并行为」，因此浏览器层的 `summarySlots()` 断言是必要补充。

## 实际执行的验证命令与结果

环境与仓库锁定工具链一致：Node `26.13.0`、pnpm `12.18.0`、TypeScript `7.0.2`（`charts-vue` 与示例按既有兼容例外用 `6.0.3` + `vue-tsc 3.3.14`）、Vue `3.5.45`、React `19.3.1`、ECharts `6.1.0`、Vitest `5.1.0`、Playwright `1.65.0` + Chromium headless shell。`test:browser` 按既有约定设置 `NEXT_PUBLIC_SITE_URL=https://gallery.test`。以下命令均在 `feat/t09-trend` 分支（0.0.5 最终状态，清空 Turbo 本地缓存后）实际执行：

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 锁文件与 `package.json` 一致，无变化 |
| `pnpm exec tsx scripts/verify-workspace.ts` | Workspace verified: 10 members, no cycles, four publishable shells, safe service graph |
| `pnpm build` | 10 tasks successful |
| `pnpm typecheck` | 14 tasks successful + 根 `tsc -p tsconfig.json --noEmit` 通过 |
| `pnpm test` | 23 files / 512 tests passed，4 skipped（`tests/tooling/verify.test.ts` 既有跳过） |
| `pnpm test:browser` | 86 passed |
| `pnpm exec vitest run tests/integration/packed-consumer-frameworks.test.ts` | 9 passed（另跑 `packed-consumer.test.ts` 1 passed，合计 10 项） |

- `pnpm test` 512 passed = 新基线 main `3bbf687` 的 491 passed + 本批 21 项趋势卡片语义。
- `pnpm test:browser` 86 passed = 新基线 main `3bbf687` 的 71 项 + 本批 15 项趋势卡片矩阵（含 2 项数值摘要 staleness 回归）。
- 按既有顺序约束，`test:browser` 会清空 `test-results/`，因此先跑浏览器测试、再单独跑一次消费者 vitest 文件以恢复打包体积基线。

## 关键行为证据

- **数值摘要语义（`computeTrendSummary`）**：当前值取第一个系列最后一个非缺失值（自末尾向前）；末尾缺失时回退（`[120,180,null]` + 前期 200 → current 180、delta -20、-10.0%、down）；全缺失或无系列 → `current = null`、`direction = 'none'`。前期值 `undefined` / `null` / `NaN` 一律归一为 `null` 且不算变化；前期值为 0 时变化量可算、变化率为 `null`；负基线按绝对值计算变化率（`current 200` / `previous -160` → delta 360、+225.0%、up），方向不被反转。
- **sparkline 语义**：系列类型为 `line`、id 稳定，数据为对齐后的类目轴数值（`[120, null, 180, 200]`，缺失值保持 `null` 不补 0）；`xAxis.type='category'` / `yAxis.type='value'`，均 `show: false`（卡片观感）但坐标系仍注册；`xAxis.boundaryGap` 为 `false`（与折线一致）。
- **空数据**：`{series: []}` → 空系列、无图例、graphic 显示「暂无数据」、无 meta 行，option JSON 不含 `NaN`、不抛错；浏览器端画布数仍为 1（空状态经 `update` 到达，不触发控制器重建）。
- **单位口径**：`unit={suffix:'人'}` 时当前值 `200人`、meta 行 `前期 160人` + `▲ 40人 (25.0%)`，与 y 轴 / tooltip 共用 `formatValue`。
- **多系列**：多个系列都绘成 sparkline 并渲染图例，但「当前值」只来自第一个系列。
- **optionOverrides**：趋势卡片合并 `grid` / `tooltip` / `legend` / `xAxis` / `yAxis` / `title` 六键均生效；`graphic` 由数据驱动，覆盖中的 `graphic` 键被忽略（`patched.graphic` 仍等于 `base.graphic`）；调色板仍来自主题，`renderer` 不进入 option。
- **SSR 安全导入**：`expect(typeof window).toBe('undefined')` 下构建 option 不访问浏览器全局；工作区外消费者 Node 导入 `./trend-card` 不访问 `window` / `document`。
- **点击载荷（双框架）**：sparkline 为折线系列，数据项为数值，`params.value` 为单一数值，载荷走 `[类目, 值]` 路径。两框架示例在 `single` 状态点击同一数据点，载荷均为 `{seriesId:'active', dataIndex:0, value:['周一',200], nativeType:'click'}` 且完全相等；控制器 `eventValue` 无需改动。
- **更新与系列删减**：`default` → `updated` → `down` 数据更新后 sparkline 序列随之变化（`[120,150,180,200]` → `[210,190,230,240]` → `[200,180,150,120]`），实例系列数与画布数始终为 1，无残留系列。
- **StrictMode / 重挂载**：React 开发态（5176）与 Vue 重挂载后仍只有 1 个画布，点击只产生 1 次事件。
- **数值摘要 staleness 修复（本批实测发现）**：控制器首次 `applyOption` 时数据尚为空（槽位 `ignore: true`），随后 `update` 才填入数据；ECharts 按 id 合并 graphic 元素，若可见槽位不显式声明 `ignore: false`，合并后会保留上一次的 `ignore: true` 而导致 meta 行不渲染，且切到空数据时会残留上一次的 meta 文本（复现：`default` → `empty` 仍显示 `前期 160 ▼ 40 (25.0%)`）。修复为三个稳定槽位（`trend-title` / `trend-value` / `trend-meta`）每次构建都完整给出，未使用的槽位 `ignore: true`、可见槽位显式 `ignore: false`。经 ECharts 探针确认 `$action: 'remove'` 与 `$action: 'replace'` 均不能可靠移除 graphic 元素，且首次渲染移除不存在元素会抛 `graphic type MUST be set` 之外的合并异常，故选用稳定槽位方案。修复后浏览器 `summarySlots()` 断言：`default` → `['近 7 日活跃用户','200','{prev|…}']`、`empty` → `['近 7 日活跃用户','暂无数据',null]`、`down` → `['近 7 日活跃用户','120','…▼…']`。
- **工作区外消费者**：`pnpm pack` 冻结三个 tarball → 工作区外临时目录 `npm install` → 解析到消费者自身 `node_modules`；`./trend-card` 与 `./line` / `./bar` / `./pie` / `./scatter` 的 Node 导入均不访问 `window` / `document`；模板工程类型检查通过；缺导出与 `@company/charts-core/src/...` 源码别名仍失败；多页构建（`index.html` + `bar.html` + `pie.html` + `scatter.html` + `trend-card.html`）成功，产物不含 `FunnelView` / `GaugeView` / `MapView` / `EffectScatter` / `BoxplotView` / `SankeyView`，不含 `packages/charts-*/src` 路径；五个页面在真实浏览器渲染并得到等价点击载荷（趋势卡片为 `{seriesId:'active', dataIndex:0, value:['周一',120], nativeType:'click'}`）。
- **打包体积护栏**（护栏 1 MiB，记录于 gitignored 的 `test-results/t03-bundle-baseline.json`）：Vue 消费者 JS `685,438` 字节（散点 0.0.4 后 `667,506`）、React 消费者 JS `843,215` 字节（散点 0.0.4 后 `825,184`），CSS 均 `128` 字节；增量来自消费者页面同时引入五个图表入口。
- **截图验证（Playwright 真实驱动示例页）**：对 `5174/trend-card.html` 捕获 `default` / `down` / `empty` 三状态，无页面错误。默认态显示标题「近 7 日活跃用户」、大号当前值「200」、meta 行「前期 160 ▲ 40 (25.0%)」（上升为绿）与平滑面积 sparkline；下降态为「120」+「前期 160 ▼ 40 (25.0%)」（下降为红）与下行 sparkline；空态为「暂无数据」且无 meta 行。截图存于 gitignored 目录（未纳入提交）。

## 候选 tarball（0.0.5）

由 `pnpm pack` 在 Linux 复现环境冻结（Node `26.13.0` / pnpm `12.18.0`），摘要如下，与 [对齐件第 5.1 节](../superpowers/specs/2026-11-12-sdk-trend-card-protocol.md) 一致：

| 包 | 版本 | 字节 | SHA-256 |
| --- | --- | --- | --- |
| `@company/charts-core` | 0.0.5 | 30,254 | `eb3b615969e4f8f882505813473056544a7db30b5bb7813037f3d7e972e7a87d` |
| `@company/charts-vue` | 0.0.5 | 5,686 | `45dac9436e0074aa885d04254652f7ac98b070a41dcbf91a510a0e53bde88856` |
| `@company/charts-react` | 0.0.5 | 10,300 | `c95c693125db8b903471fe66f3c5fd915387e7da8aa965b502c23b2f5f58a463` |

> 摘要勘误（2026-11-13 合并 main 后复核）：本表原记录为 core 30,260 / `cfc198d4…`、vue 5,696 / `2d13a7ed…`、react 10,296 / `40ead94a…`，**均为错误值**，已按上表更正。
>
> 错误根源：那三个值取自一次**临时手动** `pnpm pack`，而当时沙箱里的源码树是用 `tar` 从 Windows 工作树同步来的，`packages/charts-*/package.json` 带着工作树的 `0700` 文件模式（git 记录的权威模式是 `100644`，全仓库没有任何 tracked 文件是 755）。`pnpm pack` 原样保留文件模式，于是 tarball 里 `package/package.json` 一项是 0755 而非 0644——内容、大小、mtime 全部相同，仅模式位不同，摘要因此偏离。此前一度误判为 `style.css` 的 CRLF 差异，实测已排除：解包后逐文件 SHA-256 完全相同，`tarfile` 逐成员比对显示**唯一差异就是 `package/package.json` 的 mode**。
>
> 正确做法：候选 tarball 摘要必须用**发布链自身的方式**取——即 `packages/component-cli/src/local/pack.ts` 的 `packPackage()`（`pnpm pack --pack-destination`，并设 `SOURCE_DATE_EPOCH`），或在模式与 git 一致的树上打包。`tests/integration/packed-consumer-frameworks.test.ts` 写出的 `test-results/t03-bundle-baseline.json` 就是这套口径，本表已与之一致；同一棵提交状态重复打包 4 次摘要稳定。

## 未覆盖边界与后续

- 趋势卡片数值摘要布局基于固定卡片高度（示例 `360×180`）的像素定位；宿主任意缩放容器时不保证像素级一致。未做 sparkline 开关、聚合口径（求和 / 均值）与多指标并排。
- 未在真实 Windows 开发机原生执行 `.\scripts\pnpm.ps1`；原生复验清单见 [T09 第四批 Windows 原生复验清单](t09-trend-card-windows-native.md)（沿用柱状图 / 散点图同一模式，由用户在 Windows 开发机执行并回填）。
- ranking / proportion 按同一模式扩展，属 T09 后续批次；B 的 `component-cli` 材料生成缺口（`ComponentName` 仍为 `'line' | 'bar'`）自散点图起记录在案，本批再增 `trend-card`，见 [对齐件第 5.2 节](../superpowers/specs/2026-11-12-sdk-trend-card-protocol.md)。
- 四类图表（line / bar / pie / scatter）的组件 / 状态 / 材料交接见 [T09 图表组件与材料交接清单](t09-chart-component-handover.md)。
