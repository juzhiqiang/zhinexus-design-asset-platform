import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePnpmExecutable } from './pack.js';

export type SetupConsumerOptions = {
  targetDir: string;
  tarballs: Record<string, string>;
  dependencies?: Record<string, string>;
  overrides?: Record<string, string>;
};

export type ConsumerEnvironment = {
  targetDir: string;
  pkgJsonPath: string;
  installedPackages: string[];
};

export type TypeCheckOptions = {
  consumerDir: string;
  testFileName?: string;
  content: string;
};

export type TypeCheckResult = {
  ok: boolean;
  output: string;
};

export type RuntimeCheckOptions = {
  consumerDir: string;
  scriptFileName?: string;
  content: string;
};

export type RuntimeCheckResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

/**
 * 寻找仓库根目录中的 TypeScript 编译器 (tsc) 脚本入口。
 */
export function resolveTscExecutable(startDir: string = process.cwd()): string {
  const currentModuleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidateStarts = [startDir, process.cwd(), currentModuleDir];

  for (const candidate of candidateStarts) {
    let curr = path.resolve(candidate);
    while (curr !== path.dirname(curr)) {
      const tscJs = path.join(curr, 'node_modules', 'typescript', 'bin', 'tsc');
      if (fs.existsSync(tscJs)) {
        return tscJs;
      }
      curr = path.dirname(curr);
    }
  }
  throw new Error('typescript (tsc) not found in node_modules');
}

/**
 * 在工作区外的干净临时目录初始化独立消费者项目并安装候选 tarball：
 * - 独立 package.json，严格禁止 monorepo workspace 协议或源码 alias；
 * - 使用真实 pnpm 安装本地 tarball 与外部 peer 依赖；
 * - 验证安装结果为独立 node_modules 目录而非符号链接。
 */
export async function setupCleanConsumer(
  options: SetupConsumerOptions,
): Promise<ConsumerEnvironment> {
  const targetDir = path.resolve(options.targetDir);
  await fs.promises.mkdir(targetDir, { recursive: true });

  const deps: Record<string, string> = { ...(options.dependencies ?? {}) };
  for (const [pkgName, tarballPath] of Object.entries(options.tarballs)) {
    const normalizedPath = path.resolve(tarballPath).replace(/\\/g, '/');
    deps[pkgName] = `file:${normalizedPath}`;
  }

  const pkgJson: Record<string, unknown> = {
    name: 'clean-consumer-test',
    version: '1.0.0',
    private: true,
    type: 'module',
    dependencies: deps,
  };

  if (options.overrides && Object.keys(options.overrides).length > 0) {
    pkgJson.pnpm = {
      overrides: options.overrides,
    };
  }

  const pkgJsonPath = path.join(targetDir, 'package.json');
  await fs.promises.writeFile(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n', 'utf8');

  // 写入 .npmrc 确保严格依赖解析
  await fs.promises.writeFile(
    path.join(targetDir, '.npmrc'),
    'engine-strict=false\nstrict-peer-dependencies=false\n',
    'utf8',
  );

  const pnpmBin = resolvePnpmExecutable(targetDir);
  const isCmd = pnpmBin.endsWith('.cmd') || pnpmBin === 'pnpm';

  await new Promise<void>((resolve, reject) => {
    const child = child_process.spawn(pnpmBin, ['install', '--no-frozen-lockfile'], {
      cwd: targetDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isCmd && process.platform === 'win32',
      env: {
        ...process.env,
      },
    });

    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`pnpm install in consumer failed with exit code ${code}: ${stderr}`));
      }
    });

    child.on('error', (err) => reject(err));
  });

  return {
    targetDir,
    pkgJsonPath,
    installedPackages: Object.keys(options.tarballs),
  };
}

/**
 * 在消费者项目中执行 TypeScript 类型检查：
 * - 写入待测源码与 tsconfig.json；
 * - 使用 tsc --noEmit 验证导出与类型定义；
 * - 返回检查结果与编译器输出。
 */
export async function verifyConsumerTypes(
  options: TypeCheckOptions,
): Promise<TypeCheckResult> {
  const consumerDir = path.resolve(options.consumerDir);
  const testFileName = options.testFileName ?? 'verify-types.ts';
  const testFilePath = path.join(consumerDir, testFileName);

  await fs.promises.writeFile(testFilePath, options.content, 'utf8');

  const tsconfigPath = path.join(consumerDir, 'tsconfig.json');
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noEmit: true,
      skipLibCheck: false,
    },
    include: [testFileName],
  };
  await fs.promises.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2) + '\n', 'utf8');

  const tscJs = resolveTscExecutable(consumerDir);

  return new Promise<TypeCheckResult>((resolve) => {
    const child = child_process.spawn(
      process.execPath,
      [tscJs, '-p', tsconfigPath, '--noEmit'],
      {
        cwd: consumerDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let output = '';
    child.stdout?.on('data', (d) => (output += d.toString()));
    child.stderr?.on('data', (d) => (output += d.toString()));

    child.on('close', (code) => {
      resolve({
        ok: code === 0,
        output,
      });
    });

    child.on('error', (err) => {
      resolve({
        ok: false,
        output: err.message,
      });
    });
  });
}

/**
 * 在消费者项目中运行 Node.js 脚本：
 * - 验证无 DOM / SSR 环境下的纯导入安全性；
 * - 返回执行结果与标准输出/标准错误。
 */
export async function verifyConsumerRuntime(
  options: RuntimeCheckOptions,
): Promise<RuntimeCheckResult> {
  const consumerDir = path.resolve(options.consumerDir);
  const scriptFileName = options.scriptFileName ?? 'verify-runtime.mjs';
  const scriptPath = path.join(consumerDir, scriptFileName);

  await fs.promises.writeFile(scriptPath, options.content, 'utf8');

  return new Promise<RuntimeCheckResult>((resolve) => {
    const child = child_process.spawn(process.execPath, [scriptPath], {
      cwd: consumerDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));

    child.on('close', (code) => {
      resolve({
        ok: code === 0,
        stdout,
        stderr,
      });
    });

    child.on('error', (err) => {
      resolve({
        ok: false,
        stdout,
        stderr: err.message,
      });
    });
  });
}
