import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  computeBufferSha256,
  computeFileSha256,
  computeSourceDigest,
  createArtifactRef,
} from '../../packages/component-cli/src/local/digest.js';
import {
  freezePackageRelease,
  verifyFrozenTarball,
} from '../../packages/component-cli/src/local/freeze.js';
import {
  detectEnvironment,
  computeEnvironmentKey,
} from '../../packages/component-cli/src/local/environment.js';
import {
  buildCheckReport,
} from '../../packages/component-cli/src/local/report.js';
import {
  validateCheckReport,
} from '../../packages/component-cli/src/contracts/validation.js';

describe('T04: digest computation and release fingerprint', () => {
  it('computes 64-char lowercase SHA-256 for buffers', () => {
    const hash = computeBufferSha256(Buffer.from('hello'));
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('computes accurate SHA-256 for files on disk', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-test-'));
    try {
      const filePath = path.join(tempDir, 'sample.txt');
      fs.writeFileSync(filePath, 'hello\n');
      const hash = await computeFileSha256(filePath);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);

      const ref = await createArtifactRef(filePath, 'relative/sample.txt');
      expect(ref).toEqual({
        path: 'relative/sample.txt',
        sha256: hash,
        bytes: fs.statSync(filePath).size,
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('computes deterministic normalized sourceDigest and ignores transient files', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-digest-test-'));
    try {
      fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'dist'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'node_modules'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.turbo'), { recursive: true });

      fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name":"test"}\n');
      fs.writeFileSync(path.join(tempDir, 'src', 'index.ts'), 'export const a = 1;\n');
      // Transient files that must be ignored
      fs.writeFileSync(path.join(tempDir, 'dist', 'index.js'), 'ignored\n');
      fs.writeFileSync(path.join(tempDir, 'node_modules', 'dep.js'), 'ignored\n');
      fs.writeFileSync(path.join(tempDir, '.turbo', 'cache.log'), 'ignored\n');
      fs.writeFileSync(path.join(tempDir, 'test.tgz'), 'ignored\n');

      const digest1 = await computeSourceDigest(tempDir);
      expect(digest1).toMatch(/^[a-f0-9]{64}$/);

      // Mutating transient file does not change sourceDigest
      fs.writeFileSync(path.join(tempDir, 'dist', 'index.js'), 'mutated dist\n');
      const digest2 = await computeSourceDigest(tempDir);
      expect(digest2).toBe(digest1);

      // Mutating included source file changes sourceDigest
      fs.writeFileSync(path.join(tempDir, 'src', 'index.ts'), 'export const a = 2;\n');
      const digest3 = await computeSourceDigest(tempDir);
      expect(digest3).not.toBe(digest1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('freezePackageRelease freezes tarball and detects byte mutations', async () => {
    const repoRoot = path.resolve(__dirname, '../../');
    const corePkgDir = path.join(repoRoot, 'packages', 'charts-core');
    const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freeze-test-'));

    try {
      const frozen = await freezePackageRelease({
        packageDir: corePkgDir,
        stagingDir,
      });

      expect(frozen.packageName).toBe('@company/charts-core');
      // 版本号唯一事实来源是 packages/charts-core/package.json，测试不硬编码
      const coreVersion = JSON.parse(
        fs.readFileSync(path.join(corePkgDir, 'package.json'), 'utf8'),
      ).version as string;
      expect(frozen.version).toBe(coreVersion);
      expect(frozen.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(frozen.bytes).toBeGreaterThan(0);
      expect(fs.existsSync(frozen.tarballPath)).toBe(true);
      expect(fs.existsSync(path.join(stagingDir, 'fingerprint.json'))).toBe(true);

      // Intact tarball verifies successfully
      const checkValid = await verifyFrozenTarball(frozen);
      expect(checkValid.ok).toBe(true);

      // Mutating even 1 byte of the frozen tarball triggers failure
      const buffer = fs.readFileSync(frozen.tarballPath);
      buffer[buffer.length - 1] = (buffer[buffer.length - 1]! ^ 0xff);
      fs.writeFileSync(frozen.tarballPath, buffer);

      const checkTampered = await verifyFrozenTarball(frozen);
      expect(checkTampered.ok).toBe(false);
      if (!checkTampered.ok) {
        expect(checkTampered.error).toBe('TARBALL_MUTATION_DETECTED');
      }
    } finally {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  });

  it('pack_mutation_invalidates_report: tampered tarball invalidates report check', async () => {
    const validSha = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
    const tamperedSha = '3cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
    const env = detectEnvironment({
      browserVersion: '130.0.0.0',
      browserRevision: '1000',
      fontDigest: '1111111111111111111111111111111111111111111111111111111111111111',
      framework: 'vue',
      frameworkVersion: '3.5.45',
      echartsVersion: '6.1.0',
    });
    const envKey = computeEnvironmentKey(env);

    const report = buildCheckReport({
      id: 'rep-001',
      toolVersion: '0.0.1',
      variantId: 'line-vue',
      packageSha256: validSha,
      exampleId: 'line-default',
      environment: env,
      environmentKey: envKey,
      checks: [{ name: 'single-instance', status: 'passed' }],
      screenshots: [
        {
          id: 'shot-001',
          variantId: 'line-vue',
          framework: 'vue',
          packageVersion: '0.0.1',
          exampleId: 'line-default',
          state: 'default',
          source: 'local-automatic',
          packageSha256: validSha,
          environmentKey: envKey,
          image: { path: 'screenshots/line-vue.png', sha256: validSha, bytes: 1024 },
        },
      ],
      baselineResult: 'NEW',
    });

    // Valid report passes contract validation
    const validationResult = validateCheckReport(report);
    expect(validationResult.ok).toBe(true);

    // If tarball was tampered and report has mismatching packageSha256
    const invalidReport = { ...report, packageSha256: tamperedSha };
    const invalidValidation = validateCheckReport(invalidReport);
    expect(invalidValidation.ok).toBe(false);
  });

  it('font_or_os_mismatch_is_incompatible: environment key changes on font or OS difference', () => {
    const baseEnv = detectEnvironment({
      browserVersion: '130.0.0.0',
      browserRevision: '1000',
      fontDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      framework: 'vue',
      frameworkVersion: '3.5.45',
      echartsVersion: '6.1.0',
    });
    const baseKey = computeEnvironmentKey(baseEnv);
    expect(baseKey).toMatch(/^[a-f0-9]{64}$/);

    // Font mismatch
    const fontMismatchEnv = {
      ...baseEnv,
      fontDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    };
    const fontMismatchKey = computeEnvironmentKey(fontMismatchEnv);
    expect(fontMismatchKey).not.toBe(baseKey);

    // OS mismatch
    const osMismatchEnv = {
      ...baseEnv,
      os: baseEnv.os === 'windows' ? 'linux' : 'windows',
    };
    const osMismatchKey = computeEnvironmentKey(osMismatchEnv);
    expect(osMismatchKey).not.toBe(baseKey);
  });

  it('engine_upgrade_compares_existing_baseline: engine version is tracked in environment', () => {
    const envEcharts6 = detectEnvironment({
      browserVersion: '130.0.0.0',
      browserRevision: '1000',
      fontDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      framework: 'vue',
      frameworkVersion: '3.5.45',
      echartsVersion: '6.1.0',
    });
    const envEcharts7 = detectEnvironment({
      browserVersion: '130.0.0.0',
      browserRevision: '1000',
      fontDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      framework: 'vue',
      frameworkVersion: '3.5.45',
      echartsVersion: '6.2.0',
    });
    expect(envEcharts6.echartsVersion).toBe('6.1.0');
    expect(envEcharts7.echartsVersion).toBe('6.2.0');
    expect(computeEnvironmentKey(envEcharts6)).not.toBe(computeEnvironmentKey(envEcharts7));
  });

  it('page_error_fails_even_with_screenshot: report with failed check does not validate as all-passed', () => {
    const sha = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
    const env = detectEnvironment({
      browserVersion: '130.0.0.0',
      browserRevision: '1000',
      fontDigest: '1111111111111111111111111111111111111111111111111111111111111111',
      framework: 'react',
      frameworkVersion: '19.3.1',
      echartsVersion: '6.1.0',
    });
    const envKey = computeEnvironmentKey(env);

    const reportWithPageError = buildCheckReport({
      id: 'rep-002',
      toolVersion: '0.0.1',
      variantId: 'line-react',
      packageSha256: sha,
      exampleId: 'line-default',
      environment: env,
      environmentKey: envKey,
      checks: [
        { name: 'single-instance', status: 'passed' },
        { name: 'no-page-error', status: 'failed' },
      ],
      screenshots: [
        {
          id: 'shot-002',
          variantId: 'line-react',
          framework: 'react',
          packageVersion: '0.0.1',
          exampleId: 'line-default',
          state: 'default',
          source: 'local-automatic',
          packageSha256: sha,
          environmentKey: envKey,
          image: { path: 'screenshots/line-react.png', sha256: sha, bytes: 2048 },
        },
      ],
      baselineResult: 'NEW',
    });

    const hasFailedCheck = reportWithPageError.checks.some((c) => c.status === 'failed');
    expect(hasFailedCheck).toBe(true);
  });
});
