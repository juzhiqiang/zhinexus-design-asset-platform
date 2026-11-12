<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  PieChart,
  getVueRuntimeInfo,
  type ChartData,
  type ChartEvent,
  type PieChartConfig,
} from '@company/charts-vue';
import pieFixture from '../../fixtures/pie.json';
import {
  createExampleRuntime,
  createExampleTestHook,
  installPageErrorCollector,
} from './example/runtime.js';

const states = Object.keys(pieFixture.states);
const expectedSeriesIds: Record<string, readonly string[]> = {};
for (const name of states) {
  expectedSeriesIds[name] = pieFixture.states[name as keyof typeof pieFixture.states].expectedSeriesIds;
}

const stateName = ref(states[0] ?? 'default');
const data = computed<ChartData>(
  () => pieFixture.states[stateName.value as keyof typeof pieFixture.states].data as ChartData,
);
// 每个状态自带 donut：环形图族与实心饼图族（solid-*）只差内半径
const donut = computed<boolean>(
  () => pieFixture.states[stateName.value as keyof typeof pieFixture.states].donut ?? true,
);
const config = computed<PieChartConfig>(() => ({
  chart: 'pie',
  donut: donut.value,
  theme: 'light',
  renderer: 'canvas',
  animation: false,
}));

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
  hostSelector: '.charts-pie',
});

onMounted(() => {
  window.__COMPONENT_EXAMPLE__ = example;
  window.__COMPONENT_EXAMPLE_TEST__ = createExampleTestHook({
    getClicks: () => clicks.value,
    clearClicks: () => {
      clicks.value = [];
    },
    hostSelector: '.charts-pie',
  });
});
</script>

<template>
  <main>
    <h1>Vue 饼图 / 环形图示例</h1>
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
      <PieChart ref="chartRef" :data="data" :config="config" @point-click="onPointClick" />
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
