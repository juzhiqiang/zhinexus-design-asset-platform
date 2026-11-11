import { alignSeriesValues, collectCategories, normalizeChartData } from '../data.js';
import { formatValue } from '../format.js';
import { resolveTheme } from '../theme.js';
import type {
  ChartData,
  LineChartConfig,
  LineChartOption,
  SupportedOptionOverrides,
} from '../types.js';

const OVERRIDE_KEYS = ['grid', 'tooltip', 'legend', 'xAxis', 'yAxis', 'title'] as const;

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

function applySupportedOverrides(
  base: LineChartOption,
  overrides?: SupportedOptionOverrides,
): LineChartOption {
  if (!overrides) {
    return base;
  }
  const merged: Record<string, unknown> = { ...base };
  for (const key of OVERRIDE_KEYS) {
    const patch = overrides[key];
    if (patch === undefined) {
      continue;
    }
    merged[key] = deepMerge(base[key], patch);
  }
  return merged as LineChartOption;
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch;
  }
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      result[key] = deepMerge(result[key], value);
    }
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
