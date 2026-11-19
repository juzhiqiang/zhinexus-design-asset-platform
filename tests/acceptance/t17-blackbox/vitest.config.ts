import { defineConfig } from 'vitest/config';

// T17-D 独立黑盒：只消费仓外安装的冻结 CLI tarball 与真实本地服务，不导入产品源码。
// 调用示例（显式给出冻结包与环境）：见 tests/acceptance/t17-blackbox/README.md 与
// docs/verification/t17-blackbox-2026-11-19.md。缺失冻结包时整套用例失败关闭，不 skip。
export default defineConfig({ test: {
  include: ['tests/acceptance/t17-blackbox/installed.spec.ts'], environment: 'node', fileParallelism: false,
  globalSetup: ['tests/acceptance/t17-blackbox/global-setup.ts'], setupFiles: ['tests/platform/setup-services.ts'],
  testTimeout: 1_800_000, hookTimeout: 600_000,
} });
