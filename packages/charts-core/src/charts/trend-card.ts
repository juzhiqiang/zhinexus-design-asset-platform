import { alignSeriesValues, collectCategories, normalizeChartData } from '../data.js';
import { formatValue } from '../format.js';
import { applySupportedOverrides } from './option-overrides.js';
import { resolveTheme } from '../theme.js';
import type { ChartTheme } from '../theme.js';
import type {
  ChartData,
  ChartSeries,
  SupportedOptionOverrides,
  ThemeName,
  TrendCardConfig,
  TrendCardOption,
  TrendSummary,
} from '../types.js';

/** 空数据 / 无可用值时的大字段落；与占比场景「暂无数据」口径一致。 */
const EMPTY_DISPLAY = '暂无数据';

/** 上升 / 下降 / 中性色：按主题区分，不依赖运行 locale，保证截图可复现。 */
const TREND_COLORS: Record<ThemeName, { up: string; down: string; muted: string }> = {
  light: { up: '#059669', down: '#dc2626', muted: '#64748b' },
  dark: { up: '#34d399', down: '#f87171', muted: '#94a8b8' },
};

/** graphic 文本元素（数值摘要）：位置用像素锚定，样式为纯可序列化值。 */
type TrendTextElement = {
  type: 'text';
  id: string;
  left: number;
  top: number;
  z: number;
  /** 槽位隐藏标记：固定槽位 + ignore，避免状态切换残留上一次文本，也避免移除不存在元素报错。 */
  ignore?: boolean;
  style: {
    text: string;
    fontSize?: number;
    fontWeight?: number;
    fill?: string;
    rich?: Record<string, { color: string; fontSize: number; fontWeight?: number }>;
  };
};

/** 数值摘要三个稳定槽位 id：标题 / 当前值 / meta 行。 */
const TITLE_SLOT = 'trend-title';
const VALUE_SLOT = 'trend-value';
const META_SLOT = 'trend-meta';
const SLOT_LEFT = 16;
const SLOT_Z = 10;

/**
 * 计算趋势卡片数值摘要（纯函数，供 option 构建与调用方断言共用）。
 *
 * 语义约定：
 * - 当前值取 `series` 中最后一个非缺失值（自末尾向前），无可用值为 null；
 * - 前期值来自 `previousValue`，undefined / null / NaN 一律归一为 null（无对比基线）；
 * - 变化量 = 当前值 - 前期值（两者均可算时）；
 * - 变化率 = 变化量 / |前期值| * 100（前期值非零时可算；取基线绝对值，避免负基线反转方向）；
 * - 方向：变化量为正 up、为负 down、为 0 flat、不可算 none。
 */
export function computeTrendSummary(
  series: ChartSeries | undefined,
  previousValue?: number | null,
): TrendSummary {
  const current = lastDefinedValue(series);
  const previous =
    typeof previousValue === 'number' && !Number.isNaN(previousValue) ? previousValue : null;
  if (current === null || previous === null) {
    return { current, previous, delta: null, deltaPercent: null, direction: 'none' };
  }
  const delta = current - previous;
  const deltaPercent = previous !== 0 ? (delta / Math.abs(previous)) * 100 : null;
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  return { current, previous, delta, deltaPercent, direction };
}

/** 系列中最后一个非缺失值（自末尾向前找第一个 y !== null）；无可用值为 null。 */
function lastDefinedValue(series: ChartSeries | undefined): number | null {
  if (!series || !Array.isArray(series.points)) {
    return null;
  }
  for (let index = series.points.length - 1; index >= 0; index -= 1) {
    const value = series.points[index]?.y;
    if (typeof value === 'number' && !Number.isNaN(value)) {
      return value;
    }
  }
  return null;
}

/**
 * 构建趋势卡片 option：类目轴 sparkline（每系列一条折线）+ 隐藏坐标轴 + graphic 数值摘要。
 *
 * 语义约定（复用折线 / 柱状同一套数据规则，另有组合场景显式差异）：
 * - `points[].x` 为类目轴坐标（时间 / 期间），`points[].y` 为数值；缺失值（null）不补 0；
 * - sparkline：每系列一条 `line` 系列，平滑 + 半透明面积 + 可见小符号（保证可点击）；
 * - 坐标轴 `show: false`（卡片观感）但坐标系仍注册，`convertToPixel` 可用；
 * - 数值摘要在 `graphic`：标题 / 当前值（大号）/ meta 行（前期值 + 上升下降变化）；
 * - 空数据显示「暂无数据」、无 sparkline 系列、无 meta 行，不抛错、不产生 NaN；
 * - `unit` 作用于当前值、前期值、变化量与 y 轴 / tooltip 口径；
 * - 多系列才渲染图例，单系列与空数据不渲染；
 * - optionOverrides 只深层合并坐标轴类字段（grid / tooltip / legend / xAxis / yAxis / title），
 *   系列、主题、渲染器与 graphic 不可覆盖。
 */
export function buildTrendCardOption(
  data: ChartData,
  config: TrendCardConfig,
  optionOverrides?: SupportedOptionOverrides,
): TrendCardOption {
  const normalized = normalizeChartData(data);
  const theme = resolveTheme(config.theme);
  const categories = collectCategories(normalized);
  const unit = config.unit;
  const summary = computeTrendSummary(normalized.series[0], config.previousValue);
  const base: TrendCardOption = {
    color: theme.palette,
    textStyle: { color: theme.textColor },
    animation: config.animation ?? true,
    // 顶部预留数值摘要空间，sparkline 占据下方
    grid: { left: 12, right: 14, top: 96, bottom: 10 },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value) => formatValue(typeof value === 'number' ? value : null, unit),
    },
    xAxis: {
      type: 'category',
      data: categories,
      show: false,
      // sparkline 贴合首尾，不使用类目边界间距（与折线一致）
      boundaryGap: false,
    },
    yAxis: {
      type: 'value',
      show: false,
    },
    series: normalized.series.map((series) => ({
      type: 'line',
      id: series.id,
      name: series.name,
      data: alignSeriesValues(series, categories),
      smooth: true,
      showSymbol: true,
      symbolSize: 5,
      lineStyle: { width: 2 },
      areaStyle: { opacity: 0.15 },
      emphasis: { focus: 'series' },
    })),
  };
  if (normalized.series.length > 1) {
    base.legend = { textStyle: { color: theme.textColor } };
  }
  const merged = applySupportedOverrides(base, optionOverrides);
  // graphic 由数据驱动，不随 optionOverrides 合并；经 Record 赋值以避免 ECharts graphic 严格类型摩擦
  (merged as Record<string, unknown>).graphic = buildTrendHeadline(summary, config, theme);
  return merged;
}

/**
 * 可见文本槽位。`ignore` 必须显式为 false：控制器首次 applyOption 时数据尚为空
 * （槽位为 ignore: true），随后 update 才填入数据；ECharts 按 id 合并 graphic 元素，
 * 若可见槽位不显式声明 ignore: false，合并后会保留上一次的 ignore: true 而不渲染。
 */
function textSlot(id: string, top: number, style: TrendTextElement['style']): TrendTextElement {
  return { type: 'text', id, left: SLOT_LEFT, top, z: SLOT_Z, ignore: false, style };
}

/**
 * 隐藏槽位：固定 id + `ignore`。三个槽位每次构建都完整给出，
 * 未使用的槽位 ignore 隐藏——既不会残留上一次渲染的文本，
 * 也不会像 `$action: 'remove'` 那样在首次渲染移除不存在元素时抛错。
 */
function hiddenSlot(id: string, top: number): TrendTextElement {
  return { type: 'text', id, left: SLOT_LEFT, top, z: SLOT_Z, ignore: true, style: { text: '' } };
}

/** 数值摘要 graphic 元素：标题 / 当前值 / meta 行三个稳定槽位，未使用的槽位 ignore 隐藏。 */
function buildTrendHeadline(
  summary: TrendSummary,
  config: TrendCardConfig,
  theme: ChartTheme,
): TrendTextElement[] {
  const colors = TREND_COLORS[theme.name];
  const title = config.title
    ? textSlot(TITLE_SLOT, 12, { text: config.title, fontSize: 13, fill: colors.muted })
    : hiddenSlot(TITLE_SLOT, 12);
  const value =
    summary.current === null
      ? textSlot(VALUE_SLOT, 30, { text: EMPTY_DISPLAY, fontSize: 16, fill: colors.muted })
      : textSlot(VALUE_SLOT, 30, {
          text: formatValue(summary.current, config.unit),
          fontSize: 30,
          fontWeight: 700,
          fill: theme.textColor,
        });
  return [title, value, buildMetaSlot(summary, config, colors)];
}

/** meta 行槽位：仅当有前期值且有变化量时可见（此时 current / previous / delta 均可算）。 */
function buildMetaSlot(
  summary: TrendSummary,
  config: TrendCardConfig,
  colors: { up: string; down: string; muted: string },
): TrendTextElement {
  if (summary.previous === null || summary.delta === null) {
    return hiddenSlot(META_SLOT, 74);
  }
  const arrow = summary.direction === 'up' ? '▲' : summary.direction === 'down' ? '▼' : '–';
  const trendColor =
    summary.direction === 'up' ? colors.up : summary.direction === 'down' ? colors.down : colors.muted;
  const percent =
    summary.deltaPercent !== null ? ` (${Math.abs(summary.deltaPercent).toFixed(1)}%)` : '';
  const magnitude = formatValue(Math.abs(summary.delta), config.unit);
  const previousText = formatValue(summary.previous, config.unit);
  return textSlot(META_SLOT, 74, {
    text: `{prev|前期 ${previousText}}   {trend|${arrow} ${magnitude}${percent}}`,
    fontSize: 13,
    fill: colors.muted,
    rich: {
      prev: { color: colors.muted, fontSize: 13 },
      trend: { color: trendColor, fontSize: 13, fontWeight: 600 },
    },
  });
}
