import { useImperativeHandle, useRef } from 'react';
import { useChart } from './useChart.js';
import type { TrendCardHandle, TrendCardProps } from './trend-card-chart.types.js';

/**
 * 趋势卡片组件：数据与事件语义共享自 `@company/charts-core`。
 * 容器类名固定为 `charts-trend-card`，需要明确宽高（宿主 CSS 或 `config.width/height`）。
 */
export function TrendCard({
  data,
  config,
  optionOverrides,
  onPointClick,
  className,
  style,
  ref,
}: TrendCardProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const { whenRendered } = useChart({
    host: hostRef,
    data,
    config,
    optionOverrides,
    onPointClick,
    chart: 'trend-card',
  });
  useImperativeHandle(
    ref,
    () => ({ whenRendered }),
    [whenRendered],
  );
  return (
    <div
      ref={hostRef}
      className={className ? `charts-trend-card ${className}` : 'charts-trend-card'}
      style={style}
    />
  );
}
