import { describe, expect, it } from 'vitest';
import * as contracts from '@company/contracts';
import { makeFixture, replaceReport } from '../fixtures/releases/g1/factory.js';

function rejects(input: unknown, code: string, path?: string, reports?: Record<string, unknown>) {
  const result = contracts.validateManifest(input, { reports });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code, ...(path ? { path } : {}) })]));
}

describe('G1 release manifest', () => {
  it.each(['web', 'cli'] as const)('accepts synthetic %s dual-framework multi-component fixtures', channel => {
    const { manifest, reports } = makeFixture(channel);
    expect(contracts.validateManifest(manifest, { reports })).toEqual({ ok: true, value: manifest });
  });
  it('accepts a core package without invented framework variants', () => {
    const { manifest } = makeFixture();
    manifest.packages = [{ ...manifest.packages[0]!, name: '@company/charts-core' }];
    manifest.variants = [];
    expect(contracts.validateManifest(manifest).ok).toBe(true);
  });
  it('rejects_react_variant_using_vue_screenshot', () => {
    const { manifest } = makeFixture();
    manifest.variants[2]!.screenshots = [manifest.variants[0]!.screenshots[0]!];
    rejects(manifest, 'SCREENSHOT_VARIANT_MISMATCH', '/variants/2/screenshots/0');
  });
  it('rejects_duplicate_package_version_with_different_digest', () => {
    const { manifest } = makeFixture();
    manifest.packages.push({ ...manifest.packages[0]!, tarball: { ...manifest.packages[0]!.tarball, sha256: 'a'.repeat(64) } });
    rejects(manifest, 'CONFLICT', '/packages/2');
  });
  it('rejects missing screenshots on the second component in a package', () => {
    const { manifest } = makeFixture(); manifest.variants[1]!.screenshots = [];
    rejects(manifest, 'SCREENSHOT_REQUIRED', '/variants/1/screenshots');
  });
  it.each(['framework', 'variantId', 'packageVersion', 'packageSha256', 'exampleId', 'state'] as const)('rejects mismatched screenshot %s', field => {
    const { manifest } = makeFixture();
    const shot = manifest.variants[0]!.screenshots[0]!;
    Object.assign(shot, { [field]: field === 'packageSha256' ? 'a'.repeat(64) : field === 'framework' ? 'react' : field === 'packageVersion' ? '0.0.2' : 'different' });
    rejects(manifest, field === 'packageSha256' ? 'DIGEST_MISMATCH' : 'SCREENSHOT_VARIANT_MISMATCH');
  });
  it('rejects web claims of automatic source', () => {
    const { manifest, reports } = makeFixture('cli'); manifest.channel = 'web';
    rejects(manifest, 'SOURCE_FORBIDDEN', undefined, reports);
  });
  it('rejects invented environments for manual uploads', () => {
    const { manifest } = makeFixture(); manifest.variants[0]!.screenshots[0]!.environmentKey = 'a'.repeat(64);
    rejects(manifest, 'SOURCE_FORBIDDEN');
  });
  it('requires parsed reports for automatic screenshots', () => {
    const { manifest } = makeFixture('cli'); rejects(manifest, 'REPORT_REQUIRED');
  });
  it('rejects automatic screenshots missing their report id', () => {
    const { manifest, reports } = makeFixture('cli'); delete manifest.variants[0]!.screenshots[0]!.reportId;
    rejects(manifest, 'REPORT_REQUIRED', undefined, reports);
  });
  it('rejects a report associated with another frozen package', () => {
    const f = makeFixture('cli'); f.reports['reports/line-vue.json']!.packageSha256 = 'a'.repeat(64);
    rejects(f.manifest, 'REPORT_MISMATCH', undefined, f.reports);
  });
  it('rejects a report changing screenshot contents while retaining the screenshot id', () => {
    const f = makeFixture('cli'); f.reports['reports/line-vue.json']!.screenshots = [{ ...f.manifest.variants[0]!.screenshots[0]!, image: { ...f.manifest.variants[0]!.screenshots[0]!.image, sha256: 'a'.repeat(64) } }];
    rejects(f.manifest, 'REPORT_MISMATCH', undefined, f.reports);
  });
  it('requires previewEntry inside previewFiles', () => {
    const { manifest } = makeFixture(); manifest.variants[0]!.examples[0]!.previewEntry = 'preview/missing.html';
    rejects(manifest, 'REFERENCE_NOT_FOUND');
  });
  it('requires nested artifacts in the complete file inventory with identical metadata', () => {
    const { manifest } = makeFixture(); manifest.variants[0]!.docs.bytes++;
    rejects(manifest, 'ARTIFACT_MISMATCH');
  });
  it('rejects duplicate normalized paths', () => {
    const { manifest } = makeFixture(); manifest.files.push(manifest.files[0]!);
    rejects(manifest, 'DUPLICATE_ID');
  });
  it.each(['../escape', '/absolute', 'C:/drive', 'folder\\file', 'a/./b', 'a/../b', 'a//b', '%2e%2e/file', 'a/%252e%252e/file', 'https://host/file', 'a/file:stream', 'a/file.', 'a/CON', 'a/file?x', 'a/file#x'])('rejects unsafe artifact path %s', path => {
    const { manifest } = makeFixture(); manifest.files[0]!.path = path;
    rejects(manifest, 'INVALID_PATH', '/files/0/path');
  });
  it.each([null, [], {}, { schemaVersion: 2 }, { ...makeFixture().manifest, surprise: true }])('rejects malformed/unknown schema input %#', input => {
    rejects(input, 'INVALID_SCHEMA');
  });
  it.each(['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'not-a-digest'])('rejects invalid digest %s', sha256 => {
    const { manifest } = makeFixture(); manifest.files[0]!.sha256 = sha256; rejects(manifest, 'INVALID_SCHEMA');
  });
  it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid artifact size %s', bytes => {
    const { manifest } = makeFixture(); manifest.files[0]!.bytes = bytes; rejects(manifest, 'INVALID_SCHEMA');
  });
  it('does not mutate web inputs to conceal source fraud', () => {
    const { manifest } = makeFixture(); manifest.variants[0]!.screenshots[0]!.source = 'local-automatic';
    const before = structuredClone(manifest); contracts.validateManifest(manifest); expect(manifest).toEqual(before);
  });
  it('requires ReactDOM and matching report for passed compatibility', () => {
    const f = makeFixture('cli');
    f.manifest.variants[2]!.compatibility = [{ framework: 'react', frameworkVersion: '19.3.1', echartsVersion: '6.1.0', status: 'passed' }];
    rejects(f.manifest, 'COMPATIBILITY_EVIDENCE_REQUIRED', undefined, f.reports);
  });
  it('accepts passed compatibility bound to a successful exact report', () => {
    const f = makeFixture('cli');
    f.manifest.variants[2]!.compatibility = [{ framework: 'react', frameworkVersion: '19.3.1', reactDomVersion: '19.3.1', echartsVersion: '6.1.0', status: 'passed', reportId: 'report-line-react', verifiedAt: '2026-11-12T09:00:00.000Z' }];
    expect(contracts.validateManifest(f.manifest, { reports: f.reports }).ok).toBe(true);
    f.reports['reports/line-react.json']!.checks[0]!.status = 'failed';
    rejects(f.manifest, 'COMPATIBILITY_EVIDENCE_REQUIRED', undefined, f.reports);
  });
  it('rejects unverified passed compatibility for manual submission', () => {
    const f = makeFixture();
    f.manifest.variants[0]!.compatibility = [{ framework: 'vue', frameworkVersion: '3.5.45', echartsVersion: '6.1.0', status: 'passed', reportId: 'invented', verifiedAt: '2026-11-12T09:00:00.000Z' }];
    rejects(f.manifest, 'COMPATIBILITY_EVIDENCE_REQUIRED');
  });
  it('accepts frozen synthetic bytes and rejects changes without repacking', async () => {
    const f = makeFixture('cli'); expect((await contracts.validateReleaseBundle(f.manifest, f.files)).ok).toBe(true);
    f.files.set(f.manifest.packages[0]!.tarball.path, new TextEncoder().encode('changed'));
    const result = await contracts.validateReleaseBundle(f.manifest, f.files);
    expect(result.ok).toBe(false); if (!result.ok) expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'DIGEST_MISMATCH' })]));
  });
  it('rejects missing files and unlisted files from a frozen bundle', async () => {
    const f = makeFixture(); f.files.delete(f.manifest.files[0]!.path);
    expect((await contracts.validateReleaseBundle(f.manifest, f.files)).ok).toBe(false);
    const g = makeFixture(); g.files.set('extra.js', new Uint8Array());
    expect((await contracts.validateReleaseBundle(g.manifest, g.files)).ok).toBe(false);
  });
  it('parses actual frozen report bytes rather than trusting supplied report objects', async () => {
    const f = makeFixture('cli'); const report = f.reports['reports/line-vue.json']!;
    report.packageSha256 = 'b'.repeat(64); replaceReport(f, 'reports/line-vue.json', report);
    const result = await contracts.validateReleaseBundle(f.manifest, f.files);
    expect(result.ok).toBe(false); if (!result.ok) expect(result.issues.some(x => x.code === 'REPORT_MISMATCH')).toBe(true);
  });
});
