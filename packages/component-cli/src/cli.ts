import { runCheckCommand } from './commands/check.js';
import { acceptBaseline } from './commands/baseline.js';
import { prepareReleaseBundle, verifyReleaseBundle } from './local/manifest.js';
import {
  executeReleaseCommand,
  executeStatusCommand,
  executeResumeCommand,
} from './local/release.js';

export async function runCli(
  args: readonly string[],
  version: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (args.length === 1 && args[0] === '--version') {
    return { exitCode: 0, stdout: `${version}\n`, stderr: '' };
  }
  if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0]!))) {
    return {
      exitCode: 0,
      stdout: `component CLI v${version} — 工程骨架

用法:
  component check [--framework vue|react|all] [--staging-dir <dir>]
  component prepare-release [--bundle-dir <dir>] [--framework vue|react|all]
  component release --prepare-only [--bundle-dir <dir>]
  component baseline accept --report <path> --reason <text> [--api-url <url>] [--token <jwt>] [--expected-revision <rev>]
  component --version
  component --help

可用命令:
  check            本地构建、冻结、干净消费者验证、截图与报告生成闭环
  prepare-release  整理并生成合法的 ReleaseManifestV1 与完整冻结发布材料 Bundle
  baseline         管理与确认本地自动验证产生的视觉回归基线
  init/dev/release/status  (部分开发中)
`,
      stderr: '',
    };
  }

  const [command, ...rest] = args;

  if (command === 'prepare-release' || (command === 'release' && rest.includes('--prepare-only'))) {
    let frameworkChoice: 'vue' | 'react' | 'all' = 'all';
    let bundleDir = '.release-bundle';
    let timeoutMs: number | undefined;

    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === '--prepare-only') {
        continue;
      } else if (arg === '--framework') {
        const val = rest[++i];
        if (val === 'vue' || val === 'react' || val === 'all') {
          frameworkChoice = val;
        } else {
          return {
            exitCode: 1,
            stdout: '',
            stderr: `错误: --framework 仅支持 vue、react 或 all，收到: ${val}\n`,
          };
        }
      } else if (arg === '--bundle-dir') {
        bundleDir = rest[++i]!;
      } else if (arg === '--timeout') {
        timeoutMs = Number(rest[++i]);
      } else {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `错误: 未知参数 ${arg}\n用法: component prepare-release [--bundle-dir <dir>] [--framework vue|react|all]\n`,
        };
      }
    }

    const frameworks: Array<'vue' | 'react'> =
      frameworkChoice === 'all'
        ? ['vue', 'react']
        : frameworkChoice === 'vue'
          ? ['vue']
          : ['react'];

    try {
      const result = await prepareReleaseBundle({
        bundleDir,
        frameworks,
        timeoutMs,
      });

      if (!result.ok) {
        let errStr = `✖ 发布材料契约校验未通过:\n`;
        if (result.issues) {
          errStr += result.issues.map((issue) => `  - [${issue.code}] ${issue.path}: ${issue.message}`).join('\n') + '\n';
        }
        return { exitCode: 1, stdout: '', stderr: errStr };
      }

      let stdout = `✔ 完整发布材料生成成功！\n`;
      stdout += `  - 目录: ${result.bundleDir}\n`;
      stdout += `  - 清单版本: v${result.manifest.schemaVersion} (channel: ${result.manifest.channel})\n`;
      stdout += `  - 包含包: ${result.manifest.packages.map((p) => `${p.name}@${p.version}`).join(', ')}\n`;
      stdout += `  - 包含变体: ${result.manifest.variants.map((v) => v.variantId).join(', ')}\n`;
      stdout += `  - 文件清单总数: ${result.manifest.files.length} 个文件 (已通过 SHA-256 与字节校验)\n`;
      return { exitCode: 0, stdout, stderr: '' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { exitCode: 1, stdout: '', stderr: `✖ 生成发布材料失败: ${msg}\n` };
    }
  }

  if (command === 'check') {
    let framework: 'vue' | 'react' | 'all' = 'all';
    let stagingDir: string | undefined;
    let baselineDir: string | undefined;

    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === '--framework') {
        const val = rest[++i];
        if (val === 'vue' || val === 'react' || val === 'all') {
          framework = val;
        } else {
          return {
            exitCode: 1,
            stdout: '',
            stderr: `错误: --framework 仅支持 vue、react 或 all，收到: ${val}\n`,
          };
        }
      } else if (arg === '--staging-dir') {
        stagingDir = rest[++i];
      } else if (arg === '--baseline-dir') {
        baselineDir = rest[++i];
      } else {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `错误: 未知参数 ${arg}\n用法: component check [--framework vue|react|all] [--staging-dir <dir>] [--baseline-dir <dir>]\n`,
        };
      }
    }

    const checkResult = await runCheckCommand({ framework, stagingDir, baselineDir });
    let stdout = '';
    let stderr = '';

    for (const r of checkResult.results) {
      stdout += `✔ [${r.framework}] 验证完成: 变体 ${r.variantId}, 基线结果: ${r.report.baselineResult}, 产物摘要: ${r.packageSha256.slice(0, 16)}..., 报告: ${r.reportPath}\n`;
    }

    if (checkResult.success) {
      stdout += `\n所有指定框架本地验证完成 (已生成真实截图与合法 NEW 基线报告)。\n`;
      return { exitCode: 0, stdout, stderr };
    } else {
      stderr += `\n✖ 本地验证失败:\n${checkResult.errors.map((e) => `  - ${e}`).join('\n')}\n`;
      return { exitCode: 1, stdout, stderr };
    }
  }

  if (command === 'release' && !rest.includes('--prepare-only')) {
    let bundleDir = '.release-bundle';
    let apiUrl: string | undefined;
    let token: string | undefined;
    let idempotencyKey: string | undefined;
    let timeoutMs: number | undefined;

    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === '--bundle-dir') {
        bundleDir = rest[++i]!;
      } else if (arg === '--api-url') {
        apiUrl = rest[++i];
      } else if (arg === '--token') {
        token = rest[++i];
      } else if (arg === '--key' || arg === '--idempotency-key') {
        idempotencyKey = rest[++i];
      } else if (arg === '--timeout') {
        timeoutMs = Number(rest[++i]);
      } else {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `错误: 未知参数 ${arg}\n用法: component release [--bundle-dir <dir>] [--api-url <url>] [--token <jwt>] [--key <idempotencyKey>]\n`,
        };
      }
    }

    try {
      const result = await executeReleaseCommand({
        bundleDir,
        apiUrl,
        token,
        idempotencyKey,
        timeoutMs,
      });

      if (!result.ok) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `✖ 发布未成功: ${result.error ?? '未知错误'}\n  作业 ID: ${result.jobId ?? '未创建'}\n  终态: ${result.state ?? '未知'}\n`,
        };
      }

      let stdout = `✔ 发布成功！\n`;
      stdout += `  - 作业 ID: ${result.jobId}\n`;
      stdout += `  - 终态: ${result.state}\n`;
      stdout += `  - 阶段: ${result.stage}\n`;
      return { exitCode: 0, stdout, stderr: '' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { exitCode: 1, stdout: '', stderr: `✖ 执行发布失败: ${msg}\n` };
    }
  }

  if (command === 'status') {
    let jobId: string | undefined;
    let bundleDir: string | undefined;
    let apiUrl: string | undefined;
    let token: string | undefined;

    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === '--job-id') {
        jobId = rest[++i];
      } else if (arg === '--bundle-dir') {
        bundleDir = rest[++i];
      } else if (arg === '--api-url') {
        apiUrl = rest[++i];
      } else if (arg === '--token') {
        token = rest[++i];
      } else {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `错误: 未知参数 ${arg}\n用法: component status [--job-id <id>] [--bundle-dir <dir>] [--api-url <url>] [--token <jwt>]\n`,
        };
      }
    }

    try {
      const result = await executeStatusCommand({
        jobId,
        bundleDir,
        apiUrl,
        token,
      });

      if (!result.ok || !result.status) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `✖ 查询发布状态失败: ${result.error ?? '未知错误'}\n`,
        };
      }

      let stdout = `发布作业状态:\n`;
      stdout += `  - 状态: ${result.status.state}\n`;
      stdout += `  - 阶段: ${result.status.stage}\n`;
      stdout += `  - 尝试次数: ${result.status.attempt}\n`;
      if (result.status.lastError) {
        stdout += `  - 错误信息: [${result.status.lastError.code}] ${result.status.lastError.message}\n`;
      }
      return { exitCode: 0, stdout, stderr: '' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { exitCode: 1, stdout: '', stderr: `✖ 查询作业失败: ${msg}\n` };
    }
  }

  if (command === 'resume') {
    let bundleDir = '.release-bundle';
    let apiUrl: string | undefined;
    let token: string | undefined;
    let timeoutMs: number | undefined;

    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === '--bundle-dir') {
        bundleDir = rest[++i]!;
      } else if (arg === '--api-url') {
        apiUrl = rest[++i];
      } else if (arg === '--token') {
        token = rest[++i];
      } else if (arg === '--timeout') {
        timeoutMs = Number(rest[++i]);
      } else {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `错误: 未知参数 ${arg}\n用法: component resume [--bundle-dir <dir>] [--api-url <url>] [--token <jwt>]\n`,
        };
      }
    }

    try {
      const result = await executeResumeCommand({
        bundleDir,
        apiUrl,
        token,
        timeoutMs,
      });

      if (!result.ok) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `✖ 恢复发布未成功: ${result.error ?? '未知错误'}\n  作业 ID: ${result.jobId}\n  状态: ${result.state}\n`,
        };
      }

      let stdout = `✔ 恢复发布成功！\n`;
      stdout += `  - 作业 ID: ${result.jobId}\n`;
      stdout += `  - 终态: ${result.state}\n`;
      stdout += `  - 阶段: ${result.stage}\n`;
      return { exitCode: 0, stdout, stderr: '' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { exitCode: 1, stdout: '', stderr: `✖ 恢复发布失败: ${msg}\n` };
    }
  }

  if (command === 'baseline') {
    const [subcommand, ...subRest] = rest;
    if (subcommand !== 'accept') {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `错误: 未知 baseline 子命令 ${subcommand ?? '(空)'}\n用法: component baseline accept --report <path> --reason <text> [--api-url <url>] [--token <jwt>] [--expected-revision <rev>]\n`,
      };
    }

    let reportPath = '';
    let reason = '';
    let apiUrl: string | undefined;
    let token: string | undefined;
    let expectedRevision: string | undefined;
    let screenshotId: string | undefined;
    let jobId: string | undefined;
    let timeoutMs: number | undefined;

    for (let i = 0; i < subRest.length; i++) {
      const arg = subRest[i];
      if (arg === '--report') {
        reportPath = subRest[++i] ?? '';
      } else if (arg === '--reason') {
        reason = subRest[++i] ?? '';
      } else if (arg === '--api-url') {
        apiUrl = subRest[++i];
      } else if (arg === '--token') {
        token = subRest[++i];
      } else if (arg === '--expected-revision') {
        expectedRevision = subRest[++i];
      } else if (arg === '--screenshot-id') {
        screenshotId = subRest[++i];
      } else if (arg === '--job-id') {
        jobId = subRest[++i];
      } else if (arg === '--timeout') {
        timeoutMs = Number(subRest[++i]);
      } else {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `错误: 未知参数 ${arg}\n用法: component baseline accept --report <path> --reason <text> [--api-url <url>] [--token <jwt>] [--expected-revision <rev>] [--job-id <id>]\n`,
        };
      }
    }

    if (!reportPath) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: '错误: 缺少必填参数 --report <path>\n',
      };
    }

    const result = await acceptBaseline({
      reportPath,
      reason,
      apiUrl,
      token,
      expectedRevision,
      screenshotId,
      jobId,
      timeoutMs,
    });

    if (!result.ok) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `✖ 基线确认失败 [${result.errorCode ?? 'ERROR'}]: ${result.error ?? '未知错误'}\n`,
      };
    }

    let stdout = `✔ 视觉基线确认成功！\n`;
    stdout += `  - 基线版本 (revisionId): ${result.revisionId ?? '-'}\n`;
    stdout += `  - 变体 / 示例: ${result.variantId} / ${result.exampleId}\n`;
    stdout += `  - 环境签名: ${result.environmentKey}\n`;
    stdout += `  - 截图 ID: ${result.screenshotId}\n`;
    return { exitCode: 0, stdout, stderr: '' };
  }

  return {
    exitCode: 1,
    stdout: '',
    stderr: `命令尚未实现或参数不受支持：${args.join(' ')}\n运行 component --help 查看可用命令。\n`,
  };
}
