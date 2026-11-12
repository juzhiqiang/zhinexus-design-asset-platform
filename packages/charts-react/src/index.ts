export { LineChart } from './LineChart.js';
export { BarChart } from './BarChart.js';
export { sameBarConfig, sameChartConfig, sameLineConfig, useChart } from './useChart.js';
export type { UseChartOptions, UseChartResult } from './useChart.js';
export type { BarChartHandle, BarChartProps } from './bar-chart.types.js';
export type { LineChartHandle, LineChartProps } from './line-chart.types.js';
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

import { version } from 'react';
import { getCoreRuntimeInfo } from '@company/charts-core';

/** 工程骨架探针：保留以兼容既有引导验证，T03 起由图表组件取代其作用。 */
export function getReactRuntimeInfo() {
  return { ...getCoreRuntimeInfo(), framework: 'react', frameworkVersion: version } as const;
}
