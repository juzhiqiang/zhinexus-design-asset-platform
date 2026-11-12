# T09 第四批：双框架趋势卡片（trend-card）公共接口对齐说明

日期：2026-11-12。负责人：A（SDK）。分支：`feat/t09-trend`。任务定义见 [实现计划 T09](../plans/2026-11-11-component-platform-implementation.md)；前序基线见 [折线/柱状对齐件](2026-11-12-sdk-bar-chart-protocol.md)、[饼图对齐件](2026-11-12-sdk-pie-chart-protocol.md) 与 [散点对齐件](2026-11-12-sdk-scatter-chart-protocol.md)，验证证据见 [T09 第四批验证记录](../verification/t09-trend-card.md)。

本文是 T09 第四批（趋势卡片，T09 第一个「组合场景」）的接口对齐件，供 C（contracts / 根工具链）与 B（CLI / 消费者）评审。T09 后续批次（ranking / proportion）按同一模式扩展，不改变本文已冻结的形状，也不改变前三批已冻结的折线、柱状、饼图与散点形状。

## 1. 范围与前置

- 输入：T02 `@company/charts-core` 0.0.3、T03 双框架折线图、T09 第一批柱状图（0.0.2）、第二批饼图 / 环形图（0.0.3）、第三批散点图（0.0.4，`ChartType` 联合已含 `'scatter'`，`buildChartOption` 已按类型分发）。
- 本批交付：`@company/charts-core` 趋势卡片 option 与图表类型联合扩展（0.0.5）、`@company/charts-vue` / `@company/charts-react` 的 `TrendCard` 与 `./trend-card` 子路径、双框架趋势卡片示例（共享 `examples/fixtures/trend-card.json`）、消费者 `./trend-card` 验收。
- 不在本批：ranking / proportion（T09 后续组合场景）、`symbolSize` 等散点专属配置、ECharts 升级矩阵（T10）。
- 趋势卡片是 T09 计划中的第一个「组合场景」：它在单一图表实例内组合**数值摘要**（当前值 / 前期值 / 变化）与**迷你趋势线（sparkline）**，复用 T02 起的数据与事件约定，不引入新的数据协议。

## 2. charts-core：图表类型联合扩展

| 类型 | 形状 |
| --- | --- |
| `ChartType` | `'line' \| 'bar' \| 'pie' \| 'scatter' \| 'trend-card'` |
| `TrendCardConfig` | `ChartConfig & { chart: 'trend-card'; title?: string; previousValue?: number \| null }` |
| `TrendCardOption` | `ComposeOption<LineSeriesOption \| ChartComponentOption \| GraphicComponentOption>` |
| `AnyChartConfig` | 前述四种配置联合再并上 `TrendCardConfig`（`createChartController` 入口） |
| `TrendSummary` | `{ current: number \| null; previous: number \| null; delta: number \| null; deltaPercent: number \| null; direction: 'up' \| 'down' \| 'flat' \| 'none' }` |

- `chart` 在 `TrendCardConfig` 中为必填判别字段，与柱状图、饼图、散点图一致：框架组件在缺省配置时注入 `{ chart: 'trend-card' }`，调用方显式传配置时必须带该字段。
- 新增导出：`buildTrendCardOption`、`computeTrendSummary`；`buildLineOption` / `buildBarOption` / `buildPieOption` / `buildScatterOption` / `createChartController` / `ChartData` / `ChartEvent` / `SupportedOptionOverrides` 等既有导出的语义不变。
- 内部新增 `src/charts/trend-card.ts`；`src/charts/index.ts` 的 `chartTypeOf` / `buildChartOption` 增加 `'trend-card'` 分支；`src/engine/modules.ts` 的 `ensureChartModules('trend-card', renderer)` 注册 `LineChart` + `Grid` + `Tooltip` + `Legend` + `Graphic` + 指定渲染器（趋势卡片是类目轴图表，坐标轴组件全部需要；`Graphic` 供数值摘要文本使用）。

### 2.1 趋势卡片数值语义（`computeTrendSummary`）

- **数据复用 `ChartData`**：`points[].x` 为类目轴坐标（时间 / 期间标签），`points[].y` 为数值；与折线 / 柱状同一套类目轴与缺失值规则。
- **当前值**：取**第一个系列**（`series[0]`）中**最后一个非缺失值**（自末尾向前找第一个 `y !== null`）；没有可用值时 `current = null`。多系列时全部系列都绘成 sparkline，但摘要「当前值」只来自第一个系列（主要指标）。
- **前期值**：来自 `config.previousValue`；`undefined` / `null` / `NaN` 一律归一为 `previous = null`（视为无对比基线）。
- **变化量 / 变化率**：`current` 与 `previous` 均可算时 `delta = current - previous`；`previous !== 0` 时 `deltaPercent = (delta / Math.abs(previous)) * 100`（取基线绝对值，避免负基线导致方向反转）。任一不可算时对应字段为 `null`。
- **方向**：`delta === null → 'none'`；`delta > 0 → 'up'`；`delta < 0 → 'down'`；`delta === 0 → 'flat'`。
- **共享规范化不变**：重复 id、`NaN` y 等仍抛 `ChartDataError`；缺失值（`null`）不补 0、不参与当前值取末的逻辑（被跳过）。

### 2.2 趋势卡片 option 语义

- **sparkline**：每个系列一条 `line` 系列，`smooth: true`、`areaStyle: { opacity: 0.15 }`（用系列自身色）、`showSymbol: true` + `symbolSize: 5`（保证符号可点击、可见）；系列 `id` / `name` 稳定，`emphasis: { focus: 'series' }`。
- **坐标轴隐藏但仍建坐标系**：`xAxis.type='category'`、`yAxis.type='value'`，均 `show: false`（卡片观感），但坐标系仍注册，`convertToPixel` 可用（点击测试钩子无需按图表类型分叉）。
- **数值摘要在 `graphic`**：`graphic` 文本元素自上而下三区——标题（`config.title`，小号 muted）、当前值（`formatValue(current, unit)`，大号加粗，`current === null` 时显示「暂无数据」）、meta 行（rich text：`前期 formatValue(previous)` 为 muted，`▲/▼ |delta| (|deltaPercent|%)` 按方向上绿 / 下红 / 平 muted）。`previous` 与 `delta` 均不可算时不渲染 meta 行。
- **空数据**：`series: []` → 无 sparkline 系列、`graphic` 显示「暂无数据」、无 meta 行，JSON 不含 `NaN`，不抛错。
- **单位口径**：`unit` 作用于当前值、前期值、变化量与 sparkline 的 y 轴 / tooltip（与折线 / 柱状一致）。
- **tooltip**：`trigger: 'axis'`，`valueFormatter` 用 `formatValue(value, unit)`（与折线一致）。
- **图例**：多系列（`series.length > 1`）才渲染，单系列与空数据不渲染。
- **optionOverrides**：趋势卡片合并全部坐标轴类字段 `grid` / `tooltip` / `legend` / `xAxis` / `yAxis` / `title`（默认白名单）；系列、主题、渲染器与 `graphic` 不可覆盖。

### 2.3 控制器与事件语义

- 控制器按运行期联合分发：`chartTypeOf({chart:'trend-card'})` → `'trend-card'`；`update` / `setPresentation` / `dispose` / `ResizeObserver` 等待与既有图表共用同一实现，无趋势卡片专属分支。
- **点击载荷不变**：sparkline 为 `line` 系列，数据项为对齐后的数值（非数组），`params.value` 为单一数值，`ChartEvent.value` 走 `[类目, 值]` 路径，与折线 / 柱状同构（如 `{seriesId:'active', dataIndex:2, value:['周三',180], nativeType:'click'}`）。控制器 `eventValue` 无需改动。
- 图表类型在单个组件实例生命周期内固定，`config.chart` 不用于运行时切换。

## 3. 框架包导出面

| 入口 | 内容 |
| --- | --- |
| `.` | `LineChart`、`BarChart`、`PieChart`、`ScatterChart`、`TrendCard`、`useChart`、`sameLineConfig` / `sameBarConfig` / `samePieConfig` / `sameScatterConfig` / `sameTrendCardConfig` / `sameChartConfig`、组件与 hook 类型、自 core 重新导出的共享类型（含 `TrendCardConfig`） |
| `./trend-card` | 仅趋势卡片入口（组件 + hook + 类型），供按需加载 |
| `./style.css` | 容器基础样式（`.charts-line` / `.charts-bar` / `.charts-pie` / `.charts-scatter` / `.charts-trend-card`） |

- 两包仍不重新导出 `createChartController` / `buildTrendCardOption` / `computeTrendSummary`。
- 组件属性与既有图表对等：`data` / `config` / `optionOverrides`；Vue `@point-click` 与 React `onPointClick` 共用 `ChartEvent`；React 另保留 `className` / `style` / `ref`。容器类名固定为 `charts-trend-card`。
- `useChart` 的 `chart` 参数接受 `'trend-card'`；`CHART_CONFIG_FIELDS['trend-card'] = ['title', 'previousValue']`，`defaultConfig('trend-card') = { chart: 'trend-card' }`；既有图表字段不变。
- 新增 `sameTrendCardConfig`，与 `sameLineConfig` / `sameBarConfig` / `samePieConfig` / `sameScatterConfig` 同构。`title` / `previousValue` 变化走与主题无关的「销毁重建以应用新 option 语义」路径，数据由当前 props 保留。

## 4. 示例与消费者

- 共享 fixture：`examples/fixtures/trend-card.json`，状态 `default` / `empty` / `missing` / `single` / `no-previous` / `updated` / `down`，每状态带 `expectedSeriesIds`；两框架示例读取同一文件，数据与点击载荷完全一致。
- 示例页：`examples/vue/trend-card.html`（`src/trend-card-main.ts` + `src/TrendCardApp.vue`）与 `examples/react/trend-card.html`（`src/trend-card-main.tsx` + `src/TrendCardApp.tsx`）；示例固定 `{ chart: 'trend-card', theme: 'light', renderer: 'canvas', animation: false }` 与 `previousValue`，卡片容器固定高度（保证 graphic 布局与截图可复现）。
- 就绪协议不变（`ready` / `states` / `runState` / `getChecks`，自检 `single-instance` / `no-page-error` / `series-match` / `renderer-match`），沿用第三批的 `runState` 重复应用幂等修复。空状态经 `update` 到达（非重建），保留 1 个画布。
- 测试钩子无需改动：`seriesData()` 已兼容数值系列；`pointClientPosition` 对类目轴数值系列按类目取 x，散点图的 `[x, y]` 泛化不影响趋势卡片。
- 消费者模板新增趋势卡片页面（`tests/consumers/{vue,react}/trend-card.html` 与对应入口），`tests/integration/packed-consumer-frameworks.test.ts` 覆盖 `./trend-card` 的 Node 导入、多页构建、真实渲染与点击载荷。
- `vite.config.ts`（两示例 + 两消费者 + `charts-vue` 库入口）显式登记 `trend-card` 入口。

## 5. 需要 C / B 配合

### 5.1 候选包（0.0.5，`feat/t09-trend` 分支）

候选 tarball 由 `pnpm pack` 冻结（Linux 复现环境，Node `26.13.0` / pnpm `12.18.0`），摘要在验证记录中给出，供 B 的材料生成接入与核对；**B 应在自己的工作树重新冻结并以新摘要贯穿自己的链路**。0.0.4 → 0.0.5 为兼容变更（0.x 阶段按规则升 PATCH），无新增依赖、锁文件不变（`workspace:*` 协议）。

### 5.2 B：CLI 发布材料生成实现清单

沿用 [散点对齐件第 5.2 节](2026-11-12-sdk-scatter-chart-protocol.md) 的同一缺口：`packages/component-cli/src/local/manifest.ts` 的 `ComponentName` 仍需从 `'line' | 'bar'` 扩展到含 `pie` / `scatter` / `trend-card`，否则平台 API 的逐导出覆盖检查会拒绝未覆盖全部导出的 Bundle。trend-card 需要 B 至少补充：

1. `ComponentName` 增加 `'trend-card'`；入口文件名 `trend-card.html`（消费者页由 A 交付）。
2. `exportName` 映射补 `'TrendCard'`。
3. docs 文案映射补「趋势卡片」。
4. `capture.ts` 容器尺寸探测选择器链建议补 `.charts-trend-card`（当前经 `.chart-frame` 已可探测）。
5. 状态名：若 Bundle 需覆盖示例多于 `default` 的状态，补充趋势卡片状态名（`missing` / `single` / `no-previous` / `down`）；当前 fixtures 未被 manifest 引用，不影响默认流程。

### 5.3 C：contracts

- 无 schema 变化：`ComponentExample` / `CheckResult` / `ChartEvent`（payload 结构未变，趋势卡片取 `[类目, 值]`）/ `ExampleRef` / `ScreenshotRef` 形状均未变。
- 若 `ExampleRef.requiredStates` 需要覆盖趋势卡片示例状态，按 fixture 状态集合补充。

## 6. 已知边界与后续

- 趋势卡片「当前值」口径固定为第一个系列最后一个非缺失值，「前期值」来自 `config.previousValue`；不做聚合口径（求和 / 均值）配置，避免在组件内猜业务指标口径（与 proportion 的同一原则）。需要其它口径时以兼容方式新增配置字段并评估版本。
- sparkline 恒开启，不提供开关；卡片标题、单位、主题 / 渲染器、动画均沿用 `ChartConfig` 与既有语义。
- 数值摘要布局基于固定卡片高度的像素定位，示例使用固定高度保证截图可复现；宿主自行缩放容器时 graphic 文本位置随图表尺寸百分比/像素锚定，不保证任意高度下的像素级一致。
- ranking / proportion 按同一模式扩展：core 增加场景入口与模块注册、框架包增加组件与子路径、fixtures 与示例同步、消费者与矩阵测试补充。排名需明确排序方向与并列处理；比例需在总量为零时显示「暂无数据」并不输出 NaN。
