# CHANGELOG

本文件记录 `@company/charts-core` 的对外可见变化，遵循语义化版本与 Keep a Changelog 约定。

## [0.0.1] - 2026-11-11

### Added

- 共享图表数据类型 `ChartData` / `ChartSeries` / `ChartPoint` 与统一事件载荷 `ChartEvent`（T02）。
- `normalizeChartData` 数据校验与规范化：重复系列 id、非法 x/y 抛 `ChartDataError`；`null` 保留为缺失值，禁止转换为 0。
- `buildLineOption` 折线图 option 构建：多系列按首次出现顺序对齐共享类目轴，稳定 series id，更新以 `replaceMerge` 防残留系列；支持 `unit` / `smooth` / `area` / `connectNulls` 配置与受支持的 `optionOverrides` 深层合并（系列、主题与渲染器不可覆盖）。
- `formatValue` 确定性数值格式化：千分位分组、固定小数位、单位后缀，不依赖运行 locale；缺失值统一展示为 `-`。
- 内置 light / dark 主题令牌 `resolveTheme` / `lightTheme` / `darkTheme`。
- `createChartController` 实例控制器：零宽高容器等待 `ResizeObserver` 获得有效尺寸后再初始化；提供 `update` / `resize` / `setPresentation` / `onPointClick` / `whenRendered` / `getInstance` 与幂等 `dispose`；Canvas / SVG 模块按需注册；SSR 宿主仅安全导入。
- 保留 `getCoreRuntimeInfo` 工程骨架探针以兼容既有引导验证。
