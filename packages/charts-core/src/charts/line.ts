import { alignSeriesValues, collectCategories, normalizeChartData } from '../data.js';
import { formatValue } from '../format.js';
import { applySupportedOverrides } from './option-overrides.js';
import { resolveTheme } from '../theme.js';
import type {
  ChartData,
  LineChartConfig,
  LineChartOption,
  SupportedOptionOverrides,
} from '../types.js';

/**
 * 构建折线图 option：数据 → 共享类目轴 + 按 id 稳定的系列。
 * 缺失值（null）原样保留为 ECharts 缺失语义，不补 0。
 * optionOverrides 只深层合支持受字段，系列/主题/渲染器不可覆盖。
 */
export function buildLineOption(
  data: ChartData,
  config: LineChartConfig = {},
  optionOverrides?: SupportedOptionOverrides,
): LineChartOption {
  const normalized = normalizeChartData(data);
  const theme = resolveTheme(config.theme);
  const categories = collectCategories(normalized);
  const unit = config.unit;
  const base: LineChartOption = {
    color: theme.palette,
    textStyle: { color: theme.textColor },
    animation: config.animation ?? true,
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value) => formatValue(typeof value === 'number' ? value : null, unit),
    },
    xAxis: {
      type: 'category',
      data: categories,
      boundaryGap: false,
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
      type: 'line',
      id: series.id,
      name: series.name,
      data: alignSeriesValues(series, categories),
      smooth: config.smooth ?? false,
      connectNulls: config.connectNulls ?? false,
      areaStyle: config.area ? {} : undefined,
      emphasis: { focus: 'series' },
    })),
  };
  return applySupportedOverrides(base, optionOverrides);
}
