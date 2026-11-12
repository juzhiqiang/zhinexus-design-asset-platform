import { runCheckCommand } from './commands/check.js';
import { prepareReleaseBundle, verifyReleaseBundle } from './local/manifest.js';

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
  component --version
  component --help

可用命令:
  check            本地构建、冻结、干净消费者验证、截图与报告生成闭环
  prepare-release  整理并生成合法的 ReleaseManifestV1 与完整冻结发布材料 Bundle
  init/dev/release/status/baseline  (部分开发中)
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
      } else {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `错误: 未知参数 ${arg}\n用法: component check [--framework vue|react|all] [--staging-dir <dir>]\n`,
        };
      }
    }

    const checkResult = await runCheckCommand({ framework, stagingDir });
    let stdout = '';
    let stderr = '';

    for (const r of checkResult.results) {
      stdout += `✔ [${r.framework}] 验证通过: 变体 ${r.variantId}, 产物摘要: ${r.packageSha256.slice(0, 16)}..., 报告: ${r.reportPath}\n`;
    }

    if (checkResult.success) {
      stdout += `\n所有指定框架本地验证完成 (已生成真实截图与合法 NEW 基线报告)。\n`;
      return { exitCode: 0, stdout, stderr };
    } else {
      stderr += `\n✖ 本地验证失败:\n${checkResult.errors.map((e) => `  - ${e}`).join('\n')}\n`;
      return { exitCode: 1, stdout, stderr };
    }
  }

  return {
    exitCode: 1,
    stdout: '',
    stderr: `命令尚未实现或参数不受支持：${args.join(' ')}\n运行 component --help 查看可用命令。\n`,
  };
}
