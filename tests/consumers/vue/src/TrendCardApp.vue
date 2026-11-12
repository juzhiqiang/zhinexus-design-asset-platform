<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { TrendCard } from '@company/charts-vue/trend-card';
import type { ChartData, ChartEvent, TrendCardConfig } from '@company/charts-vue';
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
      id: 'active',
      name: '活跃用户',
      points: [
        { x: '周一', y: 120 },
        { x: '周二', y: 150 },
        { x: '周三', y: 180 },
        { x: '周四', y: 200 },
      ],
    },
  ],
};

const config: TrendCardConfig = {
  chart: 'trend-card',
  theme: 'light',
  renderer: 'canvas',
  animation: false,
  title: '近 7 日活跃用户',
  previousValue: 160,
};

const clicks = ref<ChartEvent[]>([]);

function onPointClick(event: ChartEvent): void {
  clicks.value = [...clicks.value, event];
}

/**
 * 数据点像素坐标：趋势卡片 sparkline 为类目轴折线系列，数据项为数值，
 * 按类目轴取 x、按数值取 y 换算像素，返回符号中心。坐标轴隐藏但坐标系仍注册。
 */
function pointClientPosition(
  seriesIndex: number,
  dataIndex: number,
): { x: number; y: number } | null {
  const host = document.querySelector('.charts-trend-card');
  const instance = host ? getInstanceByDom(host as HTMLElement) : null;
  if (!instance || !host) return null;
  const option = instance.getOption();
  const series = (option.series as { data?: unknown[] }[])[seriesIndex];
  const item = series?.data?.[dataIndex];
  if (typeof item !== 'number') return null;
  const categories = (option.xAxis as { data?: unknown[] }[] | undefined)?.[0]?.data ?? [];
  const rect = host.getBoundingClientRect();
  const x = instance.convertToPixel({ xAxisIndex: 0 }, categories[dataIndex] as string);
  const y = instance.convertToPixel({ yAxisIndex: 0 }, item);
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    Number.isNaN(x) ||
    Number.isNaN(y)
  ) {
    return null;
  }
  return { x: rect.left + x, y: rect.top + y };
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
    const host = document.querySelector('.charts-trend-card');
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
  const host = document.querySelector('.charts-trend-card');
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
    <h1>Vue 消费者：./trend-card</h1>
    <div class="chart-frame">
      <TrendCard :data="data" :config="config" @point-click="onPointClick" />
    </div>
  </main>
</template>
