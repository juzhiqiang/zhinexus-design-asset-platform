import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/acceptance/t17-blackbox/live-support.test.ts'], environment: 'node', fileParallelism: false } });
