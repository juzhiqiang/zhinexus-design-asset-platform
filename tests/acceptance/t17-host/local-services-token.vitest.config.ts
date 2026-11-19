import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/acceptance/t17-host/local-services-token.spec.ts'],
    environment: 'node',
    fileParallelism: false,
    hookTimeout: 240_000,
  },
});
