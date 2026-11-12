import type { CSSProperties, Ref } from 'react';
import type {
  PieChartConfig,
  ChartData,
  ChartEvent,
  SupportedOptionOverrides,
} from '@company/charts-core';

/**
 * 饼图 / 环形图组件属性。
 * `data` 变化按稳定 series id 增量更新，删除系列不残留；
 * `config.chart` 固定为 `'pie'`，作为图表类型联合的判别字段；
 * `config.donut` 只改变内半径语义（环形图），不影响数据与占比口径。
 */
export type PieChartProps = {
  data: ChartData;
  config?: PieChartConfig;
  optionOverrides?: SupportedOptionOverrides;
  onPointClick?: (event: ChartEvent) => void;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<PieChartHandle | null>;
};

/**
 * 命令式句柄：渲染完成信号，供截图与自动化就绪判定使用。
 * 仅在客户端挂载后可用。
 */
export type PieChartHandle = {
  whenRendered: () => Promise<void>;
};
