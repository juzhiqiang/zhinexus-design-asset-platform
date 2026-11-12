# T09 第五批：双框架排行榜（ranking）与占比（proportion）公共接口对齐说明

日期：2026-11-13。负责人：A（SDK）。分支：`feat/t09-ranking-proportion`。任务定义见 [实现计划 T09](../plans/2026-11-11-component-platform-implementation.md)；前序基线见 [折线/柱状对齐件](2026-11-12-sdk-bar-chart-protocol.md)、[饼图对齐件](2026-11-12-sdk-pie-chart-protocol.md)、[散点对齐件](2026-11-12-sdk-scatter-chart-protocol.md) 与 [趋势卡片对齐件](2026-11-12-sdk-trend-card-protocol.md)，验证证据见 [T09 第五批验证记录](../verification/t09-ranking-proportion.md)。

本文是 T09 第五批（排行榜与占比，T09 第二、第三个「组合场景」）的接口对齐件，供 C（contracts / 根工具链）与 B（CLI / 消费者）评审。本批完成后 T09 的 7 个逻辑组件、14 个框架实现全部齐套。本批不改变前四批已冻结的形状。

## 1. 范围与前置

- 输入：`@company/charts-core` 0.0.5（`ChartType` 联合已含 `'trend-card'`）、双框架 0.0.5（已有 `TrendCard` 与 `./trend-card` 子路径）。
- 本批交付：`@company/charts-core` 排行榜与占比的 option 构建、类型联合扩展与纯函数（0.0.6）；`@company/charts-vue` / `@company/charts-react` 的 `Ranking` / `Proportion` 与 `./ranking` / `./proportion` 子路径（0.0.6）；双框架示例（共享 `examples/fixtures/ranking.json` 与 `examples/fixtures/proportion.json`）；消费者 `./ranking` / `./proportion` 验收；`@company/component-cli` 的七组件 14 变体材料（0.0.6）。
- 不在本批：ECharts 升级矩阵（T10）、`README.md` SDK 段落刷新（建议 C 在 T09 收口时统一处理）。
- 两个场景都在单一图表实例内组合**数值摘要**（graphic 文本）与**横向条形**，复用 T02 起的数据与事件约定，不引入新的数据协议。

## 2. charts-core：图表类型联合扩展

| 类型 | 形状 |
| --- | --- |
| `ChartType` | `'line' \| 'bar' \| 'pie' \| 'scatter' \| 'trend-card' \| 'ranking' \| 'proportion'` |
| `RankingChartConfig` | `ChartConfig & { chart: 'ranking'; direction?: 'desc' \| 'asc'; limit?: number; title?: string }` |
| `RankingChartOption` | `ComposeOption<BarSeriesOption \| ChartComponentOption \| GraphicComponentOption>` |
| `RankingDirection` | `'desc' \| 'asc'` |
| `RankingEntry` | `{ rank: number; name: string \| number; value: number; sourceIndex: number }` |
| `ProportionChartConfig` | `ChartConfig & { chart: 'proportion'; title?: string }` |
| `ProportionChartOption` | `ComposeOption<BarSeriesOption \| ChartComponentOption \| GraphicComponentOption>` |
| `ProportionShare` | `{ name: string \| number; value: number \| null; share: number \| null; sourceIndex: number }` |
| `AnyChartConfig` | 前述六种配置联合再并上 `RankingChartConfig` 与 `ProportionChartConfig` |

- `chart` 在两个配置中均为必填判别字段，与既有图表一致：框架组件在缺省配置时注入 `{ chart: 'ranking' }` / `{ chart: 'proportion' }`。
- 新增导出：`buildRankingOption` / `computeRanking`、`buildProportionOption` / `computeProportionShares`、`sumDefinedValues` / `assertSingleSeries` / `assertUniqueNames`。既有导出语义不变。
- `ensureChartModules('ranking' | 'proportion', renderer)` 注册 `BarChart` + `Grid` + `Tooltip` + `Graphic` + 指定渲染器。单系列不需要图例，因此不注册 `Legend`；不注册坐标轴之外的组件。

## 3. 排行榜语义（`computeRanking` / `buildRankingOption`）

### 3.1 排序方向与并列规则（本批核心约定）

- **排序方向**：缺省 `desc`（数值大者在前，榜首在最上方）；`direction: 'asc'` 反向。
- **并列共享名次**：数值相同的条目共享同一名次，采用**竞赛排名（standard competition ranking）1,2,2,4**——并列占用名次后，后续名次跳过被占用的位数。
- **并列项顺序稳定**：并列项之间按**原始输入顺序**排列，不引入随机或字典序，保证截图与断言可复现（实现上排序Comparator 在数值相等时回退 `sourceIndex`）。
- **名次在截断前计算**：`limit` 取前 N 名，因此「取前 3 名」拿到的仍是 1、2、3 名，不会因为截断改变名次。
- **缺失值不入榜**：`points[].y === null` 的条目不进入排行，也不占用名次（`sourceIndex` 仍记录原始序号，便于调用方回查）。
- **负值原样参与**：排行榜是条形场景不是占比场景，负值进入排行并由数值轴渲染在零轴左侧；排序方向决定它排在前还是后。
- **`limit` 取值**：仅正整数生效；`undefined` / `0` / 负数 / `NaN` 不截断，正小数向下取整（`2.7` 视为取前 2 名）。

### 3.2 单系列与名称唯一性守卫

- 排行榜的输入语义是「一组条目」：**只接受单系列**，传入多系列抛 `ChartDataError`（`path: 'series[1]'`），而不是静默丢弃后续系列。
- **条目名称必须唯一**：类目轴上同名条目会落在同一个类目位而互相覆盖，抛 `ChartDataError`（`path: 'series[0].points[i].x'`）。并列指的是数值相同，名称仍必须可区分。
- 与折线 / 柱状 / 饼图共用同一套 `normalizeChartData` 规则（重复系列 id、`NaN` y 等仍抛 `ChartDataError`）。

### 3.3 option 语义

- **横向条形**：`xAxis.type='value'`、`yAxis.type='category'` 且 `inverse: true`（数组第一条显示在最上方）；系列数据项为 `{ name, value }`，`name` 为原始条目名称。
- **名次在类目轴标签上**：`yAxis.axisLabel.formatter` 输出 `"{rank}. {name}"`（如 `1. 柱状图`）。
- **数值摘要在 `graphic`**：三个固定顺序的稳定槽位——标题（`config.title`，小号 muted）、统计行（`共 N 项`；被 `limit` 截断时为 `共 N 项 · 取前 M 名`）、空数据提示（`暂无数据`）。统计行与空数据提示互斥。
- **空数据**：`series: []` → 无条形系列、`graphic` 显示「暂无数据」、统计行槽位 `ignore`，JSON 不含 `NaN`，不抛错。
- **tooltip**：`trigger: 'item'`，展示 `条目名: formatValue(value, unit)`。
- **图例**：单系列不渲染。
- **optionOverrides**：合并全部坐标轴类字段 `grid` / `tooltip` / `legend` / `xAxis` / `yAxis` / `title`（默认白名单）；系列、主题、渲染器与 `graphic` 不可覆盖。

### 3.4 点击载荷

- 横向条形系列数据项是 `{ name, value }`，`params.value` 为单一数值、`params.name` 为条目名称，`ChartEvent.value` 走 `[名称, 数值]` 路径，与折线 / 柱状 / 饼图同构（如 `{seriesId:'hot', dataIndex:0, value:['柱状图',180], nativeType:'click'}`）。控制器 `eventValue` 无需改动。

## 4. 占比语义（`computeProportionShares` / `buildProportionOption`）

### 4.1 占比口径

- **占比 = 值 / 全部条目非缺失值之和**；缺失值（`null`）不参与占比，也不进入分母（与饼图 `pieTotal` 同一口径，复用 `sumDefinedValues`）。
- **总量不可算（`total <= 0`，即全零或全缺失）时 `share` 一律为 `null`**：由调用方省略占比展示，禁止产出 `NaN%`。此时整幅图按「暂无数据」处理——百分比没有分母，条形长度也没有基准。
- **不在组件内猜业务指标口径**：占比只描述「值 / 合计」，指标含义由调用方的 `unit` 与 `title` 表达。
- **条目顺序保持输入顺序**：占比场景**不排序**（与饼图角度顺序口径一致）。需要排序时用排行榜组件——两个场景的顺序口径因此可对照，不会出现同一份数据两种顺序难以核对的问题。

### 4.2 守卫

- 同样只接受单系列（多系列抛 `ChartDataError`，`path: 'series[1]'`）且条目名称必须唯一。
- **负值抛 `ChartDataError`**（`path: 'series[0].points[i].y'`）：占比没有负值语义，与饼图同一规则；折线 / 柱状 / 排行榜为原样透传，规则显式区分。

### 4.3 option 语义

- **横向条形**：`xAxis.type='value'`、`yAxis.type='category'` 且 `inverse: true`；系列数据项为 `{ name, value }`。
- **条末标签同时展示数值与百分比**：`label.formatter` 输出 `formatValue(value, unit)（percent）`（percent 由 `formatPercent(value, total)` 给出，固定 1 位小数）。
- **数值摘要在 `graphic`**：三个固定顺序的稳定槽位——标题、总量行（`总量 formatValue(total, unit)`，仅在总量可算时可见）、空数据提示（`暂无数据`，仅在总量不可算时可见）。
- **空数据 / 零总量**：无条形系列 + 「暂无数据」，JSON 不含 `NaN`，不抛错。
- **tooltip**：`trigger: 'item'`，展示 `条目名: formatValue(value, unit)（percent）`；占比不可算时只展示值。
- **图例**：单系列不渲染。
- **optionOverrides**：与排行榜相同（默认白名单；系列、主题、渲染器与 `graphic` 不可覆盖）。

### 4.4 点击载荷

- 与排行榜同构：`{seriesId:'source', dataIndex:0, value:['搜索',120], nativeType:'click'}`。

## 5. 共享 graphic 槽位纪律（本批提取）

`src/charts/scene-slots.ts` 提供 `textSlot` / `hiddenSlot` / `EMPTY_DISPLAY` / `mutedColor`，趋势卡片、排行榜与占比共用：

- 每个场景的槽位**每次构建都完整给出**，顺序固定；未使用的槽位以 `ignore: true` 隐藏。
- **可见槽位必须显式 `ignore: false`**：控制器首次 `applyOption` 时数据尚为空（槽位 `ignore: true`），随后 `update` 才填数据；ECharts 按 id 合并 graphic 元素，若可见槽位不显式声明 `ignore: false`，合并后会保留上一次的 `ignore: true` 而不渲染。
- 不用 `$action: 'remove'`：首次渲染移除不存在元素会抛错。
- 槽位 id：趋势卡片 `trend-title` / `trend-value` / `trend-meta`；排行榜 `ranking-title` / `ranking-meta` / `ranking-empty`；占比 `proportion-title` / `proportion-total` / `proportion-empty`。

## 6. 框架包导出面

| 入口 | 内容 |
| --- | --- |
| `.` | `LineChart`、`BarChart`、`PieChart`、`ScatterChart`、`TrendCard`、`Ranking`、`Proportion`、`useChart`、`sameLineConfig` / `sameBarConfig` / `samePieConfig` / `sameScatterConfig` / `sameTrendCardConfig` / `sameRankingConfig` / `sameProportionConfig` / `sameChartConfig`、组件与 hook 类型、自 core 重新导出的共享类型 |
| `./ranking` | 仅排行榜入口（组件 + hook + 类型），供按需加载 |
| `./proportion` | 仅占比入口（组件 + hook + 类型），供按需加载 |
| `./style.css` | 容器基础样式（新增 `.charts-ranking` / `.charts-proportion`） |

- `useChart` 的 `CHART_CONFIG_FIELDS` 增加 `ranking: ['direction','limit','title']` 与 `proportion: ['title']`；`defaultConfig('ranking') = { chart: 'ranking' }`、`defaultConfig('proportion') = { chart: 'proportion' }`。
- 组件文件名采用 `RankingChart.vue` / `RankingChart.tsx`（与 `BarChart` / `PieChart` 同模式）：`ranking.ts` 与 `RankingChart.tsx` 的输出文件名在大小写不敏感文件系统（Windows / macOS）上会碰撞（`Ranking.js` vs `ranking.js`），必须避免。导出名仍为 `Ranking` / `Proportion`，与组件 id 一致。

## 7. 示例、消费者与 B 侧材料

- fixtures：`examples/fixtures/ranking.json`（`default` / `empty` / `missing` / `single` / `updated` / `tied`，`limit` 固定为 5 以覆盖「取前 N 名」路径）；`examples/fixtures/proportion.json`（`default` / `empty` / `zero-total` / `missing` / `single` / `updated`）。
- **就绪探针限制（写 fixture 时必须注意）**：占比的 `zero-total`（全零）与 `empty`（无系列）渲染结果完全相同（都没有系列、都显示「暂无数据」），系列快照不会变化，示例运行时的 `arm()` 会一直等到超时。这两个状态必须各自从 `default` 单独进入，不能连续切换。
- 示例页面：`examples/{vue,react}/ranking.html` + `src/RankingApp.{vue,tsx}` + `src/ranking-main.{ts,tsx}`、`proportion.html` + `src/ProportionApp.{vue,tsx}` + `src/proportion-main.{ts,tsx}`；两框架 vite `rollupOptions.input` 登记全部七个入口。
- 消费者页面：`tests/consumers/{vue,react}` 各新增 `ranking.html` / `proportion.html` 与对应 `src/*App` / `src/*-main`。
- 测试钩子泛化：`pointClientPosition` 增加横向条形判别（`xAxis.type==='value' && yAxis.type==='category'` 时按数值取 x、按类目取 y）；新增 `categoryLabels()` 读回类目轴标签（应用 `axisLabel.formatter` 后），用于在浏览器层断言名次标签。
- B 侧必须同批扩展（否则平台以 `ARTIFACT_MISMATCH` 拒绝 Bundle）：`manifest.ts` 的 `ComponentName` / `COMPONENT_ENTRY_HTML` / `COMPONENT_EXPORT` / 默认 `components`，`capture.ts` 的容器选择器链，以及 `tests/integration/cli-bundle.test.ts`、`tests/integration/cli-release.test.ts`、`tests/platform/http-support.ts` 的 `grant()` 三处清单（7 组件 × 2 框架 = 14 变体、14 份报告）。

## 8. C 侧 contracts

- 无 schema 变化：`ComponentExample` / `CheckResult` / `ChartEvent` / `ExampleRef` / `ScreenshotRef` 形状均未变（排行榜与占比仅取值口径为 `[条目名称, 数值]`，结构不变）。
- `componentId` 固定为 `ranking` / `proportion`，各派生 `ranking-vue` / `ranking-react` / `proportion-vue` / `proportion-react` 变体。
