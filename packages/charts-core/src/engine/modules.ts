import { use } from 'echarts/core.js';
import { LineChart } from 'echarts/charts.js';
import { GridComponent, TooltipComponent } from 'echarts/components.js';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers.js';
import type { Renderer } from '../types.js';

/**
 * 按图表入口注册所需模块：折线图 + 坐标轴/提示 + 指定渲染器。
 * ECharts `use` 幂等；只注册当前渲染器，用于验证打包结果的按需加载效果（架构 §6）。
 * T09 增加 bar / pie / scatter 时按同一模式扩展，不预先注册无关图表。
 */
export function ensureLineModules(renderer: Renderer): void {
  use([
    LineChart,
    GridComponent,
    TooltipComponent,
    renderer === 'svg' ? SVGRenderer : CanvasRenderer,
  ]);
}
