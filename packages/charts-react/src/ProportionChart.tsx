import { useImperativeHandle, useRef } from 'react';
import { useChart } from './useChart.js';
import type { ProportionHandle, ProportionProps } from './proportion-chart.types.js';

/**
 * 占比组件：数据与事件语义共享自 `@company/charts-core`。
 * 容器类名固定为 `charts-proportion`，需要明确宽高（宿主 CSS 或 `config.width/height`）。
 */
export function Proportion({
  data,
  config,
  optionOverrides,
  onPointClick,
  className,
  style,
  ref,
}: ProportionProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const { whenRendered } = useChart({
    host: hostRef,
    data,
    config,
    optionOverrides,
    onPointClick,
    chart: 'proportion',
  });
  useImperativeHandle(
    ref,
    () => ({ whenRendered }),
    [whenRendered],
  );
  return (
    <div
      ref={hostRef}
      className={className ? `charts-proportion ${className}` : 'charts-proportion'}
      style={style}
    />
  );
}
