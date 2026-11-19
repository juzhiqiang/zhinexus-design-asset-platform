import { defineConfig } from 'vitest/config';

/** Isolated unit acceptance for the T17 temporary-host runner; excludes live service and product suites. */
export default defineConfig({
  test: {
    include: ['tests/acceptance/t17-host/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 240_000,
  },
});
