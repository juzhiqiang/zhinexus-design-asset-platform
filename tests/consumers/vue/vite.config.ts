import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: 'index.html',
        bar: 'bar.html',
        pie: 'pie.html',
        scatter: 'scatter.html',
      },
    },
  },
});
