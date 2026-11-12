import {
  assertSingleSeries,
  assertUniqueNames,
  normalizeChartData,
} from '../data.js';
import { formatValue } from '../format.js';
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
  RankingChartConfig,
  RankingChartOption,
  RankingDirection,
  RankingEntry,
  SupportedOptionOverrides,
} from '../types.js';

/** 排行榜摘要三个稳定槽位 id：标题 / 统计行 / 空数据提示。 */
const TITLE_SLOT = 'ranking-title';
const META_SLOT = 'ranking-meta';
const EMPTY_SLOT = 'ranking-empty';

/** 槽位纵向位置：标题在上，统计行与空数据提示占同一行（二者互斥）。 */
const RANK_TOP = 12;
const RANK_BODY = 32;

/**
 * 计算排行榜条目（纯函数，供 option 构建与调用方断言共用）。
 *
 * 语义约定：
 * - 入参是「一组条目」：`points[].x` 为条目名称，`points[].y` 为数值；
 * - 缺失值（null）不进入排行，也不占用名次；
 * - 排序方向缺省 `desc`（数值大者在前），`asc` 为反向；
 * - 并列（数值相同）共享同一名次，采用竞赛排名 1,2,2,4——跳过被并列占用的名次；
 * - 并列项之间按原始输入顺序稳定排列，不引入随机或字典序；
 * - `limit` 取前 N 名，仅在为正整数时生效；其余取值（undefined / 0 / 负数 / NaN）不截断；
 * - 名次在截断前计算，因此「取前 3 名」拿到的仍是 1、2、3 名。
 */
export function computeRanking(
  series: ChartSeries | undefined,
  options?: { direction?: RankingDirection; limit?: number },
): RankingEntry[] {
  if (!series || !Array.isArray(series.points)) {
    return [];
  }
  const direction = options?.direction === 'asc' ? 'asc' : 'desc';
  const ranked = series.points
    .map((point, sourceIndex) => ({ point, sourceIndex }))
    .filter((item) => typeof item.point.y === 'number' && !Number.isNaN(item.point.y))
    .map(({ point, sourceIndex }) => ({
      rank: 0,
      name: point.x,
      value: point.y as number,
      sourceIndex,
    }))
    .sort((left, right) => {
      const delta = direction === 'asc' ? left.value - right.value : right.value - left.value;
      // 并列时回到输入顺序，保证截图与断言可复现
      return delta !== 0 ? delta : left.sourceIndex - right.sourceIndex;
    });
  assignCompetitionRanks(ranked);
  const cap = positiveLimit(options?.limit);
  return cap === null ? ranked : ranked.slice(0, cap);
}

/** 竞赛排名：并列项同名次，后续名次跳过被并列占用的位数（1,2,2,4）。 */
function assignCompetitionRanks(entries: RankingEntry[]): void {
  let previousValue: number | null = null;
  let previousRank = 0;
  entries.forEach((entry, index) => {
    if (previousValue !== null && entry.value === previousValue) {
      entry.rank = previousRank;
      return;
    }
    entry.rank = index + 1;
    previousRank = entry.rank;
    previousValue = entry.value;
  });
}

/** 取前 N 名的截断值：仅正整数生效，其余返回 null 表示不截断。 */
function positiveLimit(limit: number | undefined): number | null {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1) {
    return null;
  }
  return Math.floor(limit);
}

/**
 * 构建排行榜 option：单系列横向条形，按数值排序并在类目轴标签上带名次。
 *
 * 语义约定（复用共享数据规则，另有组合场景显式差异）：
 * - `points[].x` 为条目名称，`points[].y` 为数值；缺失值（null）不进入排行；
 * - 多系列与同名条目都抛 `ChartDataError`（类目轴没有这两种输入的定义）；
 * - 负值原样进入排行并渲染在零轴左侧，排序方向决定它排在前还是后；
 * - 空数据显示「暂无数据」、无系列、无 NaN；
 * - 统计行展示条目总数，被 `limit` 截断时额外说明取前几名；
 * - optionOverrides 只深层合并坐标轴类字段，系列、主题、渲染器与 graphic 不可覆盖。
 */
export function buildRankingOption(
  data: ChartData,
  config: RankingChartConfig,
  optionOverrides?: SupportedOptionOverrides,
): RankingChartOption {
  const normalized = normalizeChartData(data);
  assertSingleSeries(normalized, '排行榜');
  const series = normalized.series[0];
  if (series) {
    assertUniqueNames(series, 'series[0]');
  }
  const theme = resolveTheme(config.theme);
  const unit = config.unit;
  const entries = computeRanking(series, config);
  // 统计行按「条目数」计数，与排序、截断无关；缺失值不计入
  const entryCount = series ? series.points.filter((point) => point.y !== null).length : 0;
  const base: RankingChartOption = {
    color: theme.palette,
    textStyle: { color: theme.textColor },
    animation: config.animation ?? true,
    // 左侧留给带名次的类目标签，顶部留给标题与统计行
    grid: { left: 96, right: 32, top: 56, bottom: 12 },
    tooltip: {
      trigger: 'item',
      formatter: (params: unknown) => {
        const item = params as { name?: unknown; value?: unknown };
        const name = typeof item.name === 'string' ? item.name : '';
        return `${name}: ${formatValue(typeof item.value === 'number' ? item.value : null, unit)}`;
      },
    },
    xAxis: {
      type: 'value',
      axisLabel: { color: theme.textColor, formatter: (value: number) => formatValue(value, unit) },
    },
    yAxis: {
      type: 'category',
      // 榜首在上：inverse 让数组第一条显示在最上方
      inverse: true,
      data: entries.map((entry) => entry.name),
      axisLabel: {
        color: theme.textColor,
        // 名次来自排序结果，与类目轴数据同序，因此按 index 取值
        formatter: (_value: string, index: number) =>
          `${entries[index]?.rank ?? index + 1}. ${String(entries[index]?.name ?? '')}`,
      },
    },
    series: entries.length > 0 && series
      ? [
          {
              type: 'bar',
              id: series.id,
              name: series.name,
              // 数据项带 name：点击载荷为 [条目名称, 数值]，与折线 / 柱状 / 饼图同构
              data: entries.map((entry) => ({ name: entry.name, value: entry.value })),
              barMaxWidth: 22,
              label: {
                show: true,
                position: 'right',
                color: theme.textColor,
                formatter: (params: unknown) =>
                  formatValue((params as { value?: unknown }).value as number | null, unit),
              },
            },
        ]
      : [],
  };
  const merged = applySupportedOverrides(base, optionOverrides);
  // graphic 由数据驱动，不随 optionOverrides 合并
  (merged as Record<string, unknown>).graphic = buildRankingHeadline(config, theme, {
    total: entryCount,
    shown: entries.length,
  });
  return merged;
}

/** 统计行：条目总数；被 limit 截断时说明取前几名。 */
function metaText(total: number, shown: number): string {
  return shown < total ? `共 ${total} 项 · 取前 ${shown} 名` : `共 ${total} 项`;
}

/**
 * 排行榜 graphic 元素：标题 / 统计行 / 空数据提示三个稳定槽位，顺序固定。
 * 统计行与空数据提示互斥（有条目才有总数），未使用的槽位 ignore 隐藏，
 * 避免状态切换时残留上一次的文本。
 */
function buildRankingHeadline(
  config: RankingChartConfig,
  theme: ChartTheme,
  counts: { total: number; shown: number },
): SceneTextElement[] {
  const muted = mutedColor(theme);
  const title = config.title
    ? textSlot(TITLE_SLOT, RANK_TOP, { text: config.title, fontSize: 13, fill: muted })
    : hiddenSlot(TITLE_SLOT, RANK_TOP);
  const empty = counts.shown === 0;
  const meta = empty
    ? hiddenSlot(META_SLOT, RANK_BODY)
    : textSlot(META_SLOT, RANK_BODY, {
        text: metaText(counts.total, counts.shown),
        fontSize: 13,
        fill: muted,
      });
  const emptyText = empty
    ? textSlot(EMPTY_SLOT, RANK_BODY, { text: EMPTY_DISPLAY, fontSize: 16, fill: muted })
    : hiddenSlot(EMPTY_SLOT, RANK_BODY);
  return [title, meta, emptyText];
}
