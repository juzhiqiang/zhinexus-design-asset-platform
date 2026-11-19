import { defineConfig } from 'vitest/config';
// A missing frozen artifact, SDK bundle, toolchain, browser, or Docker is a failure, never a skip.
export default defineConfig({ test: { include: ['tests/acceptance/t17-blackbox/live.spec.ts'], environment: 'node', fileParallelism: false,
  globalSetup: ['tests/acceptance/t17-blackbox/global-setup.ts'], testTimeout: 1_800_000, hookTimeout: 600_000 } });
