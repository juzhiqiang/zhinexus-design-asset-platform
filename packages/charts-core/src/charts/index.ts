import { buildBarOption } from './bar.js';
import { buildLineOption } from './line.js';
import { buildPieOption } from './pie.js';
import { buildScatterOption } from './scatter.js';
import type {
  AnyChartConfig,
  BarChartConfig,
  BarChartOption,
  ChartData,
  ChartType,
  LineChartConfig,
  LineChartOption,
  PieChartConfig,
  PieChartOption,
  ScatterChartConfig,
  ScatterChartOption,
  SupportedOptionOverrides,
} from '../types.js';

/**
 * 解析配置的图表类型：缺省按折线图处理（兼容 T02/T03 既有调用方）。
 * 柱状图、饼图与散点图配置的 `chart` 为必填判别字段，因此不会误判。
 */
export function chartTypeOf(config: AnyChartConfig | undefined): ChartType {
  if (config?.chart === 'bar') {
    return 'bar';
  }
  if (config?.chart === 'pie') {
    return 'pie';
  }
  if (config?.chart === 'scatter') {
    return 'scatter';
  }
  return 'line';
}

/** 按图表类型分发 option 构建；数据、主题与覆盖规则与各图表入口保持一致。 */
export function buildChartOption(
  chart: 'bar',
  data: ChartData,
  config: BarChartConfig,
  optionOverrides?: SupportedOptionOverrides,
): BarChartOption;
export function buildChartOption(
  chart: 'line',
  data: ChartData,
  config: LineChartConfig,
  optionOverrides?: SupportedOptionOverrides,
): LineChartOption;
export function buildChartOption(
  chart: 'pie',
  data: ChartData,
  config: PieChartConfig,
  optionOverrides?: SupportedOptionOverrides,
): PieChartOption;
export function buildChartOption(
  chart: 'scatter',
  data: ChartData,
  config: ScatterChartConfig,
  optionOverrides?: SupportedOptionOverrides,
): ScatterChartOption;
/** 类型未收窄时（如控制器按运行期联合分发）返回 option 联合。 */
export function buildChartOption(
  chart: ChartType,
  data: ChartData,
  config: AnyChartConfig,
  optionOverrides?: SupportedOptionOverrides,
): LineChartOption | BarChartOption | PieChartOption | ScatterChartOption;
export function buildChartOption(
  chart: ChartType,
  data: ChartData,
  config: AnyChartConfig,
  optionOverrides?: SupportedOptionOverrides,
): LineChartOption | BarChartOption | PieChartOption | ScatterChartOption {
  if (chart === 'bar') {
    return buildBarOption(data, config as BarChartConfig, optionOverrides);
  }
  if (chart === 'pie') {
    return buildPieOption(data, config as PieChartConfig, optionOverrides);
  }
  if (chart === 'scatter') {
    return buildScatterOption(data, config as ScatterChartConfig, optionOverrides);
  }
  return buildLineOption(data, config as LineChartConfig, optionOverrides);
}
