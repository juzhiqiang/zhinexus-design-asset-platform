<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { PieChart } from '@company/charts-vue/pie';
import type { ChartData, ChartEvent, PieChartConfig } from '@company/charts-vue';
import { getInstanceByDom } from 'echarts/core.js';

type CheckResult = { name: string; status: 'passed' | 'failed'; message?: string };

type ComponentExample = {
  readonly ready: Promise<void>;
  readonly states: readonly string[];
  runState(name: string): Promise<void>;
  getChecks(): CheckResult[];
};

declare global {
  interface Window {
    __CONSUMER_TEST__?: {
      pointClientPosition(seriesIndex: number, dataIndex: number): { x: number; y: number } | null;
      getClicks(): ChartEvent[];
    };
    __COMPONENT_EXAMPLE__?: ComponentExample;
  }
}

const pageErrors: string[] = [];
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    pageErrors.push(event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    pageErrors.push(String(event.reason));
  });
}

const data: ChartData = {
  series: [
    {
      id: 'share',
      name: '占比',
      points: [
        { x: '搜索', y: 120 },
        { x: '直投', y: 80 },
        { x: '自然', y: 60 },
        { x: '合作', y: 100 },
      ],
    },
  ],
};

const config: PieChartConfig = {
  chart: 'pie',
  donut: true,
  theme: 'light',
  renderer: 'canvas',
  animation: false,
};

const clicks = ref<ChartEvent[]>([]);

function onPointClick(event: ChartEvent): void {
  clicks.value = [...clicks.value, event];
}

/** 数据项数值：饼图数据项为 { name, value }。 */
function rawValue(item: unknown): number | null {
  if (typeof item === 'number') {
    return item;
  }
  if (item && typeof item === 'object' && 'value' in item) {
    const value = (item as { value?: unknown }).value;
    return typeof value === 'number' ? value : null;
  }
  return null;
}

/**
 * 数据点像素坐标：有坐标轴时按类目与数值换算（折线 / 柱状），
 * 饼图 / 环形图没有坐标轴，回退到扇形几何中心。
 */
function pointClientPosition(
  seriesIndex: number,
  dataIndex: number,
): { x: number; y: number } | null {
  const host = document.querySelector('.charts-pie');
  const instance = host ? getInstanceByDom(host as HTMLElement) : null;
  if (!instance || !host) return null;
  const option = instance.getOption();
  const series = (option.series as { data?: unknown[] }[])[seriesIndex];
  const value = rawValue(series?.data?.[dataIndex]);
  if (value === null) return null;
  const rect = host.getBoundingClientRect();
  const categories = (option.xAxis as { data?: unknown[] }[] | undefined)?.[0]?.data ?? [];
  const category = categories[dataIndex];
  const x = instance.convertToPixel({ xAxisIndex: 0 }, category as string);
  const y = instance.convertToPixel({ yAxisIndex: 0 }, value);
  if (typeof x === 'number' && typeof y === 'number' && !Number.isNaN(x) && !Number.isNaN(y)) {
    return { x: rect.left + x, y: rect.top + y };
  }
  // 饼图：zrender 显示列表中的 sector 元素按系列顺序、系列内按数据序排列
  type SectorShape = {
    cx: number;
    cy: number;
    r0: number;
    r: number;
    startAngle: number | null;
    endAngle: number | null;
  };
  const sectors = (
    instance.getZr().storage.getDisplayList(false) as unknown as {
      type: string;
      shape?: Partial<SectorShape>;
    }[]
  ).filter((element) => element.type === 'sector' && element.shape != null);
  let offset = 0;
  for (let index = 0; index < seriesIndex; index += 1) {
    offset += ((option.series as { data?: unknown[] }[])[index]?.data ?? []).length;
  }
  const shape = sectors[offset + dataIndex]?.shape;
  if (
    !shape ||
    typeof shape.startAngle !== 'number' ||
    typeof shape.endAngle !== 'number' ||
    typeof shape.cx !== 'number' ||
    typeof shape.cy !== 'number' ||
    typeof shape.r0 !== 'number' ||
    typeof shape.r !== 'number'
  ) {
    return null;
  }
  const midAngle = (shape.startAngle + shape.endAngle) / 2;
  const midRadius = (shape.r0 + shape.r) / 2;
  return {
    x: rect.left + shape.cx + midRadius * Math.cos(midAngle),
    y: rect.top + shape.cy + midRadius * Math.sin(midAngle),
  };
}

let resolveReady: () => void;
const readyPromise = new Promise<void>((resolve) => {
  resolveReady = resolve;
});

async function checkReady(): Promise<void> {
  if (document.fonts) {
    await document.fonts.ready;
  }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const host = document.querySelector('.charts-pie');
    if (host) {
      const rect = host.getBoundingClientRect();
      const instance = getInstanceByDom(host as HTMLElement);
      if (rect.width > 0 && rect.height > 0 && instance) {
        resolveReady();
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  resolveReady();
}

function getChecks(): CheckResult[] {
  const host = document.querySelector('.charts-pie');
  const instance = host ? getInstanceByDom(host as HTMLElement) : null;
  const canvases = host ? host.querySelectorAll('canvas').length : 0;
  const rect = host ? host.getBoundingClientRect() : { width: 0, height: 0 };
  const hasSeries = Boolean(instance && (instance.getOption().series as unknown[])?.length > 0);

  return [
    {
      name: 'single-instance',
      status: instance != null && canvases === 1 ? 'passed' : 'failed',
      message: `instance=${instance != null} canvas=${canvases}`,
    },
    {
      name: 'no-page-error',
      status: pageErrors.length === 0 ? 'passed' : 'failed',
      message: pageErrors.join('; '),
    },
    {
      name: 'valid-dimensions',
      status: rect.width > 0 && rect.height > 0 ? 'passed' : 'failed',
      message: `${rect.width}x${rect.height}`,
    },
    {
      name: 'fonts-ready',
      status: document.fonts.status === 'loaded' ? 'passed' : 'failed',
      message: `font-status=${document.fonts.status}`,
    },
    {
      name: 'series-rendered',
      status: hasSeries ? 'passed' : 'failed',
      message: `hasSeries=${hasSeries}`,
    },
  ];
}

onMounted(() => {
  window.__CONSUMER_TEST__ = { pointClientPosition, getClicks: () => clicks.value };
  window.__COMPONENT_EXAMPLE__ = {
    ready: readyPromise,
    states: ['default'],
    async runState() {
      // 默认状态无额外切换操作
    },
    getChecks,
  };
  checkReady();
});
</script>

<template>
  <main>
    <h1>Vue 消费者：./pie</h1>
    <div class="chart-frame">
      <PieChart :data="data" :config="config" @point-click="onPointClick" />
    </div>
  </main>
</template>
