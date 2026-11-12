import { UPLOAD_LIMITS, canonicalJson, validateReleaseBundle, type PackageRef, type ReleaseManifestV1, type ValidationIssue, type ValidationResult, type VariantRef } from '@company/contracts';
import { ArtifactFailure, boundedJson, parseImage, parseNpmArchive, requireSafePath } from './artifact-parser.js';

type ArtifactMetadata = { mimeType: string; width?: number; height?: number };
const rejected = <T>(message: string, code: ValidationIssue['code'] = 'ARTIFACT_MISMATCH', path = '/files'): ValidationResult<T> => ({ ok: false, issues: [{ code, path, message }] });
const failure = <T>(error: unknown): ValidationResult<T> => rejected(error instanceof ArtifactFailure ? error.message : 'Artifact bytes are malformed or exceed the decoding limit', error instanceof ArtifactFailure && error.pathFailure ? 'INVALID_PATH' : 'ARTIFACT_MISMATCH');
const textMimes: Record<string, string> = { html: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', md: 'text/markdown', txt: 'text/plain', svg: 'image/svg+xml', map: 'application/json' };

/** Upload completion checks actual bytes before the store freezes the object. */
export async function validateUploadedArtifact(path: string, bytes: Uint8Array): Promise<ValidationResult<ArtifactMetadata>> {
  try {
    requireSafePath(path);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > UPLOAD_LIMITS.tarballBytes) return rejected('Artifact bytes are empty or exceed the per-file limit');
    if (/\.png$|\.jpe?g$/iu.test(path)) return { ok: true, value: parseImage(path, bytes) };
    if (/\.(?:tgz|tar\.gz)$/iu.test(path)) { parseNpmArchive(bytes); return { ok: true, value: { mimeType: 'application/gzip' } }; }
    const extension = path.split('.').at(-1)?.toLowerCase() ?? '';
    const mimeType = textMimes[extension];
    if (mimeType) {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (text.includes('\0')) return rejected('Text artifact contains binary data');
      if (extension === 'json' || extension === 'map') boundedJson(bytes);
      if (extension === 'svg' && !/^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/u.test(text)) return rejected('SVG signature must match the extension');
      return { ok: true, value: { mimeType } };
    }
    // Other static assets (fonts/wasm/images outside screenshot formats) are inert bytes here.
    return { ok: true, value: { mimeType: 'application/octet-stream' } };
  } catch (error) { return failure(error); }
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const MANAGED_EXPORTS = new Set(['line', 'bar', 'pie', 'scatter', 'radar', 'heatmap', 'treemap', 'sankey', 'funnel', 'gauge', 'graph', 'map', 'candlestick', 'boxplot', 'sunburst']);
function validatePackage(pkg: PackageRef, archive: ReadonlyMap<string, Uint8Array>, variants: VariantRef[]): void {
  const bytes = archive.get('package.json');
  if (!bytes) throw new ArtifactFailure('npm package.json is missing');
  const metadata = boundedJson(bytes);
  if (!record(metadata) || metadata.name !== pkg.name || metadata.version !== pkg.version) throw new ArtifactFailure('npm package identity differs from the manifest');
  for (const property of ['dependencies', 'peerDependencies'] as const) {
    const value = metadata[property] ?? {};
    if (!record(value) || Object.values(value).some(version => typeof version !== 'string') || canonicalJson(value) !== canonicalJson(pkg[property])) throw new ArtifactFailure('npm dependencies differ from the manifest');
  }
  const exports = metadata.exports;
  if (!record(exports) && typeof exports !== 'string') throw new ArtifactFailure('npm exports must declare bounded package targets');
  const targets = (value: unknown, depth = 0): string[] => {
    if (depth > 16) throw new ArtifactFailure('npm export nesting exceeds the limit');
    if (typeof value === 'string') {
      if (!value.startsWith('./')) throw new ArtifactFailure('npm export target must stay inside the package');
      const path = value.slice(2); requireSafePath(path);
      if (path.includes('*') || !archive.has(path)) throw new ArtifactFailure('npm export target is missing from the package');
      return [value];
    }
    if (record(value) || Array.isArray(value)) {
      const children = Object.values(value);
      if (!children.length) throw new ArtifactFailure('npm export target is empty');
      return children.flatMap(child => targets(child, depth + 1));
    }
    if (value === null) return [];
    throw new ArtifactFailure('npm export target is invalid');
  };
  targets(exports);
  const subpaths: Record<string, unknown> = record(exports) && Object.keys(exports).some(key => key.startsWith('.')) ? exports : { '.': exports };
  if (Object.keys(subpaths).some(key => key !== '.' && !key.startsWith('./'))) throw new ArtifactFailure('npm exports mix conditions and subpaths');
  const framework = pkg.name === '@company/charts-vue' ? 'vue' : pkg.name === '@company/charts-react' ? 'react' : undefined;
  const runtimeTargets = (value: unknown): string[] => {
    if (typeof value === 'string') return /\.(?:[cm]?js)$/iu.test(value) ? [value] : [];
    if (record(value)) return Object.entries(value).flatMap(([condition, child]) => condition === 'types' ? [] : runtimeTargets(child));
    if (Array.isArray(value)) return value.flatMap(runtimeTargets);
    return [];
  };
  for (const variant of variants) {
    if (framework && variant.framework !== framework || pkg.name === '@company/charts-core') throw new ArtifactFailure('Variant framework differs from the npm package');
    if (!Object.hasOwn(subpaths, variant.exportPath) || runtimeTargets(subpaths[variant.exportPath]).length === 0) throw new ArtifactFailure('Variant runtime export is missing from the npm package');
  }
  for (const [subpath, value] of Object.entries(subpaths)) {
    if (!subpath.startsWith('./')) continue;
    requireSafePath(subpath.slice(2));
    if (MANAGED_EXPORTS.has(subpath.slice(2)) && targets(value).length && !variants.some(variant => variant.exportPath === subpath)) throw new ArtifactFailure('Managed npm component export has no declared implementation');
  }
}

/** Shared contract validation plus stronger actual-file checks; authenticated channel is authoritative. */
export async function validatePlatformBundle(input: unknown, files: ReadonlyMap<string, Uint8Array>, channel: 'cli' | 'web'): Promise<ValidationResult<ReleaseManifestV1>> {
  let total = 0;
  if (files.size > UPLOAD_LIMITS.maxFiles) return rejected('Bundle file count exceeds the limit');
  for (const bytes of files.values()) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > UPLOAD_LIMITS.tarballBytes) return rejected('Bundle file exceeds the per-file limit');
    total += bytes.byteLength;
    if (total > UPLOAD_LIMITS.totalBytes) return rejected('Bundle total bytes exceed the limit');
  }
  // Bound reports before the environment-neutral validator parses their JSON.
  if (record(input) && Array.isArray(input.reports)) for (const ref of input.reports) {
    if (record(ref) && typeof ref.path === 'string') {
      const bytes = files.get(ref.path);
      if (bytes) try { boundedJson(bytes); } catch (error) { return failure(error); }
    }
  }
  const contract = await validateReleaseBundle(input, files);
  if (!contract.ok) return contract;
  const manifest = contract.value;
  if (manifest.channel !== channel) return rejected('Manifest channel differs from the authenticated client', 'SOURCE_FORBIDDEN', '/channel');
  const screenshotPaths = new Set(manifest.variants.flatMap(variant => variant.screenshots.map(shot => shot.image.path)));
  // Reports can hold independent automatic evidence beside a manual variant screenshot.
  for (const ref of manifest.reports) {
    const report = boundedJson(files.get(ref.path)!);
    if (record(report) && Array.isArray(report.screenshots)) for (const shot of report.screenshots) {
      if (record(shot) && record(shot.image) && typeof shot.image.path === 'string') screenshotPaths.add(shot.image.path);
    }
  }
  const packagePaths = new Set(manifest.packages.map(pkg => pkg.tarball.path));
  for (const [path, bytes] of files) {
    if (screenshotPaths.has(path) && !/\.(?:png|jpe?g)$/iu.test(path)) return rejected('Screenshots require PNG or JPEG');
    if (packagePaths.has(path) && !/\.(?:tgz|tar\.gz)$/iu.test(path)) return rejected('npm packages require a gzip tarball');
    // Parse packages once below; other files include all preview resources and reports.
    if (!packagePaths.has(path)) {
      const validated = await validateUploadedArtifact(path, bytes);
      if (!validated.ok) return validated;
    }
  }
  try {
    for (const pkg of manifest.packages) {
      requireSafePath(pkg.tarball.path);
      const archive = parseNpmArchive(files.get(pkg.tarball.path)!);
      validatePackage(pkg, archive, manifest.variants.filter(variant => variant.packageName === pkg.name && variant.packageVersion === pkg.version));
    }
    return contract;
  } catch (error) { return failure(error); }
}
