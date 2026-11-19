import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/acceptance/t17-blackbox/preflight.spec.ts'],
    environment: 'node',
    fileParallelism: false,
  },
});
