import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

/**
 * charts-vue 构建：vite 库模式发射 ESM（SFC 由 @vitejs/plugin-vue 编译）。
 * 声明产物由 scripts/build.mjs 中的 vue-tsc 先行生成，因此关闭 outDir 清空。
 */
export default defineConfig({
  // 关闭 prod devtools：避免 SFC 产物携带构建机绝对路径（__file），保证 tarball 可复现
  plugins: [vue({ features: { prodDevtools: false } })],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        line: fileURLToPath(new URL('./src/line.ts', import.meta.url)),
        bar: fileURLToPath(new URL('./src/bar.ts', import.meta.url)),
        pie: fileURLToPath(new URL('./src/pie.ts', import.meta.url)),
        scatter: fileURLToPath(new URL('./src/scatter.ts', import.meta.url)),
        'trend-card': fileURLToPath(new URL('./src/trend-card.ts', import.meta.url)),
        ranking: fileURLToPath(new URL('./src/ranking.ts', import.meta.url)),
        proportion: fileURLToPath(new URL('./src/proportion.ts', import.meta.url)),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: ['vue', /^echarts(\/.*)?$/, '@company/charts-core'],
    },
  },
});
