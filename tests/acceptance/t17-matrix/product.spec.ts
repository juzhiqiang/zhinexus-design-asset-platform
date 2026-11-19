/** Opt-in real frozen-product acceptance. Missing inputs fail; fixture-only tests cannot satisfy it. */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareT17LocalServices } from '../t17-host/local-services.js';
import { runT17ProductDiagnostic, runT17ProductMatrix, runT17ProductPnpmLockDiagnostic } from './product-executor.js';

describe('T17 frozen CLI concrete matrix', () => {
  it('executes owned real product projects and preserves immutable evidence', async () => {
    for (const name of ['T17_HOST_CLI_TARBALL', 'T17_HOST_CLI_SHA256', 'T17_HOST_CLI_VERSION', 'T17_HOST_SDK_BUNDLE', 'T17_HOST_SDK_MANIFEST_SHA256', 'T17_D_COMPATIBILITY_EVIDENCE', 'T17_D_COMPATIBILITY_SHA256']) {
      if (!process.env[name]) throw new Error('Missing concrete product acceptance input: ' + name);
    }
    const services = await prepareT17LocalServices({ sdkBundle: process.env.T17_HOST_SDK_BUNDLE!, evidenceDirectory: await mkdtemp(join(tmpdir(), 'zhinexus-t17-product-services-')),
      compatibilityEvidence: { file: process.env.T17_D_COMPATIBILITY_EVIDENCE!, sha256: process.env.T17_D_COMPATIBILITY_SHA256! } });
    try {
      expect(services.sdkManifestSha256).toBe(process.env.T17_HOST_SDK_MANIFEST_SHA256);
      expect(services.acceptedCompatibilityFile).toBeTruthy();
      const env: Record<string, string | undefined> = { T17_HOST_CLI_TARBALL: process.env.T17_HOST_CLI_TARBALL, T17_HOST_CLI_SHA256: process.env.T17_HOST_CLI_SHA256, T17_HOST_CLI_VERSION: process.env.T17_HOST_CLI_VERSION,
        T17_HOST_SDK_BUNDLE: services.sdkBundle, T17_HOST_SDK_MANIFEST_SHA256: services.sdkManifestSha256, T17_HOST_API_URL: services.apiUrl, T17_HOST_REGISTRY_URL: services.registryUrl,
        T17_HOST_VARIANTS_FILE: services.variantsFile, T17_HOST_VARIANTS_SHA256: services.variantsSha256, ZHINEXUS_API_TOKEN: services.apiToken, ZHINEXUS_REGISTRY_TOKEN: services.registryToken };
      if (process.env.T17_PRODUCT_PNPM_LOCK_DIAGNOSTIC === '1') {
        const result = await runT17ProductPnpmLockDiagnostic({ env, repositoryRoot: resolve(process.cwd()) });
        console.info(JSON.stringify(result));
        expect(result.fixedDenominatorEvaluated).toBe(false);
      } else if (process.env.T17_PRODUCT_DIAGNOSTIC_CASES) {
        const result = await runT17ProductDiagnostic({ env, repositoryRoot: resolve(process.cwd()), caseIds: process.env.T17_PRODUCT_DIAGNOSTIC_CASES.split(',').map(id => id.trim()) });
        console.info(JSON.stringify(result));
        expect(result.fixedDenominatorEvaluated).toBe(false);
        expect(result.results.every(item => item.outcome === 'pass' || item.outcome === 'refused')).toBe(true);
      } else {
        const result = await runT17ProductMatrix({ env, repositoryRoot: resolve(process.cwd()) });
        console.info(JSON.stringify({ evidenceRoot: result.evidenceRoot, sealPath: result.sealPath, matrix: result.matrix, executionErrors: result.executionErrors }));
        expect(result.matrix.positive.total).toBe(20); expect(result.matrix.refusals.total).toBe(13);
        expect(result.matrix.matrixAccepted).toBe(true);
      }
    } finally { await services.close(); }
  }, 7_200_000);
});
