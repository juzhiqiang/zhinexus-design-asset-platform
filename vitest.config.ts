import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

const vitestCacheRoot = join(tmpdir(), 'zhinexus-vitest-cache', 'root');

export default defineConfig({
  // Keep Vite/Vitest caches outside repo node_modules so Next.js 16 Turbopack dev watchers never stall on Windows.
  cacheDir: join(vitestCacheRoot, 'vite'),
  // Next preserves JSX for its own compiler; static gallery tests need executable JSX.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/platform/**'],
    environment: 'node',
    fileParallelism: false,
    fsModuleCachePath: join(vitestCacheRoot, 'modules'),
  },
});
