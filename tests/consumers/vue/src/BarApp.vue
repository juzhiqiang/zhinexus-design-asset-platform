<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { BarChart } from '@company/charts-vue/bar';
import type { BarChartConfig, ChartData, ChartEvent } from '@company/charts-vue';
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

const clicks = ref<ChartEvent[]>([]);

function onPointClick(event: ChartEvent): void {
  clicks.value = [...clicks.value, event];
}

function pointClientPosition(
  seriesIndex: number,
  dataIndex: number,
): { x: number; y: number } | null {
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
}

onMounted(() => {
  window.__CONSUMER_TEST__ = { pointClientPosition, getClicks: () => clicks.value };
});
</script>

<template>
  <main>
    <h1>Vue 消费者：./bar</h1>
    <div class="chart-frame">
      <BarChart :data="data" :config="config" @point-click="onPointClick" />
    </div>
  </main>
</template>
