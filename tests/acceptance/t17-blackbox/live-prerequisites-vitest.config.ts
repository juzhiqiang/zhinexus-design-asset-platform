import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/acceptance/t17-blackbox/live-prerequisites.spec.ts'], environment: 'node', fileParallelism: false, testTimeout: 300_000, hookTimeout: 120_000 } });
