import { describe, expect, it } from 'vitest';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { ValidationResult } from '@company/contracts';
import { createValidBundle, jpegBytes, packageBytes, pngBytes, replaceBundleArtifact, tarBytes } from '../fixtures/t05-artifacts.js';
import { digest, replaceReport } from '../fixtures/releases/g1/factory.js';

// Services are exercised through their compiled exports, as production loads them.
const api = await import('../../apps/api/dist/uploads/validator.js');
const reject = (result: ValidationResult<unknown>, code?: string) => {
  expect(result.ok).toBe(false);
  if (!result.ok && code) expect(result.issues.some(issue => issue.code === code)).toBe(true);
};
describe('bounded upload byte validation', () => {
  it('decodes actual PNG and JPEG and reports their dimensions', async () => {
    expect(await api.validateUploadedArtifact('shot.png', pngBytes())).toEqual({ ok: true, value: { mimeType: 'image/png', width: 2, height: 2 } });
    expect(await api.validateUploadedArtifact('shot.jpeg', jpegBytes())).toEqual({ ok: true, value: { mimeType: 'image/jpeg', width: 2, height: 2 } });
  });
  it.each([
    ['shot.png', Buffer.from('fake png')], ['shot.png', jpegBytes()], ['shot.jpg', pngBytes()],
    ['shot.png', pngBytes().subarray(0, 40)], ['shot.jpg', jpegBytes().subarray(0, 40)],
    ['shot.png', Buffer.concat([pngBytes(), Buffer.from('<script>evil</script>')])],
    ['../shot.png', pngBytes()], ['shot.png', Buffer.alloc(10 * 1024 ** 2 + 1)],
  ])('rejects malformed, mismatched, unsafe or oversized file %s', async (path, bytes) => {
    reject(await api.validateUploadedArtifact(path, bytes));
  });
  it('rejects an excessive PNG header before decoding pixel buffers', async () => {
    const bytes = pngBytes(); bytes.writeUInt32BE(8193, 16);
    reject(await api.validateUploadedArtifact('shot.png', bytes));
  });
  it.each(['../escape.js', '/package/evil.js', 'package/../evil.js', 'package\\evil.js', 'C:/evil.js', 'package/file:stream', 'package/CON', 'package/file.', 'package/COM\u00b9', 'package/a|b', 'package/a*b'])('rejects tar path %s', async name => {
    reject(await api.validateUploadedArtifact('pkg.tgz', await tarBytes([{ name, bytes: Buffer.from('x') }])));
  });
  it.each(['symlink', 'link'] as const)('rejects tar %s entries', async type => {
    reject(await api.validateUploadedArtifact('pkg.tgz', await tarBytes([{ name: 'package/link', type, linkname: 'package/safe.js' }])));
  });
  it.each([['package/A.js', 'package/a.js'], ['package/a.js', 'package/a.js'], ['package/caf\u00e9.js', 'package/cafe\u0301.js']])('rejects canonical tar collisions', async (first, second) => {
    reject(await api.validateUploadedArtifact('pkg.tgz', await tarBytes([{ name: first!, bytes: Buffer.from('x') }, { name: second!, bytes: Buffer.from('y') }])));
  });
  it('rejects unsafe PAX path overrides', async () => {
    reject(await api.validateUploadedArtifact('pkg.tgz', await tarBytes([{ name: 'package/a', bytes: Buffer.from('x'), pax: { path: '../escape' } }])));
  });
  it('rejects too many archive entries', async () => {
    reject(await api.validateUploadedArtifact('pkg.tgz', await tarBytes(Array.from({ length: 5001 }, (_, i) => ({ name: `package/${i}`, bytes: Buffer.alloc(0) })) )));
  });
  it('rejects decompression bombs with bounded output', async () => {
    reject(await api.validateUploadedArtifact('pkg.tgz', gzipSync(Buffer.alloc(200 * 1024 ** 2 + 512))));
  });
  it('rejects an archive header claiming unbounded entry memory', async () => {
    const raw = gunzipSync(await tarBytes([{ name: 'package/a', bytes: Buffer.from('x') }]));
    raw.fill(0, 124, 136); raw.write('77777777777', 124); raw.fill(32, 148, 156);
    const sum = raw.subarray(0, 512).reduce((a, b) => a + b, 0); raw.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    reject(await api.validateUploadedArtifact('pkg.tgz', gzipSync(raw)));
  });
  it('accepts safe Unicode PAX filenames and directories', async () => {
    expect((await api.validateUploadedArtifact('pkg.tgz', await tarBytes([
      { name: 'package/', type: 'directory' }, { name: 'package/docs/', type: 'directory' },
      { name: 'package/docs/\u6587\u6863.md', bytes: Buffer.from('# docs') },
    ]))).ok).toBe(true);
  });
  it('rejects JPEG trailing payloads and oversized frame dimensions before decoding', async () => {
    reject(await api.validateUploadedArtifact('shot.jpg', Buffer.concat([jpegBytes(), Buffer.from('trailer'), Buffer.from([255, 217])])));
    const bytes = jpegBytes(); const frame = bytes.indexOf(Buffer.from([255, 192])); bytes.writeUInt16BE(8193, frame + 7);
    reject(await api.validateUploadedArtifact('shot.jpg', bytes));
  });
});
describe('platform frozen bundle validation', () => {
  it.each(['web', 'cli'] as const)('accepts valid real npm/PNG %s materials', async channel => {
    const { manifest, files } = await createValidBundle(channel);
    expect((await api.validatePlatformBundle(manifest, files, channel)).ok).toBe(true);
  });
  it.each(['DIGEST_MISMATCH', 'SCREENSHOT_REQUIRED', 'SCREENSHOT_VARIANT_MISMATCH', 'SOURCE_FORBIDDEN'])('preserves shared contract rejection %s', async code => {
    const f = await createValidBundle(); const shot = f.manifest.variants[0]!.screenshots[0]!;
    if (code === 'DIGEST_MISMATCH') f.files.set(shot.image.path, Buffer.from('changed'));
    if (code === 'SCREENSHOT_REQUIRED') f.manifest.variants[0]!.screenshots = [];
    if (code === 'SCREENSHOT_VARIANT_MISMATCH') shot.framework = 'react';
    if (code === 'SOURCE_FORBIDDEN') shot.source = 'local-automatic';
    reject(await api.validatePlatformBundle(f.manifest, f.files, 'web'), code);
  });
  it('rejects cli declarations received through an authenticated web client', async () => {
    const f = await createValidBundle('cli'); reject(await api.validatePlatformBundle(f.manifest, f.files, 'web'), 'SOURCE_FORBIDDEN');
  });
  it('allows SVG as static preview bytes but rejects it as a screenshot', async () => {
    expect((await api.validateUploadedArtifact('preview/chart.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).ok).toBe(true);
    const f = await createValidBundle(); const shot = f.manifest.variants[0]!.screenshots[0]!;
    const old = shot.image.path; const next = old.replace('.png', '.svg');
    f.files.delete(old); f.files.set(next, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
    for (const ref of [shot.image, ...f.manifest.files.filter(ref => ref.path === old)]) ref.path = next;
    replaceBundleArtifact(f, next, f.files.get(next)!);
    reject(await api.validatePlatformBundle(f.manifest, f.files, 'web'));
  });
  it.each([
    { version: '0.0.9' }, { name: '@evil/package' }, { dependencies: { evil: '1.0.0' } },
    { peerDependencies: {} }, { exports: { '.': './dist/index.js' } },
    { exports: { './line': '../escape.js', './bar': './dist/bar.js' } },
    { exports: { './line': './dist/missing.js', './bar': './dist/bar.js' } },
    { exports: { './line': { types: './dist/line.d.ts' }, './bar': './dist/bar.js' } },
    { exports: { './line': './dist/line.js', './bar': './dist/bar.js', './pie': './dist/index.js' } },
  ])('rejects npm identity, dependency or export mismatch %j', async overrides => {
    const f = await createValidBundle(); replaceBundleArtifact(f, f.manifest.packages[0]!.tarball.path, await packageBytes(f, 0, overrides));
    reject(await api.validatePlatformBundle(f.manifest, f.files, 'web'));
  });
  it('rejects removal of an implementation for a managed npm export', async () => {
    const f = await createValidBundle(); f.manifest.variants = f.manifest.variants.filter(v => v.variantId !== 'bar-vue');
    reject(await api.validatePlatformBundle(f.manifest, f.files, 'web'));
  });
  it('does not require fabricated component variants for a root-only core package', async () => {
    const f = await createValidBundle(); f.manifest.variants = []; f.manifest.packages = [f.manifest.packages[0]!];
    const pkg = f.manifest.packages[0]!; pkg.name = '@company/charts-core'; pkg.peerDependencies = { echarts: '6.1.0' };
    replaceBundleArtifact(f, pkg.tarball.path, await packageBytes(f));
    expect((await api.validatePlatformBundle(f.manifest, f.files, 'web')).ok).toBe(true);
  });
  it('rejects SVG held only in report ScreenshotRef evidence', async () => {
    const f = await createValidBundle('cli'); f.manifest.channel = 'web';
    for (const variant of f.manifest.variants) variant.screenshots = variant.screenshots.map(shot => ({ ...shot, source: 'manual-upload', environmentKey: 'unknown-manual' }));
    const [reportPath, report] = Object.entries(f.reports)[0]!;
    const path = 'screenshots/report-only.svg'; const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const ref = { path, bytes: bytes.length, sha256: digest(bytes) }; f.files.set(path, bytes); f.manifest.files.push(ref);
    report.screenshots[0]!.image = ref; replaceReport(f, reportPath, report);
    reject(await api.validatePlatformBundle(f.manifest, f.files, 'web'));
  });
  it('rejects total bytes and file count before parsing an invalid manifest', async () => {
    const bytes = Buffer.alloc(50 * 1024 ** 2); const files = new Map(Array.from({ length: 11 }, (_, i) => [`asset-${i}`, bytes] as const));
    reject(await api.validatePlatformBundle({}, files, 'web'), 'ARTIFACT_MISMATCH');
    reject(await api.validatePlatformBundle({}, new Map(Array.from({ length: 5001 }, (_, i) => [`asset-${i}`, Buffer.alloc(1)] as const)), 'web'), 'ARTIFACT_MISMATCH');
  });
  it('rejects actual JSON nesting beyond the bounded document depth', async () => {
    reject(await api.validateUploadedArtifact('api.json', Buffer.from('['.repeat(33) + '0' + ']'.repeat(33))));
  });
});

describe('review regressions for npm runtime inventory and conditions', () => {
  it.each(['constructor', '__proto__'])('returns an inert string MIME for inherited suffix %s', async extension => {
    expect(await api.validateUploadedArtifact(`asset.${extension}`, Buffer.from('bytes'))).toEqual({ ok: true, value: { mimeType: 'application/octet-stream' } });
  });
  it.each(['./custom-chart', './charts/line'])('rejects undeclared runtime component subpath %s', async subpath => {
    const f = await createValidBundle();
    replaceBundleArtifact(f, f.manifest.packages[0]!.tarball.path, await packageBytes(f, 0, { exports: {
      '.': './dist/index.js', './line': './dist/line.js', './bar': './dist/bar.js', [subpath]: './dist/index.js',
    } }));
    reject(await api.validatePlatformBundle(f.manifest, f.files, 'web'));
  });
  it.each(['./custom-chart', './charts/line'])('accepts declared custom runtime subpath with its own screenshot %s', async subpath => {
    const f = await createValidBundle(); const variant = f.manifest.variants[0]!; variant.exportPath = subpath;
    replaceBundleArtifact(f, f.manifest.packages[0]!.tarball.path, await packageBytes(f));
    expect((await api.validatePlatformBundle(f.manifest, f.files, 'web')).ok).toBe(true);
  });
  it('allows explicit non-JavaScript style exports without fabricating variants', async () => {
    const f = await createValidBundle(); const raw = gunzipSync(await packageBytes(f, 0, { exports: {
      '.': './dist/index.js', './line': './dist/line.js', './bar': './dist/bar.js', './style.css': './dist/style.css',
    } }));
    const extra = gunzipSync(await tarBytes([{ name: 'package/dist/style.css', bytes: Buffer.from('.chart {}') }]));
    replaceBundleArtifact(f, f.manifest.packages[0]!.tarball.path, gzipSync(Buffer.concat([raw.subarray(0, -1024), extra])));
    expect((await api.validatePlatformBundle(f.manifest, f.files, 'web')).ok).toBe(true);
  });
  it.each([
    { optionalDependencies: { hidden: '1.0.0' } }, { optionalDependencies: { echarts: '9.0.0' } },
    { bundledDependencies: ['hidden'] }, { bundleDependencies: ['hidden'] }, { bundledDependencies: true },
  ])('rejects unmodeled installation dependencies %j', async overrides => {
    const f = await createValidBundle();
    replaceBundleArtifact(f, f.manifest.packages[0]!.tarball.path, await packageBytes(f, 0, overrides));
    reject(await api.validatePlatformBundle(f.manifest, f.files, 'web'));
  });
  it('rejects optional overrides of an otherwise exactly declared runtime dependency', async () => {
    const f = await createValidBundle(); f.manifest.packages[0]!.dependencies = { '@company/charts-core': '0.0.2' };
    replaceBundleArtifact(f, f.manifest.packages[0]!.tarball.path, await packageBytes(f, 0, { optionalDependencies: { '@company/charts-core': '0.0.9' } }));
    reject(await api.validatePlatformBundle(f.manifest, f.files, 'web'));
  });
  it.each([
    ['@company/contracts', '0.0.1'], ['@company/platform-api', '0.0.1'], ['@company/gallery', '0.0.1'],
    ['@company/charts-core', 'workspace:*'], ['other', 'file:../other'], ['other', 'npm:@company/contracts@0.0.1'], ['other', '^1.0.0'],
  ])('rejects forbidden frozen runtime dependency %s=%s even when manifest agrees', async (name, version) => {
    const f = await createValidBundle(); f.manifest.packages[0]!.dependencies = { [name!]: version! };
    replaceBundleArtifact(f, f.manifest.packages[0]!.tarball.path, await packageBytes(f));
    reject(await api.validatePlatformBundle(f.manifest, f.files, 'web'));
  });
  it('accepts declared exact public dependencies including a valid prerelease', async () => {
    const f = await createValidBundle(); f.manifest.packages[0]!.dependencies = { '@company/charts-core': '0.0.2-rc.1' };
    replaceBundleArtifact(f, f.manifest.packages[0]!.tarball.path, await packageBytes(f));
    expect((await api.validatePlatformBundle(f.manifest, f.files, 'web')).ok).toBe(true);
  });
  it('rejects hidden node_modules contents not declared by the dependency model', async () => {
    const f = await createValidBundle(); const raw = gunzipSync(await packageBytes(f));
    const extra = gunzipSync(await tarBytes([{ name: 'package/node_modules/hidden/package.json', bytes: Buffer.from('{"name":"hidden","version":"1.0.0"}') }]));
    replaceBundleArtifact(f, f.manifest.packages[0]!.tarball.path, gzipSync(Buffer.concat([raw.subarray(0, -1024), extra])));
    reject(await api.validatePlatformBundle(f.manifest, f.files, 'web'));
  });
  it.each([
    { import: null, default: './dist/line.js' }, { default: null, import: './dist/line.js' },
    { onlyUnknownCondition: './dist/line.js' }, { import: { onlyUnknownCondition: './dist/line.js' } },
    { '0': './dist/line.js', import: './dist/line.js' }, { import: [null, null] },
    { browser: null, import: './dist/line.js' }, { node: null, import: './dist/line.js' },
    { import: './dist/line.d.ts', default: './dist/line.js' }, { './invalid': './dist/line.js' },
    { import: [], default: './dist/line.js' }, { import: [null], default: './dist/line.js' },
    { import: [null, { onlyUnknownCondition: './dist/line.js' }], default: './dist/line.js' },
    { import: [{ onlyUnknownCondition: './dist/line.js' }, null], default: './dist/line.js' },
  ])('rejects blocked, unknown, invalid or declaration-only ESM conditions %j', async lineExport => {
    const f = await createValidBundle(); replaceBundleArtifact(f, f.manifest.packages[0]!.tarball.path, await packageBytes(f, 0, { exports: {
      '.': './dist/index.js', './line': lineExport, './bar': './dist/bar.js',
    } }));
    reject(await api.validatePlatformBundle(f.manifest, f.files, 'web'));
  });
  it.each([
    { types: './dist/line.d.ts', import: './dist/line.js' },
    { onlyUnknownCondition: './dist/line.d.ts', default: './dist/line.js' },
    { import: { onlyUnknownCondition: './dist/line.d.ts' }, default: './dist/line.js' },
    { default: './dist/line.js', import: null },
    { node: './dist/line.js', browser: './dist/line.js', import: './dist/line.js' },
    { import: [{ onlyUnknownCondition: './dist/line.d.ts' }, './dist/line.js'] },
    { import: [null, './dist/line.js'] },
    { import: [{ onlyUnknownCondition: './dist/line.js' }], default: './dist/line.js' },
  ])('accepts ordered ESM import/default resolution %j', async lineExport => {
    const f = await createValidBundle(); replaceBundleArtifact(f, f.manifest.packages[0]!.tarball.path, await packageBytes(f, 0, { exports: {
      '.': './dist/index.js', './line': lineExport, './bar': './dist/bar.js',
    } }));
    expect((await api.validatePlatformBundle(f.manifest, f.files, 'web')).ok).toBe(true);
  });
  it.each([
    {}, { '.': [] }, { '.': null }, { '.': { onlyUnknownCondition: './dist/index.js' } },
    { '.': { import: null, default: './dist/index.js' } }, { '.': { node: null, import: './dist/index.js' } },
    { '.': { browser: null, import: './dist/index.js' } }, { './types': './dist/index.d.ts' },
  ])('rejects a root-only core without a usable supported ESM root %j', async exports => {
    const f = await createValidBundle(); f.manifest.variants = []; f.manifest.packages = [f.manifest.packages[0]!];
    const pkg = f.manifest.packages[0]!; pkg.name = '@company/charts-core'; pkg.peerDependencies = { echarts: '6.1.0' };
    replaceBundleArtifact(f, pkg.tarball.path, await packageBytes(f, 0, { exports }));
    reject(await api.validatePlatformBundle(f.manifest, f.files, 'web'));
  });
  it('accepts a root-only core with ordered unknown-array fallback and no variants', async () => {
    const f = await createValidBundle(); f.manifest.variants = []; f.manifest.packages = [f.manifest.packages[0]!];
    const pkg = f.manifest.packages[0]!; pkg.name = '@company/charts-core'; pkg.peerDependencies = { echarts: '6.1.0' };
    replaceBundleArtifact(f, pkg.tarball.path, await packageBytes(f, 0, { exports: { '.': {
      import: [{ onlyUnknownCondition: './dist/index.js' }], default: './dist/index.js',
    } } }));
    expect((await api.validatePlatformBundle(f.manifest, f.files, 'web')).ok).toBe(true);
  });
});
