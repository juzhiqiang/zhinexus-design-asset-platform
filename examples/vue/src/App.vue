<script setup lang="ts">
import { getVueRuntimeInfo } from '@company/charts-vue';
const runtime = getVueRuntimeInfo();
</script>
<template>
  <main>
    <h1>Vue 工程示例</h1>
    <p>工作区包入口已连接，图表组件待 T02/T03 实现。</p>
    <pre data-testid="runtime-info">{{ JSON.stringify(runtime, null, 2) }}</pre>
  </main>
</template>
<style>
body { font-family: system-ui, sans-serif; margin: 48px; color: #263044; }
</style>
