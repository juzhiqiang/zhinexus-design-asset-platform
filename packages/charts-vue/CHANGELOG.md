# CHANGELOG

本文件记录 `@company/charts-vue` 的对外可见变化，遵循语义化版本与 Keep a Changelog 约定。

## [0.0.1] - 2026-11-12

### Added

- `LineChart` 折线图组件（SFC）：`data` / `config` / `optionOverrides` 属性与 `point-click` 事件，载荷与 React 实现对等（T03）。
- `useChart` 组合函数：控制器随挂载创建、随卸载销毁；兼容 `KeepAlive` 停用后实例与数据保留、激活时恢复尺寸。
- 命令式句柄 `whenRendered()`：渲染完成（ECharts `finished`）信号，供截图与自动化就绪判定。
- 包入口：`.`、`./line`（按需加载）与 `./style.css`（`.charts-line` 容器基础样式）。
- 自 `@company/charts-core` 重新导出共享类型（`ChartData` / `ChartEvent` / `ChartConfig` / `LineChartConfig` / `SupportedOptionOverrides` 等）。
