/** Synthetic protocol fixtures, never evidence of a built package or browser run. */
import { createHash } from 'node:crypto';
import type { ArtifactRef, CheckReportV1, EnvironmentV1, ReleaseManifestV1 } from '@company/contracts';

export const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const environment: EnvironmentV1 = {
  os: 'windows', arch: 'x64', browserVersion: '131.0.0.0', browserRevision: '1234',
  fontDigest: digest('synthetic-font'), locale: 'zh-CN', timezone: 'Asia/Shanghai',
  deviceScaleFactor: 1, renderer: 'canvas', width: 800, height: 600, theme: 'light',
  frameworkVersion: '3.5.45', echartsVersion: '6.1.0',
};
// Independent Node implementation of the documented v1 environment projection.
export function expectedEnvironmentKey(env: EnvironmentV1): string {
  const { frameworkVersion: _framework, echartsVersion: _engine, ...key } = env;
  return digest(JSON.stringify(Object.fromEntries(Object.entries(key).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))));
}

export function makeFixture(channel: 'web' | 'cli' = 'web') {
  const files = new Map<string, Uint8Array>();
  function artifact(path: string, content: string): ArtifactRef {
    const bytes = new TextEncoder().encode(content);
    files.set(path, bytes);
    return { path, sha256: digest(bytes), bytes: bytes.byteLength };
  }
  const manifest: ReleaseManifestV1 = {
    schemaVersion: 1, channel, packages: [], variants: [], files: [], reports: [],
  };
  const reports: Record<string, CheckReportV1> = {};
  for (const framework of ['vue', 'react'] as const) {
    const name = `@company/charts-${framework}`;
    const tarball = artifact(`packages/charts-${framework}-0.0.1.tgz`, `synthetic-${framework}-tarball`);
    manifest.packages.push({ name, version: '0.0.1', tarball, sourceDigest: digest(`source-${framework}`), dependencies: {}, peerDependencies: { [framework]: framework === 'vue' ? '3.5.45' : '19.3.1', echarts: '6.1.0' } });
    for (const componentId of framework === 'vue' ? ['line', 'bar'] : ['line']) {
      const variantId = `${componentId}-${framework}`;
      const preview = artifact(`preview/${variantId}/index.html`, `<p>synthetic ${variantId}</p>`);
      const image = artifact(`screenshots/${variantId}.png`, 'synthetic-image-not-a-real-png');
      const screenshot = {
        id: `screenshot-${variantId}`, variantId, framework, packageVersion: '0.0.1',
        exampleId: `example-${variantId}`, state: 'default', source: channel === 'web' ? 'manual-upload' as const : 'local-automatic' as const,
        image, packageSha256: tarball.sha256, environmentKey: channel === 'web' ? 'unknown-manual' : expectedEnvironmentKey(environment),
        ...(channel === 'cli' ? { reportId: `report-${variantId}` } : {}),
      };
      const variant = {
        componentId, variantId, framework, packageName: name, packageVersion: '0.0.1', exportPath: `./${componentId}`, exportName: componentId === 'line' ? 'LineChart' : 'BarChart',
        api: artifact(`api/${variantId}.json`, '{}'), docs: artifact(`docs/${variantId}.md`, '# synthetic'),
        examples: [{ id: screenshot.exampleId, previewEntry: preview.path, previewFiles: [preview], fixtureDigest: digest('fixture'), renderer: 'canvas' as const, theme: 'light', width: 800, height: 600, requiredStates: ['default'] }],
        screenshots: [screenshot], compatibility: [],
      };
      if (channel === 'cli') {
        const report: CheckReportV1 = {
          id: `report-${variantId}`, toolVersion: '0.0.1', variantId, packageSha256: tarball.sha256,
          exampleId: screenshot.exampleId, environment: { ...environment, frameworkVersion: framework === 'vue' ? '3.5.45' : '19.3.1' },
          checks: [{ name: 'synthetic-render', status: 'passed' }], screenshots: [screenshot],
          baselineResult: 'NEW', createdAt: '2026-11-12T09:00:00.000Z',
        };
        const path = `reports/${variantId}.json`;
        reports[path] = report;
        manifest.reports.push(artifact(path, JSON.stringify(report)));
      }
      manifest.variants.push(variant);
    }
  }
  manifest.files = [...files.entries()].map(([path, bytes]) => ({ path, sha256: digest(bytes), bytes: bytes.byteLength }));
  return { manifest, reports, files };
}

export function replaceReport(fixture: ReturnType<typeof makeFixture>, path: string, report: CheckReportV1) {
  fixture.reports[path] = report;
  const bytes = new TextEncoder().encode(JSON.stringify(report));
  fixture.files.set(path, bytes);
  const ref = { path, sha256: digest(bytes), bytes: bytes.byteLength };
  fixture.manifest.reports = fixture.manifest.reports.map(x => x.path === path ? ref : x);
  fixture.manifest.files = fixture.manifest.files.map(x => x.path === path ? ref : x);
}
