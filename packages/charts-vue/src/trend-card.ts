export { default as TrendCard } from './TrendCard.vue';
export {
  useChart,
  sameTrendCardConfig,
  samePieConfig,
  sameBarConfig,
  sameLineConfig,
  sameScatterConfig,
} from './useChart.js';
export type { UseChartOptions, UseChartResult } from './useChart.js';
export type { TrendCardEmits, TrendCardHandle, TrendCardProps } from './trend-card-chart.types.js';
export type {
  TrendCardConfig,
  ChartConfig,
  ChartData,
  ChartEvent,
  ChartPoint,
  ChartSeries,
  PointClickListener,
  Renderer,
  SupportedOptionOverrides,
  ThemeName,
  UnitSpec,
  Unsubscribe,
} from '@company/charts-core';
