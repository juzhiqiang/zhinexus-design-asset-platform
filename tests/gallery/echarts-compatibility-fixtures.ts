import type { AcceptedCompatibilityRecord, ApiMessages, Framework } from '@company/contracts';

export const candidateIntegrity = `sha512-${'A'.repeat(86)}==`;
export const packageSha256 = 'a'.repeat(64);

export function officialFixture(version = '6.2.0') {
  return { name: 'echarts', version, dist: { integrity: candidateIntegrity, tarball: `https://registry.npmjs.org/echarts/-/echarts-${version}.tgz` } };
}

export function releaseFixture(framework: Framework = 'vue'): ApiMessages['variantReleaseResponse'] {
  const variantId = `line-${framework}`;
  const artifact = (path: string) => ({ path, sha256: packageSha256, bytes: 10 });
  return {
    variantReleaseId: `release-${framework}`,
    variant: { componentId: 'line', variantId, framework, packageName: `@company/charts-${framework}`, packageVersion: '0.0.12',
      exportPath: './line', exportName: 'LineChart', api: artifact(`api/${variantId}.json`), docs: artifact(`docs/${variantId}.md`),
      examples: [{ id: `${variantId}-default`, previewEntry: `preview/${variantId}/index.html`, previewFiles: [artifact(`preview/${variantId}/index.html`)], fixtureDigest: packageSha256, renderer: 'canvas', theme: 'light', width: 800, height: 400, requiredStates: ['default'] }],
      screenshots: [], compatibility: [] },
    package: { name: `@company/charts-${framework}`, version: '0.0.12', tarball: artifact(`packages/charts-${framework}.tgz`), sourceDigest: packageSha256, dependencies: {}, peerDependencies: { echarts: '6.1.0', [framework]: framework === 'vue' ? '3.5.45' : '19.3.1' } },
    availability: 'Ready', reportSource: 'local-automatic', baselineStatus: 'accepted', indexStatus: 'indexed',
  };
}

export function catalogFixture(framework: Framework = 'vue'): ApiMessages['componentsResponse'] {
  const release = releaseFixture(framework);
  return { items: [{ componentId: 'line', variants: [{ variantReleaseId: release.variantReleaseId, variantId: release.variant.variantId, framework, packageName: release.package.name, packageVersion: release.package.version }] }], page: 1, pageSize: 100, total: 1 };
}

export function compatibilityFixture(framework: Framework = 'vue'): ApiMessages['variantCompatibilityResponse'] {
  const release = releaseFixture(framework);
  const record: AcceptedCompatibilityRecord = { compatibilityId: `accepted-${framework}`, variantReleaseId: release.variantReleaseId,
    packageName: release.package.name, packageVersion: release.package.version, packageSha256, framework,
    frameworkVersion: framework === 'vue' ? '3.5.45' : '19.3.1', echartsVersion: '6.1.0', candidateIntegrity,
    candidateSource: 'https://registry.npmjs.org/echarts', status: 'passed', evidenceSha256: 'b'.repeat(64), createdAt: '2026-11-21T01:00:00Z' };
  return { variantReleaseId: release.variantReleaseId, items: [record] };
}
