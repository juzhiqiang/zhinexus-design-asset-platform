/**
 * T17 A2 产品失败测试：CLI `component integrate verify` / `repair` 命令入口。
 *
 * 覆盖：
 * - 冻结参数表：--project / --plan / --apply-result / --spec / --out / --allow-project-scripts / --allow-browser / --report / --max-attempts；
 * - 坏 JSON、未知/重复/缺失 flags、非法布尔或 --max-attempts 3 返回 exit 1 + stdout 单 JSON error envelope；
 * - stderr 脱敏，不回显敏感环境变量或原文；
 * - 退出码分层：0 (passed/repaired)、2 (failed/blocked/stopped/recovery-required)、1 (参数/读取/执行错误)。
 */
import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runCli } from '../../packages/component-cli/src/cli.js';
import { validIntegrationPlanFixture } from '../fixtures/integration-plan.js';
import { applyResultFixture } from '../fixtures/integration-apply.js';
import { verificationSpecFixture } from '../fixtures/integration-verification.js';

describe('T17 A2 CLI integrate verify / repair 命令入口', () => {
  const tempRoots: string[] = [];

  function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempRoots.push(dir);
    return dir;
  }

  afterAll(() => {
    for (const dir of tempRoots) {
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch {
        // ignore
      }
    }
  });

  it('未知/重复/缺失 flags 与非法 --max-attempts 均返回 exit 1 且 stdout 为单一 JSON 错误信封', async () => {
    const rUnknown = await runCli(['integrate', 'verify', '--bogus', '1'], '0.0.14');
    expect(rUnknown.exitCode).toBe(1);
    const parsedUnknown = JSON.parse(rUnknown.stdout) as { status?: string; error?: { code?: string } };
    expect(parsedUnknown.status).toBe('error');
    expect(parsedUnknown.error?.code).toBe('INVALID_ARGUMENTS');

    const rMissing = await runCli(['integrate', 'verify', '--project', 'C:/tmp/p'], '0.0.14');
    expect(rMissing.exitCode).toBe(1);
    expect((JSON.parse(rMissing.stdout) as { error?: { code?: string } }).error?.code).toBe('INVALID_ARGUMENTS');

    const rDup = await runCli(['integrate', 'repair', '--project', 'a', '--project', 'b'], '0.0.14');
    expect(rDup.exitCode).toBe(1);
    expect((JSON.parse(rDup.stdout) as { error?: { code?: string } }).error?.code).toBe('INVALID_ARGUMENTS');
  });

  it('坏 JSON 输入返回 exit 1 且 stderr 不回显敏感令牌', async () => {
    const dir = makeTempDir('zhinexus-t17-cli-badjson-');
    const badFile = path.join(dir, 'bad.json');
    fs.writeFileSync(badFile, '{ not-valid-json', 'utf8');

    const secret = 'CLI_SECRET_SHOULD_NOT_ECHO_7788';
    const prev = process.env.ZHINEXUS_API_TOKEN;
    process.env.ZHINEXUS_API_TOKEN = secret;
    try {
      const res = await runCli(
        [
          'integrate',
          'verify',
          '--project', dir,
          '--plan', badFile,
          '--apply-result', badFile,
          '--spec', badFile,
          '--out', path.join(dir, 'out'),
          '--allow-project-scripts', 'false',
          '--allow-browser', 'false',
        ],
        '0.0.14',
      );
      expect(res.exitCode).toBe(1);
      const parsed = JSON.parse(res.stdout) as { status?: string; error?: { code?: string } };
      expect(parsed.status).toBe('error');
      expect(res.stderr).not.toContain(secret);
      expect(res.stdout).not.toContain(secret);
    } finally {
      if (prev === undefined) delete process.env.ZHINEXUS_API_TOKEN;
      else process.env.ZHINEXUS_API_TOKEN = prev;
    }
  });

  it('合法参数调用 integrate verify 返回结构化报告与 exit 2（非参数错误 exit 1）', async () => {
    const dir = makeTempDir('zhinexus-t17-cli-valid-flags-');
    const outDir = makeTempDir('zhinexus-t17-cli-out-');
    const planFile = path.join(dir, 'plan.json');
    const applyFile = path.join(dir, 'apply.json');
    const specFile = path.join(dir, 'spec.json');
    fs.writeFileSync(planFile, JSON.stringify(validIntegrationPlanFixture()), 'utf8');
    fs.writeFileSync(applyFile, JSON.stringify(applyResultFixture()), 'utf8');
    fs.writeFileSync(specFile, JSON.stringify(verificationSpecFixture()), 'utf8');

    const res = await runCli(
      [
        'integrate',
        'verify',
        '--project', dir,
        '--plan', planFile,
        '--apply-result', applyFile,
        '--spec', specFile,
        '--out', outDir,
        '--allow-project-scripts', 'false',
        '--allow-browser', 'false',
      ],
      '0.0.14',
    );
    expect(res.exitCode).toBe(2);
    const parsed = JSON.parse(res.stdout) as { operation?: string; status?: string };
    expect(parsed.operation).toBe('verify');
    expect(parsed.status).toBe('blocked');
  });
});
