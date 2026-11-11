import type { ChartData, ChartEvent, LineChartConfig, SupportedOptionOverrides } from '@company/charts-core';

/**
 * 折线图组件属性（Vue 模板中使用 kebab-case：`:option-overrides`、`@point-click`）。
 * `data` 变化按稳定 series id 增量更新，删除系列不残留。
 */
export type LineChartProps = {
  data: ChartData;
  config?: LineChartConfig;
  optionOverrides?: SupportedOptionOverrides;
};

/** 折线图事件：与 React `onPointClick` 共用同一 `ChartEvent` 载荷。 */
export type LineChartEmits = {
  'point-click': [event: ChartEvent];
};

/** 命令式句柄：渲染完成信号，供截图与自动化就绪判定使用。 */
export type LineChartHandle = {
  whenRendered: () => Promise<void>;
};
