<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  Proportion,
  getVueRuntimeInfo,
  type ChartData,
  type ChartEvent,
  type ProportionChartConfig,
} from '@company/charts-vue';
import proportionFixture from '../../fixtures/proportion.json';
import {
  createExampleRuntime,
  createExampleTestHook,
  installPageErrorCollector,
  resolvePresentation,
} from './example/runtime.js';

// 展示配置可由 URL 查询参数覆盖（?theme=dark&renderer=svg），缺省 light + canvas；
// light/dark × Canvas/SVG 矩阵测试与人工核对都靠它，不各自硬编码。
const presentation = resolvePresentation();

const states = Object.keys(proportionFixture.states);
const expectedSeriesIds: Record<string, readonly string[]> = {};
for (const name of states) {
  expectedSeriesIds[name] = proportionFixture.states[name as keyof typeof proportionFixture.states].expectedSeriesIds;
}

const stateName = ref(states[0] ?? 'default');
const data = computed<ChartData>(
  () => proportionFixture.states[stateName.value as keyof typeof proportionFixture.states].data as ChartData,
);
// 占比：横向条形 + 条末「值（百分比）」标签；条目顺序保持输入顺序，状态只改数据
const config: ProportionChartConfig = {
  chart: 'proportion',
  theme: presentation.theme,
  renderer: presentation.renderer,
  animation: false,
  title: '流量来源占比',
  unit: { suffix: '次' },
};

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
  hostSelector: '.charts-proportion',
});

onMounted(() => {
  window.__COMPONENT_EXAMPLE__ = example;
  window.__COMPONENT_EXAMPLE_TEST__ = createExampleTestHook({
    getClicks: () => clicks.value,
    clearClicks: () => {
      clicks.value = [];
    },
    hostSelector: '.charts-proportion',
  });
});
</script>

<template>
  <main>
    <h1>Vue 占比示例</h1>
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
    <div class="proportion-frame">
      <Proportion ref="chartRef" :data="data" :config="config" @point-click="onPointClick" />
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
