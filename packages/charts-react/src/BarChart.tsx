import { useImperativeHandle, useRef } from 'react';
import { useChart } from './useChart.js';
import type { BarChartHandle, BarChartProps } from './bar-chart.types.js';

/**
 * 柱状图组件：数据与事件语义共享自 `@company/charts-core`。
 * 容器类名固定为 `charts-bar`，需要明确宽高（宿主 CSS 或 `config.width/height`）。
 */
export function BarChart({
  data,
  config,
  optionOverrides,
  onPointClick,
  className,
  style,
  ref,
}: BarChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const { whenRendered } = useChart({
    host: hostRef,
    data,
    config,
    optionOverrides,
    onPointClick,
    chart: 'bar',
  });
  useImperativeHandle(
    ref,
    () => ({ whenRendered }),
    [whenRendered],
  );
  return (
    <div
      ref={hostRef}
      className={className ? `charts-bar ${className}` : 'charts-bar'}
      style={style}
    />
  );
}
