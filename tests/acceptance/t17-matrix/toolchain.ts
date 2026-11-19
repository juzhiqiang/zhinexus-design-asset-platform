/**
 * T17 矩阵工具链：固定工具链命令、冻结 CLI 安装、项目依赖安装与原生脚本执行。
 *
 * 边界：
 * - 只使用显式给出的绝对工具路径（node / npm-cli.js / pnpm），不在 PATH 上猜；
 * - 子进程环境做最小白名单，平台/注册表令牌只传给安装与 CLI（不传给项目脚本）；
 * - 所有执行都带超时与输出上限，输出只作为证据字节，不进最终结论文本。
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { MatrixEnv } from './env.js';
import { canonicalProjectRoot, ensureDir } from './support.js';

export type CommandOutcome = {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
};

const MAX_BUFFER = 8 * 1024 * 1024;

function baseEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'COMSPEC', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'PLAYWRIGHT_BROWSERS_PATH', 'NUMBER_OF_PROCESSORS'];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

export async function runCommand(
  executable: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs?: number; env?: NodeJS.ProcessEnv },
): Promise<CommandOutcome> {
  const started = Date.now();
  return await new Promise<CommandOutcome>((resolve) => {
    const child = execFile(
      executable,
      [...args],
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 600_000,
        maxBuffer: MAX_BUFFER,
        env: options.env ?? baseEnv(),
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const code = error && 'code' in error && typeof error.code === 'number' ? error.code : error ? 1 : 0;
        resolve({
          code,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          timedOut: Boolean(error && 'killed' in error && error.killed),
          durationMs: Date.now() - started,
        });
      },
    );
    child.stdin?.end();
  });
}

export function npmInstallEnv(env: MatrixEnv): NodeJS.ProcessEnv {
  return { ...baseEnv() };
}

/** 项目 .npmrc：注册表与令牌只写进用例工程（令牌不进入任何证据文件）。 */
export async function writeProjectNpmrc(env: MatrixEnv, projectRoot: string): Promise<void> {
  const url = new URL(env.registryBase);
  const host = url.host;
  const authKey = `//${host}/:_authToken`;
  const lines = [
    `registry=${env.registryBase.replace(/\/+$/, '')}/`,
    `${authKey}=${env.registryToken}`,
    'strict-peer-dependencies=true',
    'auto-install-peers=false',
    'fund=false',
    'audit=false',
  ];
  await writeFile(path.join(projectRoot, '.npmrc'), lines.join('\n') + '\n', 'utf8');
}

export async function installProjectDependencies(
  env: MatrixEnv,
  projectRoot: string,
  packageManager: 'npm' | 'pnpm',
): Promise<CommandOutcome> {
  await writeProjectNpmrc(env, projectRoot);
  if (packageManager === 'npm') {
    return runCommand(process.execPath, [env.npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund'], {
      cwd: projectRoot,
      timeoutMs: 600_000,
      env: npmInstallEnv(env),
    });
  }
  return runCommand(env.pnpmBin, ['install', '--ignore-scripts'], {
    cwd: projectRoot,
    timeoutMs: 600_000,
    env: npmInstallEnv(env),
  });
}

/** 运行项目自身声明的原生脚本（typecheck/build）；环境里不携带平台令牌。 */
export async function runProjectScript(
  env: MatrixEnv,
  projectRoot: string,
  packageManager: 'npm' | 'pnpm',
  script: string,
): Promise<CommandOutcome> {
  const commandEnv = { ...baseEnv(), PNPM_CONFIG_ENABLE_PRE_POST_SCRIPTS: 'false', CI: '1' };
  if (packageManager === 'npm') {
    return runCommand(process.execPath, [env.npmCli, 'run', script], { cwd: projectRoot, timeoutMs: 600_000, env: commandEnv });
  }
  return runCommand(env.pnpmBin, ['run', script], { cwd: projectRoot, timeoutMs: 600_000, env: commandEnv });
}

export type InstalledCli = {
  binPath: string;
  version: string;
  tarballSha256: string;
  installRoot: string;
};

/** 把冻结 CLI tarball 安装到工作根内的工具目录（-scripts，不执行生命周期脚本）。 */
export async function installFrozenCli(env: MatrixEnv, tarballSha256: string): Promise<InstalledCli> {
  const installRoot = path.join(env.workRoot, 'toolchain', 'cli');
  await ensureDir(installRoot);
  await writeFile(
    path.join(installRoot, 'package.json'),
    JSON.stringify({ private: true, dependencies: { '@company/component-cli': `file:${env.cliTarball.replace(/\\/g, '/')}` } }, null, 2) + '\n',
    'utf8',
  );
  const outcome = await runCommand(process.execPath, [env.npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: installRoot,
    timeoutMs: 300_000,
    env: npmInstallEnv(env),
  });
  if (outcome.code !== 0) throw new Error('冻结 CLI 安装失败: ' + outcome.stderr.slice(0, 400));
  const packageRoot = path.join(installRoot, 'node_modules', '@company', 'component-cli');
  const binPath = path.join(packageRoot, 'dist', 'bin.js');
  if (!existsSync(binPath)) throw new Error('冻结 CLI 缺少 dist/bin.js');
  const pkg = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(packageRoot, 'package.json'), 'utf8')) as { version: string };
  return { binPath, version: pkg.version, tarballSha256, installRoot: canonicalProjectRoot(installRoot) };
}

export type CliOutcome = {
  outcome: CommandOutcome;
  json: unknown | null;
  jsonError: string | null;
};

/** 调用冻结 CLI：stdout 只应有一个 JSON；解析失败单独记录，不抛异常。 */
export async function runCli(
  env: MatrixEnv,
  cli: InstalledCli,
  args: readonly string[],
  options: { cwd: string; timeoutMs?: number; withTokens?: boolean },
): Promise<CliOutcome> {
  const childEnv: NodeJS.ProcessEnv = { ...baseEnv() };
  if (options.withTokens) {
    childEnv.ZHINEXUS_API_TOKEN = env.apiToken;
    childEnv.ZHINEXUS_REGISTRY_TOKEN = env.registryToken;
  }
  const outcome = await runCommand(process.execPath, [cli.binPath, ...args], {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? 900_000,
    env: childEnv,
  });
  let json: unknown | null = null;
  let jsonError: string | null = null;
  try {
    json = JSON.parse(outcome.stdout);
  } catch {
    jsonError = outcome.stdout.trim() ? 'stdout 不是单个 JSON' : 'stdout 为空';
  }
  return { outcome, json, jsonError };
}

export async function prepareBackupRoot(env: MatrixEnv, caseId: string): Promise<string> {
  const backupRoot = path.join(env.workRoot, 'backups', caseId);
  await mkdir(backupRoot, { recursive: true });
  return backupRoot;
}
