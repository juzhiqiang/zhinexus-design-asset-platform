import { describe, expect, it } from 'vitest';
import {
  ChartDataError,
  alignSeriesValues,
  buildBarOption,
  buildLineOption,
  buildPieOption,
  collectCategories,
  formatPercent,
  formatValue,
  normalizeChartData,
} from '../../packages/charts-core/src/index.js';
import type {
  BarChartConfig,
  ChartData,
  PieChartConfig,
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

/** 饼图单系列：合计 300，占比可整算（120 → 40.0%）。 */
const pieSingle: ChartData = {
  series: [
    {
      id: 'share',
      name: '占比',
      points: [
        { x: '搜索', y: 120 },
        { x: '直投', y: 80 },
        { x: '自然', y: null },
        { x: '合作', y: 100 },
      ],
    },
  ],
};

/** 饼图零总量：全部为 0，任何占比都不可算。 */
const pieZeroTotal: ChartData = {
  series: [
    {
      id: 'share',
      name: '占比',
      points: [
        { x: '搜索', y: 0 },
        { x: '直投', y: 0 },
      ],
    },
  ],
};

/** 饼图多系列：同心嵌套环，外环在前。 */
const pieNested: ChartData = {
  series: [
    {
      id: 'outer',
      name: '外环',
      points: [
        { x: '甲', y: 120 },
        { x: '乙', y: 80 },
      ],
    },
    {
      id: 'inner',
      name: '内环',
      points: [
        { x: 'A', y: 30 },
        { x: 'B', y: 70 },
      ],
    },
  ],
};

function seriesOf(option: unknown): { id: string; type: string; data: unknown[] }[] {
  return (option as { series: { id: string; type: string; data: unknown[] }[] }).series;
}

/** 饼图系列：data 为 { name, value } 对象数组。 */
function pieSeriesOf(option: unknown): {
  id: string;
  type: string;
  radius: unknown;
  data: { name: unknown; value: unknown }[];
}[] {
  return (
    option as {
      series: { id: string; type: string; radius: unknown; data: { name: unknown; value: unknown }[] }[];
    }
  ).series;
}

function radiusOf(option: unknown, index = 0): [string, string] {
  return pieSeriesOf(option)[index]!.radius as [string, string];
}

function axisOf(option: unknown, name: 'xAxis' | 'yAxis'): Record<string, unknown> {
  const axes = option as Record<string, Record<string, unknown>>;
  return axes[name]!;
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

describe('饼图 / 环形图 option 构建', () => {
  it('系列类型为 pie、id 稳定，扇形数据为 { name, value }', () => {
    const option = buildPieOption(pieSingle, { chart: 'pie' });
    expect(pieSeriesOf(option).map((series) => [series.id, series.type])).toEqual([['share', 'pie']]);
    expect(pieSeriesOf(option)[0]?.data).toEqual([
      { name: '搜索', value: 120 },
      { name: '直投', value: 80 },
      { name: '自然', value: null },
      { name: '合作', value: 100 },
    ]);
  });

  it('空数据返回空系列、无图例，不产生 NaN', () => {
    const option = buildPieOption({ series: [] }, { chart: 'pie' });
    expect(pieSeriesOf(option)).toEqual([]);
    expect(JSON.stringify(option)).not.toContain('NaN');
    expect((option as { legend?: unknown }).legend).toBeUndefined();
  });

  it('缺失值保留为 null 而不是 0，且不参与占比分母', () => {
    const option = buildPieOption(pieSingle, { chart: 'pie' });
    const data = pieSeriesOf(option)[0]!.data;
    expect(data[2]).toEqual({ name: '自然', value: null });
    expect(JSON.stringify(data)).not.toContain('null,0');
    // 合计只计非缺失值：120 + 80 + 100 = 300
    const tooltip = (option as { tooltip: { formatter: (params: unknown) => string } }).tooltip;
    expect(tooltip.formatter({ name: '搜索', value: 120 })).toBe('搜索: 120（40.0%）');
    expect(tooltip.formatter({ name: '自然', value: null })).toBe('自然: -');
  });

  it('负值抛出 ChartDataError，path 指向出错点', () => {
    const negative: ChartData = {
      series: [
        {
          id: 'share',
          name: '占比',
          points: [
            { x: '搜索', y: 120 },
            { x: '直投', y: -40 },
          ],
        },
      ],
    };
    expect(() => buildPieOption(negative, { chart: 'pie' })).toThrow(ChartDataError);
    try {
      buildPieOption(negative, { chart: 'pie' });
      expect.unreachable('应当抛出 ChartDataError');
    } catch (error) {
      expect((error as ChartDataError).path).toBe('series[0].points[1].y');
    }
  });

  it('实心饼图内半径为 0，外半径固定 70%', () => {
    const option = buildPieOption(pieSingle, { chart: 'pie' });
    expect(radiusOf(option)).toEqual(['0%', '70%']);
  });

  it('donut 显式为 false 与缺省完全等价', () => {
    // 判据是 `donut === true`：false 不得被当成真值，也不得退化成环形
    const omitted = buildPieOption(pieSingle, { chart: 'pie' });
    const disabled = buildPieOption(pieSingle, { chart: 'pie', donut: false });
    expect(radiusOf(disabled)).toEqual(['0%', '70%']);
    expect(JSON.stringify(disabled)).toBe(JSON.stringify(omitted));
  });

  it('donut 只改变内半径，数据、顺序与图例规则不变', () => {
    const solid = buildPieOption(pieSingle, { chart: 'pie' });
    const ring = buildPieOption(pieSingle, { chart: 'pie', donut: true });
    expect(radiusOf(ring)).toEqual(['35%', '70%']);
    // 除内半径外的语义完全一致
    expect(pieSeriesOf(ring)[0]?.data).toEqual(pieSeriesOf(solid)[0]?.data);
    expect(pieSeriesOf(ring)[0]?.id).toBe(pieSeriesOf(solid)[0]?.id);
    expect((ring as { legend?: unknown }).legend).toBeUndefined();
    expect((solid as { legend?: unknown }).legend).toBeUndefined();
  });

  it('多系列为同心嵌套环，外环在前且各环带宽相等', () => {
    const option = buildPieOption(pieNested, { chart: 'pie' });
    expect(pieSeriesOf(option).map((series) => series.id)).toEqual(['outer', 'inner']);
    expect(radiusOf(option, 0)).toEqual(['35%', '70%']);
    expect(radiusOf(option, 1)).toEqual(['0%', '35%']);
    const ring = buildPieOption(pieNested, { chart: 'pie', donut: true });
    // 内孔 35% 之后剩余 35% 均分两环
    expect(radiusOf(ring, 0)).toEqual(['52.5%', '70%']);
    expect(radiusOf(ring, 1)).toEqual(['35%', '52.5%']);
  });

  it('多系列才渲染图例，单系列不渲染', () => {
    const multi = buildPieOption(pieNested, { chart: 'pie' });
    expect((multi as { legend?: unknown }).legend).toBeDefined();
    const single = buildPieOption(pieSingle, { chart: 'pie' });
    expect((single as { legend?: unknown }).legend).toBeUndefined();
  });

  it('零总量不产出 NaN，占比被省略而不是 NaN%', () => {
    const option = buildPieOption(pieZeroTotal, { chart: 'pie' });
    expect(JSON.stringify(option)).not.toContain('NaN');
    const tooltip = (option as { tooltip: { formatter: (params: unknown) => string } }).tooltip;
    expect(tooltip.formatter({ name: '搜索', value: 0 })).toBe('搜索: 0');
    const label = (pieSeriesOf(option)[0] as unknown as { label: { formatter: (p: unknown) => string } })
      .label;
    expect(label.formatter({ name: '搜索', value: 0 })).toBe('搜索\n0');
  });

  it('正常总量下 tooltip 与标签共用同一占比口径', () => {
    const unit = { suffix: '万元', decimals: 1 };
    const option = buildPieOption(pieSingle, { chart: 'pie', unit });
    const tooltip = (option as { tooltip: { formatter: (params: unknown) => string } }).tooltip;
    const label = (pieSeriesOf(option)[0] as unknown as { label: { formatter: (p: unknown) => string } })
      .label;
    expect(tooltip.formatter({ name: '直投', value: 80 })).toBe('直投: 80.0万元（26.7%）');
    expect(label.formatter({ name: '合作', value: 100 })).toBe('合作\n100.0万元（33.3%）');
    // 缺失值在标签中同样展示缺失符，不展示占比
    expect(label.formatter({ name: '自然', value: null })).toBe('自然\n-');
  });

  it('formatPercent 在总量不可算时返回 null', () => {
    expect(formatPercent(120, 300)).toBe('40.0%');
    expect(formatPercent(80, 300)).toBe('26.7%');
    expect(formatPercent(120, 0)).toBeNull();
    expect(formatPercent(120, -10)).toBeNull();
    expect(formatPercent(null, 300)).toBeNull();
    expect(formatPercent(0, 0)).toBeNull();
  });

  it('optionOverrides 对饼图只合并 tooltip / legend / title', () => {
    const base = buildPieOption(pieNested, { chart: 'pie', theme: 'dark' });
    const patched = buildPieOption(
      pieNested,
      { chart: 'pie', theme: 'dark' },
      {
        tooltip: { trigger: 'item' },
        legend: { orient: 'vertical' },
        title: { text: '构成' },
        grid: { top: 8 },
        xAxis: { data: ['甲'] },
        yAxis: { data: [1] },
        color: ['#ff0000'],
        renderer: 'svg',
      } as unknown as SupportedOptionOverrides,
    );
    expect(patched.tooltip).toMatchObject({ trigger: 'item' });
    expect(patched.legend).toMatchObject({ orient: 'vertical' });
    expect((patched as { title?: { text?: string } }).title).toEqual({ text: '构成' });
    // 坐标轴类字段对饼图无意义，合并不生效
    expect('grid' in patched).toBe(false);
    expect('xAxis' in patched).toBe(false);
    expect('yAxis' in patched).toBe(false);
    // 调色板来自主题，overrides 无法注入；渲染器不属于 option
    expect(patched.color).toEqual(base.color);
    expect('renderer' in patched).toBe(false);
  });

  it('饼图与折线 / 柱状共用同一套数据规范化规则', () => {
    const invalid: ChartData = {
      series: [
        { id: 'a', name: '甲', points: [{ x: 'x', y: 1 }] },
        { id: 'a', name: '甲 again', points: [] },
      ],
    };
    expect(() => buildPieOption(invalid, { chart: 'pie' })).toThrow(ChartDataError);
    expect(() =>
      buildPieOption({ series: [{ id: 'a', name: '甲', points: [{ x: 'x', y: Number.NaN }] }] }, { chart: 'pie' }),
    ).toThrow(ChartDataError);
    // 规范化不修改入参
    const snapshot = JSON.stringify(pieSingle);
    buildPieOption(pieSingle, { chart: 'pie' });
    expect(JSON.stringify(pieSingle)).toBe(snapshot);
  });

  it('无 DOM 环境（SSR 导入）下构建 option 不访问浏览器全局', () => {
    expect(typeof window).toBe('undefined');
    const option = buildPieOption(pieNested, { chart: 'pie', donut: true, theme: 'dark', renderer: 'svg' });
    expect(pieSeriesOf(option)).toHaveLength(2);
  });

  it('饼图配置类型不接受折线 / 柱状专属字段', () => {
    // 编译期约束的类型层断言：PieChartConfig 只有 donut 一个专属字段
    const pie: PieChartConfig = { chart: 'pie', donut: true, unit: { suffix: '%' } };
    expect(pie.chart).toBe('pie');
    const option = buildPieOption(pieSingle, pie);
    expect(radiusOf(option)).toEqual(['35%', '70%']);
  });

  it('同一数据重复构建得到等价 option', () => {
    const first = buildPieOption(pieSingle, { chart: 'pie', donut: true });
    const second = buildPieOption(pieSingle, { chart: 'pie', donut: true });
    expect(serializable(first)).toEqual(serializable(second));
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
