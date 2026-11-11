import * as fs from 'node:fs';
import * as path from 'node:path';
import { computeFileSha256, computeSourceDigest } from './digest.js';
import { packPackage } from './pack.js';

export type FrozenArtifact = {
  packageName: string;
  version: string;
  tarballPath: string;
  tarballName: string;
  sha256: string;
  bytes: number;
  sourceDigest: string;
  frozenAt: string;
};

export type FreezeOptions = {
  packageDir: string;
  stagingDir: string;
  expectedVersion?: string;
};

export type TarballVerificationResult =
  | { ok: true }
  | {
      ok: false;
      error: 'TARBALL_FILE_NOT_FOUND' | 'TARBALL_MUTATION_DETECTED';
      message?: string;
      expected?: string;
      actual?: string;
    };

/**
 * 冻结待发布包（T04 产物冻结核心）：
 * 1. 执行 pnpm pack 生成候选 tarball；
 * 2. 计算 tarball 的 SHA-256 摘要与规范化 sourceDigest；
 * 3. 产物一旦生成即行冻结，写入 fingerprint.json 元数据；
 * 4. 全链路安装、截图、报告与上传必须使用该冻结产物，产物或源码变动必须使原有验证失效并重新打冻结包。
 */
export async function freezePackageRelease(
  options: FreezeOptions,
): Promise<FrozenArtifact> {
  const stagingDir = path.resolve(options.stagingDir);
  await fs.promises.mkdir(stagingDir, { recursive: true });

  const packResult = await packPackage({
    packageDir: options.packageDir,
    outputDir: stagingDir,
  });

  if (options.expectedVersion && packResult.version !== options.expectedVersion) {
    throw new Error(
      `Package version mismatch: expected ${options.expectedVersion}, got ${packResult.version}`,
    );
  }

  const sourceDigest = await computeSourceDigest(options.packageDir);

  const frozen: FrozenArtifact = {
    packageName: packResult.packageName,
    version: packResult.version,
    tarballPath: packResult.tarballPath,
    tarballName: packResult.tarballName,
    sha256: packResult.sha256,
    bytes: packResult.bytes,
    sourceDigest,
    frozenAt: new Date().toISOString(),
  };

  const fingerprintPath = path.join(stagingDir, 'fingerprint.json');
  await fs.promises.writeFile(
    fingerprintPath,
    JSON.stringify(frozen, null, 2) + '\n',
    'utf8',
  );

  return frozen;
}

/**
 * 校验已冻结 tarball 的完整性。若文件被篡改或字节发生任何变动，立即判定失效并阻断后续流程。
 */
export async function verifyFrozenTarball(
  frozen: FrozenArtifact,
): Promise<TarballVerificationResult> {
  if (!fs.existsSync(frozen.tarballPath)) {
    return {
      ok: false,
      error: 'TARBALL_FILE_NOT_FOUND',
      message: `Tarball does not exist: ${frozen.tarballPath}`,
    };
  }

  const actualSha256 = await computeFileSha256(frozen.tarballPath);
  if (actualSha256 !== frozen.sha256) {
    return {
      ok: false,
      error: 'TARBALL_MUTATION_DETECTED',
      message: `Tarball SHA-256 mismatch: expected ${frozen.sha256}, actual ${actualSha256}`,
      expected: frozen.sha256,
      actual: actualSha256,
    };
  }

  return { ok: true };
}
