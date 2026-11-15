import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Next preserves JSX for its own compiler; static gallery tests need executable JSX.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/platform/**'],
    environment: 'node',
    fileParallelism: false,
  },
});
