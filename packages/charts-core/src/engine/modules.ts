import { use } from 'echarts/core.js';
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts.js';
import {
  GraphicComponent,
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
 * 饼图 / 环形图没有坐标轴，只注册提示、图例与标题；散点图是双数值轴图表，
 * 与柱状图一样注册网格、提示与图例，另注册标题组件供 optionOverrides 的 `title` 字段使用；
 * 趋势卡片是类目轴 sparkline + graphic 数值摘要，注册折线、网格、提示、图例与 graphic 组件。
 */
export function ensureChartModules(chart: ChartType, renderer: Renderer): void {
  const charts =
    chart === 'bar'
      ? [BarChart]
      : chart === 'pie'
        ? [PieChart]
        : chart === 'scatter'
          ? [ScatterChart]
          : chart === 'trend-card'
            ? [LineChart]
            : [LineChart];
  const components =
    chart === 'pie'
      ? [TooltipComponent, LegendComponent, TitleComponent]
      : chart === 'scatter'
        ? [GridComponent, TooltipComponent, LegendComponent, TitleComponent]
        : chart === 'trend-card'
          ? [GridComponent, TooltipComponent, LegendComponent, GraphicComponent]
          : chart === 'bar'
            ? [GridComponent, TooltipComponent, LegendComponent]
            : [GridComponent, TooltipComponent];
  use([...charts, ...components, renderer === 'svg' ? SVGRenderer : CanvasRenderer]);
}
