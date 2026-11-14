import { defineConfig } from 'vitest/config';

// Explicit acceptance suite; missing actual frozen inputs is an error, never a skip.
export default defineConfig({ test: {
  include: ['tests/acceptance/installed-compatibility.spec.ts'],
  environment: 'node', fileParallelism: false, testTimeout: 240_000, hookTimeout: 60_000,
} });
