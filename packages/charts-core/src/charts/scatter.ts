import { ChartDataError, normalizeChartData } from '../data.js';
import { formatValue } from '../format.js';
import { applySupportedOverrides } from './option-overrides.js';
import { resolveTheme } from '../theme.js';
import type {
  ChartData,
  ScatterChartConfig,
  ScatterChartOption,
  SupportedOptionOverrides,
  UnitSpec,
} from '../types.js';

/**
 * 构建散点图 option：双数值轴 + 按 id 稳定的 [x, y] 数值对系列。
 *
 * 语义约定（与折线 / 柱状共用同一套数据规则，散点另有显式差异）：
 * - `points[].x` 为数值轴坐标，必须是数值（类目轴图表允许字符串 x，散点图显式拒绝）；
 * - `points[].y` 为数值；缺失值（null）原样保留为 `[x, null]`，ECharts 不渲染该符号，也不补 0；
 * - 负值原样进入数据项，由数值轴自行渲染零轴以下区域，option 层不裁剪、不取绝对值；
 * - 空数据返回空系列、无图例，不抛错、不产生 NaN；
 * - `unit` 只作用于 y 轴与 tooltip 的 y 口径（与折线 / 柱状的数值轴一致），x 轴按无单位格式化；
 * - 多系列才渲染图例，单系列与空数据不渲染；
 * - optionOverrides 合并全部坐标轴类字段（grid / tooltip / legend / xAxis / yAxis / title），
 *   系列、主题与渲染器不可覆盖。
 */
export function buildScatterOption(
  data: ChartData,
  config: ScatterChartConfig,
  optionOverrides?: SupportedOptionOverrides,
): ScatterChartOption {
  const normalized = normalizeChartData(data);
  assertNumericAbscissa(normalized);
  const theme = resolveTheme(config.theme);
  const unit = config.unit;
  const base: ScatterChartOption = {
    color: theme.palette,
    textStyle: { color: theme.textColor },
    animation: config.animation ?? true,
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'item',
      formatter: (params: unknown) => {
        const item = params as { seriesName?: unknown; value?: unknown };
        const name = typeof item.seriesName === 'string' ? item.seriesName : '';
        return `${name}: ${scatterPairText(item.value, unit)}`;
      },
    },
    xAxis: {
      type: 'value',
      name: config.xAxisName,
      axisLine: { lineStyle: { color: theme.axisLineColor } },
      axisLabel: {
        color: theme.textColor,
        // x 轴不带单位：unit 描述被度量的数值（y 轴口径），x 只做千分位分组
        formatter: (value: number) => formatValue(value),
      },
    },
    yAxis: {
      type: 'value',
      name: config.yAxisName,
      axisLine: { lineStyle: { color: theme.axisLineColor } },
      axisLabel: { color: theme.textColor, formatter: (value: number) => formatValue(value, unit) },
      splitLine: { lineStyle: { color: theme.splitLineColor } },
    },
    series: normalized.series.map((series) => ({
      type: 'scatter',
      id: series.id,
      name: series.name,
      // ECharts 运行期接受 [x, null]（该符号不渲染、不进入任何聚合），
      // 但其声明类型未收窄到可空；显式断言以保留「null 即缺失，禁止写成 0」的共享数据规则
      data: series.points.map((point) => [point.x as number, point.y as number]),
      emphasis: { focus: 'series' },
    })),
  };
  if (normalized.series.length > 1) {
    base.legend = { textStyle: { color: theme.textColor } };
  }
  return applySupportedOverrides(base, optionOverrides);
}

/** 数值 x 校验：散点图 x 轴为数值轴，字符串 x 没有坐标语义，path 指向出错点。 */
function assertNumericAbscissa(data: ChartData): void {
  data.series.forEach((series, seriesIndex) => {
    series.points.forEach((point, pointIndex) => {
      if (typeof point.x !== 'number' || Number.isNaN(point.x)) {
        throw new ChartDataError(
          '散点图 x 必须为数值（数值轴坐标）',
          `series[${seriesIndex}].points[${pointIndex}].x`,
        );
      }
    });
  });
}

/** tooltip 文本：`(x, y)` 数值对；y 缺失时展示缺失符，整体非数值对时只展示缺失符。 */
function scatterPairText(value: unknown, unit?: UnitSpec): string {
  if (!Array.isArray(value)) {
    return formatValue(null, unit);
  }
  const x = typeof value[0] === 'number' ? value[0] : null;
  const y = typeof value[1] === 'number' ? value[1] : null;
  return `(${formatValue(x)}, ${formatValue(y, unit)})`;
}
