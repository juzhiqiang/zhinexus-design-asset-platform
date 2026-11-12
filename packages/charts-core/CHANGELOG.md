# CHANGELOG

本文件记录 `@company/charts-core` 的对外可见变化，遵循语义化版本与 Keep a Changelog 约定。

## [0.0.6] - 2026-11-13

### Added

- 排行榜（ranking，T09 第五批「组合场景」）：图表类型联合新增 `'ranking'`、`RankingChartConfig` / `RankingChartOption` / `RankingEntry` / `RankingDirection`，以及 `buildRankingOption` option 构建与 `computeRanking` 纯函数。
- 排行榜语义：单系列横向条形，默认按数值降序（`direction: 'asc'` 反向）；并列（数值相同）共享名次，采用竞赛排名 1,2,2,4，并列项之间保持原始输入顺序；缺失值（null）不进入排行也不占用名次；`limit` 取前 N 名且名次在截断前计算；负值原样参与排行；名次写进类目轴标签（`1. 条目`）；统计行展示条目总数，被截断时说明取前几名；空数据显示「暂无数据」、无系列、不产生 NaN。
- 占比（proportion，T09 第五批「组合场景」）：图表类型联合新增 `'proportion'`、`ProportionChartConfig` / `ProportionChartOption` / `ProportionShare`，以及 `buildProportionOption` option 构建与 `computeProportionShares` 纯函数。
- 占比语义：单系列横向条形，条目顺序保持输入顺序（占比场景不排序，需要排序时用排行榜）；占比 = 值 / 全部条目非缺失值之和，缺失值不参与分母；总量为零（全零或全缺失）时展示「暂无数据」、无系列、不产出 `NaN%`；负值没有占比语义抛 `ChartDataError`；总量行展示参与占比的合计值；不在组件内猜业务指标口径。
- 共享数据工具 `sumDefinedValues`（非缺失值之和）与单系列 / 条目名称唯一性守卫 `assertSingleSeries` / `assertUniqueNames`：多系列与同名条目在类目轴场景下没有定义，明确抛 `ChartDataError` 而不是静默丢弃或互相覆盖。

### Changed

- `createChartController` 的配置联合新增 `RankingChartConfig` 与 `ProportionChartConfig`；排行榜与占比按需注册 `BarChart` + 网格 / 提示 / `Graphic` 组件 + 指定渲染器（单系列不需要图例），不注册其他图表模块。
- `ChartType` 联合新增 `'ranking'` 与 `'proportion'`；`buildChartOption` / `chartTypeOf` 增加对应分发分支，既有图表行为不变。
- `pieTotal` 改为复用 `sumDefinedValues`，计算口径不变（缺失值不补 0、不进入分母）。
- 趋势卡片的 graphic 槽位辅助逻辑提取到 `charts/scene-slots.ts`（`textSlot` / `hiddenSlot` / `EMPTY_DISPLAY` / `mutedColor`），供排行榜与占比复用；槽位 id、`ignore` 纪律与渲染结果不变。

### Fixed

- 排行榜与占比的数值摘要同样使用固定顺序的稳定 graphic 槽位（`ranking-title` / `ranking-meta` / `ranking-empty` 与 `proportion-title` / `proportion-total` / `proportion-empty`），未使用的槽位以 `ignore: true` 隐藏、可见槽位显式 `ignore: false`，避免状态切换时残留上一次的摘要文本。

## [0.0.5] - 2026-11-12

### Added

- 趋势卡片（trend-card，T09 第一个「组合场景」）：图表类型联合新增 `'trend-card'`、`TrendCardConfig` 与 `TrendCardOption`，以及 `buildTrendCardOption` option 构建。
- `computeTrendSummary` 数值摘要纯函数：当前值取第一个系列最后一个非缺失值，前期值来自 `config.previousValue`；变化量 = 当前值 - 前期值，变化率 = 变化量 / |前期值| * 100（前期值为 0 或不可算时为 `null`），方向为 `up` / `down` / `flat` / `none`。
- 趋势卡片语义：类目轴 sparkline（每系列一条平滑折线 + 半透明面积 + 可见符号）；坐标轴 `show: false` 但坐标系仍注册；数值摘要经 `graphic` 渲染（标题 / 当前值大字段落 / meta 行含前期值与上升下降变化，`current` 为空时显示「暂无数据」）；`unit` 作用于当前值、前期值、变化量与 y 轴 / tooltip；多系列才渲染图例；空数据返回空系列、不抛错、不产生 NaN。
- `optionOverrides` 对趋势卡片深层合并 `grid` / `tooltip` / `legend` / `xAxis` / `yAxis` / `title`（系列、主题、渲染器与 graphic 不可覆盖）。

### Changed

- `createChartController` 的配置联合新增 `TrendCardConfig`；趋势卡片按需注册 `LineChart` + 网格 / 提示 / 图例 / `Graphic` 组件 + 指定渲染器，不注册其他图表模块。
- `ChartType` 联合新增 `'trend-card'`；`buildChartOption` / `chartTypeOf` 增加对应分发分支，既有图表行为不变。

### Fixed

- 趋势卡片数值摘要改用三个稳定 graphic 槽位（`trend-title` / `trend-value` / `trend-meta`）并在每次构建时完整给出：未使用的槽位以 `ignore: true` 隐藏，可见槽位显式 `ignore: false`。修复控制器首次渲染（数据为空、槽位 `ignore: true`）后 `update` 填数据时，ECharts 按 id 合并 graphic 元素导致可见槽位保留 `ignore: true` 而不渲染，以及切到空数据时残留上一次 meta 行的问题。

## [0.0.4] - 2026-11-12

### Added

- 散点图：图表类型联合新增 `'scatter'`、`ScatterChartConfig` 与 `ScatterChartOption`，以及 `buildScatterOption` option 构建（T09 第三批）。
- 散点图语义：x / y 双数值轴，数据项为 `[x, y]` 数值对；x 必须为数值（字符串 x 抛 `ChartDataError` 且 path 指向出错点）；缺失值保持 `null` 且该符号不渲染；负值原样进入数据项并由数值轴渲染零轴以下；`unit` 只作用于 y 轴与 tooltip 口径，x 轴按无单位格式化；tooltip 以 `trigger: 'item'` 展示 `(x, y)` 数值对；多系列才渲染图例；空数据返回空系列、不抛错、不产生 NaN。
- `optionOverrides` 对散点图深层合并 `grid` / `tooltip` / `legend` / `xAxis` / `yAxis` / `title`（系列、主题与渲染器仍不可覆盖）。

### Changed

- `createChartController` 的配置联合新增 `ScatterChartConfig`；散点图按需注册 `ScatterChart` + 网格 / 提示 / 图例 / 标题组件 + 指定渲染器，不注册其他图表模块。
- 点击事件载荷兼容 `[x, y]` 数值对（散点图）：`ChartEvent.value` 为 `[x, y]`；折线 / 柱状 / 饼图的 `[名称, 值]` 载荷形状与既有行为不变。

## [0.0.3] - 2026-11-12

### Added

- 饼图 / 环形图：图表类型联合新增 `'pie'`、`PieChartConfig` 与 `PieChartOption`，以及 `buildPieOption` option 构建（T09 第二批）。
- `pieTotal` 饼图总量计算（缺失值不补 0、不进入分母）与 `formatPercent` 占比格式化（固定 1 位小数；总量不可算或值缺失时返回 `null`，不产出 `NaN%`）。
- 饼图语义：一个系列对应一圈，多系列为同心嵌套环且外环在前；缺失值保持 `null` 且该扇形不渲染；负值没有占比语义，抛 `ChartDataError`；空数据返回空系列、无图例、不抛错；`donut` 只从内侧预留外半径 50% 的内孔；tooltip 与标签共用同一占比口径；多系列才渲染图例。
- `optionOverrides` 对饼图只深层合并 `tooltip` / `legend` / `title`（无坐标轴，`grid` / `xAxis` / `yAxis` 合并不生效）。

### Changed

- `createChartController` 的配置联合新增 `PieChartConfig`；饼图按需注册 `PieChart` + 提示 / 图例 / 标题组件，不注册坐标轴组件。

## [0.0.2] - 2026-11-12

### Added

- 图表类型联合 `ChartType` / `BarChartConfig` / `AnyChartConfig` 与 `BarChartOption`，以及 `buildBarOption` 柱状图 option 构建（T09 第一批）。
- 柱状图语义：类目轴保留边界间距（柱条不贴边）、缺失值保持 `null` 不补 0、负值原样进入系列数据并由数值轴渲染零轴以下、单位与缺失值格式化规则和折线图一致、多系列才渲染图例、`stack` 堆叠分组透传。
- `createChartController` 接受图表配置联合，按类型分发 option 构建与 ECharts 按需模块注册。

### Changed

- `LineChartConfig` 新增可选判别字段 `chart?: 'line'`；既有折线图调用方与全部既有导出行为不变。
- ECharts 模块注册入口由折线专用 `ensureLineModules` 调整为 `ensureChartModules(chart, renderer)`（内部 API，不随包入口导出）。
- 折线与柱状共用同一套受支持 `optionOverrides` 深层合并规则（系列、主题与渲染器仍不可覆盖）。

## [0.0.1] - 2026-11-11

### Added

- 共享图表数据类型 `ChartData` / `ChartSeries` / `ChartPoint` 与统一事件载荷 `ChartEvent`（T02）。
- `normalizeChartData` 数据校验与规范化：重复系列 id、非法 x/y 抛 `ChartDataError`；`null` 保留为缺失值，禁止转换为 0。
- `buildLineOption` 折线图 option 构建：多系列按首次出现顺序对齐共享类目轴，稳定 series id，更新以 `replaceMerge` 防残留系列；支持 `unit` / `smooth` / `area` / `connectNulls` 配置与受支持的 `optionOverrides` 深层合并（系列、主题与渲染器不可覆盖）。
- `formatValue` 确定性数值格式化：千分位分组、固定小数位、单位后缀，不依赖运行 locale；缺失值统一展示为 `-`。
- 内置 light / dark 主题令牌 `resolveTheme` / `lightTheme` / `darkTheme`。
- `createChartController` 实例控制器：零宽高容器等待 `ResizeObserver` 获得有效尺寸后再初始化；提供 `update` / `resize` / `setPresentation` / `onPointClick` / `whenRendered` / `getInstance` 与幂等 `dispose`；Canvas / SVG 模块按需注册；SSR 宿主仅安全导入。
- 保留 `getCoreRuntimeInfo` 工程骨架探针以兼容既有引导验证。
