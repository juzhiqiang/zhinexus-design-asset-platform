import { defineConfig } from 'vitest/config';
/** Explicit product suite: never discovered by the fast unit-only root configuration. */
export default defineConfig({ test: { include: ['tests/acceptance/t17-matrix/product.spec.ts'], environment: 'node', fileParallelism: false, testTimeout: 7_200_000, hookTimeout: 240_000 } });
