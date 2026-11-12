export { default as LineChart } from './LineChart.vue';
export { default as BarChart } from './BarChart.vue';
export { default as PieChart } from './PieChart.vue';
export { default as ScatterChart } from './ScatterChart.vue';
export { default as TrendCard } from './TrendCard.vue';
export { default as Ranking } from './RankingChart.vue';
export { default as Proportion } from './ProportionChart.vue';
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
export type { BarChartEmits, BarChartHandle, BarChartProps } from './bar-chart.types.js';
export type { LineChartEmits, LineChartHandle, LineChartProps } from './line-chart.types.js';
export type { PieChartEmits, PieChartHandle, PieChartProps } from './pie-chart.types.js';
export type { ProportionEmits, ProportionHandle, ProportionProps } from './proportion-chart.types.js';
export type { RankingEmits, RankingHandle, RankingProps } from './ranking-chart.types.js';
export type { ScatterChartEmits, ScatterChartHandle, ScatterChartProps } from './scatter-chart.types.js';
export type { TrendCardEmits, TrendCardHandle, TrendCardProps } from './trend-card-chart.types.js';
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

import { version } from 'vue';
import { getCoreRuntimeInfo } from '@company/charts-core';

/** 工程骨架探针：保留以兼容既有引导验证，T03 起由图表组件取代其作用。 */
export function getVueRuntimeInfo() {
  return { ...getCoreRuntimeInfo(), framework: 'vue', frameworkVersion: version } as const;
}
