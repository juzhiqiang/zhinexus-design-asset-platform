# CHANGELOG

本文件记录 `@company/charts-core` 的对外可见变化，遵循语义化版本与 Keep a Changelog 约定。

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
