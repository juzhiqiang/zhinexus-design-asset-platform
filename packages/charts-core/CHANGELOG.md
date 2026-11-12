# CHANGELOG

本文件记录 `@company/charts-core` 的对外可见变化，遵循语义化版本与 Keep a Changelog 约定。

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
