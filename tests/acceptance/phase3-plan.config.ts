import { defineConfig } from 'vitest/config';

export default defineConfig({ test: {
  include: ['tests/acceptance/phase3-plan.spec.ts'], environment: 'node', fileParallelism: false,
  globalSetup: ['tests/platform/global-setup.ts'], setupFiles: ['tests/platform/setup-services.ts'],
  testTimeout: 120_000, hookTimeout: 240_000,
} });
