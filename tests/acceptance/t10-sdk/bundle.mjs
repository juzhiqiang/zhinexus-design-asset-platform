/**
 * 冻结 bundle 只读读取（T10 探针，A 侧）。
 *
 * 探针**不打包、不重新 pack、不改写**任何已冻结产物：它只读 `manifest.json`
 * 与 `packages/*.tgz`，逐字节核对 SHA-256，然后把 tarball 的绝对路径交给
 * 工作区外的干净消费者安装。这与 `rules/testing-release.md` 的
 * 「单一冻结产物贯穿全链路」一致——探针消费的必须是 C 在 Windows 上冻结的同一份字节。
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

/** 一期三个公开图表包。 */
export const SDK_PACKAGES = /** @type {const} */ ([
  '@company/charts-core',
  '@company/charts-vue',
  '@company/charts-react',
]);

/** 与 `tests/acceptance/sdk-declarations.mjs` 同一套路径安全约束。 */
async function boundedPath(root, logical) {
  if (typeof logical !== 'string' || path.isAbsolute(logical) || path.win32.isAbsolute(logical) || logical.includes('\\')) {
    throw new Error(`PROBE_INPUT unsafe bundle path: ${logical}`);
  }
  if (logical.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`PROBE_INPUT unsafe bundle path: ${logical}`);
  }
  const physical = await realpath(path.join(root, logical));
  const relative = path.relative(root, physical);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`PROBE_INPUT file resolves outside the frozen bundle: ${logical}`);
  }
  return physical;
}

function sha256File(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * 读取并校验冻结 bundle。
 *
 * 校验项（任一不满足即抛错，探针不半途放行）：
 * 1. `manifest.json` 存在且是合法 JSON；
 * 2. 三个 SDK 包各出现一次，版本完全一致；
 * 3. `charts-vue` / `charts-react` 对 `charts-core` 的依赖是同一精确版本（无 `workspace:` 残留）；
 * 4. 每个 tarball 的**实际字节摘要**等于 manifest 记录的 `tarball.sha256`，字节数也相等；
 * 5. tarball 文件真实存在于 bundle 内。
 */
export async function readFrozenBundle(bundleRootInput) {
  if (!bundleRootInput) throw new Error('PROBE_INPUT 缺少 --bundle');
  const root = await realpath(path.resolve(bundleRootInput));
  if (!existsSync(root)) throw new Error(`PROBE_INPUT bundle 目录不存在：${bundleRootInput}`);
  const manifestPath = await boundedPath(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  if (!Array.isArray(manifest.packages)) throw new Error('PROBE_INPUT manifest.packages 缺失');
  for (const name of SDK_PACKAGES) {
    const matches = manifest.packages.filter((entry) => entry.name === name);
    if (matches.length !== 1) {
      throw new Error(`PROBE_INPUT 期望 ${name} 恰好出现一次，实际 ${matches.length} 次`);
    }
  }
  if (manifest.packages.length !== SDK_PACKAGES.length) {
    throw new Error(`PROBE_INPUT 期望只有 ${SDK_PACKAGES.length} 个 SDK 包，实际 ${manifest.packages.length} 个`);
  }
  const version = manifest.packages[0].version;
  const packages = [];
  for (const entry of manifest.packages) {
    if (entry.version !== version) {
      throw new Error(`PROBE_INPUT 版本不一致：${entry.name} 为 ${entry.version}，其余为 ${version}`);
    }
    const serialized = JSON.stringify(entry.dependencies ?? {});
    if (serialized.includes('workspace:')) {
      throw new Error(`PROBE_INPUT ${entry.name} 的依赖仍含 workspace: 协议`);
    }
    const file = await boundedPath(root, entry.tarball.path);
    if (!existsSync(file)) throw new Error(`PROBE_INPUT tarball 不存在：${entry.tarball.path}`);
    const bytes = await readFile(file);
    const digest = sha256File(bytes);
    if (digest !== entry.tarball.sha256) {
      throw new Error(
        `PROBE_INPUT 冻结摘要不符：${entry.name} manifest=${entry.tarball.sha256} 实际=${digest}。` +
          '探针拒绝在产物已被改写的 bundle 上出具报告。',
      );
    }
    if (bytes.length !== entry.tarball.bytes) {
      throw new Error(`PROBE_INPUT 字节数不符：${entry.name} manifest=${entry.tarball.bytes} 实际=${bytes.length}`);
    }
    packages.push({
      name: entry.name,
      version: entry.version,
      tarballPath: entry.tarball.path,
      tarballFile: file,
      sha256: digest,
      bytes: bytes.length,
      sourceDigest: entry.sourceDigest,
      dependencies: entry.dependencies ?? {},
      peerDependencies: entry.peerDependencies ?? {},
    });
  }
  const coreVersion = packages.find((entry) => entry.name === '@company/charts-core').version;
  for (const name of ['@company/charts-vue', '@company/charts-react']) {
    const dependency = packages.find((entry) => entry.name === name).dependencies['@company/charts-core'];
    if (dependency !== coreVersion) {
      throw new Error(`PROBE_INPUT ${name} 对 charts-core 的依赖应为 ${coreVersion}，实际 ${dependency}`);
    }
  }
  return {
    root,
    manifestPath,
    schemaVersion: manifest.schemaVersion,
    channel: manifest.channel,
    version,
    packages,
  };
}

/**
 * 三个包一致的 `peerDependencies.echarts`——当前已锁定基线的唯一答案。
 * 混合基线直接抛错，不取首项（与 `compatibility.ts` 的纪律同源）。
 */
export function peerEchartsBaseline(bundle) {
  const seen = new Map();
  for (const entry of bundle.packages) {
    const peer = entry.peerDependencies.echarts;
    if (!peer) throw new Error(`PROBE_INPUT ${entry.name} 未声明 peerDependencies.echarts`);
    seen.set(peer, (seen.get(peer) ?? 0) + 1);
  }
  if (seen.size !== 1) {
    throw new Error(
      `PROBE_INPUT 三个包的 echarts peer 不一致：${[...seen.keys()].join(' 与 ')}。无法判定唯一基线。`,
    );
  }
  return [...seen.keys()][0];
}

/**
 * 从冻结 manifest 的 `variants[].compatibility` 取「当前已实测通过」的精确组合清单。
 *
 * 这是 `supported` 的事实来源：不是探针硬编码，而是冻结产物自己登记的内容。
 * 只取 `status === 'passed'` 且带 `reportId` 与 `verifiedAt` 的记录——契约要求如此。
 */
export async function supportedCombinations(bundle) {
  return readSupportedFromManifest(bundle);
}

async function readSupportedFromManifest(bundle) {
  const manifest = JSON.parse(await readFile(bundle.manifestPath, 'utf8'));
  const rows = [];
  for (const variant of manifest.variants ?? []) {
    for (const record of variant.compatibility ?? []) {
      if (record.status !== 'passed') continue;
      if (!record.reportId || !record.verifiedAt) continue;
      rows.push({
        framework: record.framework,
        frameworkVersion: record.frameworkVersion,
        reactDomVersion: record.reactDomVersion,
        echartsVersion: record.echartsVersion,
        reportId: record.reportId,
        verifiedAt: record.verifiedAt,
      });
    }
  }
  return dedupeSupported(rows);
}

/** 精确组合去重：同一 (框架, 框架版本, ECharts 基线) 只保留一条。 */
export function dedupeSupported(rows) {
  const unique = new Map();
  for (const row of rows) {
    const key = `${row.framework}@${row.frameworkVersion}@${row.echartsVersion}`;
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()].map((row) => ({
    framework: row.framework,
    frameworkVersion: row.frameworkVersion,
    reactDomVersion: row.reactDomVersion,
    echartsVersion: row.echartsVersion,
    reportId: row.reportId,
    verifiedAt: row.verifiedAt,
  }));
}

/**
 * 从冻结 manifest 取每个实现的包摘要，用于报告里逐实现留痕。
 * 返回值：`Map<variantId, { packageName, packageVersion, packageSha256 }>`
 */
export async function variantPackageDigests(bundle) {
  const manifest = JSON.parse(await readFile(bundle.manifestPath, 'utf8'));
  const digests = new Map();
  for (const variant of manifest.variants ?? []) {
    digests.set(variant.variantId, {
      packageName: variant.packageName,
      packageVersion: variant.packageVersion,
      packageSha256: bundle.packages.find((entry) => entry.name === variant.packageName)?.sha256,
    });
  }
  return digests;
}
