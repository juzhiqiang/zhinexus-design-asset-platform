export { default as LineChart } from './LineChart.vue';
export { useChart, sameLineConfig } from './useChart.js';
export type { UseChartOptions, UseChartResult } from './useChart.js';
export type { LineChartEmits, LineChartHandle, LineChartProps } from './line-chart.types.js';
export type {
  ChartConfig,
  ChartData,
  ChartEvent,
  ChartPoint,
  ChartSeries,
  LineChartConfig,
  PointClickListener,
  Renderer,
  SupportedOptionOverrides,
  ThemeName,
  UnitSpec,
  Unsubscribe,
} from '@company/charts-core';
