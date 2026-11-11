import type { CSSProperties, Ref } from 'react';
import type {
  ChartData,
  ChartEvent,
  LineChartConfig,
  SupportedOptionOverrides,
} from '@company/charts-core';

/**
 * 折线图组件属性。
 * `data` 变化按稳定 series id 增量更新，删除系列不残留。
 */
export type LineChartProps = {
  data: ChartData;
  config?: LineChartConfig;
  optionOverrides?: SupportedOptionOverrides;
  onPointClick?: (event: ChartEvent) => void;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<LineChartHandle | null>;
};

/**
 * 命令式句柄：渲染完成信号，供截图与自动化就绪判定使用。
 * 仅在客户端挂载后可用。
 */
export type LineChartHandle = {
  whenRendered: () => Promise<void>;
};
