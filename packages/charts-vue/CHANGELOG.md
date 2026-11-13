# CHANGELOG

本文件记录 `@company/charts-vue` 的对外可见变化，遵循语义化版本与 Keep a Changelog 约定。

## [0.0.8] - 2026-11-13

### Changed

- `@company/charts-core` 依赖随兼容策略缺陷修复同步升至精确版本 `0.0.8`；本包自身的组件 API、Props、事件与子路径导出不变。发布顺序仍须先发 `charts-core` 并通过注册表依赖可达性检查，再发本包（`rules/testing-release.md`）。

## [0.0.7] - 2026-11-13

### Changed

- `@company/charts-core` 依赖随 T10 兼容策略发布同步升至精确版本 `0.0.7`；本包自身的组件 API、Props、事件与子路径导出不变。发布顺序仍须先发 `charts-core` 并通过注册表依赖可达性检查，再发本包（`rules/testing-release.md`）。

## [0.0.6] - 2026-11-13

### Added

- `Ranking` 排行榜组件（SFC）：`data` / `config` / `optionOverrides` 属性与 `point-click` 事件，载荷为 `[条目名称, 数值]` 且与 React 实现对等（T09 第五批）。
- `Proportion` 占比组件（SFC）：`data` / `config` / `optionOverrides` 属性与 `point-click` 事件，载荷为 `[条目名称, 数值]` 且与 React 实现对等（T09 第五批）。
- `./ranking` 与 `./proportion` 子路径入口（按需加载）与 `.charts-ranking` / `.charts-proportion` 容器基础样式。
- `sameRankingConfig` / `sameProportionConfig` 配置等价判断；自 `@company/charts-core` 重新导出 `RankingChartConfig` / `RankingEntry` / `RankingDirection` / `ProportionChartConfig` / `ProportionShare` 共享类型。

### Changed

- `useChart` 的 `chart` 参数接受 `'ranking'` 与 `'proportion'`；`LineChart` / `BarChart` / `PieChart` / `ScatterChart` / `TrendCard`、既有子路径与既有导出行为不变。

## [0.0.5] - 2026-11-12

### Added

- `TrendCard` 趋势卡片组件（SFC）：`data` / `config` / `optionOverrides` 属性与 `point-click` 事件，载荷为 `[类目, 值]` 且与 React 实现对等（T09 第四批）。
- `./trend-card` 子路径入口（按需加载）与 `.charts-trend-card` 容器基础样式。
- `sameTrendCardConfig` 配置等价判断；自 `@company/charts-core` 重新导出 `TrendCardConfig` 共享类型。

### Changed

- `useChart` 的 `chart` 参数接受 `'trend-card'`；`LineChart` / `BarChart` / `PieChart` / `ScatterChart`、既有子路径与既有导出行为不变。

## [0.0.4] - 2026-11-12

### Added

- `ScatterChart` 散点图组件（SFC）：`data` / `config` / `optionOverrides` 属性与 `point-click` 事件，载荷为 `[x, y]` 数值对且与 React 实现对等（T09 第三批）。
- `./scatter` 子路径入口（按需加载）与 `.charts-scatter` 容器基础样式。
- `sameScatterConfig` 配置等价判断；自 `@company/charts-core` 重新导出 `ScatterChartConfig` 共享类型。

### Changed

- `useChart` 的 `chart` 参数接受 `'scatter'`；`LineChart` / `BarChart` / `PieChart`、既有子路径与既有导出行为不变。

## [0.0.3] - 2026-11-12

### Added

- `PieChart` 饼图 / 环形图组件（SFC）：`data` / `config` / `optionOverrides` 属性与 `point-click` 事件，载荷与 React 实现对等（T09 第二批）。
- `./pie` 子路径入口（按需加载）与 `.charts-pie` 容器基础样式。
- `samePieConfig` 配置等价判断；自 `@company/charts-core` 重新导出 `PieChartConfig` 共享类型。

### Changed

- `useChart` 的 `chart` 参数接受 `'pie'`；`LineChart` / `BarChart`、既有子路径与既有导出行为不变。

## [0.0.2] - 2026-11-12

### Added

- `BarChart` 柱状图组件（SFC）：`data` / `config` / `optionOverrides` 属性与 `point-click` 事件，载荷与 React 实现对等（T09 第一批）。
- `./bar` 子路径入口（按需加载）与 `.charts-bar` 容器基础样式。
- `sameBarConfig` / `sameChartConfig` 配置等价判断；自 `@company/charts-core` 重新导出 `BarChartConfig` / `AnyChartConfig` / `ChartType` 等共享类型。

### Changed

- `useChart` 泛化为按图表类型（`line` / `bar`）复用同一生命周期实现；`LineChart`、`./line` 入口与既有导出行为不变。

## [0.0.1] - 2026-11-12

### Added

- `LineChart` 折线图组件（SFC）：`data` / `config` / `optionOverrides` 属性与 `point-click` 事件，载荷与 React 实现对等（T03）。
- `useChart` 组合函数：控制器随挂载创建、随卸载销毁；兼容 `KeepAlive` 停用后实例与数据保留、激活时恢复尺寸。
- 命令式句柄 `whenRendered()`：渲染完成（ECharts `finished`）信号，供截图与自动化就绪判定。
- 包入口：`.`、`./line`（按需加载）与 `./style.css`（`.charts-line` 容器基础样式）。
- 自 `@company/charts-core` 重新导出共享类型（`ChartData` / `ChartEvent` / `ChartConfig` / `LineChartConfig` / `SupportedOptionOverrides` 等）。
