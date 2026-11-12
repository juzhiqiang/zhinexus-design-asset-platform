export { default as ScatterChart } from './ScatterChart.vue';
export { useChart, sameScatterConfig, samePieConfig, sameBarConfig, sameLineConfig } from './useChart.js';
export type { UseChartOptions, UseChartResult } from './useChart.js';
export type { ScatterChartEmits, ScatterChartHandle, ScatterChartProps } from './scatter-chart.types.js';
export type {
  ScatterChartConfig,
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
