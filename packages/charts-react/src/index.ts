export { LineChart } from './LineChart.js';
export { BarChart } from './BarChart.js';
export { PieChart } from './PieChart.js';
export { ScatterChart } from './ScatterChart.js';
export { TrendCard } from './TrendCard.js';
export { Proportion } from './ProportionChart.js';
export { Ranking } from './RankingChart.js';
export {
  sameBarConfig,
  sameChartConfig,
  sameLineConfig,
  samePieConfig,
  sameProportionConfig,
  sameRankingConfig,
  sameScatterConfig,
  sameTrendCardConfig,
  useChart,
} from './useChart.js';
export type { UseChartOptions, UseChartResult } from './useChart.js';
export type { BarChartHandle, BarChartProps } from './bar-chart.types.js';
export type { LineChartHandle, LineChartProps } from './line-chart.types.js';
export type { PieChartHandle, PieChartProps } from './pie-chart.types.js';
export type { ProportionHandle, ProportionProps } from './proportion-chart.types.js';
export type { RankingHandle, RankingProps } from './ranking-chart.types.js';
export type { ScatterChartHandle, ScatterChartProps } from './scatter-chart.types.js';
export type { TrendCardHandle, TrendCardProps } from './trend-card-chart.types.js';
export type {
  AnyChartConfig,
  BarChartConfig,
  ChartConfig,
  ChartData,
  ChartEvent,
  ChartPoint,
  ChartSeries,
  ChartType,
  LineChartConfig,
  PieChartConfig,
  PointClickListener,
  ProportionChartConfig,
  ProportionChartOption,
  ProportionShare,
  RankingChartConfig,
  RankingChartOption,
  RankingDirection,
  RankingEntry,
  Renderer,
  ScatterChartConfig,
  SupportedOptionOverrides,
  ThemeName,
  TrendCardConfig,
  UnitSpec,
  Unsubscribe,
} from '@company/charts-core';

import { version } from 'react';
import { getCoreRuntimeInfo } from '@company/charts-core';

/** 工程骨架探针：保留以兼容既有引导验证，T03 起由图表组件取代其作用。 */
export function getReactRuntimeInfo() {
  return { ...getCoreRuntimeInfo(), framework: 'react', frameworkVersion: version } as const;
}
