export { default as BarChart } from './BarChart.vue';
export { useChart, sameBarConfig, sameLineConfig } from './useChart.js';
export type { UseChartOptions, UseChartResult } from './useChart.js';
export type { BarChartEmits, BarChartHandle, BarChartProps } from './bar-chart.types.js';
export type {
  BarChartConfig,
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
