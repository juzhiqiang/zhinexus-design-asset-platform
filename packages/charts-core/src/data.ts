import type { ChartData, ChartPoint, ChartSeries } from './types.js';

/** 数据协议错误：调用方数据不符合 ChartData 约定时抛出，path 指向出错位置。 */
export class ChartDataError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(message);
    this.name = 'ChartDataError';
    this.path = path;
  }
}

/** 校验并返回规范化副本；不修改入参，不填充缺失值。 */
export function normalizeChartData(data: ChartData): ChartData {
  if (!data || typeof data !== 'object' || !Array.isArray(data.series)) {
    throw new ChartDataError('图表数据必须是 { series: [] } 结构', 'series');
  }
  const seenIds = new Set<string>();
  const series = data.series.map((item, index) => normalizeSeries(item, `series[${index}]`, seenIds));
  return { series };
}

function normalizeSeries(series: ChartSeries, path: string, seenIds: Set<string>): ChartSeries {
  if (!series || typeof series !== 'object') {
    throw new ChartDataError('系列必须是对象', path);
  }
  if (typeof series.id !== 'string' || series.id.length === 0) {
    throw new ChartDataError('系列 id 必须是非空字符串（更新按 id 合并）', `${path}.id`);
  }
  if (seenIds.has(series.id)) {
    throw new ChartDataError(`系列 id 重复: ${series.id}`, `${path}.id`);
  }
  seenIds.add(series.id);
  if (typeof series.name !== 'string') {
    throw new ChartDataError('系列 name 必须是字符串', `${path}.name`);
  }
  if (!Array.isArray(series.points)) {
    throw new ChartDataError('系列 points 必须是数组', `${path}.points`);
  }
  const points = series.points.map((point, index) => normalizePoint(point, `${path}.points[${index}]`));
  return { id: series.id, name: series.name, points };
}

function normalizePoint(point: ChartPoint, path: string): ChartPoint {
  if (!point || typeof point !== 'object') {
    throw new ChartDataError('数据点必须是对象', path);
  }
  if (typeof point.x !== 'string' && typeof point.x !== 'number') {
    throw new ChartDataError('数据点 x 必须是字符串或数值', `${path}.x`);
  }
  if (point.y !== null && (typeof point.y !== 'number' || Number.isNaN(point.y))) {
    throw new ChartDataError('数据点 y 必须是数值或 null（null 表示缺失，禁止写成 0）', `${path}.y`);
  }
  return { x: point.x, y: point.y };
}

/** 按首次出现顺序收集全部系列的类目轴，保证多系列对齐且顺序稳定。 */
export function collectCategories(data: ChartData): (string | number)[] {
  const categories: (string | number)[] = [];
  const seen = new Set<string>();
  for (const series of data.series) {
    for (const point of series.points) {
      const key = categoryKey(point.x);
      if (!seen.has(key)) {
        seen.add(key);
        categories.push(point.x);
      }
    }
  }
  return categories;
}

/** 将系列数值对齐到共享类目轴；该类目无数据时为 null（缺失），不补 0。 */
export function alignSeriesValues(
  series: ChartSeries,
  categories: (string | number)[],
): (number | null)[] {
  const position = new Map<string, number>();
  categories.forEach((category, index) => position.set(categoryKey(category), index));
  const values: (number | null)[] = categories.map(() => null);
  for (const point of series.points) {
    const index = position.get(categoryKey(point.x));
    if (index !== undefined) {
      values[index] = point.y;
    }
  }
  return values;
}

function categoryKey(x: string | number): string {
  return `${typeof x}:${String(x)}`;
}
