<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ChartEvent } from '@company/charts-core';
import { useChart } from './useChart.js';
import type { ProportionEmits, ProportionProps } from './proportion-chart.types.js';

const props = defineProps<ProportionProps>();
const emit = defineEmits<ProportionEmits>();

const host = ref<HTMLDivElement | null>(null);
const { whenRendered } = useChart({
  host,
  data: computed(() => props.data),
  config: computed(() => props.config),
  optionOverrides: computed(() => props.optionOverrides),
  onPointClick: (event: ChartEvent) => emit('point-click', event),
  chart: 'proportion',
});

defineExpose({ whenRendered });
</script>

<template>
  <div ref="host" class="charts-proportion" />
</template>
