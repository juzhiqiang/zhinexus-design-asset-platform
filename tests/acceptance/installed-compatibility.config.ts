import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

const vitestCacheRoot = join(tmpdir(), 'zhinexus-vitest-cache', 'installed-compatibility');

// Explicit acceptance suite; missing actual frozen inputs is an error, never a skip.
export default defineConfig({
  cacheDir: join(vitestCacheRoot, 'vite'),
  test: {
    include: ['tests/acceptance/installed-compatibility.spec.ts'],
    environment: 'node', fileParallelism: false, testTimeout: 240_000, hookTimeout: 60_000,
    fsModuleCachePath: join(vitestCacheRoot, 'modules'),
  },
});
