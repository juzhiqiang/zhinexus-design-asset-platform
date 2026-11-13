import type { Framework, PackageRef, ScreenshotRef, VariantRef } from '@company/contracts';

export type ScreenshotValidationIssue = {
  code: 'SCREENSHOT_REQUIRED' | 'SCREENSHOT_VARIANT_MISMATCH' | 'SOURCE_FORBIDDEN' | 'DIGEST_MISMATCH';
  variantId: string;
  framework?: Framework;
  message: string;
};

export type ScreenshotValidationResult = {
  ok: boolean;
  missingVariantIds: string[];
  issues: ScreenshotValidationIssue[];
};

/**
 * 严格校验各变体截图关联：
 * 1. 逐实现必检：每个待发布逻辑组件的每个框架实现必须至少关联一张有效截图；
 * 2. 框架严格匹配：严禁跨框架错配（如将 Vue 截图配给 React 实现）；
 * 3. 来源防伪：网页手动上传的截图强制标记为 manual-upload 与 unknown-manual。
 */
export function validateVariantScreenshots(
  variants: VariantRef[],
  packages: PackageRef[] = [],
): ScreenshotValidationResult {
  const issues: ScreenshotValidationIssue[] = [];
  const missingVariantIds: string[] = [];
  const packagesMap = new Map<string, PackageRef>();

  for (const pkg of packages) {
    packagesMap.set(`${pkg.name}@${pkg.version}`, pkg);
  }

  for (const variant of variants) {
    if (!variant.screenshots || variant.screenshots.length === 0) {
      missingVariantIds.push(variant.variantId);
      issues.push({
        code: 'SCREENSHOT_REQUIRED',
        variantId: variant.variantId,
        framework: variant.framework,
        message: `组件实现 ${variant.variantId} (${variant.framework}) 缺少必需的展示截图`,
      });
      continue;
    }

    const pkgKey = `${variant.packageName}@${variant.packageVersion}`;
    const pkg = packagesMap.get(pkgKey);

    for (const shot of variant.screenshots) {
      // 变体标识与框架一致性核验
      if (shot.variantId !== variant.variantId || shot.framework !== variant.framework) {
        issues.push({
          code: 'SCREENSHOT_VARIANT_MISMATCH',
          variantId: variant.variantId,
          framework: variant.framework,
          message: `截图所属实现 (${shot.variantId}/${shot.framework}) 与当前变体 (${variant.variantId}/${variant.framework}) 框架错配`,
        });
      }

      // 版本一致性核验
      if (shot.packageVersion !== variant.packageVersion) {
        issues.push({
          code: 'SCREENSHOT_VARIANT_MISMATCH',
          variantId: variant.variantId,
          framework: variant.framework,
          message: `截图版本 (${shot.packageVersion}) 与变体版本 (${variant.packageVersion}) 不一致`,
        });
      }

      // 产物包哈希核验
      if (pkg && shot.packageSha256 !== pkg.tarball.sha256) {
        issues.push({
          code: 'DIGEST_MISMATCH',
          variantId: variant.variantId,
          framework: variant.framework,
          message: `截图关联包摘要 (${shot.packageSha256}) 与冻结包摘要 (${pkg.tarball.sha256}) 不匹配`,
        });
      }

      // 网页渠道来源强制约束
      if (shot.source !== 'manual-upload' || shot.environmentKey !== 'unknown-manual') {
        issues.push({
          code: 'SOURCE_FORBIDDEN',
          variantId: variant.variantId,
          framework: variant.framework,
          message: `网页手动提交截图来源必须为 manual-upload 且环境为 unknown-manual，严禁伪造 local-automatic`,
        });
      }
    }
  }

  return {
    ok: issues.length === 0,
    missingVariantIds,
    issues,
  };
}

/**
 * 构造合规的网页手动截图引用
 */
export function createManualScreenshotRef(options: {
  id: string;
  variantId: string;
  framework: Framework;
  packageVersion: string;
  packageSha256: string;
  exampleId: string;
  imagePath: string;
  imageSha256: string;
  imageBytes: number;
  width: number;
  height: number;
  state?: string;
}): ScreenshotRef {
  return {
    id: options.id,
    source: 'manual-upload',
    variantId: options.variantId,
    framework: options.framework,
    packageVersion: options.packageVersion,
    packageSha256: options.packageSha256,
    exampleId: options.exampleId,
    state: options.state ?? 'default',
    image: {
      path: options.imagePath,
      sha256: options.imageSha256,
      bytes: options.imageBytes,
    },
    environmentKey: 'unknown-manual',
  };
}
