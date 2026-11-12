import type { CSSProperties, Ref } from 'react';
import type {
  TrendCardConfig,
  ChartData,
  ChartEvent,
  SupportedOptionOverrides,
} from '@company/charts-core';

/**
 * 趋势卡片组件属性。
 * `data` 变化按稳定 series id 增量更新，删除系列不残留；
 * `config.chart` 固定为 `'trend-card'`，作为图表类型联合的判别字段；
 * 点击载荷为 `[类目, 值]`，与折线 / 柱状同构（sparkline 为 line 系列）。
 */
export type TrendCardProps = {
  data: ChartData;
  config?: TrendCardConfig;
  optionOverrides?: SupportedOptionOverrides;
  onPointClick?: (event: ChartEvent) => void;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<TrendCardHandle | null>;
};

/**
 * 命令式句柄：渲染完成信号，供截图与自动化就绪判定使用。
 * 仅在客户端挂载后可用。
 */
export type TrendCardHandle = {
  whenRendered: () => Promise<void>;
};
