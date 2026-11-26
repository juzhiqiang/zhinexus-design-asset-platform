import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

const vitestCacheRoot = join(tmpdir(), 'zhinexus-vitest-cache', 't17-blackbox');

// T17-D 独立黑盒：只消费仓外安装的冻结 CLI tarball 与真实本地 MCP stdio client，不导入产品源码。
// 缺少冻结包、版本或 Node/npm 输入时整套用例失败关闭，不 skip。
export default defineConfig({
  cacheDir: join(vitestCacheRoot, 'vite'),
  test: {
    include: ['tests/acceptance/t17-blackbox/installed.spec.ts'], environment: 'node', fileParallelism: false,
    globalSetup: ['tests/acceptance/t17-blackbox/global-setup.ts'],
    testTimeout: 1_800_000, hookTimeout: 600_000,
    fsModuleCachePath: join(vitestCacheRoot, 'modules'),
  },
});
