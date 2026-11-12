import {
  assertSingleSeries,
  assertUniqueNames,
  ChartDataError,
  normalizeChartData,
  sumDefinedValues,
} from '../data.js';
import { formatPercent, formatValue } from '../format.js';
import { applySupportedOverrides } from './option-overrides.js';
import {
  EMPTY_DISPLAY,
  hiddenSlot,
  mutedColor,
  textSlot,
  type SceneTextElement,
} from './scene-slots.js';
import { resolveTheme } from '../theme.js';
import type { ChartTheme } from '../theme.js';
import type {
  ChartData,
  ChartSeries,
  ProportionChartConfig,
  ProportionChartOption,
  ProportionShare,
  SupportedOptionOverrides,
} from '../types.js';

/** 占比摘要三个稳定槽位 id：标题 / 总量行 / 空数据提示。 */
const TITLE_SLOT = 'proportion-title';
const TOTAL_SLOT = 'proportion-total';
const EMPTY_SLOT = 'proportion-empty';

const PROPORTION_TOP = 12;
const PROPORTION_BODY = 32;

/**
 * 计算占比条目（纯函数，供 option 构建与调用方断言共用）。
 *
 * 语义约定：
 * - 入参是「一组条目」：`points[].x` 为条目名称，`points[].y` 为数值；
 * - 缺失值（null）不参与占比，也不进入分母（与饼图同一口径）；
 * - 占比 = 值 / 全部条目非缺失值之和；总量不可算（`total <= 0`）时一律为 `null`，
 *   由调用方省略占比展示，禁止产出 `NaN%`；
 * - 条目顺序保持输入顺序——占比场景不排序，需要排序时用排行榜组件，
 *   避免同一份数据在两个场景里给出不同顺序而难以对照。
 */
export function computeProportionShares(
  series: ChartSeries | undefined,
): ProportionShare[] {
  if (!series || !Array.isArray(series.points)) {
    return [];
  }
  const total = sumDefinedValues(series);
  return series.points.map((point, sourceIndex) => ({
    name: point.x,
    value: point.y,
    share: point.y === null ? null : total > 0 ? point.y / total : null,
    sourceIndex,
  }));
}

/**
 * 构建占比 option：单系列横向条形，条末同时标注数值与占总量的百分比。
 *
 * 语义约定（复用共享数据规则，另有组合场景显式差异）：
 * - `points[].x` 为条目名称，`points[].y` 为数值；缺失值（null）保留为缺失，
 *   不补 0、不参与分母，也不进入 option 的系列数据；
 * - 负值没有占比语义，直接抛 `ChartDataError`（与饼图一致，折线 / 柱状 / 排行榜为原样透传）；
 * - 多系列与同名条目都抛 `ChartDataError`（类目轴没有这两种输入的定义）；
 * - 总量为零（全零或全缺失）时展示「暂无数据」、无系列、不产出 `NaN%`；
 * - 总量行展示参与占比的合计值，便于核对百分比口径；
 * - 不在组件内猜业务指标口径：占比只描述「值 / 合计」，指标含义由调用方的 `unit` 与标题表达；
 * - optionOverrides 只深层合并坐标轴类字段，系列、主题、渲染器与 graphic 不可覆盖。
 */
export function buildProportionOption(
  data: ChartData,
  config: ProportionChartConfig,
  optionOverrides?: SupportedOptionOverrides,
): ProportionChartOption {
  const normalized = normalizeChartData(data);
  assertSingleSeries(normalized, '占比');
  const series = normalized.series[0];
  assertNonNegativeValues(series);
  if (series) {
    assertUniqueNames(series, 'series[0]');
  }
  const theme = resolveTheme(config.theme);
  const unit = config.unit;
  const shares = computeProportionShares(series);
  const total = series ? sumDefinedValues(series) : 0;
  // 总量不可算时整幅图按「暂无数据」处理：百分比没有分母，条形长度也没有基准
  const computable = total > 0;
  const rendered = computable ? shares.filter((share) => share.value !== null) : [];
  const base: ProportionChartOption = {
    color: theme.palette,
    textStyle: { color: theme.textColor },
    animation: config.animation ?? true,
    grid: { left: 96, right: 64, top: 56, bottom: 12 },
    tooltip: {
      trigger: 'item',
      formatter: (params: unknown) => {
        const item = params as { name?: unknown; value?: unknown };
        const name = typeof item.name === 'string' ? item.name : '';
        const value = typeof item.value === 'number' ? item.value : null;
        const percent = formatPercent(value, total);
        return percent === null
          ? `${name}: ${formatValue(value, unit)}`
          : `${name}: ${formatValue(value, unit)}（${percent}）`;
      },
    },
    xAxis: {
      type: 'value',
      axisLabel: { color: theme.textColor, formatter: (value: number) => formatValue(value, unit) },
    },
    yAxis: {
      type: 'category',
      // 输入顺序即展示顺序，与饼图角度顺序口径一致
      inverse: true,
      data: rendered.map((share) => share.name),
      axisLabel: { color: theme.textColor },
    },
    series: rendered.length > 0 && series
      ? [
          {
              type: 'bar',
              id: series.id,
              name: series.name,
              // 数据项带 name：点击载荷为 [条目名称, 数值]，与折线 / 柱状 / 饼图同构
              data: rendered.map((share) => ({ name: share.name, value: share.value as number })),
              barMaxWidth: 22,
              label: {
                show: true,
                position: 'right',
                color: theme.textColor,
                formatter: (params: unknown) => {
                  const item = params as { name?: unknown; value?: unknown };
                  const value = typeof item.value === 'number' ? item.value : null;
                  const percent = formatPercent(value, total);
                  return percent === null
                    ? formatValue(value, unit)
                    : `${formatValue(value, unit)}（${percent}）`;
                },
              },
            },
        ]
      : [],
  };
  const merged = applySupportedOverrides(base, optionOverrides);
  // graphic 由数据驱动，不随 optionOverrides 合并
  (merged as Record<string, unknown>).graphic = buildProportionHeadline(config, theme, {
    total,
    computable,
  });
  return merged;
}

/** 负值拒绝：占比没有负值语义，path 指向出错点，便于调用方定位（与饼图同一规则）。 */
function assertNonNegativeValues(series: ChartSeries | undefined): void {
  if (!series) {
    return;
  }
  series.points.forEach((point, index) => {
    if (point.y !== null && point.y < 0) {
      throw new ChartDataError(
        '占比数值必须为非负数（负值没有占比语义）',
        `series[0].points[${index}].y`,
      );
    }
  });
}

/**
 * 占比 graphic 元素：标题 / 总量行 / 空数据提示三个稳定槽位，顺序固定。
 * 总量行与空数据提示互斥（有可算总量才展示合计），未使用的槽位 ignore 隐藏。
 */
function buildProportionHeadline(
  config: ProportionChartConfig,
  theme: ChartTheme,
  counts: { total: number; computable: boolean },
): SceneTextElement[] {
  const muted = mutedColor(theme);
  const title = config.title
    ? textSlot(TITLE_SLOT, PROPORTION_TOP, { text: config.title, fontSize: 13, fill: muted })
    : hiddenSlot(TITLE_SLOT, PROPORTION_TOP);
  const totalSlot = counts.computable
    ? textSlot(TOTAL_SLOT, PROPORTION_BODY, {
        text: `总量 ${formatValue(counts.total, config.unit)}`,
        fontSize: 13,
        fill: muted,
      })
    : hiddenSlot(TOTAL_SLOT, PROPORTION_BODY);
  const emptySlot = counts.computable
    ? hiddenSlot(EMPTY_SLOT, PROPORTION_BODY)
    : textSlot(EMPTY_SLOT, PROPORTION_BODY, { text: EMPTY_DISPLAY, fontSize: 16, fill: muted });
  return [title, totalSlot, emptySlot];
}
