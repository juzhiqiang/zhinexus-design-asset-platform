import type { CSSProperties, Ref } from 'react';
import type {
  RankingChartConfig,
  ChartData,
  ChartEvent,
  SupportedOptionOverrides,
} from '@company/charts-core';

/**
 * 排行榜组件属性。
 * `data` 变化按稳定 series id 增量更新，删除系列不残留；
 * `config.chart` 固定为 `'ranking'`，作为图表类型联合的判别字段；
 * 点击载荷为 `[条目名称, 数值]`，与折线 / 柱状 / 饼图同构（横向条形系列）。
 */
export type RankingProps = {
  data: ChartData;
  config?: RankingChartConfig;
  optionOverrides?: SupportedOptionOverrides;
  onPointClick?: (event: ChartEvent) => void;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<RankingHandle | null>;
};

/**
 * 命令式句柄：渲染完成信号，供截图与自动化就绪判定使用。
 * 仅在客户端挂载后可用。
 */
export type RankingHandle = {
  whenRendered: () => Promise<void>;
};
