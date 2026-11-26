import { describe, expect, it } from 'vitest';
import * as contracts from '@company/contracts';
import { makeFixture, replaceReport } from '../fixtures/releases/g1/factory.js';

describe('category snapshots and ordinary component materials', () => {
  it('rejects NUL in category create, update and response names before PostgreSQL storage', () => {
    for (const name of ['\u0000', 'bad\u0000name']) {
      expect(contracts.validateCreateComponentCategory({ id: 'general', name }).ok).toBe(false);
      expect(contracts.validateUpdateComponentCategory({ name, enabled: true, expectedRevision: '0' }).ok).toBe(false);
      expect(contracts.validateComponentCategory({ id: 'general', name, enabled: true, revision: '0' }).ok).toBe(false);
    }
  });
  it('validates category administration and publishing wire inputs without trusting extra authority fields', () => {
    const category = { id: 'charts', name: '图表', enabled: true, revision: '0' };
    expect(contracts.validateComponentCategory(category).ok).toBe(true);
    expect(contracts.validateComponentCategoryList({ items: [category] }).ok).toBe(true);
    expect(contracts.validateCreateComponentCategory({ id: 'charts', name: '图表' }).ok).toBe(true);
    expect(contracts.validateUpdateComponentCategory({ name: '图表', enabled: false, expectedRevision: '12' }).ok).toBe(true);
    expect(contracts.validatePublishingOptions({ categories: [category], components: [{ componentId: 'line', category: 'uncategorized', isPublic: false }], packages: ['@company/charts-vue'] }).ok).toBe(true);
    expect(contracts.validateUpdateComponentVisibility({ isPublic: true, reason: '评审通过后对画廊公开' }).ok).toBe(true);
    expect(contracts.validateUpdateComponentVisibility({ isPublic: true, reason: '   ' }).ok).toBe(false);
    expect(contracts.validateUpdateComponentVisibility({ isPublic: true, reason: 'ok', subject: 'forged' }).ok).toBe(false);
    expect(contracts.validateComponentVisibility({ componentId: 'line', isPublic: true, category: 'charts' }).ok).toBe(true);
    expect(contracts.validateComponentReleaseHistory({
      componentId: 'line',
      category: 'charts',
      isPublic: false,
      items: [{ variantReleaseId: '11111111-1111-4111-8111-111111111111', variantId: 'line-vue', framework: 'vue', packageName: '@company/charts-vue', packageVersion: '0.1.0', exportName: 'LineChart', availability: 'DEPRECATED', deprecatedReason: '已被 0.2.0 替代' }],
    }).ok).toBe(true);
    for (const name of ['', ' ', ' padded ', 'a'.repeat(129)]) expect(contracts.validateCreateComponentCategory({ id: 'charts', name }).ok).toBe(false);
    for (const expectedRevision of ['-1', '01', 1, '*']) expect(contracts.validateUpdateComponentCategory({ name: '图表', enabled: true, expectedRevision }).ok).toBe(false);
    expect(contracts.validateCreateComponentCategory({ id: 'charts', name: '图表', subject: 'forged', administrator: true }).ok).toBe(false);
    expect(contracts.validatePublishingOptions({ categories: [category], components: [], packages: ['*'] }).ok).toBe(false);
  });
  it('accepts a stable category snapshot on both frameworks and preserves old manifests', () => {
    const { manifest } = makeFixture();
    expect(contracts.validateManifest(manifest).ok).toBe(true);
    for (const variant of manifest.variants) Object.assign(variant, { category: 'charts' });
    expect(contracts.validateManifest(manifest).ok).toBe(true);
  });
  it('rejects conflicting explicit categories for the same logical component', () => {
    const { manifest } = makeFixture();
    Object.assign(manifest.variants[0]!, { category: 'charts' });
    Object.assign(manifest.variants[2]!, { category: 'cards' });
    const result = contracts.validateManifest(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: 'CONFLICT', path: '/variants/2/category' }));
  });
  it.each(['', '../charts', '*', 'a'.repeat(129)])('rejects invalid snapshot ID %s', category => {
    const { manifest } = makeFixture(); Object.assign(manifest.variants[0]!, { category });
    expect(contracts.validateManifest(manifest).ok).toBe(false);
  });
  it('accepts an ordinary component API without fabricated CSS or a component ready method', () => {
    expect(contracts.validateComponentApi({ schemaVersion: 1, componentId: 'button', framework: 'react', exportName: 'Button', exportPath: './button', props: [], events: [], notes: [] }).ok).toBe(true);
  });
  it('accepts honest automatic reports without an ECharts dependency and keeps the environment key stable', async () => {
    const fixture = makeFixture('cli');
    const report = fixture.reports['reports/line-vue.json']!;
    const before = await contracts.environmentKey(report.environment);
    delete (report.environment as Partial<contracts.EnvironmentV1>).echartsVersion;
    replaceReport(fixture, 'reports/line-vue.json', report);
    expect(contracts.validateCheckReport(report).ok).toBe(true);
    expect(contracts.validateManifest(fixture.manifest, { reports: fixture.reports }).ok).toBe(true);
    expect(await contracts.environmentKey(report.environment)).toBe(before);
    fixture.manifest.variants[0]!.compatibility = [{ framework: 'vue', frameworkVersion: '3.5.45', echartsVersion: '6.1.0', status: 'passed', reportId: report.id, verifiedAt: report.createdAt }];
    expect(contracts.validateManifest(fixture.manifest, { reports: fixture.reports }).ok).toBe(false);
  });
});
