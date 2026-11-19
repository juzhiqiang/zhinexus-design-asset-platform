import { defineConfig } from 'vitest/config';

/** Local product-level T17 owned-host end-to-end acceptance (independent reference baselines + pass + repair chains). */
export default defineConfig({
  test: {
    include: ['tests/acceptance/t17-host/local-product.spec.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 900_000,
    hookTimeout: 240_000,
  },
});
