<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  ScatterChart,
  getVueRuntimeInfo,
  type ChartData,
  type ChartEvent,
  type ScatterChartConfig,
} from '@company/charts-vue';
import scatterFixture from '../../fixtures/scatter.json';
import {
  createExampleRuntime,
  createExampleTestHook,
  installPageErrorCollector,
  resolvePresentation,
} from './example/runtime.js';

// 展示配置可由 URL 查询参数覆盖（?theme=dark&renderer=svg），缺省 light + canvas；
// light/dark × Canvas/SVG 矩阵测试与人工核对都靠它，不各自硬编码。
const presentation = resolvePresentation();

const states = Object.keys(scatterFixture.states);
const expectedSeriesIds: Record<string, readonly string[]> = {};
for (const name of states) {
  expectedSeriesIds[name] = scatterFixture.states[name as keyof typeof scatterFixture.states].expectedSeriesIds;
}

const stateName = ref(states[0] ?? 'default');
const data = computed<ChartData>(
  () => scatterFixture.states[stateName.value as keyof typeof scatterFixture.states].data as ChartData,
);
// 散点图：x / y 双数值轴；unit 缺省时不带单位，x 轴同样按无单位格式化
const config: ScatterChartConfig = { chart: 'scatter', theme: presentation.theme, renderer: presentation.renderer, animation: false };

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
  renderer: presentation.renderer,
  hostSelector: '.charts-scatter',
});

onMounted(() => {
  window.__COMPONENT_EXAMPLE__ = example;
  window.__COMPONENT_EXAMPLE_TEST__ = createExampleTestHook({
    getClicks: () => clicks.value,
    clearClicks: () => {
      clicks.value = [];
    },
    hostSelector: '.charts-scatter',
  });
});
</script>

<template>
  <main>
    <h1>Vue 散点图示例</h1>
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
      <ScatterChart ref="chartRef" :data="data" :config="config" @point-click="onPointClick" />
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
