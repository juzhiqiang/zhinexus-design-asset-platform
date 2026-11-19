import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const inside = (root: string, candidate: string) => {
  const path = relative(root, candidate);
  return path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
};
export type ProductImportProof = {
  generatedPath: string; generatedSha256: string; loadedSha256: string;
  sourceMapPath: string; sourceMapSha256: string; sourceMapBytes: number; source: string;
};

/** A source-map claim counts only when the browser loaded the exact adjacent built JS. */
export async function proveGeneratedProductImports(input: { projectRoot: string; distDir: string; generatedPaths: string[]; loaded: { url: string; bytes: number; sha256: string }[] }): Promise<ProductImportProof[]> {
  const maps: { sourceMapPath: string; sourceMapSha256: string; sourceMapBytes: number; loadedSha256: string; sources: string[]; sourcesContent: unknown[]; sourceRoot: string }[] = [];
  for (const loaded of input.loaded) {
    const assetPath = resolve(input.distDir, '.' + decodeURIComponent(new URL(loaded.url).pathname));
    if (!inside(input.distDir, assetPath)) throw new Error('Browser-loaded JS escaped the built output.');
    const bytes = await readFile(assetPath);
    if (bytes.length !== loaded.bytes || sha256(bytes) !== loaded.sha256) throw new Error('Browser-loaded JS bytes do not match the built file.');
    const mapName = /(?:^|\n)\/\/# sourceMappingURL=([^\s]+)\s*$/.exec(bytes.toString('utf8'))?.[1];
    if (!mapName) continue;
    const sourceMapPath = resolve(dirname(assetPath), mapName);
    if (!inside(input.distDir, sourceMapPath)) throw new Error('Built source map escaped the output.');
    const mapBytes = await readFile(sourceMapPath), raw = JSON.parse(mapBytes.toString('utf8')) as Record<string, unknown>;
    if (raw.version !== 3 || !Array.isArray(raw.sources) || !raw.sources.every(source => typeof source === 'string') || !Array.isArray(raw.sourcesContent)
      || (raw.sourceRoot !== undefined && typeof raw.sourceRoot !== 'string')) throw new Error('Loaded bundle source map has an invalid structure.');
    maps.push({ sourceMapPath, sourceMapSha256: sha256(mapBytes), sourceMapBytes: mapBytes.length, loadedSha256: loaded.sha256,
      sources: raw.sources as string[], sourcesContent: raw.sourcesContent, sourceRoot: typeof raw.sourceRoot === 'string' ? raw.sourceRoot : '' });
  }
  const result: ProductImportProof[] = [];
  for (const generatedPath of input.generatedPaths) {
    const expectedPath = resolve(input.projectRoot, generatedPath);
    if (!inside(input.projectRoot, expectedPath)) throw new Error('Generated module escaped the owned project.');
    const expectedHash = sha256(await readFile(expectedPath));
    let proof: ProductImportProof | undefined;
    for (const map of maps) {
      for (const [index, source] of map.sources.entries()) {
        const path = resolve(dirname(map.sourceMapPath), map.sourceRoot, source.split('?')[0]!);
        const content = map.sourcesContent[index];
        if (path === expectedPath && typeof content === 'string' && sha256(content) === expectedHash) proof = {
          generatedPath, generatedSha256: expectedHash, loadedSha256: map.loadedSha256, sourceMapPath: map.sourceMapPath,
          sourceMapSha256: map.sourceMapSha256, sourceMapBytes: map.sourceMapBytes, source,
        };
      }
    }
    if (!proof) throw new Error('Generated module is missing from browser-loaded source maps, or its source bytes differ: ' + generatedPath);
    result.push(proof);
  }
  if (!result.length) throw new Error('Generated module import proof must not be empty.');
  return result;
}
