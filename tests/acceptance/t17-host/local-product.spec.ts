/**
 * T17 owned-host 本地产品级端到端实跑入口（Vue + React 双框架 + 独立手写参考基线 + 已知模板故障 repair 链）。
 *
 * 边界：
 * - 缺失冻结 CLI tarball / SHA-256 / 版本号时立即 fail-closed，不跳过、不伪造通过；
 * - 使用 `prepareT17LocalServices` 启动隔离本地 API/Registry，并在 `finally` 中彻底清理；
 * - 先用独立手写直接 SDK 宿主生成并封存参考 PNG 与真实 `EnvironmentV1`，再跑被测冻结 CLI 的
 *   `plan → apply → typecheck/build/click/visual PASS` 及已知模板故障 `failed → repair → passed` 链；
 * - 显式标记 `productionAcceptance: false`，不将临时工程冒充真实业务项目试点。
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareT17LocalServices } from './local-services.js';
import { resolveT17FixedToolchain } from './e2e-config.js';
import {
  generateIndependentReferenceBaselines,
  verifyIndependentReferenceBaselineSeal,
} from './baseline-reference.js';
import { runT17HostAcceptanceChain, verifyHostChainReceipt } from './chain.js';

const DEFAULT_FROZEN_SDK_BUNDLE =
  'D:/project/zhinexus-design-asset-platform/.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3';
const DEFAULT_FROZEN_SDK_MANIFEST_SHA256 =
  '04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1';
const DEFAULT_COMPATIBILITY_EVIDENCE_FILE =
  'D:/project/zhinexus-design-asset-platform/.tools/sdk-label-acceptance-8929ffb81fcf4c90b98352c5f8afbed1/adopt/probe-evidence-adopt.json';
const DEFAULT_COMPATIBILITY_EVIDENCE_SHA256 =
  'c61820814884126a3b8869b69079c7b3c286afd5e26acdd282b94f749c159cc7';

describe('T17 owned-host 本地产品级端到端实跑（独立参考基线 + 双框架通过 + 有限修复链）', () => {
  it('双框架完成独立参考基线 → plan/apply/verify 全通过，并验证已知模板故障 failed → repair → passed', async () => {
    const cliTarball = process.env.T17_HOST_CLI_TARBALL;
    const cliSha256 = process.env.T17_HOST_CLI_SHA256;
    const cliVersion = process.env.T17_HOST_CLI_VERSION;
    if (!cliTarball || !cliSha256 || !cliVersion) {
      throw new Error(
        'Missing required frozen CLI inputs for local-product acceptance: T17_HOST_CLI_TARBALL, T17_HOST_CLI_SHA256, T17_HOST_CLI_VERSION',
      );
    }

    const sdkBundle = process.env.T17_HOST_SDK_BUNDLE ?? DEFAULT_FROZEN_SDK_BUNDLE;
    const expectedManifestSha = process.env.T17_HOST_SDK_MANIFEST_SHA256 ?? DEFAULT_FROZEN_SDK_MANIFEST_SHA256;
    const compatFile = process.env.T17_HOST_COMPAT_EVIDENCE_FILE ?? DEFAULT_COMPATIBILITY_EVIDENCE_FILE;
    const compatSha = process.env.T17_HOST_COMPAT_EVIDENCE_SHA256 ?? DEFAULT_COMPATIBILITY_EVIDENCE_SHA256;
    const repositoryRoot = resolve(process.env.T17_HOST_REPO_ROOT ?? process.cwd());
    const toolchain = resolveT17FixedToolchain(repositoryRoot);
    const serviceEvidenceDir = await mkdtemp(join(tmpdir(), 'zhinexus-t17-local-product-svc-'));

    const services = await prepareT17LocalServices({
      sdkBundle,
      evidenceDirectory: serviceEvidenceDir,
      compatibilityEvidence: {
        file: compatFile,
        sha256: compatSha,
      },
    });

    try {
      expect(services.sdkManifestSha256).toBe(expectedManifestSha);
      expect(services.acceptedCompatibilityFile).toBeTruthy();

      // 1. 独立手写直接 SDK 宿主生成并封存双框架参考 PNG 与真实 EnvironmentV1
      const refBaselines = await generateIndependentReferenceBaselines({
        sdkVersionByFramework: { vue: '0.0.12', react: '0.0.12' },
        registryUrl: services.registryUrl,
        registryToken: services.registryToken,
        toolchain,
        viewport: { width: 800, height: 400 },
        renderer: 'canvas',
        theme: 'light',
      });
      await verifyIndependentReferenceBaselineSeal(refBaselines);

      // 构造仅在内存传递的服务与冻结包输入（显式传入不可枚举的 apiToken / registryToken）
      const chainEnv: Record<string, string | undefined> = {
        T17_HOST_CLI_TARBALL: cliTarball,
        T17_HOST_CLI_SHA256: cliSha256,
        T17_HOST_CLI_VERSION: cliVersion,
        T17_HOST_SDK_BUNDLE: services.sdkBundle,
        T17_HOST_SDK_MANIFEST_SHA256: services.sdkManifestSha256,
        T17_HOST_API_URL: services.apiUrl,
        T17_HOST_REGISTRY_URL: services.registryUrl,
        T17_HOST_VARIANTS_FILE: services.variantsFile,
        T17_HOST_VARIANTS_SHA256: services.variantsSha256,
        ZHINEXUS_API_TOKEN: services.apiToken,
        ZHINEXUS_REGISTRY_TOKEN: services.registryToken,
      };

      // 2. 正向双框架全链：plan → apply → typecheck/build/click/visual PASS
      const passReceipt = await runT17HostAcceptanceChain({
        env: chainEnv,
        repositoryRoot,
        allowBrowser: true,
        visualBaselines: refBaselines.baselines,
        maxRepairAttempts: 2,
      });
      await verifyHostChainReceipt(passReceipt);
      expect(passReceipt.result).toBe('passed');
      expect(passReceipt.productionAcceptance).toBe(false);
      expect(passReceipt.childProcessesCleaned).toBe(true);
      for (const chain of passReceipt.chains) {
        expect(chain.verifyStatus).toBe('passed');
        expect(chain.repairStatus).toBe('not-needed');
        expect(chain.repairAttempts).toBe(0);
        expect(chain.builtImportEvidence).toBeTruthy();
      }

      // 3. 已知生成模板故障受控链：initial verify failed → repair (1..2 次) → passed
      const repairReceipt = await runT17HostAcceptanceChain({
        env: chainEnv,
        repositoryRoot,
        allowBrowser: true,
        visualBaselines: refBaselines.baselines,
        faultLayoutForRepair: {
          vue: 'synthetic-template-fault:stage-1',
          react: 'synthetic-template-fault:stage-1',
        },
        browserAssertions: [
          { kind: 'visible', selector: '[data-testid="ready"]' },
          { kind: 'visible', selector: 'canvas' },
          { kind: 'visible', selector: '[data-layout="grid cell 1"]' },
          { kind: 'text', selector: '[data-testid="event-count"]', value: '1' },
          {
            kind: 'text', selector: '[data-testid="event-payload"]',
            value: '{"seriesId":"revenue","dataIndex":1,"value":["Tuesday",75],"nativeType":"click"}',
          },
        ],
        maxRepairAttempts: 2,
      });
      await verifyHostChainReceipt(repairReceipt);
      expect(repairReceipt.result).toBe('passed');
      expect(repairReceipt.productionAcceptance).toBe(false);
      for (const chain of repairReceipt.chains) {
        expect(chain.verifyStatus).toBe('failed');
        expect(chain.repairStatus).toBe('repaired');
        expect(chain.repairAttempts).toBeGreaterThanOrEqual(1);
        expect(chain.repairAttempts).toBeLessThanOrEqual(2);
      }

      const summaryPath = join(serviceEvidenceDir, 't17-local-product-summary.json');
      const summary = {
        schemaVersion: 1,
        productionAcceptance: false,
        cliVersion,
        cliSha256,
        sdkManifestSha256: services.sdkManifestSha256,
        compatibilityProvenance: 'historical-real-installed-cli-probe-replay',
        acceptedCompatibilityFile: services.acceptedCompatibilityFile,
        compatibilityEvidenceSha256: services.compatibilityEvidenceSha256,
        referenceBaselineEvidenceRoot: refBaselines.evidenceRoot,
        referenceBaselineSealPath: refBaselines.sealPath,
        passChainEvidenceRoot: passReceipt.evidenceRoot,
        passChainReceiptFile: passReceipt.receiptEvidencePath,
        repairChainEvidenceRoot: repairReceipt.evidenceRoot,
        repairChainReceiptFile: repairReceipt.receiptEvidencePath,
      };
      await writeFile(summaryPath, JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
      console.log('T17_LOCAL_PRODUCT_SUMMARY=' + JSON.stringify({ summaryPath, ...summary }));
    } finally {
      await services.close();
    }
  // Full dependency inventories and owned cleanup exceeded the old budget under concurrent Windows I/O.
  }, 1_800_000);
});
