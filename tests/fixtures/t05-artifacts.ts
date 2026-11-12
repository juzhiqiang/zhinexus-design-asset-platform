/** Real binary test materials; never a browser/consumer verification claim. */
import { gzipSync } from 'node:zlib';
import { pack, type Header } from 'tar-stream';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { makeFixture, digest, replaceReport } from './releases/g1/factory.js';

export function pngBytes(width = 2, height = 2): Buffer {
  const image = new PNG({ width, height }); image.data.fill(255);
  return PNG.sync.write(image);
}
export function jpegBytes(): Buffer {
  return jpeg.encode({ width: 2, height: 2, data: Buffer.alloc(16, 255) }, 90).data;
}
export async function tarBytes(entries: Array<{ name: string; bytes?: Uint8Array; type?: Header['type']; linkname?: string; pax?: Record<string, string> }>): Promise<Buffer> {
  const archive = pack(); const chunks: Buffer[] = [];
  const collected = (async () => { for await (const chunk of archive) {
    if (!(chunk instanceof Uint8Array)) throw new Error('Expected tar bytes');
    chunks.push(Buffer.from(chunk));
  } })();
  for (const entry of entries) archive.entry({ name: entry.name, ...(entry.type ? { type: entry.type } : {}), ...(entry.linkname ? { linkname: entry.linkname } : {}), ...(entry.pax ? { pax: entry.pax } : {}) }, Buffer.from(entry.bytes ?? []));
  archive.finalize(); await collected;
  return gzipSync(Buffer.concat(chunks));
}
export type BinaryFixture = ReturnType<typeof makeFixture>;
export function replaceBundleArtifact(fixture: BinaryFixture, path: string, bytes: Uint8Array): void {
  const previous = fixture.files.get(path); const oldDigest = previous && digest(previous);
  fixture.files.set(path, bytes);
  const update = (input: unknown): void => {
    if (!input || typeof input !== 'object') return;
    const object = input as Record<string, unknown>;
    if (object.path === path) { object.sha256 = digest(bytes); object.bytes = bytes.byteLength; }
    if (oldDigest && object.packageSha256 === oldDigest) object.packageSha256 = digest(bytes);
    for (const value of Object.values(object)) update(value);
  };
  update(fixture.manifest); update(fixture.reports);
  for (const [reportPath, report] of Object.entries(fixture.reports)) replaceReport(fixture, reportPath, report);
}
export async function packageBytes(fixture: BinaryFixture, packageIndex = 0, overrides: Record<string, unknown> = {}): Promise<Buffer> {
  const pkg = fixture.manifest.packages[packageIndex]!;
  const variants = fixture.manifest.variants.filter(v => v.packageName === pkg.name);
  const exports: Record<string, unknown> = { '.': { types: './dist/index.d.ts', import: './dist/index.js' } };
  const entries = [
    { name: 'package/dist/index.js', bytes: Buffer.from('export {};') },
    { name: 'package/dist/index.d.ts', bytes: Buffer.from('export {};') },
  ];
  for (const variant of variants) {
    exports[variant.exportPath] = { types: `./dist/${variant.componentId}.d.ts`, import: `./dist/${variant.componentId}.js` };
    entries.push({ name: `package/dist/${variant.componentId}.js`, bytes: Buffer.from(`export const ${variant.exportName} = {};`) }, { name: `package/dist/${variant.componentId}.d.ts`, bytes: Buffer.from(`export declare const ${variant.exportName}: object;`) });
  }
  entries.unshift({ name: 'package/package.json', bytes: Buffer.from(JSON.stringify({ name: pkg.name, version: pkg.version, dependencies: pkg.dependencies, peerDependencies: pkg.peerDependencies, exports, ...overrides })) });
  return tarBytes(entries);
}
export async function createValidBundle(channel: 'web' | 'cli' = 'web'): Promise<BinaryFixture> {
  const fixture = makeFixture(channel);
  for (const [index, pkg] of fixture.manifest.packages.entries()) replaceBundleArtifact(fixture, pkg.tarball.path, await packageBytes(fixture, index));
  for (const variant of fixture.manifest.variants) replaceBundleArtifact(fixture, variant.screenshots[0]!.image.path, pngBytes());
  return fixture;
}
