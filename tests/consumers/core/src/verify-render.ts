import { createChartController } from '@company/charts-core';
import type { ChartData, ChartEvent, ChartController } from '@company/charts-core';

export function mountTestChart(host: HTMLElement): {
  controller: ChartController;
  whenRendered: () => Promise<void>;
  simulateClick: () => void;
  dispose: () => void;
  getLastClickEvent: () => ChartEvent | null;
} {
  const controller = createChartController(host, {
    renderer: 'canvas',
    theme: 'light',
    animation: false,
  });

  const testData: ChartData = {
    series: [
      {
        id: 'series-alpha',
        name: '测试系列',
        points: [
          { x: '1月', y: 100 },
          { x: '2月', y: 200 },
        ],
      },
    ],
  };

  controller.update(testData);

  let lastClick: ChartEvent | null = null;
  controller.onPointClick((evt: ChartEvent) => {
    lastClick = evt;
  });

  return {
    controller,
    whenRendered: () => controller.whenRendered(),
    simulateClick: () => {
      const instance = controller.getInstance();
      if (instance) {
        instance.trigger('click', {
          componentType: 'series',
          seriesId: 'series-alpha',
          dataIndex: 1,
          name: '2月',
          value: 200,
          type: 'click',
          event: { event: { type: 'pointerdown' } },
        });
      }
    },
    dispose: () => controller.dispose(),
    getLastClickEvent: () => lastClick,
  };
}
