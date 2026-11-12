import { useEffect, useRef, useState } from 'react';
import { BarChart } from '@company/charts-react/bar';
import type { BarChartConfig, ChartData, ChartEvent } from '@company/charts-react';
import { getInstanceByDom } from 'echarts/core.js';

declare global {
  interface Window {
    __CONSUMER_TEST__?: {
      pointClientPosition(seriesIndex: number, dataIndex: number): { x: number; y: number } | null;
      getClicks(): ChartEvent[];
    };
  }
}

const data: ChartData = {
  series: [
    {
      id: 'revenue',
      name: '收入',
      points: [
        { x: '周一', y: 120 },
        { x: '周二', y: null },
        { x: '周三', y: -40 },
        { x: '周四', y: 150 },
      ],
    },
  ],
};

const config: BarChartConfig = { chart: 'bar', theme: 'light', renderer: 'canvas', animation: false };

export function BarApp() {
  const [clicks, setClicks] = useState<ChartEvent[]>([]);
  const clicksRef = useRef(clicks);
  clicksRef.current = clicks;

  function onPointClick(event: ChartEvent): void {
    setClicks((previous) => [...previous, event]);
  }

  useEffect(() => {
    window.__CONSUMER_TEST__ = {
      pointClientPosition(seriesIndex, dataIndex) {
        const host = document.querySelector('.charts-bar');
        const instance = host ? getInstanceByDom(host as HTMLElement) : null;
        if (!instance || !host) return null;
        const option = instance.getOption();
        const series = (option.series as { data?: unknown[] }[])[seriesIndex];
        const point = series?.data?.[dataIndex];
        if (point === null || point === undefined) return null;
        const categories = (option.xAxis as { data?: unknown[] }[])[0]?.data ?? [];
        const category = categories[dataIndex];
        const x = instance.convertToPixel({ xAxisIndex: 0 }, category as string);
        const y = instance.convertToPixel({ yAxisIndex: 0 }, point as number);
        if (typeof x !== 'number' || typeof y !== 'number' || Number.isNaN(x) || Number.isNaN(y)) {
          return null;
        }
        const rect = host.getBoundingClientRect();
        return { x: rect.left + x, y: rect.top + y };
      },
      getClicks: () => clicksRef.current,
    };
  }, []);

  return (
    <main>
      <h1>React 消费者：./bar</h1>
      <div className="chart-frame">
        <BarChart data={data} config={config} onPointClick={onPointClick} />
      </div>
    </main>
  );
}
