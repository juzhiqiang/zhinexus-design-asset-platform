export function runCli(args: readonly string[], version: string): { exitCode: number; stdout: string; stderr: string } {
  if (args.length === 1 && args[0] === '--version') {
    return { exitCode: 0, stdout: `${version}\n`, stderr: '' };
  }
  if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0]!))) {
    return {
      exitCode: 0,
      stdout: 'component — 工程骨架\n\n可用：--help、--version\ninit/dev/check/release/baseline/status/integrate 尚未实现。\n',
      stderr: '',
    };
  }
  return { exitCode: 1, stdout: '', stderr: `命令尚未实现或参数不受支持：${args.join(' ')}\n运行 component --help 查看工程骨架范围。\n` };
}
