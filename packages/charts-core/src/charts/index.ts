import { buildBarOption } from './bar.js';
import { buildLineOption } from './line.js';
import type {
  AnyChartConfig,
  BarChartConfig,
  BarChartOption,
  ChartData,
  ChartType,
  LineChartConfig,
  LineChartOption,
  SupportedOptionOverrides,
} from '../types.js';

/**
 * 解析配置的图表类型：缺省按折线图处理（兼容 T02/T03 既有调用方）。
 * 柱状图配置的 `chart` 为必填判别字段，因此不会误判。
 */
export function chartTypeOf(config: AnyChartConfig | undefined): ChartType {
  return config?.chart === 'bar' ? 'bar' : 'line';
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
/** 类型未收窄时（如控制器按运行期联合分发）返回 option 联合。 */
export function buildChartOption(
  chart: ChartType,
  data: ChartData,
  config: AnyChartConfig,
  optionOverrides?: SupportedOptionOverrides,
): LineChartOption | BarChartOption;
export function buildChartOption(
  chart: ChartType,
  data: ChartData,
  config: AnyChartConfig,
  optionOverrides?: SupportedOptionOverrides,
): LineChartOption | BarChartOption {
  if (chart === 'bar') {
    return buildBarOption(data, config as BarChartConfig, optionOverrides);
  }
  return buildLineOption(data, config as LineChartConfig, optionOverrides);
}
