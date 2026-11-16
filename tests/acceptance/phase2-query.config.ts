import { defineConfig } from 'vitest/config';

// Explicit acceptance: required inputs fail closed; this suite is outside default test globs.
export default defineConfig({ test: {
  include: ['tests/acceptance/component-query-sdk.spec.ts', 'tests/acceptance/component-query-gallery.spec.ts'],
  environment: 'node', fileParallelism: false,
  globalSetup: ['tests/platform/global-setup.ts'], setupFiles: ['tests/platform/setup-services.ts'],
  testTimeout: 120_000, hookTimeout: 120_000,
} });
