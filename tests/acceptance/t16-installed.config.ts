import { defineConfig } from 'vitest/config';

export default defineConfig({ test: {
  include: ['tests/acceptance/t16-installed.spec.ts'], environment: 'node', fileParallelism: false,
  globalSetup: ['tests/acceptance/t16-installed-global-setup.ts'], setupFiles: ['tests/platform/setup-services.ts'],
  testTimeout: 1_200_000, hookTimeout: 300_000,
} });
