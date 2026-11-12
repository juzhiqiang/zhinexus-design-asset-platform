import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeFileSha256 } from './digest.js';

export type PackOptions = {
  packageDir: string;
  outputDir: string;
};

export type PackResult = {
  tarballPath: string;
  tarballName: string;
  packageName: string;
  version: string;
  sha256: string;
  bytes: number;
};

/**
 * 寻找工作区隔离工具链中的 pnpm 可执行文件路径；若未在工具链中找到则回退至 PATH 中的 pnpm。
 */
export function resolvePnpmExecutable(startDir: string = process.cwd()): string {
  const currentModuleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidateStarts = [startDir, process.cwd(), currentModuleDir];

  for (const candidate of candidateStarts) {
    let curr = path.resolve(candidate);
    while (curr !== path.dirname(curr)) {
      const toolsPnpm = path.join(
        curr,
        '.tools',
        'pnpm-native-12.18.0',
        'package',
        process.platform === 'win32' ? 'pnpm.exe' : 'pnpm',
      );
      if (fs.existsSync(toolsPnpm)) {
        return toolsPnpm;
      }
      const toolsBinPnpm = path.join(
        curr,
        '.tools',
        'bin',
        process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
      );
      if (fs.existsSync(toolsBinPnpm)) {
        return toolsBinPnpm;
      }
      curr = path.dirname(curr);
    }
  }
  return 'pnpm';
}

/**
 * 执行 pnpm pack 将指定包打包为候选 tarball，保存至 outputDir，并计算其全链路 SHA-256 与文件尺寸。
 */
export async function packPackage(options: PackOptions): Promise<PackResult> {
  const packageDir = path.resolve(options.packageDir);
  const outputDir = path.resolve(options.outputDir);

  await fs.promises.mkdir(outputDir, { recursive: true });

  const pkgJsonPath = path.join(packageDir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) {
    throw new Error(`package.json not found in package directory: ${packageDir}`);
  }
  const pkgJson = JSON.parse(await fs.promises.readFile(pkgJsonPath, 'utf8'));
  const packageName: string = pkgJson.name;
  const version: string = pkgJson.version;

  const pnpmBin = resolvePnpmExecutable(packageDir);

  // 记录打包前 outputDir 已有的 tgz，防止重名混淆
  const beforeFiles = new Set(
    (await fs.promises.readdir(outputDir)).filter((f) => f.endsWith('.tgz')),
  );

  await new Promise<void>((resolve, reject) => {
    const isCmd = pnpmBin.endsWith('.cmd') || pnpmBin === 'pnpm';
    const child = child_process.spawn(
      pnpmBin,
      ['pack', '--pack-destination', outputDir],
      {
        cwd: packageDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: isCmd && process.platform === 'win32',
        env: {
          ...process.env,
          SOURCE_DATE_EPOCH: process.env.SOURCE_DATE_EPOCH || '1700000000',
        },
      },
    );

    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `pnpm pack failed for ${packageName} with exit code ${code}: ${stderr}`,
          ),
        );
      }
    });

    child.on('error', (err) => reject(err));
  });

  const afterFiles = (await fs.promises.readdir(outputDir)).filter((f) =>
    f.endsWith('.tgz'),
  );
  const newFiles = afterFiles.filter((f) => !beforeFiles.has(f));
  const candidateName =
    newFiles.length > 0
      ? newFiles[0]!
      : afterFiles.find((f) =>
          f.includes(packageName.replace(/^@company\//, '').replace(/\//g, '-')),
        ) ?? afterFiles[0];

  if (!candidateName) {
    throw new Error(
      `No tarball was produced in ${outputDir} after running pnpm pack for ${packageName}`,
    );
  }

  const tarballPath = path.join(outputDir, candidateName);
  const stat = await fs.promises.stat(tarballPath);
  const sha256 = await computeFileSha256(tarballPath);

  return {
    tarballPath,
    tarballName: candidateName,
    packageName,
    version,
    sha256,
    bytes: stat.size,
  };
}
