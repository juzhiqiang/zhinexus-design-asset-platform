import { defineConfig } from 'vitest/config';

// Explicit real-service suite: it fails if PostgreSQL or MinIO is unavailable, never silently skips.
export default defineConfig({ test: {
  include: ['tests/platform/**/*.test.ts'], environment: 'node', fileParallelism: false,
  testTimeout: 60_000, hookTimeout: 60_000,
} });
