import { describe, expect, it } from 'vitest';
import { CONTRACT_SCHEMAS, validateCheckReport, validateManifest, validateReleaseBundle } from '@company/contracts';
import { makeFixture, replaceReport } from '../fixtures/releases/g1/factory.js';

describe('G1 association and path edge cases', () => {
  it.each(['a/con.txt', 'a/Nul.png', 'a/com1.js', 'a//b', 'a/b/', 'a/../b'])('published JSON Schema pattern rejects %s without nonstandard flags', path => {
    const schema = CONTRACT_SCHEMAS['release-manifest-v1']!;
    const pattern = schema.properties!.files!.items!.properties!.path!.pattern!;
    expect(new RegExp(pattern).test(path)).toBe(false);
  });
  it('rejects paths colliding under Windows case folding', () => {
    const { manifest } = makeFixture(); manifest.files.push({ ...manifest.files[0]!, path: manifest.files[0]!.path.toUpperCase() });
    expect(validateManifest(manifest).ok).toBe(false);
  });
  it('rejects NFC-equivalent path collisions', () => {
    const { manifest } = makeFixture(); manifest.files.push({ path: 'docs/é.md', sha256: 'a'.repeat(64), bytes: 0 }, { path: 'docs/e\u0301.md', sha256: 'a'.repeat(64), bytes: 0 });
    expect(validateManifest(manifest).ok).toBe(false);
  });
  it('requires every named state for automatic example evidence', () => {
    const f = makeFixture('cli'); f.manifest.variants[0]!.examples[0]!.requiredStates.push('empty');
    expect(validateManifest(f.manifest, { reports: f.reports }).ok).toBe(false);
  });
  it('does not impose automatic state coverage on manual display images', () => {
    const f = makeFixture(); f.manifest.variants[0]!.examples[0]!.requiredStates.push('empty');
    expect(validateManifest(f.manifest).ok).toBe(true);
  });
  it('rejects manual screenshot report references to another variant', () => {
    const f = makeFixture('cli'); f.manifest.channel = 'web';
    for (const report of Object.values(f.reports)) report.screenshots = structuredClone(report.screenshots);
    for (const variant of f.manifest.variants) for (const shot of variant.screenshots) { shot.source = 'manual-upload'; shot.environmentKey = 'unknown-manual'; }
    f.manifest.variants[0]!.screenshots[0]!.reportId = 'report-line-react';
    expect(validateManifest(f.manifest, { reports: f.reports }).ok).toBe(false);
  });
  it('accepts manual display images with separate correctly associated automatic reports', () => {
    const f = makeFixture('cli'); f.manifest.channel = 'web';
    for (const report of Object.values(f.reports)) report.screenshots = structuredClone(report.screenshots);
    for (const variant of f.manifest.variants) for (const shot of variant.screenshots) { shot.source = 'manual-upload'; shot.environmentKey = 'unknown-manual'; }
    expect(validateManifest(f.manifest, { reports: f.reports }).ok).toBe(true);
  });
  it('rejects candidate compatibility claiming a report for another variant', () => {
    const f = makeFixture('cli'); f.manifest.variants[0]!.compatibility = [{ framework: 'vue', frameworkVersion: '3.5.45', echartsVersion: '6.1.0', status: 'candidate', reportId: 'report-line-react' }];
    expect(validateManifest(f.manifest, { reports: f.reports }).ok).toBe(false);
  });
  it('rejects mutated environment keys even when manifest and report agree on the forgery', async () => {
    const f = makeFixture('cli');
    f.manifest.variants[0]!.screenshots[0]!.environmentKey = 'a'.repeat(64);
    // This fixture deliberately shares the screenshot object; both wire documents claim the same false key.
    replaceReport(f, 'reports/line-vue.json', f.reports['reports/line-vue.json']!);
    expect((await validateReleaseBundle(f.manifest, f.files)).ok).toBe(false);
  });
  it('rejects required-state coverage omitted from an otherwise passing compatibility report', () => {
    const f = makeFixture('cli');
    f.manifest.variants[0]!.examples[0]!.requiredStates.push('updated');
    f.manifest.variants[0]!.compatibility = [{ framework: 'vue', frameworkVersion: '3.5.45', echartsVersion: '6.1.0', status: 'passed', reportId: 'report-line-vue', verifiedAt: '2026-11-12T09:00:00.000Z' }];
    expect(validateManifest(f.manifest, { reports: f.reports }).ok).toBe(false);
  });
  it('rejects report screenshots with an invalid relation', () => {
    const report = structuredClone(makeFixture('cli').reports['reports/line-vue.json']!);
    report.screenshots[0]!.variantId = 'line-react'; expect(validateCheckReport(report).ok).toBe(false);
  });
});
