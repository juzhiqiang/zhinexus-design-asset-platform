<script setup lang="ts">
import { ref } from 'vue';
import {
  LineChart,
  type ChartData,
  type ChartEvent,
  type LineChartConfig,
} from '@company/charts-vue';

defineProps<{ data: ChartData; config: LineChartConfig }>();
const emit = defineEmits<{ 'point-click': [event: ChartEvent] }>();

const chart = ref<{ whenRendered: () => Promise<void> } | null>(null);

function forwardPointClick(event: ChartEvent): void {
  emit('point-click', event);
}

defineExpose({
  whenRendered: () => chart.value?.whenRendered() ?? Promise.resolve(),
});
</script>

<template>
  <section class="chart-frame">
    <LineChart
      ref="chart"
      :data="data"
      :config="config"
      @point-click="forwardPointClick"
    />
  </section>
</template>
