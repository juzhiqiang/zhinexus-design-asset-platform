/**
 * T17 owned-host 产品级真实 CLI 验收入口（与支架单元测试 *.test.ts 明确分离）。
 *
 * 当冻结 CLI tarball、服务凭据、SDK bundle 或变体映射缺失时，立即 fail-closed 失败，
 * 严禁跳过或用 T16 inspect 冒充 T17 产品级通过。
 */
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { runT17HostAcceptanceChain, verifyHostChainReceipt } from './chain.js';

describe('T17 owned-host 产品级真实 CLI 验收（Vue + React）', () => {
  it('使用冻结 CLI、SDK bundle 与真实本地服务执行双框架 plan → apply → verify/repair 全链并清理子进程', async () => {
    const receipt = await runT17HostAcceptanceChain({
      env: process.env,
      repositoryRoot: resolve(process.cwd()),
      maxRepairAttempts: 2,
      allowBrowser: process.env.T17_HOST_ALLOW_BROWSER === 'true',
    });

    await verifyHostChainReceipt(receipt);
    expect(receipt.result).toBe('passed');
    expect(receipt.productionAcceptance).toBe(false);
    expect(receipt.childProcessesCleaned).toBe(true);
    expect(receipt.chains.map(c => c.framework).sort()).toEqual(['react', 'vue']);
    for (const chain of receipt.chains) {
      expect(chain.planStatus).toBe('planned');
      expect(chain.applyStatus).toBe('applied');
      expect(chain.repairAttempts).toBeLessThanOrEqual(2);
      expect(chain.childProcessesCleaned).toBe(true);
    }
  }, 600_000);
});
