import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/acceptance/t17-blackbox/support.spec.ts'],
    environment: 'node',
    fileParallelism: false,
  },
});
