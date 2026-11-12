import { use } from 'echarts/core.js';
import { BarChart, LineChart, PieChart } from 'echarts/charts.js';
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components.js';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers.js';
import type { ChartType, Renderer } from '../types.js';

/**
 * 按图表入口注册所需模块：图表类型 + 该图表用到的组件 + 指定渲染器。
 * ECharts `use` 幂等；只注册当前渲染器与当前图表类型，用于验证打包结果的按需加载效果（架构 §6）。
 *
 * 组件集合按图表类型收窄：折线与柱状需要坐标轴网格（柱状另含图例），
 * 饼图 / 环形图没有坐标轴，只注册提示、图例与标题；标题组件供 optionOverrides 的
 * `title` 字段使用（饼图同样支持该覆盖键）。
 */
export function ensureChartModules(chart: ChartType, renderer: Renderer): void {
  const charts =
    chart === 'bar' ? [BarChart] : chart === 'pie' ? [PieChart] : [LineChart];
  const components =
    chart === 'pie'
      ? [TooltipComponent, LegendComponent, TitleComponent]
      : chart === 'bar'
        ? [GridComponent, TooltipComponent, LegendComponent]
        : [GridComponent, TooltipComponent];
  use([...charts, ...components, renderer === 'svg' ? SVGRenderer : CanvasRenderer]);
}
