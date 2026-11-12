import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  prepareReleaseBundle,
  loadReleaseBundle,
  verifyReleaseBundle,
} from '../../packages/component-cli/src/local/manifest.js';
import { validateReleaseBundle } from '../../packages/component-cli/src/contracts/bundle.js';
import { computeFileSha256 } from '../../packages/component-cli/src/local/digest.js';
import { runCli } from '../../packages/component-cli/src/cli.js';

describe('T04: prepare release bundle and end-to-end frozen materials verification', () => {
  it(
    'generates a real, frozen release bundle covering line and bar components in vue and react',
    async () => {
      const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-release-bundle-'));
      try {
        const result = await prepareReleaseBundle({
          bundleDir,
          components: ['line', 'bar'],
          frameworks: ['vue', 'react'],
          timeoutMs: 30_000,
        });

        expect(result.ok).toBe(true);
        expect(result.manifest.schemaVersion).toBe(1);
        expect(result.manifest.channel).toBe('cli');

        // 1. 验证待发布包集合：charts-core, charts-vue, charts-react
        const packageNames = result.manifest.packages.map((p) => p.name);
        expect(packageNames).toContain('@company/charts-core');
        expect(packageNames).toContain('@company/charts-vue');
        expect(packageNames).toContain('@company/charts-react');

        // 每个包的 tarball 真实存在于 bundleDir/packages
        for (const pkg of result.manifest.packages) {
          const tarballDiskPath = path.join(bundleDir, pkg.tarball.path);
          expect(fs.existsSync(tarballDiskPath)).toBe(true);
          const actualSha = await computeFileSha256(tarballDiskPath);
          expect(actualSha).toBe(pkg.tarball.sha256);
          expect(fs.statSync(tarballDiskPath).size).toBe(pkg.tarball.bytes);
        }

        // 2. 验证变体覆盖：共 4 个变体（line-vue, line-react, bar-vue, bar-react）
        const variantIds = result.manifest.variants.map((v) => v.variantId);
        expect(variantIds).toEqual(
          expect.arrayContaining(['line-vue', 'line-react', 'bar-vue', 'bar-react']),
        );
        expect(result.manifest.variants.length).toBe(4);

        for (const variant of result.manifest.variants) {
          // 必需状态 default 必须有自动截图证据
          expect(variant.screenshots.length).toBeGreaterThanOrEqual(1);
          const defaultShot = variant.screenshots.find((s) => s.state === 'default');
          expect(defaultShot).toBeDefined();
          expect(defaultShot?.source).toBe('local-automatic');
          expect(defaultShot?.framework).toBe(variant.framework);
          expect(defaultShot?.variantId).toBe(variant.variantId);

          // 截图文件真实存在于 bundle 目录
          const shotDiskPath = path.join(bundleDir, defaultShot!.image.path);
          expect(fs.existsSync(shotDiskPath)).toBe(true);
          const actualShotSha = await computeFileSha256(shotDiskPath);
          expect(actualShotSha).toBe(defaultShot!.image.sha256);

          // 兼容性记录状态为 passed
          expect(variant.compatibility.length).toBeGreaterThanOrEqual(1);
          const passedCompat = variant.compatibility.find((c) => c.status === 'passed');
          expect(passedCompat).toBeDefined();
          if (variant.framework === 'react') {
            expect(passedCompat?.reactDomVersion).toBe('19.3.1');
          }

          // API 与 Docs 真实存在
          expect(fs.existsSync(path.join(bundleDir, variant.api.path))).toBe(true);
          expect(fs.existsSync(path.join(bundleDir, variant.docs.path))).toBe(true);
        }

        // 3. 验证完整报告清单
        expect(result.manifest.reports.length).toBe(4);
        for (const repRef of result.manifest.reports) {
          const repDiskPath = path.join(bundleDir, repRef.path);
          expect(fs.existsSync(repDiskPath)).toBe(true);
          const repJson = JSON.parse(fs.readFileSync(repDiskPath, 'utf8'));
          expect(repJson.baselineResult).toBe('NEW');
        }

        // 4. 验证完整文件清单 files
        expect(result.manifest.files.length).toBeGreaterThanOrEqual(15);
        for (const fileRef of result.manifest.files) {
          const diskPath = path.join(bundleDir, fileRef.path);
          expect(fs.existsSync(diskPath), `文件遗漏: ${fileRef.path}`).toBe(true);
          const actualSha = await computeFileSha256(diskPath);
          expect(actualSha).toBe(fileRef.sha256);
          expect(fs.statSync(diskPath).size).toBe(fileRef.bytes);
        }

        // 5. 校验 bundle 自检结果
        const verifyResult = await verifyReleaseBundle(bundleDir);
        expect(verifyResult.ok).toBe(true);

        // 6. 故障注入与防篡改验证
        const { manifest, filesMap } = await loadReleaseBundle(bundleDir);

        // 6.1 缺图必须失败 (SCREENSHOT_REQUIRED)
        const tamperedNoScreenshot = structuredClone(manifest);
        tamperedNoScreenshot.variants[0]!.screenshots = [];
        const checkNoScreenshot = await validateReleaseBundle(tamperedNoScreenshot, filesMap);
        expect(checkNoScreenshot.ok).toBe(false);
        if (!checkNoScreenshot.ok) {
          expect(checkNoScreenshot.issues.some((i) => i.code === 'SCREENSHOT_REQUIRED')).toBe(true);
        }

        // 6.2 错配框架必须失败 (SCREENSHOT_VARIANT_MISMATCH)
        const tamperedMismatchFramework = structuredClone(manifest);
        const reactVariant = tamperedMismatchFramework.variants.find((v) => v.framework === 'react')!;
        const vueShot = tamperedMismatchFramework.variants.find((v) => v.framework === 'vue')!.screenshots[0]!;
        reactVariant.screenshots = [vueShot];
        const checkMismatch = await validateReleaseBundle(tamperedMismatchFramework, filesMap);
        expect(checkMismatch.ok).toBe(false);
        if (!checkMismatch.ok) {
          expect(checkMismatch.issues.some((i) => i.code === 'SCREENSHOT_VARIANT_MISMATCH')).toBe(true);
        }

        // 6.3 篡改 tarball 字节必须失败 (DIGEST_MISMATCH)
        const tamperedFiles = new Map(filesMap);
        const coreTarballPath = manifest.packages.find((p) => p.name === '@company/charts-core')!.tarball.path;
        const originalBytes = tamperedFiles.get(coreTarballPath)!;
        const mutatedBytes = new Uint8Array(originalBytes);
        mutatedBytes[mutatedBytes.length - 1] = mutatedBytes[mutatedBytes.length - 1]! ^ 0xff;
        tamperedFiles.set(coreTarballPath, mutatedBytes);

        const checkTarballTampered = await validateReleaseBundle(manifest, tamperedFiles);
        expect(checkTarballTampered.ok).toBe(false);
        if (!checkTarballTampered.ok) {
          expect(checkTarballTampered.issues.some((i) => i.code === 'DIGEST_MISMATCH')).toBe(true);
        }

        // 6.4 清单外意外文件必须失败 (UNEXPECTED_FILE)
        const unexpectedFiles = new Map(filesMap);
        unexpectedFiles.set('unlisted-malicious-file.sh', new TextEncoder().encode('echo pwn'));
        const checkUnexpected = await validateReleaseBundle(manifest, unexpectedFiles);
        expect(checkUnexpected.ok).toBe(false);
        if (!checkUnexpected.ok) {
          expect(checkUnexpected.issues.some((i) => i.code === 'UNEXPECTED_FILE')).toBe(true);
        }

        // 6.5 清单内文件丢失必须失败 (FILE_REQUIRED)
        const missingFiles = new Map(filesMap);
        missingFiles.delete(manifest.files[0]!.path);
        const checkMissing = await validateReleaseBundle(manifest, missingFiles);
        expect(checkMissing.ok).toBe(false);
        if (!checkMissing.ok) {
          expect(checkMissing.issues.some((i) => i.code === 'FILE_REQUIRED')).toBe(true);
        }
      } finally {
        fs.rmSync(bundleDir, { recursive: true, force: true });
      }
    },
    240_000,
  );

  it('rejects unknown arguments in CLI prepare-release with exit code 1', async () => {
    const result = await runCli(['prepare-release', '--unknown-flag'], '0.0.1');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('未知参数 --unknown-flag');
  });

  it('rejects invalid framework argument in CLI prepare-release with exit code 1', async () => {
    const result = await runCli(['prepare-release', '--framework', 'invalid'], '0.0.1');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--framework 仅支持 vue、react 或 all');
  });
});
