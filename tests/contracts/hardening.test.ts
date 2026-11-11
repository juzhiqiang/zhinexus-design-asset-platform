import { describe, expect, it } from 'vitest';
import { canonicalJson, CONTRACT_SCHEMAS, validateCheckReport, validateEnvironment, validateManifest, validateReleaseBundle } from '@company/contracts';
import { digest, makeFixture, replaceReport } from '../fixtures/releases/g1/factory.js';

describe('G1 association and path edge cases', () => {
  it.each(['a/con.txt', 'a/Nul.png', 'a/com1.js', 'a//b', 'a/b/', 'a/../b', 'docs/*.md', 'a/COM¹.txt', 'a/lpt²', 'a/COM³.js'])('published JSON Schema pattern rejects %s without nonstandard flags', path => {
    const schema = CONTRACT_SCHEMAS['release-manifest-v1']!;
    const pattern = schema.properties!.files!.items!.properties!.path!.pattern!;
    expect(new RegExp(pattern).test(path)).toBe(false);
  });
  it.each(['0.0.1-01', '0.0.1-alpha.01', '0.0.1-00.beta'])('rejects numeric prerelease leading zeroes in %s', version => {
    const environment = structuredClone(makeFixture('cli').reports['reports/line-vue.json']!.environment);
    environment.frameworkVersion = version;
    expect(validateEnvironment(environment).ok).toBe(false);
    expect(new RegExp(CONTRACT_SCHEMAS['environment-v1']!.properties!.frameworkVersion!.pattern!).test(version)).toBe(false);
  });
  it.each(['0.0.1-0', '0.0.1-alpha.1', '0.0.1-01a', '9007199254740992.0.1'])('accepts syntactically valid exact SemVer %s', version => {
    const environment = structuredClone(makeFixture('cli').reports['reports/line-vue.json']!.environment);
    environment.frameworkVersion = version;
    expect(validateEnvironment(environment).ok).toBe(true);
  });
  it('rejects array accessors without invoking them', () => {
    const { manifest } = makeFixture();
    let calls = 0;
    const file = manifest.files[0]!;
    Object.defineProperty(manifest.files, '0', { enumerable: true, configurable: true, get() { calls++; return file; } });
    expect(validateManifest(manifest).ok).toBe(false);
    expect(() => canonicalJson(manifest)).toThrow();
    expect(calls).toBe(0);
  });
  it.each(['extra', 'symbol', 'non-enumerable', 'subclass'])('rejects non-JSON array property shape: %s', shape => {
    const { manifest } = makeFixture();
    if (shape === 'extra') Object.defineProperty(manifest.files, 'extra', { value: 1, enumerable: true });
    if (shape === 'symbol') Object.defineProperty(manifest.files, Symbol('hidden'), { value: 1 });
    if (shape === 'non-enumerable') Object.defineProperty(manifest.files, '0', { enumerable: false });
    if (shape === 'subclass') { class Files extends Array {} Object.setPrototypeOf(manifest.files, Files.prototype); }
    expect(validateManifest(manifest).ok).toBe(false);
    expect(() => canonicalJson(manifest)).toThrow();
  });
  it('rejects paths colliding under Windows case folding', () => {
    const { manifest } = makeFixture(); manifest.files.push({ ...manifest.files[0]!, path: manifest.files[0]!.path.toUpperCase() });
    expect(validateManifest(manifest).ok).toBe(false);
  });
  it('rejects NFC-equivalent path collisions', () => {
    const { manifest } = makeFixture(); manifest.files.push({ path: 'docs/é.md', sha256: 'a'.repeat(64), bytes: 0 }, { path: 'docs/e\u0301.md', sha256: 'a'.repeat(64), bytes: 0 });
    expect(validateManifest(manifest).ok).toBe(false);
  });
  it.each([['Σ', 'ς'], ['s', 'ſ']])('rejects portable case collisions between %s and %s', (a, b) => {
    const { manifest } = makeFixture();
    manifest.files.push({ path: `docs/${a}.md`, sha256: 'a'.repeat(64), bytes: 0 }, { path: `docs/${b}.md`, sha256: 'a'.repeat(64), bytes: 0 });
    expect(validateManifest(manifest).ok).toBe(false);
  });
  it.each([
    ['2026-11-12T09:00:00.000Z', false],
    ['2026-11-13T09:00:00.000Z', true],
  ] as const)('bounds all contributing reports by verification time %s', async (verifiedAt, expected) => {
    const f = makeFixture('cli');
    const variant = f.manifest.variants[0]!;
    variant.examples[0]!.requiredStates.push('updated');
    const extra = structuredClone(f.reports['reports/line-vue.json']!);
    extra.id = 'report-line-vue-updated';
    extra.createdAt = '2026-11-13T09:00:00.000Z';
    extra.screenshots[0]!.id = 'screenshot-line-vue-updated';
    extra.screenshots[0]!.state = 'updated';
    extra.screenshots[0]!.reportId = extra.id;
    variant.screenshots.push(extra.screenshots[0]!);
    const path = 'reports/line-vue-updated.json';
    const bytes = new TextEncoder().encode(JSON.stringify(extra));
    const ref = { path, sha256: digest(bytes), bytes: bytes.byteLength };
    f.files.set(path, bytes); f.reports[path] = extra;
    f.manifest.files.push(ref); f.manifest.reports.push(ref);
    variant.compatibility = [{ framework: 'vue', frameworkVersion: '3.5.45', echartsVersion: '6.1.0', status: 'passed', reportId: 'report-line-vue', verifiedAt }];
    expect(validateManifest(f.manifest, { reports: f.reports }).ok).toBe(expected);
    expect((await validateReleaseBundle(f.manifest, f.files)).ok).toBe(expected);
  });
  it('bounds standalone report issues to the documented limit', () => {
    const report = structuredClone(makeFixture('cli').reports['reports/line-vue.json']!);
    report.checks = Array.from({ length: 150 }, () => ({ name: 'duplicate', status: 'passed' as const }));
    const result = validateCheckReport(report);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toHaveLength(100);
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
