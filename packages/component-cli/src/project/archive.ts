import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { loadProjectBundle } from './prepare.js';
import { canonicalJson } from '../contracts/schema.js';

/** ZIP is a transport envelope; package tarballs and evidence are never rebuilt. */
export async function createBundleZip(bundleDir: string): Promise<string> {
  const { bundleDir: root, manifest, filesMap } = await loadProjectBundle(bundleDir);
  if (filesMap.has('manifest.json')) throw new Error('ZIP_RESERVED_PATH: manifest.json');
  const entries = new Map(filesMap);
  const manifestBytes = await readFile(join(root, 'manifest.json'));
  if (canonicalJson(JSON.parse(manifestBytes.toString('utf8'))) !== canonicalJson(manifest)) throw new Error('FROZEN_MANIFEST_MISMATCH');
  entries.set('manifest.json', manifestBytes);
  if (entries.size >= 0xffff) throw new Error('ZIP_LIMIT: too many files');
  const contents: Buffer[] = [], directory: Buffer[] = [];
  let offset = 0;
  for (const [name, bytes] of entries) {
    const filename = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(bytes);
    if (filename.length > 0xffff || bytes.length >= 0xffffffff || offset + 30 + filename.length + compressed.length >= 0xffffffff) throw new Error('ZIP_LIMIT: archive too large');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // DEFLATE
    local.writeUInt16LE(33, 12); // 1980-01-01, deterministic metadata
    local.writeUInt32LE(crc32(bytes), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    local.copy(central, 6, 4, 30);
    central.writeUInt32LE(offset, 42);
    contents.push(local, filename, compressed);
    directory.push(central, filename);
    offset += local.length + filename.length + compressed.length;
  }
  const directorySize = directory.reduce((total, buffer) => total + buffer.length, 0);
  if (offset + directorySize + 22 >= 0xffffffff) throw new Error('ZIP_LIMIT: archive too large');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.size, 8); end.writeUInt16LE(entries.size, 10);
  end.writeUInt32LE(directorySize, 12); end.writeUInt32LE(offset, 16);
  const archivePath = root + '.zip';
  await writeFile(archivePath, Buffer.concat([...contents, ...directory, end]), { flag: 'wx' });
  return archivePath;
}
