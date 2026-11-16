import { describe, expect, it } from 'vitest';
import {
  validateVariantScreenshots,
} from '../../apps/gallery/app/lib/uploads/screenshot-validation.js';
import type {
  PackageRef,
  VariantRef,
} from '../../packages/component-cli/src/contracts/release-manifest.js';

/**
 * 二期发布验收补齐（T04/T07/T08）：网页手动提交的截图/冻结包一致性覆盖补齐。
 *
 * 背景（详见 `docs/verification/b-release-acceptance-2026-11-16.md`）：
 * - 缺口 E：既有 `web-upload-workflow.test.ts` 的 `validateVariantScreenshots` 用例全部不传
 *   `packages`，`DIGEST_MISMATCH`（截图包摘要 vs 冻结包摘要）分支无覆盖。本文件补齐。
 * - 原「同一实现重复关联同一 `image.sha256` 必须拒绝」按 C 2026-11-16 复核意见**已撤除**：
 *   现有契约只要求每个框架实现正确关联至少一张有效截图，Vue/React 可能产出相同图片字节，
 *   SHA 唯一性属未授权约束，改为文档审计排除项，不改契约。
 * - 冻结 tarball 的编排级覆盖见 `tests/integration/cli-check-tamper-orchestration.test.ts`。
 *
 * 本文件四条用例行为均已存在，属覆盖补齐，宿主实跑应全部通过。
 */

/** 构造一个最小合法的网页手动截图引用（与上传页 `createManualScreenshotRef` 同语义）。 */
function manualShot(overrides: {
  id: string;
  variantId: string;
  framework: 'vue' | 'react';
  packageVersion: string;
  packageSha256: string;
  exampleId: string;
  imagePath: string;
  imageSha256: string;
  imageBytes: number;
  width?: number;
  height?: number;
}) {
  return {
    id: overrides.id,
    source: 'manual-upload' as const,
    variantId: overrides.variantId,
    framework: overrides.framework,
    packageVersion: overrides.packageVersion,
    packageSha256: overrides.packageSha256,
    exampleId: overrides.exampleId,
    state: 'default',
    image: { path: overrides.imagePath, sha256: overrides.imageSha256, bytes: overrides.imageBytes },
    environmentKey: 'unknown-manual',
    width: overrides.width ?? 800,
    height: overrides.height ?? 400,
  };
}

/** 最小变体引用（只填校验器会读到的字段）。 */
function variant(overrides: Partial<VariantRef> & { variantId: string; framework: 'vue' | 'react' }): VariantRef {
  return {
    componentId: overrides.variantId.split('-')[0]!,
    variantId: overrides.variantId,
    framework: overrides.framework,
    packageName: overrides.packageName ?? '@company/charts-react',
    packageVersion: overrides.packageVersion ?? '0.0.5',
    exportPath: './line',
    exportName: 'LineChart',
    api: { path: 'api/line.json', sha256: 'a'.repeat(64), bytes: 10 },
    docs: { path: 'docs/line.md', sha256: 'b'.repeat(64), bytes: 10 },
    examples: [],
    screenshots: overrides.screenshots ?? [],
    compatibility: [],
  };
}

describe('T08 网页逐实现必检：截图必须真实对应冻结包', () => {
  const imageSha = 'c'.repeat(64);
  const frozenSha = 'd'.repeat(64);

  it('distinct_screenshots_for_same_variant_are_accepted: 不同字节的截图各自计入证据', () => {
    const lineVue = variant({
      variantId: 'line-vue',
      framework: 'vue',
      screenshots: [
        manualShot({
          id: 'shot-line-vue-default',
          variantId: 'line-vue',
          framework: 'vue',
          packageVersion: '0.0.5',
          packageSha256: frozenSha,
          exampleId: 'example-line-vue-default',
          imagePath: 'screenshots/line-vue-default.png',
          imageSha256: imageSha,
          imageBytes: 2048,
        }),
        manualShot({
          id: 'shot-line-vue-empty',
          variantId: 'line-vue',
          framework: 'vue',
          packageVersion: '0.0.5',
          packageSha256: frozenSha,
          exampleId: 'example-line-vue-empty',
          imagePath: 'screenshots/line-vue-empty.png',
          imageSha256: 'e'.repeat(64),
          imageBytes: 1024,
        }),
      ],
    });

    const result = validateVariantScreenshots([lineVue]);

    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});

describe('T08 网页逐实现必检：截图摘要必须比对冻结包摘要', () => {
  it('screenshot_digest_is_checked_against_frozen_package: 传入 packages 时摘要不符必须报 DIGEST_MISMATCH', () => {
    const frozenSha = 'f'.repeat(64);
    const wrongSha = '1'.repeat(64);

    const pkg: PackageRef = {
      name: '@company/charts-react',
      version: '0.0.5',
      tarball: { path: 'packages/charts-react-0.0.5.tgz', sha256: frozenSha, bytes: 4096 },
      sourceDigest: '2'.repeat(64),
      dependencies: {},
      peerDependencies: {},
    };

    const lineReact = variant({
      variantId: 'line-react',
      framework: 'react',
      packageName: '@company/charts-react',
      packageVersion: '0.0.5',
      screenshots: [
        manualShot({
          id: 'shot-line-react',
          variantId: 'line-react',
          framework: 'react',
          packageVersion: '0.0.5',
          packageSha256: wrongSha,
          exampleId: 'example-line-react-default',
          imagePath: 'screenshots/line-react.png',
          imageSha256: '3'.repeat(64),
          imageBytes: 2048,
        }),
      ],
    });

    const result = validateVariantScreenshots([lineReact], [pkg]);

    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'DIGEST_MISMATCH')).toBe(true);
    expect(result.issues.some((i) => i.variantId === 'line-react')).toBe(true);
  });

  it('screenshot_digest_matching_frozen_package_is_accepted: 摘要一致时放行', () => {
    const frozenSha = 'f'.repeat(64);

    const pkg: PackageRef = {
      name: '@company/charts-react',
      version: '0.0.5',
      tarball: { path: 'packages/charts-react-0.0.5.tgz', sha256: frozenSha, bytes: 4096 },
      sourceDigest: '2'.repeat(64),
      dependencies: {},
      peerDependencies: {},
    };

    const lineReact = variant({
      variantId: 'line-react',
      framework: 'react',
      packageName: '@company/charts-react',
      packageVersion: '0.0.5',
      screenshots: [
        manualShot({
          id: 'shot-line-react',
          variantId: 'line-react',
          framework: 'react',
          packageVersion: '0.0.5',
          packageSha256: frozenSha,
          exampleId: 'example-line-react-default',
          imagePath: 'screenshots/line-react.png',
          imageSha256: '3'.repeat(64),
          imageBytes: 2048,
        }),
      ],
    });

    const result = validateVariantScreenshots([lineReact], [pkg]);

    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('web_source_is_enforced_even_with_matching_digest: 摘要一致但来源不是 manual-upload 仍须拒绝', () => {
    const frozenSha = 'f'.repeat(64);

    const pkg: PackageRef = {
      name: '@company/charts-react',
      version: '0.0.5',
      tarball: { path: 'packages/charts-react-0.0.5.tgz', sha256: frozenSha, bytes: 4096 },
      sourceDigest: '2'.repeat(64),
      dependencies: {},
      peerDependencies: {},
    };

    const forged = manualShot({
      id: 'shot-line-react',
      variantId: 'line-react',
      framework: 'react',
      packageVersion: '0.0.5',
      packageSha256: frozenSha,
      exampleId: 'example-line-react-default',
      imagePath: 'screenshots/line-react.png',
      imageSha256: '3'.repeat(64),
      imageBytes: 2048,
    });
    // 伪造自动验证来源与环境键
    const lineReact = variant({
      variantId: 'line-react',
      framework: 'react',
      packageName: '@company/charts-react',
      packageVersion: '0.0.5',
      screenshots: [{ ...forged, source: 'local-automatic' as const, environmentKey: 'a'.repeat(64) }],
    });

    const result = validateVariantScreenshots([lineReact], [pkg]);

    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'SOURCE_FORBIDDEN')).toBe(true);
  });
});
