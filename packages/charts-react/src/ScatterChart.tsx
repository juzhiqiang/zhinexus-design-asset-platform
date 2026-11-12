import { useImperativeHandle, useRef } from 'react';
import { useChart } from './useChart.js';
import type { ScatterChartHandle, ScatterChartProps } from './scatter-chart.types.js';

/**
 * 散点图组件：数据与事件语义共享自 `@company/charts-core`。
 * 容器类名固定为 `charts-scatter`，需要明确宽高（宿主 CSS 或 `config.width/height`）。
 */
export function ScatterChart({
  data,
  config,
  optionOverrides,
  onPointClick,
  className,
  style,
  ref,
}: ScatterChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const { whenRendered } = useChart({
    host: hostRef,
    data,
    config,
    optionOverrides,
    onPointClick,
    chart: 'scatter',
  });
  useImperativeHandle(
    ref,
    () => ({ whenRendered }),
    [whenRendered],
  );
  return (
    <div
      ref={hostRef}
      className={className ? `charts-scatter ${className}` : 'charts-scatter'}
      style={style}
    />
  );
}
