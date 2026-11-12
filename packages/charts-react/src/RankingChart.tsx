import { useImperativeHandle, useRef } from 'react';
import { useChart } from './useChart.js';
import type { RankingHandle, RankingProps } from './ranking-chart.types.js';

/**
 * 排行榜组件：数据与事件语义共享自 `@company/charts-core`。
 * 容器类名固定为 `charts-ranking`，需要明确宽高（宿主 CSS 或 `config.width/height`）。
 */
export function Ranking({
  data,
  config,
  optionOverrides,
  onPointClick,
  className,
  style,
  ref,
}: RankingProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const { whenRendered } = useChart({
    host: hostRef,
    data,
    config,
    optionOverrides,
    onPointClick,
    chart: 'ranking',
  });
  useImperativeHandle(
    ref,
    () => ({ whenRendered }),
    [whenRendered],
  );
  return (
    <div
      ref={hostRef}
      className={className ? `charts-ranking ${className}` : 'charts-ranking'}
      style={style}
    />
  );
}
