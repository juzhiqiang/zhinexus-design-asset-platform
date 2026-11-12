export { default as Proportion } from './ProportionChart.vue';
export {
  useChart,
  sameProportionConfig,
  sameRankingConfig,
  samePieConfig,
  sameBarConfig,
  sameLineConfig,
  sameScatterConfig,
  sameTrendCardConfig,
} from './useChart.js';
export type { UseChartOptions, UseChartResult } from './useChart.js';
export type { ProportionEmits, ProportionHandle, ProportionProps } from './proportion-chart.types.js';
export type {
  ProportionChartConfig,
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
