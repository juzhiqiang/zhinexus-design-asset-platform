import type { ScatterChartConfig, ChartData, ChartEvent, SupportedOptionOverrides } from '@company/charts-core';

/**
 * 散点图组件属性（Vue 模板中使用 kebab-case：`:option-overrides`、`@point-click`）。
 * `data` 变化按稳定 series id 增量更新，删除系列不残留；
 * `config.chart` 固定为 `'scatter'`，作为图表类型联合的判别字段；
 * 点击载荷为 `[x, y]` 数值对，与折线 / 柱状的 `[类目, 值]` 显式区分。
 */
export type ScatterChartProps = {
  data: ChartData;
  config?: ScatterChartConfig;
  optionOverrides?: SupportedOptionOverrides;
};

/** 散点图事件：与 React `onPointClick` 共用同一 `ChartEvent` 载荷。 */
export type ScatterChartEmits = {
  'point-click': [event: ChartEvent];
};

/** 命令式句柄：渲染完成信号，供截图与自动化就绪判定使用。 */
export type ScatterChartHandle = {
  whenRendered: () => Promise<void>;
};
