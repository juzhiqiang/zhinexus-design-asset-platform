import { useImperativeHandle, useRef } from 'react';
import { useChart } from './useChart.js';
import type { PieChartHandle, PieChartProps } from './pie-chart.types.js';

/**
 * 饼图 / 环形图组件：数据与事件语义共享自 `@company/charts-core`。
 * 容器类名固定为 `charts-pie`，需要明确宽高（宿主 CSS 或 `config.width/height`）。
 */
export function PieChart({
  data,
  config,
  optionOverrides,
  onPointClick,
  className,
  style,
  ref,
}: PieChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const { whenRendered } = useChart({
    host: hostRef,
    data,
    config,
    optionOverrides,
    onPointClick,
    chart: 'pie',
  });
  useImperativeHandle(
    ref,
    () => ({ whenRendered }),
    [whenRendered],
  );
  return (
    <div
      ref={hostRef}
      className={className ? `charts-pie ${className}` : 'charts-pie'}
      style={style}
    />
  );
}
