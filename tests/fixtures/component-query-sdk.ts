import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export type ExpectedSdkFramework = 'vue' | 'react';

export type ExpectedSdkComponent = {
  componentId: string;
  framework: ExpectedSdkFramework;
  packageName: string;
  exportName: string;
  exportPath: string;
  styleExport: string;
  readyMethod: string;
  eventNames: readonly string[];
};

const COMPONENT_EXPORT_SPEC: ReadonlyArray<{
  componentId: string;
  exportName: string;
  exportPath: string;
}> = [
  { componentId: 'line', exportName: 'LineChart', exportPath: './line' },
  { componentId: 'bar', exportName: 'BarChart', exportPath: './bar' },
  { componentId: 'pie', exportName: 'PieChart', exportPath: './pie' },
  { componentId: 'scatter', exportName: 'ScatterChart', exportPath: './scatter' },
  { componentId: 'trend-card', exportName: 'TrendCard', exportPath: './trend-card' },
  { componentId: 'ranking', exportName: 'Ranking', exportPath: './ranking' },
  { componentId: 'proportion', exportName: 'Proportion', exportPath: './proportion' },
];

const FRAMEWORK_CONFIG: Record<
  ExpectedSdkFramework,
  { packageName: string; eventNames: readonly string[] }
> = {
  vue: { packageName: '@company/charts-vue', eventNames: ['point-click'] },
  react: { packageName: '@company/charts-react', eventNames: ['onPointClick'] },
};

/**
 * 7 类组件 × 2 框架（Vue 3 / React 19）的 14 项独立预期矩阵。
 * 导出名、子路径、样式、就绪方法与事件名均来自 packages/charts-* 源码类型审计，不依赖服务端 GET 响应。
 */
export const expectedSdkComponents: readonly ExpectedSdkComponent[] = COMPONENT_EXPORT_SPEC.flatMap(
  (spec) =>
    (['vue', 'react'] as const).map((framework) => ({
      componentId: spec.componentId,
      framework,
      packageName: FRAMEWORK_CONFIG[framework].packageName,
      exportName: spec.exportName,
      exportPath: spec.exportPath,
      styleExport: './style.css',
      readyMethod: 'whenRendered',
      eventNames: [...FRAMEWORK_CONFIG[framework].eventNames],
    })),
);

export type MatrixValidationResult = { valid: true } | { valid: false; errors: string[] };

/**
 * 校验双框架 SDK 预期矩阵：检查 14 项完整性、无重复键、框架事件、包名、导出名与子路径。
 */
export function validateExpectedSdkMatrix(
  entries: readonly ExpectedSdkComponent[],
): MatrixValidationResult {
  const errors: string[] = [];
  const seenKeys = new Set<string>();
  const specMap = new Map(COMPONENT_EXPORT_SPEC.map((spec) => [spec.componentId, spec]));

  for (const entry of entries) {
    const key = `${entry.componentId}:${entry.framework}`;
    if (seenKeys.has(key)) {
      errors.push(`存在重复的 (componentId, framework) 键：${key}`);
    }
    seenKeys.add(key);

    const spec = specMap.get(entry.componentId);
    if (!spec) {
      errors.push(`未知 componentId：${entry.componentId}`);
      continue;
    }

    const fwConfig = FRAMEWORK_CONFIG[entry.framework];
    if (!fwConfig) {
      errors.push(`未知 framework：${String(entry.framework)} (${entry.componentId})`);
      continue;
    }

    if (entry.packageName !== fwConfig.packageName) {
      errors.push(`${key} 包名错误：期望 ${fwConfig.packageName}，实际 ${entry.packageName}`);
    }
    if (entry.exportName !== spec.exportName) {
      errors.push(`${key} 导出名错误：期望 ${spec.exportName}，实际 ${entry.exportName}`);
    }
    if (entry.exportPath !== spec.exportPath) {
      errors.push(`${key} 导出路径错误：期望 ${spec.exportPath}，实际 ${entry.exportPath}`);
    }
    if (entry.styleExport !== './style.css') {
      errors.push(`${key} 样式导出错误：期望 ./style.css，实际 ${entry.styleExport}`);
    }
    if (entry.readyMethod !== 'whenRendered') {
      errors.push(`${key} 就绪方法错误：期望 whenRendered，实际 ${entry.readyMethod}`);
    }
    if (
      entry.eventNames.length !== fwConfig.eventNames.length ||
      entry.eventNames.some((name, idx) => name !== fwConfig.eventNames[idx])
    ) {
      errors.push(
        `${key} 事件名错误：期望 [${fwConfig.eventNames.join(', ')}]，实际 [${entry.eventNames.join(', ')}]`,
      );
    }
  }

  for (const spec of COMPONENT_EXPORT_SPEC) {
    for (const framework of ['vue', 'react'] as const) {
      const expectedKey = `${spec.componentId}:${framework}`;
      if (!seenKeys.has(expectedKey)) {
        errors.push(`缺少组件框架实现：${expectedKey}`);
      }
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

export type PackageVersionDigest = {
  version: string;
  sha256: string;
};

/**
 * 校验目标记录引用的 packageName、packageVersion 与 packageSha256 是否与冻结 manifest 一致，
 * 防止混用 @company/charts-core 与框架包版本或篡改摘要。
 */
export function validatePackageVersionConsistency(
  target: { packageName: string; packageVersion: string; packageSha256: string },
  packages: Readonly<Record<string, PackageVersionDigest>>,
): MatrixValidationResult {
  const errors: string[] = [];
  const expectedPkg = packages[target.packageName];
  if (!expectedPkg) {
    errors.push(`manifest 中不存在包 ${target.packageName}`);
    return { valid: false, errors };
  }
  if (target.packageVersion !== expectedPkg.version) {
    errors.push(
      `${target.packageName} 版本不一致（禁止混用 SDK 包版本）：期望 ${expectedPkg.version}，实际 ${target.packageVersion}`,
    );
  }
  if (target.packageSha256 !== expectedPkg.sha256) {
    errors.push(
      `${target.packageName} SHA-256 不一致：期望 ${expectedPkg.sha256}，实际 ${target.packageSha256}`,
    );
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

type RawFileRef = { path: string; sha256: string; bytes: number };
type RawManifest = {
  schemaVersion: number;
  channel: string;
  packages: Array<{
    name: string;
    version: string;
    tarball: RawFileRef;
    sourceDigest: string;
    dependencies: Record<string, string>;
    peerDependencies: Record<string, string>;
  }>;
  variants: Array<{
    componentId: string;
    variantId: string;
    framework: ExpectedSdkFramework;
    packageName: string;
    packageVersion: string;
    exportPath: string;
    exportName: string;
    api: RawFileRef;
    docs: RawFileRef;
    examples: Array<{ previewFiles: RawFileRef[] }>;
    screenshots: Array<{ image: RawFileRef; packageSha256: string }>;
  }>;
};

type RawApiJson = {
  styleExport: string;
  readyMethod: string;
  props: Array<{ name: string; type: string; required: boolean }>;
  events: Array<{ name: string; payload: string }>;
};

export type FrozenPackageMetadata = {
  name: string;
  version: string;
  sha256: string;
  bytes: number;
  tarballPath: string;
  sourceDigest: string;
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
};

export type FrozenVariantMetadata = {
  componentId: string;
  variantId: string;
  framework: ExpectedSdkFramework;
  packageName: string;
  packageVersion: string;
  packageSha256: string;
  exportName: string;
  exportPath: string;
  styleExport: string;
  readyMethod: string;
  eventNames: string[];
  requiredPropNames: string[];
  apiSha256: string;
  docsSha256: string;
};

export type FrozenManifestSummary = {
  bundleDir: string;
  packages: Record<string, FrozenPackageMetadata>;
  variants: FrozenVariantMetadata[];
};

function readRawManifest(bundleDir: string): RawManifest {
  const manifestPath = path.join(bundleDir, 'manifest.json');
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as RawManifest;
}

/**
 * 从已冻结 bundle 的 manifest.json 与 api/*.json 读取逐包版本、SHA-256 及 14 个变体元数据。
 */
export function readFrozenBundleManifest(bundleDir: string): FrozenManifestSummary {
  const raw = readRawManifest(bundleDir);
  const packages: Record<string, FrozenPackageMetadata> = {};

  for (const pkg of raw.packages) {
    packages[pkg.name] = {
      name: pkg.name,
      version: pkg.version,
      sha256: pkg.tarball.sha256,
      bytes: pkg.tarball.bytes,
      tarballPath: pkg.tarball.path,
      sourceDigest: pkg.sourceDigest,
      dependencies: pkg.dependencies,
      peerDependencies: pkg.peerDependencies,
    };
  }

  const variants: FrozenVariantMetadata[] = raw.variants.map((variant) => {
    const apiJson = JSON.parse(
      readFileSync(path.join(bundleDir, variant.api.path), 'utf8'),
    ) as RawApiJson;
    const pkgMeta = packages[variant.packageName];
    const screenshotSha = variant.screenshots[0]?.packageSha256 ?? pkgMeta?.sha256 ?? '';

    return {
      componentId: variant.componentId,
      variantId: variant.variantId,
      framework: variant.framework,
      packageName: variant.packageName,
      packageVersion: variant.packageVersion,
      packageSha256: screenshotSha,
      exportName: variant.exportName,
      exportPath: variant.exportPath,
      styleExport: apiJson.styleExport,
      readyMethod: apiJson.readyMethod,
      eventNames: apiJson.events.map((event) => event.name),
      requiredPropNames: apiJson.props.filter((prop) => prop.required).map((prop) => prop.name),
      apiSha256: variant.api.sha256,
      docsSha256: variant.docs.sha256,
    };
  });

  return { bundleDir, packages, variants };
}

export type FrozenBundleFileCheck = {
  manifestReferencedFiles: number;
  reportFiles: number;
  bundleFilesExcludingManifest: number;
  mismatches: string[];
};

/**
 * 核对冻结 bundle 中的全部 199 个文件（185 个 manifest 引用文件 + 14 个 reports 文件）存在性、字节数与 SHA-256。
 */
export function verifyFrozenBundleFiles(bundleDir: string): FrozenBundleFileCheck {
  const raw = readRawManifest(bundleDir);
  const refs = new Map<string, RawFileRef>();

  for (const pkg of raw.packages) {
    refs.set(pkg.tarball.path, pkg.tarball);
  }
  for (const variant of raw.variants) {
    refs.set(variant.api.path, variant.api);
    refs.set(variant.docs.path, variant.docs);
    for (const example of variant.examples) {
      for (const previewFile of example.previewFiles) {
        refs.set(previewFile.path, previewFile);
      }
    }
    for (const shot of variant.screenshots) {
      refs.set(shot.image.path, shot.image);
    }
  }

  const mismatches: string[] = [];
  for (const [relPath, expected] of refs) {
    const fullPath = path.join(bundleDir, relPath);
    if (!existsSync(fullPath)) {
      mismatches.push(`缺失文件：${relPath}`);
      continue;
    }
    const content = readFileSync(fullPath);
    const actualSha = createHash('sha256').update(content).digest('hex');
    if (content.length !== expected.bytes) {
      mismatches.push(`字节数不匹配：${relPath} (${content.length} != ${expected.bytes})`);
    }
    if (actualSha !== expected.sha256) {
      mismatches.push(`SHA-256 不匹配：${relPath} (${actualSha} != ${expected.sha256})`);
    }
  }

  const reportsDir = path.join(bundleDir, 'reports');
  const reportFiles = existsSync(reportsDir)
    ? readdirSync(reportsDir).filter((name) => statSync(path.join(reportsDir, name)).isFile()).length
    : 0;

  return {
    manifestReferencedFiles: refs.size,
    reportFiles,
    bundleFilesExcludingManifest: refs.size + reportFiles,
    mismatches,
  };
}
