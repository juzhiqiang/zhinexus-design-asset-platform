import { runCheckCommand } from './commands/check.js';

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
  component --version
  component --help

可用命令:
  check        本地构建、冻结、干净消费者验证、截图与报告生成闭环
  init/dev/release/status/baseline  (尚未实现)
`,
      stderr: '',
    };
  }

  const [command, ...rest] = args;

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
