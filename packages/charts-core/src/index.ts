export type {
  AnyChartConfig,
  BarChartConfig,
  BarChartOption,
  ChartComponentOption,
  ChartConfig,
  ChartController,
  ChartData,
  ChartEvent,
  ChartPoint,
  ChartSeries,
  ChartType,
  LineChartConfig,
  LineChartOption,
  PieChartConfig,
  PieChartOption,
  PointClickListener,
  Renderer,
  ScatterChartConfig,
  ScatterChartOption,
  SupportedOptionOverrides,
  ThemeName,
  TrendCardConfig,
  TrendCardOption,
  TrendSummary,
  UnitSpec,
  Unsubscribe,
} from './types.js';
export { ChartDataError, alignSeriesValues, collectCategories, normalizeChartData } from './data.js';
export { MISSING_VALUE_DISPLAY, formatPercent, formatValue } from './format.js';
export { darkTheme, lightTheme, resolveTheme } from './theme.js';
export type { ChartTheme } from './theme.js';
export { buildBarOption } from './charts/bar.js';
export { buildLineOption } from './charts/line.js';
export { buildPieOption, pieTotal } from './charts/pie.js';
export { buildScatterOption } from './charts/scatter.js';
export { buildTrendCardOption, computeTrendSummary } from './charts/trend-card.js';
export { createChartController } from './controller.js';

import { version } from 'echarts/core.js';

/**
 * 工程骨架探针：返回 ECharts 运行时版本。
 * T03 起由双框架组件与控制器取代其探针作用，保留以兼容既有引导验证。
 */
export function getCoreRuntimeInfo() {
  return { stage: 'bootstrap', echartsVersion: version } as const;
}
