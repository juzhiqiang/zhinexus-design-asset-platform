import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      input: {
        index: 'index.html',
        // 框架无关的 charts-core 生命周期夹具入口（T02 浏览器测试使用）
        'core-harness': 'harness.html',
      },
    },
  },
});
