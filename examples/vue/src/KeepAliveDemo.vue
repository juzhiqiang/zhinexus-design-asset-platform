<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { ChartData, ChartEvent, LineChartConfig } from '@company/charts-vue';
import lineFixture from '../../fixtures/line.json';
import ChartPane from './ChartPane.vue';
import {
  createExampleRuntime,
  createExampleTestHook,
  installPageErrorCollector,
} from './example/runtime.js';

type Tab = 'chart' | 'placeholder';

const states = Object.keys(lineFixture.states);
const expectedSeriesIds: Record<string, readonly string[]> = {};
for (const name of states) {
  expectedSeriesIds[name] = lineFixture.states[name as keyof typeof lineFixture.states].expectedSeriesIds;
}

const tab = ref<Tab>('chart');
const stateName = ref(states[0] ?? 'default');
const data = computed<ChartData>(
  () => lineFixture.states[stateName.value as keyof typeof lineFixture.states].data as ChartData,
);
const config: LineChartConfig = { theme: 'light', renderer: 'canvas', animation: false };

const clicks = ref<ChartEvent[]>([]);
const paneRef = ref<{ whenRendered: () => Promise<void> } | null>(null);

function onPointClick(event: ChartEvent): void {
  clicks.value = [...clicks.value, event];
}

function switchTab(next: Tab): void {
  tab.value = next;
}

installPageErrorCollector();

const { example } = createExampleRuntime({
  states,
  expectedSeriesIds,
  applyStateData: (name) => {
    stateName.value = name;
  },
  whenRendered: () => paneRef.value?.whenRendered() ?? Promise.resolve(),
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
    <h1>Vue KeepAlive 生命周期示例</h1>
    <p>折线图位于 KeepAlive 中：切到占位视图即停用（实例与数据保留），切回时 onActivated 恢复尺寸。</p>
    <div class="tabs">
      <button type="button" :class="{ active: tab === 'chart' }" @click="switchTab('chart')">折线图</button>
      <button type="button" :class="{ active: tab === 'placeholder' }" @click="switchTab('placeholder')">占位视图</button>
    </div>
    <KeepAlive>
      <ChartPane
        v-if="tab === 'chart'"
        ref="paneRef"
        :data="data"
        :config="config"
        @point-click="onPointClick"
      />
      <section v-else class="placeholder" data-testid="keepalive-placeholder">
        <p>占位内容：图表已停用，实例与数据仍保留在缓存中。</p>
      </section>
    </KeepAlive>
    <div class="toolbar">
      <button
        v-for="name in states"
        :key="name"
        type="button"
        :class="{ active: name === stateName }"
        @click="example.runState(name)"
      >
        {{ name }}
      </button>
    </div>
  </main>
</template>

<style>
body { font-family: system-ui, sans-serif; margin: 24px; color: #263044; }
.tabs { display: flex; gap: 8px; margin-bottom: 16px; }
.tabs button { padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; cursor: pointer; }
.tabs button.active { border-color: #3b82f6; color: #1d4ed8; }
.chart-frame { width: 720px; height: 360px; border: 1px solid #e2e8f0; }
.placeholder { width: 720px; height: 120px; border: 1px dashed #cbd5e1; display: flex; align-items: center; justify-content: center; color: #64748b; }
.toolbar { display: flex; gap: 8px; margin-top: 16px; }
.toolbar button { padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; cursor: pointer; }
</style>
