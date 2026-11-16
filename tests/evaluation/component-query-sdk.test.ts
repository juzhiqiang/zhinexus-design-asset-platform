import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  expectedSdkComponents,
  readFrozenBundleManifest,
  validateExpectedSdkMatrix,
  validatePackageVersionConsistency,
  verifyFrozenBundleFiles,
  type ExpectedSdkComponent,
} from '../fixtures/component-query-sdk.js';

const REPO_ROOT = process.cwd();
const DEFAULT_FROZEN_BUNDLE_DIR =
  'D:/project/zhinexus-design-asset-platform/.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3';

function resolveFrozenBundleDir(): string {
  return process.env.A10_FROZEN_BUNDLE ?? DEFAULT_FROZEN_BUNDLE_DIR;
}

describe('P2 双框架真实 SDK 预期矩阵与独立源码审计', () => {
  it('导出 7 类 × 2 框架共 14 项独立预期矩阵且字段完整', () => {
    expect(expectedSdkComponents).toHaveLength(14);
    expect(validateExpectedSdkMatrix(expectedSdkComponents)).toEqual({ valid: true });

    const expectedKeys = [
      'componentId',
      'framework',
      'packageName',
      'exportName',
      'exportPath',
      'styleExport',
      'readyMethod',
      'eventNames',
    ] as const;

    for (const item of expectedSdkComponents) {
      for (const key of expectedKeys) {
        expect(item).toHaveProperty(key);
      }
      expect(item.styleExport).toBe('./style.css');
      expect(item.readyMethod).toBe('whenRendered');
      if (item.framework === 'vue') {
        expect(item.packageName).toBe('@company/charts-vue');
        expect(item.eventNames).toEqual(['point-click']);
      } else {
        expect(item.packageName).toBe('@company/charts-react');
        expect(item.eventNames).toEqual(['onPointClick']);
      }
    }

    const rankingEntries = expectedSdkComponents.filter((item) => item.componentId === 'ranking');
    expect(rankingEntries).toHaveLength(2);
    for (const entry of rankingEntries) {
      expect(entry.exportName).toBe('Ranking');
      expect(entry.exportPath).toBe('./ranking');
    }

    const proportionEntries = expectedSdkComponents.filter((item) => item.componentId === 'proportion');
    expect(proportionEntries).toHaveLength(2);
    for (const entry of proportionEntries) {
      expect(entry.exportName).toBe('Proportion');
      expect(entry.exportPath).toBe('./proportion');
    }
  });

  it('独立核对真实 SDK 源码导出、事件类型、样式导出与 required props', () => {
    const vuePkg = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'packages/charts-vue/package.json'), 'utf8'),
    ) as { exports: Record<string, unknown> };
    const reactPkg = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'packages/charts-react/package.json'), 'utf8'),
    ) as { exports: Record<string, unknown> };

    expect(vuePkg.exports).toHaveProperty('./style.css');
    expect(reactPkg.exports).toHaveProperty('./style.css');

    const vueIndex = readFileSync(path.join(REPO_ROOT, 'packages/charts-vue/src/index.ts'), 'utf8');
    const reactIndex = readFileSync(path.join(REPO_ROOT, 'packages/charts-react/src/index.ts'), 'utf8');

    for (const item of expectedSdkComponents) {
      const subpathKey = item.exportPath;
      const pkgExports = item.framework === 'vue' ? vuePkg.exports : reactPkg.exports;
      expect(pkgExports).toHaveProperty(subpathKey);

      const subpathFile = item.componentId;
      const pkgDir = item.framework === 'vue' ? 'packages/charts-vue/src' : 'packages/charts-react/src';
      const entrySource = readFileSync(path.join(REPO_ROOT, pkgDir, `${subpathFile}.ts`), 'utf8');
      const typesSource = readFileSync(path.join(REPO_ROOT, pkgDir, `${subpathFile}-chart.types.ts`), 'utf8');

      if (item.framework === 'vue') {
        expect(entrySource).toMatch(new RegExp(`export\\s*\\{\\s*default\\s+as\\s+${item.exportName}\\s*\\}`));
        expect(vueIndex).toMatch(new RegExp(`export\\s*\\{\\s*default\\s+as\\s+${item.exportName}\\s*\\}`));
        expect(typesSource).toContain("'point-click': [event: ChartEvent]");
      } else {
        expect(entrySource).toMatch(new RegExp(`export\\s*\\{\\s*${item.exportName}\\s*\\}`));
        expect(reactIndex).toMatch(new RegExp(`export\\s*\\{\\s*${item.exportName}\\s*\\}`));
        expect(typesSource).toContain('onPointClick?: (event: ChartEvent) => void');
      }

      expect(typesSource).toContain('data: ChartData;');
      expect(typesSource).toContain('whenRendered: () => Promise<void>;');
    }
  });

  it('反例：拒绝遗漏框架实现', () => {
    const missingReactRanking = expectedSdkComponents.filter(
      (item) => !(item.componentId === 'ranking' && item.framework === 'react'),
    );
    const result = validateExpectedSdkMatrix(missingReactRanking);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes('ranking') && e.includes('react'))).toBe(true);
    }
  });

  it('反例：拒绝重复 (componentId, framework) 键', () => {
    const duplicated: ExpectedSdkComponent[] = [
      ...expectedSdkComponents,
      { ...expectedSdkComponents[0]! },
    ];
    const result = validateExpectedSdkMatrix(duplicated);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes('重复'))).toBe(true);
    }
  });

  it('反例：拒绝错误事件名（Vue 使用 onPointClick 或 React 使用 point-click）', () => {
    const wrongVueEvent = expectedSdkComponents.map((item) =>
      item.componentId === 'line' && item.framework === 'vue'
        ? { ...item, eventNames: ['onPointClick'] }
        : item,
    );
    const vueRes = validateExpectedSdkMatrix(wrongVueEvent);
    expect(vueRes.valid).toBe(false);
    if (!vueRes.valid) {
      expect(vueRes.errors.some((e) => e.includes('point-click'))).toBe(true);
    }

    const wrongReactEvent = expectedSdkComponents.map((item) =>
      item.componentId === 'ranking' && item.framework === 'react'
        ? { ...item, eventNames: ['point-click'] }
        : item,
    );
    const reactRes = validateExpectedSdkMatrix(wrongReactEvent);
    expect(reactRes.valid).toBe(false);
    if (!reactRes.valid) {
      expect(reactRes.errors.some((e) => e.includes('onPointClick'))).toBe(true);
    }
  });

  it('反例：拒绝错误导出名或导出子路径（如 RankingChart）', () => {
    const wrongExportName = expectedSdkComponents.map((item) =>
      item.componentId === 'ranking' && item.framework === 'vue'
        ? { ...item, exportName: 'RankingChart' }
        : item,
    );
    const nameRes = validateExpectedSdkMatrix(wrongExportName);
    expect(nameRes.valid).toBe(false);
    if (!nameRes.valid) {
      expect(nameRes.errors.some((e) => e.includes('Ranking'))).toBe(true);
    }

    const wrongExportPath = expectedSdkComponents.map((item) =>
      item.componentId === 'proportion' && item.framework === 'react'
        ? { ...item, exportPath: './proportion-chart' }
        : item,
    );
    const pathRes = validateExpectedSdkMatrix(wrongExportPath);
    expect(pathRes.valid).toBe(false);
    if (!pathRes.valid) {
      expect(pathRes.errors.some((e) => e.includes('./proportion'))).toBe(true);
    }
  });

  it('反例：拒绝混用 @company/charts-core 与框架包版本或伪造 SHA-256', () => {
    const packageVersions = {
      '@company/charts-core': { version: '0.0.11', sha256: 'a'.repeat(64) },
      '@company/charts-vue': { version: '0.0.12', sha256: 'b'.repeat(64) },
      '@company/charts-react': { version: '0.0.12', sha256: 'c'.repeat(64) },
    };

    expect(
      validatePackageVersionConsistency(
        { packageName: '@company/charts-vue', packageVersion: '0.0.12', packageSha256: 'b'.repeat(64) },
        packageVersions,
      ),
    ).toEqual({ valid: true });

    const mixedCoreIntoVue = validatePackageVersionConsistency(
      { packageName: '@company/charts-vue', packageVersion: '0.0.11', packageSha256: 'b'.repeat(64) },
      packageVersions,
    );
    expect(mixedCoreIntoVue.valid).toBe(false);

    const mixedVueIntoCore = validatePackageVersionConsistency(
      { packageName: '@company/charts-core', packageVersion: '0.0.12', packageSha256: 'a'.repeat(64) },
      packageVersions,
    );
    expect(mixedVueIntoCore.valid).toBe(false);

    const wrongSha = validatePackageVersionConsistency(
      { packageName: '@company/charts-react', packageVersion: '0.0.12', packageSha256: 'd'.repeat(64) },
      packageVersions,
    );
    expect(wrongSha.valid).toBe(false);
  });

  it('核对冻结 bundle 的 manifest、199 文件摘要与 14 个变体 API 证据（禁止统一 SDK 版本）', () => {
    const bundleDir = resolveFrozenBundleDir();
    expect(existsSync(path.join(bundleDir, 'manifest.json'))).toBe(true);

    const fileCheck = verifyFrozenBundleFiles(bundleDir);
    expect(fileCheck.manifestReferencedFiles).toBe(185);
    expect(fileCheck.reportFiles).toBe(14);
    expect(fileCheck.bundleFilesExcludingManifest).toBe(199);
    expect(fileCheck.mismatches).toEqual([]);

    const summary = readFrozenBundleManifest(bundleDir);
    expect(summary.packages['@company/charts-core']?.version).toBe('0.0.11');
    expect(summary.packages['@company/charts-vue']?.version).toBe('0.0.12');
    expect(summary.packages['@company/charts-react']?.version).toBe('0.0.12');
    expect(summary.packages['@company/charts-core']?.version).not.toBe(
      summary.packages['@company/charts-vue']?.version,
    );

    expect(summary.variants).toHaveLength(14);

    const expectedMap = new Map(
      expectedSdkComponents.map((item) => [`${item.componentId}:${item.framework}`, item]),
    );

    for (const variant of summary.variants) {
      const expected = expectedMap.get(`${variant.componentId}:${variant.framework}`);
      expect(expected).toBeDefined();
      expect(variant.packageName).toBe(expected!.packageName);
      expect(variant.exportName).toBe(expected!.exportName);
      expect(variant.exportPath).toBe(expected!.exportPath);
      expect(variant.styleExport).toBe(expected!.styleExport);
      expect(variant.readyMethod).toBe(expected!.readyMethod);
      expect(variant.eventNames).toEqual(expected!.eventNames);
      expect(variant.requiredPropNames).toContain('data');

      const pkgCheck = validatePackageVersionConsistency(
        {
          packageName: variant.packageName,
          packageVersion: variant.packageVersion,
          packageSha256: variant.packageSha256,
        },
        summary.packages,
      );
      expect(pkgCheck).toEqual({ valid: true });
    }
  });
});
