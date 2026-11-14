import { defineConfig } from 'vitest/config';

// Explicit real-service suite: it fails if PostgreSQL or MinIO is unavailable, never silently skips.
export default defineConfig({ test: {
  include: ['tests/platform/**/*.test.ts'], environment: 'node', fileParallelism: false,
  globalSetup: ['tests/platform/global-setup.ts'], setupFiles: ['tests/platform/setup-services.ts'],
  testTimeout: 60_000, hookTimeout: 60_000,
} });
