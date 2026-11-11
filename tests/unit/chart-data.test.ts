import { describe, expect, it } from 'vitest';
import {
  ChartDataError,
  buildLineOption,
  formatValue,
  normalizeChartData,
} from '../../packages/charts-core/src/index.js';
import type { ChartData, SupportedOptionOverrides } from '../../packages/charts-core/src/index.js';

const twoSeries: ChartData = {
  series: [
    {
      id: 'revenue',
      name: '收入',
      points: [
        { x: '周一', y: 100 },
        { x: '周二', y: null },
        { x: '周三', y: 1234.5 },
      ],
    },
    {
      id: 'cost',
      name: '成本',
      points: [
        { x: '周一', y: 40 },
        { x: '周三', y: 80 },
      ],
    },
  ],
};

function seriesOf(option: unknown): { id: string; data: unknown[] }[] {
  return (option as { series: { id: string; data: unknown[] }[] }).series;
}

describe('图表数据规范化', () => {
  it('保留 null 为缺失值，不改写已有数值', () => {
    expect(normalizeChartData(twoSeries)).toEqual(twoSeries);
    expect(normalizeChartData(twoSeries).series[0]?.points.map((point) => point.y)).toEqual([
      100, null, 1234.5,
    ]);
  });

  it('拒绝重复系列 id', () => {
    const duplicated: ChartData = {
      series: [
        { id: 'a', name: '甲', points: [] },
        { id: 'a', name: '甲 again', points: [] },
      ],
    };
    expect(() => normalizeChartData(duplicated)).toThrow(ChartDataError);
  });

  it('拒绝非法数据点', () => {
    const cases: ChartData[] = [
      { series: [{ id: '', name: '甲', points: [] }] },
      { series: [{ id: 'a', name: '甲', points: [{ x: 'x', y: Number.NaN }] }] },
      { series: [{ id: 'a', name: '甲', points: [{ x: 'x', y: '1' as unknown as number }] }] },
      { series: [{ id: 'a', name: '甲', points: [{ x: undefined as unknown as string, y: 1 }] }] },
      { series: [{ id: 'a', name: '甲', points: 'nope' as unknown as [] }] },
      { series: 'nope' as unknown as ChartData['series'] },
    ];
    for (const invalid of cases) {
      expect(() => normalizeChartData(invalid)).toThrow(ChartDataError);
    }
  });
});

describe('折线图 option 构建', () => {
  it('null 保留为缺失值而不是 0，并支持单位格式化', () => {
    const option = buildLineOption(twoSeries, { unit: { suffix: '%', decimals: 1 } });
    expect(seriesOf(option)[0]?.data).toEqual([100, null, 1234.5]);
    // 第二系列缺少“周二”，对齐后为缺失值而非 0
    expect(seriesOf(option)[1]?.data).toEqual([40, null, 80]);
  });

  it('多系列按首次出现顺序对齐到共享类目轴', () => {
    const option = buildLineOption(twoSeries);
    expect((option as { xAxis: { data: unknown[]; type: string } }).xAxis.data).toEqual([
      '周一', '周二', '周三',
    ]);
    expect((option as { xAxis: { type: string } }).xAxis.type).toBe('category');
  });

  it('系列 id 稳定：同一数据重复构建得到相同 id 与等价 option', () => {
    const first = buildLineOption(twoSeries);
    const second = buildLineOption(twoSeries);
    expect(seriesOf(first).map((series) => series.id)).toEqual(['revenue', 'cost']);
    // formatter 为每次构建的新闭包，按可序列化结构比对构建确定性
    const serializable = (option: unknown) => JSON.parse(JSON.stringify(option)) as unknown;
    expect(serializable(first)).toEqual(serializable(second));
  });

  it('空数据返回空系列而不抛错', () => {
    expect(seriesOf(buildLineOption({ series: [] }))).toEqual([]);
  });

  it('单位格式化一致：tooltip 与坐标轴使用同一规则', () => {
    const unit = { suffix: '%', decimals: 1 };
    const option = buildLineOption(twoSeries, { unit });
    const yAxis = (option as {
      yAxis: { axisLabel: { formatter: (value: number) => string } };
    }).yAxis;
    const tooltip = (option as {
      tooltip: { valueFormatter: (value: unknown) => string };
    }).tooltip;
    expect(yAxis.axisLabel.formatter(1234.5)).toBe(formatValue(1234.5, unit));
    expect(yAxis.axisLabel.formatter(1234.5)).toBe('1,234.5%');
    expect(tooltip.valueFormatter(null)).toBe('-');
    expect(tooltip.valueFormatter(1234.5)).toBe('1,234.5%');
  });

  it('optionOverrides 只深层合并不受支持的字段，且不改写主题与渲染器', () => {
    const base = buildLineOption(twoSeries, { theme: 'dark' });
    const patched = buildLineOption(twoSeries, { theme: 'dark' }, {
      grid: { top: 8 },
      tooltip: { trigger: 'item' },
      color: ['#ff0000'],
      renderer: 'svg',
    } as unknown as SupportedOptionOverrides);
    expect(patched.grid).toMatchObject({ top: 8, containLabel: true });
    expect(patched.tooltip).toMatchObject({ trigger: 'item' });
    // 调色板来自主题，overrides 无法注入
    expect(patched.color).toEqual(base.color);
    // 渲染器不属于 option，只能通过 setPresentation 重建
    expect('renderer' in patched).toBe(false);
  });

  it('无 DOM 环境（SSR 导入）下构建 option 不访问浏览器全局', () => {
    expect(typeof window).toBe('undefined');
    const option = buildLineOption(twoSeries, { theme: 'dark', renderer: 'svg' });
    expect(seriesOf(option)).toHaveLength(2);
  });
});

describe('数值格式化', () => {
  it('缺失值统一展示为 -', () => {
    expect(formatValue(null)).toBe('-');
    expect(formatValue(undefined)).toBe('-');
  });

  it('千分位、小数位与单位后缀确定且不依赖运行 locale', () => {
    expect(formatValue(1234.5, { suffix: '%', decimals: 1 })).toBe('1,234.5%');
    expect(formatValue(1000000)).toBe('1,000,000');
    expect(formatValue(-1234.5, { decimals: 1 })).toBe('-1,234.5');
    expect(formatValue(0, { suffix: '%', decimals: 1 })).toBe('0.0%');
  });
});
