/**
 * T17 矩阵 vitest 配置：独立于根 suite，用既有运行环境但显式指定目录。
 * 运行命令（.scripts 包装）：
 *   .\scripts\pnpm.ps1 exec vitest run --config tests/acceptance/t17-matrix/vitest.config.ts
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/acceptance/t17-matrix/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 240_000,
  },
});