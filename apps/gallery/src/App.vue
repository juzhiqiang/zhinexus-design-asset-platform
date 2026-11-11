<script setup lang="ts">
import { MANIFEST_SCHEMA_VERSION } from '@company/contracts';
</script>
<template>
  <main>
    <h1>Zhinexus 组件资产平台</h1>
    <p>工程骨架已连接，目录与发布功能待开发。</p>
    <p>协议草案版本：{{ MANIFEST_SCHEMA_VERSION }}</p>
  </main>
</template>
<style>
body { margin: 0; color: #263044; background: #f6f7fa; font-family: system-ui, sans-serif; }
main { max-width: 800px; margin: 64px auto; padding: 24px; }
</style>
