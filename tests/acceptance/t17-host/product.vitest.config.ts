import { defineConfig } from 'vitest/config';

/** Product-level T17 owned-host real CLI acceptance; fails closed when frozen tarball/services/SDK/variants are absent. */
export default defineConfig({
  test: {
    include: ['tests/acceptance/t17-host/product-chain.spec.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 240_000,
  },
});
