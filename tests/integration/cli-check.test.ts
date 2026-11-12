import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { runCli } from '../../packages/component-cli/src/cli.js';
import { runCheckCommand } from '../../packages/component-cli/src/commands/check.js';
import { validateCheckReport } from '../../packages/component-cli/src/contracts/validation.js';
import { computeFileSha256 } from '../../packages/component-cli/src/local/digest.js';
import { freezePackageRelease, verifyFrozenTarball } from '../../packages/component-cli/src/local/freeze.js';

describe('T04: component check command end-to-end local closed loop', () => {
  it('rejects invalid framework options with exit code 1', async () => {
    const result = await runCli(['check', '--framework', 'angular'], '0.0.1');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--framework 仅支持 vue、react 或 all');
  });

  it('rejects unknown arguments with exit code 1', async () => {
    const result = await runCli(['check', '--foo'], '0.0.1');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('未知参数 --foo');
  });

  it(
    'executes component check for vue, generating frozen tarball, screenshot and valid NEW report',
    async () => {
      const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-check-vue-'));
      try {
        const result = await runCheckCommand({
          framework: 'vue',
          stagingDir,
          timeoutMs: 30_000,
        });

        expect(result.success).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(result.results.length).toBe(1);

        const vueResult = result.results[0]!;
        expect(vueResult.framework).toBe('vue');
        expect(vueResult.variantId).toBe('line-vue');
        expect(vueResult.packageSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(vueResult.environmentKey).toMatch(/^[a-f0-9]{64}$/);

        // 验证生成的报告文件
        expect(fs.existsSync(vueResult.reportPath)).toBe(true);
        const reportJson = JSON.parse(fs.readFileSync(vueResult.reportPath, 'utf8'));
        expect(reportJson.baselineResult).toBe('NEW');
        expect(reportJson.packageSha256).toBe(vueResult.packageSha256);

        // 严格通过契约校验
        const validation = validateCheckReport(reportJson);
        expect(validation.ok).toBe(true);

        // 验证生成的截图文件
        expect(vueResult.screenshots.length).toBeGreaterThanOrEqual(1);
        const screenshotPath = path.join(stagingDir, 'screenshots', 'vue', vueResult.screenshots[0]!);
        expect(fs.existsSync(screenshotPath)).toBe(true);
        const screenshotSha256 = await computeFileSha256(screenshotPath);
        expect(screenshotSha256).toBe(reportJson.screenshots[0].image.sha256);
      } finally {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      }
    },
    180_000,
  );

  it(
    'executes component check for react, generating frozen tarball, screenshot and valid NEW report',
    async () => {
      const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-check-react-'));
      try {
        const result = await runCheckCommand({
          framework: 'react',
          stagingDir,
          timeoutMs: 30_000,
        });

        expect(result.success).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(result.results.length).toBe(1);

        const reactResult = result.results[0]!;
        expect(reactResult.framework).toBe('react');
        expect(reactResult.variantId).toBe('line-react');
        expect(reactResult.packageSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(reactResult.environmentKey).toMatch(/^[a-f0-9]{64}$/);

        // 验证生成的报告文件
        expect(fs.existsSync(reactResult.reportPath)).toBe(true);
        const reportJson = JSON.parse(fs.readFileSync(reactResult.reportPath, 'utf8'));
        expect(reportJson.baselineResult).toBe('NEW');
        expect(reportJson.packageSha256).toBe(reactResult.packageSha256);

        // 严格通过契约校验
        const validation = validateCheckReport(reportJson);
        expect(validation.ok).toBe(true);

        // 验证生成的截图文件
        expect(reactResult.screenshots.length).toBeGreaterThanOrEqual(1);
        const screenshotPath = path.join(stagingDir, 'screenshots', 'react', reactResult.screenshots[0]!);
        expect(fs.existsSync(screenshotPath)).toBe(true);
        const screenshotSha256 = await computeFileSha256(screenshotPath);
        expect(screenshotSha256).toBe(reportJson.screenshots[0].image.sha256);
      } finally {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      }
    },
    180_000,
  );

  it(
    'executes component check --framework all via CLI entrypoint',
    async () => {
      const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-check-all-'));
      try {
        const result = await runCli(['check', '--framework', 'all', '--staging-dir', stagingDir], '0.0.1');
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('[vue] 验证通过');
        expect(result.stdout).toContain('[react] 验证通过');
        expect(result.stdout).toContain('所有指定框架本地验证完成');
      } finally {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      }
    },
    300_000,
  );

  it('tampered frozen tarball triggers mutation failure and non-zero exit', async () => {
    const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-tamper-test-'));
    try {
      const repoRoot = path.resolve(__dirname, '../../');
      const vuePkgDir = path.join(repoRoot, 'packages', 'charts-vue');
      const frozen = await freezePackageRelease({
        packageDir: vuePkgDir,
        stagingDir,
      });

      // 篡改 tarball
      const content = fs.readFileSync(frozen.tarballPath);
      content[content.length - 1] = (content[content.length - 1]! ^ 0xff);
      fs.writeFileSync(frozen.tarballPath, content);

      const verifyResult = await verifyFrozenTarball(frozen);
      expect(verifyResult.ok).toBe(false);
      if (!verifyResult.ok) {
        expect(verifyResult.error).toBe('TARBALL_MUTATION_DETECTED');
      }
    } finally {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  });
});
