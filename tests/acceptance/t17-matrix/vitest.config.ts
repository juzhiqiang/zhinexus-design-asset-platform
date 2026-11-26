/**
 * T17 矩阵 vitest 配置：独立于根 suite，用既有运行环境但显式指定目录。
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

const vitestCacheRoot = join(tmpdir(), 'zhinexus-vitest-cache', 't17-matrix');

export default defineConfig({
  cacheDir: join(vitestCacheRoot, 'vite'),
  test: {
    include: ['tests/acceptance/t17-matrix/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 240_000,
    fsModuleCachePath: join(vitestCacheRoot, 'modules'),
  },
});
