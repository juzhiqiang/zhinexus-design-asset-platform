import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

const vitestCacheRoot = join(tmpdir(), 'zhinexus-vitest-cache', 't17-host');

/** Isolated unit acceptance for the T17 temporary-host runner; excludes live service and product suites. */
export default defineConfig({
  cacheDir: join(vitestCacheRoot, 'vite'),
  test: {
    include: ['tests/acceptance/t17-host/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 240_000,
    fsModuleCachePath: join(vitestCacheRoot, 'modules'),
  },
});
