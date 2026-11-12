export { default as LineChart } from './LineChart.vue';
export { default as BarChart } from './BarChart.vue';
export { sameBarConfig, sameChartConfig, sameLineConfig, useChart } from './useChart.js';
export type { UseChartOptions, UseChartResult } from './useChart.js';
export type { BarChartEmits, BarChartHandle, BarChartProps } from './bar-chart.types.js';
export type { LineChartEmits, LineChartHandle, LineChartProps } from './line-chart.types.js';
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
  PointClickListener,
  Renderer,
  SupportedOptionOverrides,
  ThemeName,
  UnitSpec,
  Unsubscribe,
} from '@company/charts-core';

import { version } from 'vue';
import { getCoreRuntimeInfo } from '@company/charts-core';

/** 工程骨架探针：保留以兼容既有引导验证，T03 起由图表组件取代其作用。 */
export function getVueRuntimeInfo() {
  return { ...getCoreRuntimeInfo(), framework: 'vue', frameworkVersion: version } as const;
}
