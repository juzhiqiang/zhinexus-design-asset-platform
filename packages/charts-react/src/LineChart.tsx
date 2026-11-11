import { useImperativeHandle, useRef } from 'react';
import { useChart } from './useChart.js';
import type { LineChartHandle, LineChartProps } from './line-chart.types.js';

/**
 * 折线图组件：数据与事件语义共享自 `@company/charts-core`。
 * 容器类名固定为 `charts-line`，需要明确宽高（宿主 CSS 或 `config.width/height`）。
 */
export function LineChart({
  data,
  config,
  optionOverrides,
  onPointClick,
  className,
  style,
  ref,
}: LineChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const { whenRendered } = useChart({ host: hostRef, data, config, optionOverrides, onPointClick });
  useImperativeHandle(
    ref,
    () => ({ whenRendered }),
    [whenRendered],
  );
  return (
    <div
      ref={hostRef}
      className={className ? `charts-line ${className}` : 'charts-line'}
      style={style}
    />
  );
}
