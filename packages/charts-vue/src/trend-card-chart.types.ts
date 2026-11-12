import type { TrendCardConfig, ChartData, ChartEvent, SupportedOptionOverrides } from '@company/charts-core';

/**
 * 趋势卡片组件属性（Vue 模板中使用 kebab-case：`:option-overrides`、`@point-click`）。
 * `data` 变化按稳定 series id 增量更新，删除系列不残留；
 * `config.chart` 固定为 `'trend-card'`，作为图表类型联合的判别字段；
 * 点击载荷为 `[类目, 值]`，与折线 / 柱状同构（sparkline 为 line 系列）。
 */
export type TrendCardProps = {
  data: ChartData;
  config?: TrendCardConfig;
  optionOverrides?: SupportedOptionOverrides;
};

/** 趋势卡片事件：与 React `onPointClick` 共用同一 `ChartEvent` 载荷。 */
export type TrendCardEmits = {
  'point-click': [event: ChartEvent];
};

/** 命令式句柄：渲染完成信号，供截图与自动化就绪判定使用。 */
export type TrendCardHandle = {
  whenRendered: () => Promise<void>;
};
