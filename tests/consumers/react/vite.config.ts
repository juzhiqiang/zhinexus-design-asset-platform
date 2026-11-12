import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: 'index.html',
        bar: 'bar.html',
        pie: 'pie.html',
        scatter: 'scatter.html',
        'trend-card': 'trend-card.html',
      },
    },
  },
});
