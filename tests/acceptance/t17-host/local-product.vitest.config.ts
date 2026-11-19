import { defineConfig } from 'vitest/config';

/** Local product-level T17 owned-host end-to-end acceptance (independent reference baselines + pass + repair chains). */
export default defineConfig({
  test: {
    include: ['tests/acceptance/t17-host/local-product.spec.ts'],
    environment: 'node',
    fileParallelism: false,
    // Full dependency inventories and owned cleanup need room for concurrent Windows I/O.
    testTimeout: 1_800_000,
    hookTimeout: 240_000,
  },
});
