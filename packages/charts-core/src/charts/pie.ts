import { ChartDataError, normalizeChartData } from '../data.js';
import { formatPercent, formatValue } from '../format.js';
import { PIE_OVERRIDE_KEYS, applySupportedOverrides } from './option-overrides.js';
import { resolveTheme } from '../theme.js';
import type {
  ChartData,
  PieChartConfig,
  PieChartOption,
  SupportedOptionOverrides,
  UnitSpec,
} from '../types.js';

/** 饼图外半径：占容器较小边的比例，固定值保证截图可复现。 */
const OUTER_RADIUS_PERCENT = 70;

/** 环形图内孔：外半径的 50%。donut 只改变内半径语义，其余规则不变。 */
const DONUT_INNER_RATIO = 0.5;

/**
 * 构建饼图 / 环形图 option：数据 → 按 id 稳定的同心嵌套环。
 *
 * 语义约定（与折线 / 柱状共用同一套数据规则，饼图另有显式差异）：
 * - `points[].x` 为扇形名称，`points[].y` 为数值；一个系列对应一圈，多系列为同心嵌套环，外环在前；
 * - 缺失值（null）原样保留，ECharts 不渲染该扇形，也不参与占比分母；
 * - 负值没有占比语义，直接抛 `ChartDataError`（折线 / 柱状图为原样透传，规则显式区分）；
 * - 空数据返回空系列、无图例，不抛错、不产生 NaN；
 * - `donut` 只从内侧预留内孔，不改变数据、角度顺序、图例规则与占比口径；
 * - 多系列才渲染图例，单系列与空数据不渲染；
 * - 总量为零（全零或全缺失）时占比不可算，tooltip 与标签只展示值，不产出 `NaN%`；
 * - optionOverrides 只深层合并 `tooltip` / `legend` / `title`，系列、主题与渲染器不可覆盖。
 */
export function buildPieOption(
  data: ChartData,
  config: PieChartConfig,
  optionOverrides?: SupportedOptionOverrides,
): PieChartOption {
  const normalized = normalizeChartData(data);
  assertNonNegativeValues(normalized);
  const theme = resolveTheme(config.theme);
  const unit = config.unit;
  const total = pieTotal(normalized);
  const rings = normalized.series.length;
  const base: PieChartOption = {
    color: theme.palette,
    textStyle: { color: theme.textColor },
    animation: config.animation ?? true,
    tooltip: {
      trigger: 'item',
      formatter: (params: unknown) => {
        const item = params as { name?: unknown; value?: unknown };
        const name = typeof item.name === 'string' ? item.name : '';
        return `${name}: ${pieValueText(item.value, total, unit)}`;
      },
    },
    series: normalized.series.map((series, index) => ({
      type: 'pie',
      id: series.id,
      name: series.name,
      radius: ringRadius(index, rings, config.donut === true),
      center: ['50%', '50%'],
      data: series.points.map((point) => ({
        name: point.x,
        // ECharts 运行期接受 value: null（该扇形不渲染、不参与占比），
        // 但其声明类型未收窄到可空；显式断言以保留“null 即缺失，禁止写成 0”的共享数据规则
        value: point.y as number,
      })),
      label: {
        color: theme.textColor,
        formatter: (params: unknown) => {
          const item = params as { name?: unknown; value?: unknown };
          const name = typeof item.name === 'string' ? item.name : '';
          return `${name}\n${pieValueText(item.value, total, unit)}`;
        },
      },
    })),
  };
  if (rings > 1) {
    base.legend = { textStyle: { color: theme.textColor } };
  }
  return applySupportedOverrides(base, optionOverrides, PIE_OVERRIDE_KEYS);
}

/** 饼图总量：全部系列非缺失值之和；缺失值不补 0，也不进入分母。 */
export function pieTotal(data: ChartData): number {
  let total = 0;
  for (const series of data.series) {
    for (const point of series.points) {
      if (point.y !== null) {
        total += point.y;
      }
    }
  }
  return total;
}

/** 负值拒绝：饼图角度没有负值语义，path 指向出错点，便于调用方定位。 */
function assertNonNegativeValues(data: ChartData): void {
  data.series.forEach((series, seriesIndex) => {
    series.points.forEach((point, pointIndex) => {
      if (point.y !== null && point.y < 0) {
        throw new ChartDataError(
          '饼图数值必须为非负数（负值没有占比语义）',
          `series[${seriesIndex}].points[${pointIndex}].y`,
        );
      }
    });
  });
}

/** 扇形文本：值 + 占比；总量不可算或值缺失时省略占比。 */
function pieValueText(value: unknown, total: number, unit?: UnitSpec): string {
  const numeric = typeof value === 'number' ? value : null;
  const percent = formatPercent(numeric, total);
  return percent === null
    ? formatValue(numeric, unit)
    : `${formatValue(numeric, unit)}（${percent}）`;
}

/**
 * 第 `index` 圈（0 为最外圈）的内外半径。
 * 环形图先预留内孔，剩余带宽在各环之间均分，保证任何系列数下内半径都小于外半径。
 */
function ringRadius(index: number, rings: number, donut: boolean): [string, string] {
  const hole = donut ? OUTER_RADIUS_PERCENT * DONUT_INNER_RATIO : 0;
  const band = (OUTER_RADIUS_PERCENT - hole) / rings;
  const inner = hole + (rings - 1 - index) * band;
  const outer = hole + (rings - index) * band;
  return [`${trimPercent(inner)}%`, `${trimPercent(outer)}%`];
}

/** 去掉浮点尾差：52.5 保持 52.5，26.666666666666668 之类的值取 2 位小数。 */
function trimPercent(value: number): string {
  return String(Math.round(value * 100) / 100);
}
