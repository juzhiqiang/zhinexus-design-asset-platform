import { describe, expect, it } from 'vitest';
import {
  ChartDataError,
  alignSeriesValues,
  buildBarOption,
  buildLineOption,
  collectCategories,
  formatValue,
  normalizeChartData,
} from '../../packages/charts-core/src/index.js';
import type {
  BarChartConfig,
  ChartData,
  SupportedOptionOverrides,
} from '../../packages/charts-core/src/index.js';

const twoSeries: ChartData = {
  series: [
    {
      id: 'revenue',
      name: '收入',
      points: [
        { x: '周一', y: 120 },
        { x: '周二', y: null },
        { x: '周三', y: 180 },
      ],
    },
    {
      id: 'cost',
      name: '成本',
      points: [
        { x: '周一', y: 40 },
        { x: '周三', y: 60 },
      ],
    },
  ],
};

const withNegative: ChartData = {
  series: [
    {
      id: 'profit',
      name: '利润',
      points: [
        { x: 'Q1', y: 120 },
        { x: 'Q2', y: -40 },
        { x: 'Q3', y: null },
        { x: 'Q4', y: -15 },
      ],
    },
  ],
};

function seriesOf(option: unknown): { id: string; type: string; data: unknown[] }[] {
  return (option as { series: { id: string; type: string; data: unknown[] }[] }).series;
}

function axisOf(option: unknown, name: 'xAxis' | 'yAxis'): Record<string, unknown> {
  return (option as Record<string, Record<string, unknown>>)[name];
}

/** 序列化 option：formatter 为每次构建的新闭包，按可序列化结构比对构建确定性。 */
function serializable(option: unknown): unknown {
  return JSON.parse(JSON.stringify(option)) as unknown;
}

describe('柱状图 option 构建', () => {
  it('类目轴 + 数值轴，系列类型为 bar 且 id 稳定', () => {
    const option = buildBarOption(twoSeries, { chart: 'bar' });
    expect(axisOf(option, 'xAxis').type).toBe('category');
    expect(axisOf(option, 'xAxis').data).toEqual(['周一', '周二', '周三']);
    expect(axisOf(option, 'yAxis').type).toBe('value');
    expect(seriesOf(option).map((series) => [series.id, series.type])).toEqual([
      ['revenue', 'bar'],
      ['cost', 'bar'],
    ]);
  });

  it('类目轴保留边界间距，柱条不贴边', () => {
    const option = buildBarOption(twoSeries, { chart: 'bar' });
    expect(axisOf(option, 'xAxis').boundaryGap).toBe(true);
    // 折线图不使用边界间距，两者语义不得互相污染
    expect(axisOf(buildLineOption(twoSeries), 'xAxis').boundaryGap).toBe(false);
  });

  it('空数据返回空系列与空类目轴，不产生 NaN', () => {
    const option = buildBarOption({ series: [] }, { chart: 'bar' });
    expect(seriesOf(option)).toEqual([]);
    expect(axisOf(option, 'xAxis').data).toEqual([]);
    expect(JSON.stringify(option)).not.toContain('NaN');
    // 空数据不渲染图例
    expect((option as { legend?: unknown }).legend).toBeUndefined();
  });

  it('缺失值保留为 null 而不是 0，对齐后仍为 null', () => {
    const option = buildBarOption(twoSeries, { chart: 'bar' });
    // “周二”只有 revenue 有值，cost 对齐后为缺失；revenue 自身也是缺失
    expect(seriesOf(option)[0]?.data).toEqual([120, null, 180]);
    expect(seriesOf(option)[1]?.data).toEqual([40, null, 60]);
    expect(JSON.stringify(option)).not.toContain('null,0');
  });

  it('负值原样进入系列数据，并渲染在零轴以下', () => {
    const option = buildBarOption(withNegative, { chart: 'bar' });
    expect(seriesOf(option)[0]?.data).toEqual([120, -40, null, -15]);
    // 负值不得被 clamp 成 0，也不得取绝对值
    expect(seriesOf(option)[0]?.data).toContain(-40);
    expect(seriesOf(option)[0]?.data).not.toContain(0);
    // 数值轴由 ECharts 自行处理零轴以下区域，option 层不做裁剪
    expect(axisOf(option, 'yAxis').type).toBe('value');
  });

  it('负值单位格式化一致：tooltip 与坐标轴同一规则', () => {
    const unit = { suffix: '万元', decimals: 1 };
    const option = buildBarOption(withNegative, { chart: 'bar', unit });
    const yAxis = axisOf(option, 'yAxis') as { axisLabel: { formatter: (value: number) => string } };
    const tooltip = (option as { tooltip: { valueFormatter: (value: unknown) => string } }).tooltip;
    expect(yAxis.axisLabel.formatter(-40)).toBe('-40.0万元');
    expect(yAxis.axisLabel.formatter(-40)).toBe(formatValue(-40, unit));
    expect(tooltip.valueFormatter(null)).toBe('-');
    expect(tooltip.valueFormatter(1234.5)).toBe('1,234.5万元');
  });

  it('多系列才渲染图例，单系列不渲染', () => {
    const multi = buildBarOption(twoSeries, { chart: 'bar' });
    expect((multi as { legend?: unknown }).legend).toBeDefined();
    const single = buildBarOption(withNegative, { chart: 'bar' });
    expect((single as { legend?: unknown }).legend).toBeUndefined();
  });

  it('stack 配置透传到同组系列，缺省不堆叠', () => {
    const option = buildBarOption(twoSeries, { chart: 'bar', stack: 'total' });
    expect(seriesOf(option).map((series) => (series as { stack?: string }).stack)).toEqual([
      'total',
      'total',
    ]);
    const plain = buildBarOption(twoSeries, { chart: 'bar' });
    expect(seriesOf(plain).every((series) => (series as { stack?: string }).stack === undefined)).toBe(
      true,
    );
  });

  it('同一数据重复构建得到等价 option', () => {
    const first = buildBarOption(twoSeries, { chart: 'bar', unit: { suffix: '%' } });
    const second = buildBarOption(twoSeries, { chart: 'bar', unit: { suffix: '%' } });
    expect(serializable(first)).toEqual(serializable(second));
  });

  it('optionOverrides 只深层合并不受支持的字段，且不改写主题与渲染器', () => {
    const base = buildBarOption(twoSeries, { chart: 'bar', theme: 'dark' });
    const patched = buildBarOption(
      twoSeries,
      { chart: 'bar', theme: 'dark' },
      {
        grid: { top: 8 },
        tooltip: { trigger: 'item' },
        color: ['#ff0000'],
        renderer: 'svg',
      } as unknown as SupportedOptionOverrides,
    );
    expect(patched.grid).toMatchObject({ top: 8, containLabel: true });
    expect(patched.tooltip).toMatchObject({ trigger: 'item' });
    // 调色板来自主题，overrides 无法注入
    expect(patched.color).toEqual(base.color);
    // 渲染器不属于 option，只能通过 setPresentation 重建
    expect('renderer' in patched).toBe(false);
  });

  it('数据校验与折线图共用同一套规范化规则', () => {
    const invalid: ChartData = {
      series: [
        { id: 'a', name: '甲', points: [{ x: 'x', y: 1 }] },
        { id: 'a', name: '甲 again', points: [] },
      ],
    };
    expect(() => buildBarOption(invalid, { chart: 'bar' })).toThrow(ChartDataError);
    expect(() => buildBarOption({ series: [{ id: 'a', name: '甲', points: [{ x: 'x', y: Number.NaN }] }] }, { chart: 'bar' })).toThrow(
      ChartDataError,
    );
    // 规范化不修改入参
    const snapshot = JSON.stringify(twoSeries);
    buildBarOption(twoSeries, { chart: 'bar' });
    expect(JSON.stringify(twoSeries)).toBe(snapshot);
  });

  it('无 DOM 环境（SSR 导入）下构建 option 不访问浏览器全局', () => {
    expect(typeof window).toBe('undefined');
    const option = buildBarOption(twoSeries, { chart: 'bar', theme: 'dark', renderer: 'svg' });
    expect(seriesOf(option)).toHaveLength(2);
  });

  it('共享数据工具对柱状图同样可用且顺序稳定', () => {
    const normalized = normalizeChartData(twoSeries);
    expect(collectCategories(normalized)).toEqual(['周一', '周二', '周三']);
    expect(alignSeriesValues(normalized.series[1]!, ['周一', '周二', '周三'])).toEqual([40, null, 60]);
  });

  it('柱状图配置类型不兼容折线图专属字段', () => {
    // 编译期约束的类型层断言：BarChartConfig 不接受 smooth / area / connectNulls
    const bar: BarChartConfig = { chart: 'bar', stack: 'total', xAxisName: '月份', yAxisName: '金额' };
    expect(bar.chart).toBe('bar');
    const option = buildBarOption(twoSeries, bar);
    expect(axisOf(option, 'xAxis').name).toBe('月份');
    expect(axisOf(option, 'yAxis').name).toBe('金额');
  });
});

describe('折线图 option 无回归', () => {
  it('折线图仍为 line 系列、无边界间距、无柱状图专属字段', () => {
    const option = buildLineOption(twoSeries, { smooth: true, area: true, connectNulls: true });
    expect(seriesOf(option).map((series) => series.type)).toEqual(['line', 'line']);
    expect(axisOf(option, 'xAxis').boundaryGap).toBe(false);
    expect(seriesOf(option).every((series) => (series as { stack?: string }).stack === undefined)).toBe(
      true,
    );
    expect((option as { legend?: unknown }).legend).toBeUndefined();
  });

  it('折线图与柱状图共享同一数据时类目轴一致', () => {
    const line = buildLineOption(twoSeries);
    const bar = buildBarOption(twoSeries, { chart: 'bar' });
    expect(axisOf(bar, 'xAxis').data).toEqual(axisOf(line, 'xAxis').data);
  });
});
