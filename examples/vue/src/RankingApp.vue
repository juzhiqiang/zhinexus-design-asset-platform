<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  Ranking,
  getVueRuntimeInfo,
  type ChartData,
  type ChartEvent,
  type RankingChartConfig,
} from '@company/charts-vue';
import rankingFixture from '../../fixtures/ranking.json';
import {
  createExampleRuntime,
  createExampleTestHook,
  installPageErrorCollector,
} from './example/runtime.js';

const states = Object.keys(rankingFixture.states);
const expectedSeriesIds: Record<string, readonly string[]> = {};
for (const name of states) {
  expectedSeriesIds[name] = rankingFixture.states[name as keyof typeof rankingFixture.states].expectedSeriesIds;
}

const stateName = ref(states[0] ?? 'default');
const data = computed<ChartData>(
  () => rankingFixture.states[stateName.value as keyof typeof rankingFixture.states].data as ChartData,
);
// 排行榜：横向条形 + 名次标签；排序方向与取前 N 名固定，状态只改数据
const config: RankingChartConfig = {
  chart: 'ranking',
  theme: 'light',
  renderer: 'canvas',
  animation: false,
  title: '热门组件 Top 5',
  direction: 'desc',
  limit: rankingFixture.limit,
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
  renderer: 'canvas',
  hostSelector: '.charts-ranking',
});

onMounted(() => {
  window.__COMPONENT_EXAMPLE__ = example;
  window.__COMPONENT_EXAMPLE_TEST__ = createExampleTestHook({
    getClicks: () => clicks.value,
    clearClicks: () => {
      clicks.value = [];
    },
    hostSelector: '.charts-ranking',
  });
});
</script>

<template>
  <main>
    <h1>Vue 排行榜示例</h1>
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
    <div class="ranking-frame">
      <Ranking ref="chartRef" :data="data" :config="config" @point-click="onPointClick" />
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
