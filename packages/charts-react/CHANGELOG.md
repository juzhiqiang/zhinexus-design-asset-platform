# CHANGELOG

本文件记录 `@company/charts-react` 的对外可见变化，遵循语义化版本与 Keep a Changelog 约定。

## [0.0.2] - 2026-11-12

### Added

- `BarChart` 柱状图组件（TSX）：`data` / `config` / `optionOverrides` / `onPointClick` / `className` / `style` 属性与 `ref` 句柄，载荷与 Vue 实现对等（T09 第一批）。
- `./bar` 子路径入口（按需加载）与 `.charts-bar` 容器基础样式。
- `sameBarConfig` / `sameChartConfig` 配置等价判断；自 `@company/charts-core` 重新导出 `BarChartConfig` / `AnyChartConfig` / `ChartType` 等共享类型。

### Changed

- `useChart` 泛化为按图表类型（`line` / `bar`）复用同一生命周期实现；`LineChart`、`./line` 入口与既有导出行为不变。

## [0.0.1] - 2026-11-12

### Added

- `LineChart` 折线图组件（TSX）：`data` / `config` / `optionOverrides` / `className` / `style` 属性与 `onPointClick` 回调，载荷与 Vue 实现对等（T03）。
- `useChart` Hook：控制器随挂载创建、随卸载销毁；兼容 `StrictMode` 开发态 Effect 重复挂载/清理，重复挂载只产生一个实例。
- 命令式句柄 `whenRendered()`（通过 `ref`）：渲染完成（ECharts `finished`）信号，供截图与自动化就绪判定。
- 包入口：`.`、`./line`（按需加载）与 `./style.css`（`.charts-line` 容器基础样式）。
- 自 `@company/charts-core` 重新导出共享类型（`ChartData` / `ChartEvent` / `ChartConfig` / `LineChartConfig` / `SupportedOptionOverrides` 等）。
