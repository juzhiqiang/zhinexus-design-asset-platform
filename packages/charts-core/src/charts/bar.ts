import { alignSeriesValues, collectCategories, normalizeChartData } from '../data.js';
import { formatValue } from '../format.js';
import { applySupportedOverrides } from './option-overrides.js';
import { resolveTheme } from '../theme.js';
import type {
  BarChartConfig,
  BarChartOption,
  ChartData,
  SupportedOptionOverrides,
} from '../types.js';

/**
 * 构建柱状图 option：共享类目轴 + 按 id 稳定的柱状系列。
 *
 * 语义约定（与折线图共用同一套数据规则）：
 * - 缺失值（null）原样保留为 ECharts 缺失语义，不补 0；柱条不渲染该缺口；
 * - 负值原样进入系列数据，由数值轴自行渲染零轴以下区域，option 层不裁剪；
 * - 类目轴保留边界间距（`boundaryGap: true`），柱条不贴边；折线图不使用边界间距；
 * - 多系列才渲染图例，单系列与空数据不渲染；
 * - optionOverrides 只深层合支持受字段，系列/主题/渲染器不可覆盖。
 */
export function buildBarOption(
  data: ChartData,
  config: BarChartConfig,
  optionOverrides?: SupportedOptionOverrides,
): BarChartOption {
  const normalized = normalizeChartData(data);
  const theme = resolveTheme(config.theme);
  const categories = collectCategories(normalized);
  const unit = config.unit;
  const base: BarChartOption = {
    color: theme.palette,
    textStyle: { color: theme.textColor },
    animation: config.animation ?? true,
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      valueFormatter: (value) => formatValue(typeof value === 'number' ? value : null, unit),
    },
    xAxis: {
      type: 'category',
      data: categories,
      // 柱状图需要边界间距，否则首尾柱条贴边
      boundaryGap: true,
      name: config.xAxisName,
      axisLine: { lineStyle: { color: theme.axisLineColor } },
      axisLabel: { color: theme.textColor },
    },
    yAxis: {
      type: 'value',
      name: config.yAxisName,
      axisLabel: { color: theme.textColor, formatter: (value: number) => formatValue(value, unit) },
      splitLine: { lineStyle: { color: theme.splitLineColor } },
    },
    series: normalized.series.map((series) => ({
      type: 'bar',
      id: series.id,
      name: series.name,
      data: alignSeriesValues(series, categories),
      stack: config.stack,
      emphasis: { focus: 'series' },
    })),
  };
  if (normalized.series.length > 1) {
    base.legend = { textStyle: { color: theme.textColor } };
  }
  return applySupportedOverrides(base, optionOverrides);
}
