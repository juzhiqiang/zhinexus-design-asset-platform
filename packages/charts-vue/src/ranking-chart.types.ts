import type { RankingChartConfig, ChartData, ChartEvent, SupportedOptionOverrides } from '@company/charts-core';

/**
 * 排行榜组件属性（Vue 模板中使用 kebab-case：`:option-overrides`、`@point-click`）。
 * `data` 变化按稳定 series id 增量更新，删除系列不残留；
 * `config.chart` 固定为 `'ranking'`，作为图表类型联合的判别字段；
 * 点击载荷为 `[条目名称, 数值]`，与折线 / 柱状 / 饼图同构（横向条形系列）。
 */
export type RankingProps = {
  data: ChartData;
  config?: RankingChartConfig;
  optionOverrides?: SupportedOptionOverrides;
};

/** 排行榜事件：与 React `onPointClick` 共用同一 `ChartEvent` 载荷。 */
export type RankingEmits = {
  'point-click': [event: ChartEvent];
};

/** 命令式句柄：渲染完成信号，供截图与自动化就绪判定使用。 */
export type RankingHandle = {
  whenRendered: () => Promise<void>;
};
