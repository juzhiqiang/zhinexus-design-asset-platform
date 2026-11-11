<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  LineChart,
  getVueRuntimeInfo,
  type ChartData,
  type ChartEvent,
  type LineChartConfig,
} from '@company/charts-vue';
import lineFixture from '../../fixtures/line.json';
import {
  createExampleRuntime,
  createExampleTestHook,
  installPageErrorCollector,
} from './example/runtime.js';

const states = Object.keys(lineFixture.states);
const expectedSeriesIds: Record<string, readonly string[]> = {};
for (const name of states) {
  expectedSeriesIds[name] = lineFixture.states[name as keyof typeof lineFixture.states].expectedSeriesIds;
}

const stateName = ref(states[0] ?? 'default');
const data = computed<ChartData>(
  () => lineFixture.states[stateName.value as keyof typeof lineFixture.states].data as ChartData,
);
const config: LineChartConfig = { theme: 'light', renderer: 'canvas', animation: false };

const clicks = ref<ChartEvent[]>([]);
const chartRef = ref<{ whenRendered: () => Promise<void> } | null>(null);

function onPointClick(event: ChartEvent): void {
  clicks.value = [...clicks.value, event];
}

installPageErrorCollector();

const { example } = createExampleRuntime({
  states,
  expectedSeriesIds,
  applyStateData: (name) => {
    stateName.value = name;
  },
  whenRendered: () => chartRef.value?.whenRendered() ?? Promise.resolve(),
  renderer: 'canvas',
});

onMounted(() => {
  window.__COMPONENT_EXAMPLE__ = example;
  window.__COMPONENT_EXAMPLE_TEST__ = createExampleTestHook({
    getClicks: () => clicks.value,
    clearClicks: () => {
      clicks.value = [];
    },
  });
});
</script>

<template>
  <main>
    <h1>Vue 折线图示例</h1>
    <p>消费工作区内的 @company/charts-vue；同一数据与事件语义在 React 示例中对等实现。</p>
    <div class="toolbar">
      <button
        v-for="name in states"
        :key="name"
        type="button"
        :class="{ active: name === stateName }"
        :data-testid="`state-${name}`"
        @click="example.runState(name)"
      >
        {{ name }}
      </button>
    </div>
    <div class="chart-frame">
      <LineChart ref="chartRef" :data="data" :config="config" @point-click="onPointClick" />
    </div>
    <section class="clicks">
      <h2>点击载荷</h2>
      <pre data-testid="click-log">{{ JSON.stringify(clicks, null, 2) }}</pre>
    </section>
    <footer>
      <pre data-testid="runtime-info">{{ JSON.stringify(getVueRuntimeInfo(), null, 2) }}</pre>
    </footer>
  </main>
</template>

<style>
body { font-family: system-ui, sans-serif; margin: 24px; color: #263044; }
.toolbar { display: flex; gap: 8px; margin-bottom: 16px; }
.toolbar button { padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; cursor: pointer; }
.toolbar button.active { border-color: #3b82f6; color: #1d4ed8; }
.chart-frame { width: 720px; height: 360px; border: 1px solid #e2e8f0; }
.clicks pre { background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; }
footer pre { color: #64748b; font-size: 12px; }
</style>
