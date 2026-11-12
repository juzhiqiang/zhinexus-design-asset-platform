import { use } from 'echarts/core.js';
import { BarChart, LineChart } from 'echarts/charts.js';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components.js';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers.js';
import type { ChartType, Renderer } from '../types.js';

/**
 * 按图表入口注册所需模块：图表类型 + 坐标轴/提示（柱状图另含图例）+ 指定渲染器。
 * ECharts `use` 幂等；只注册当前渲染器与当前图表类型，用于验证打包结果的按需加载效果（架构 §6）。
 * T09 继续增加 pie / scatter 时按同一模式扩展，不预先注册无关图表。
 */
export function ensureChartModules(chart: ChartType, renderer: Renderer): void {
  const charts = chart === 'bar' ? [BarChart] : [LineChart];
  const components =
    chart === 'bar'
      ? [GridComponent, TooltipComponent, LegendComponent]
      : [GridComponent, TooltipComponent];
  use([...charts, ...components, renderer === 'svg' ? SVGRenderer : CanvasRenderer]);
}
