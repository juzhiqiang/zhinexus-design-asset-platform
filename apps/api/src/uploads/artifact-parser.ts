import { gunzipSync, inflateSync } from 'node:zlib';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { UPLOAD_LIMITS } from '@company/contracts';

/** Errors contain fixed descriptions only: never forward decoder text or uploaded values. */
export class ArtifactFailure extends Error {
  constructor(message: string, readonly pathFailure = false) { super(message); }
}
function fail(message: string): never { throw new ArtifactFailure(message); }
export function requireSafePath(path: string): void {
  if (!path || path.length > 1024 || /[\\:<>"|*\x00-\x1f\x7f%?#]/u.test(path) || path.startsWith('/')) throw new ArtifactFailure('Artifact path is unsafe', true);
  for (const part of path.split('/')) {
    if (!part || part === '.' || part === '..' || /[. ]$/u.test(part) || /^(?:CON|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)/iu.test(part)) throw new ArtifactFailure('Artifact path is unsafe', true);
  }
}
const canonical = (path: string) => path.normalize('NFC').toUpperCase();
const utf8 = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const field = (bytes: Buffer) => {
  const nul = bytes.indexOf(0);
  if (nul >= 0 && bytes.subarray(nul).some(byte => byte !== 0)) fail('Archive header has malformed text');
  return utf8(nul < 0 ? bytes : bytes.subarray(0, nul));
};
const octal = (bytes: Buffer) => {
  const text = bytes.toString('ascii').replace(/\0.*$/u, '').trim();
  if (!/^[0-7]+$/u.test(text)) fail('Archive header has invalid numeric fields');
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) fail('Archive numeric field is out of range');
  return value;
};
const PAX_KEYS = new Set(['path', 'size', 'mtime', 'atime', 'ctime', 'uid', 'gid', 'uname', 'gname', 'comment', 'charset']);
function parsePax(bytes: Buffer): Record<string, string> {
  if (bytes.length > 64 * 1024) fail('Archive extended header exceeds the limit');
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset);
    if (space < 0 || space - offset > 8) fail('Archive extended header is malformed');
    const lengthText = bytes.subarray(offset, space).toString('ascii');
    if (!/^[1-9][0-9]*$/u.test(lengthText)) fail('Archive extended header is malformed');
    const length = Number(lengthText); const end = offset + length;
    if (end > bytes.length || end <= space + 2 || bytes[end - 1] !== 10) fail('Archive extended header is malformed');
    const record = utf8(bytes.subarray(space + 1, end - 1)); const separator = record.indexOf('=');
    if (separator <= 0) fail('Archive extended header is malformed');
    const key = record.slice(0, separator); const value = record.slice(separator + 1);
    if (!PAX_KEYS.has(key) || Object.hasOwn(result, key) || /[\x00-\x1f\x7f]/u.test(value)) fail('Archive extended header contains unsupported overrides');
    result[key] = value; offset = end;
  }
  return result;
}

/** Bounded gzip/ustar parser. Views stay in memory; nothing is extracted or executed. */
export function parseNpmArchive(bytes: Uint8Array): ReadonlyMap<string, Uint8Array> {
  if (bytes.byteLength === 0 || bytes.byteLength > UPLOAD_LIMITS.tarballBytes || bytes[0] !== 0x1f || bytes[1] !== 0x8b) fail('Package must be a bounded gzip archive');
  // zlib stops growing output at the shared bound, including for concatenated gzip members.
  const raw = gunzipSync(bytes, { maxOutputLength: UPLOAD_LIMITS.archiveBytes });
  if (raw.length < 1024 || raw.length % 512 !== 0) fail('Archive is truncated');
  const files = new Map<string, Uint8Array>();
  const names = new Map<string, 'file' | 'directory'>();
  let offset = 0; let count = 0; let total = 0;
  let nextPax: Record<string, string> | undefined;
  let globalPax: Record<string, string> = {};
  while (offset + 512 <= raw.length) {
    const header = raw.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      if (nextPax || offset + 1024 > raw.length || raw.subarray(offset).some(byte => byte !== 0)) fail('Archive terminator is invalid');
      return files;
    }
    if (++count > UPLOAD_LIMITS.archiveFiles) fail('Archive entry count exceeds the limit');
    const checksum = octal(header.subarray(148, 156)); let actual = 0;
    for (let i = 0; i < 512; i++) actual += i >= 148 && i < 156 ? 32 : header[i]!;
    if (checksum !== actual) fail('Archive header checksum differs');
    if (!header.subarray(257, 263).equals(Buffer.from('ustar\0')) && !header.subarray(257, 263).equals(Buffer.from('ustar '))) fail('Only ustar npm archives are supported');
    const base = field(header.subarray(0, 100)); const prefix = field(header.subarray(345, 500));
    let name = prefix ? `${prefix}/${base}` : base;
    let size = octal(header.subarray(124, 136)); const flag = header[156];
    const linkname = field(header.subarray(157, 257));
    offset += 512;
    if (size > UPLOAD_LIMITS.archiveBytes || size > raw.length - offset) fail('Archive entry size exceeds the bound');
    if (flag === 120 || flag === 103) {
      if (nextPax || linkname) fail('Archive extended headers are invalid');
      const pax = parsePax(raw.subarray(offset, offset + size));
      if (flag === 103) {
        if (Object.hasOwn(pax, 'path') || Object.hasOwn(pax, 'size')) fail('Archive global path and size overrides are forbidden');
        globalPax = { ...globalPax, ...pax };
      } else nextPax = pax;
      offset += Math.ceil(size / 512) * 512; continue;
    }
    if (flag !== 0 && flag !== 48 && flag !== 53 || linkname) fail('Archive links and special entries are forbidden');
    const pax = { ...globalPax, ...nextPax }; nextPax = undefined;
    if (pax.path !== undefined) name = pax.path;
    if (pax.size !== undefined) {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(pax.size)) fail('Archive size override is invalid');
      size = Number(pax.size);
      if (!Number.isSafeInteger(size) || size > UPLOAD_LIMITS.archiveBytes || size > raw.length - offset) fail('Archive size override exceeds the bound');
    }
    const directory = flag === 53;
    if (directory && name.endsWith('/')) name = name.slice(0, -1);
    requireSafePath(name);
    if (name !== 'package' && !name.startsWith('package/') || name === 'package' && !directory) fail('Archive entries must stay inside package/');
    if (directory && size !== 0) fail('Archive directories may not contain data');
    const key = canonical(name);
    if (names.has(key)) fail('Archive paths collide under canonical normalization');
    const segments = key.split('/');
    for (let i = 1; i < segments.length; i++) if (names.get(segments.slice(0, i).join('/')) === 'file') fail('Archive file and directory paths collide');
    if (!directory && [...names.keys()].some(existing => existing.startsWith(`${key}/`))) fail('Archive file and directory paths collide');
    names.set(key, directory ? 'directory' : 'file');
    total += size;
    if (total > UPLOAD_LIMITS.archiveBytes) fail('Archive content exceeds the expanded limit');
    if (!directory) files.set(name.slice('package/'.length), raw.subarray(offset, offset + size));
    const padded = Math.ceil(size / 512) * 512;
    if (offset + padded > raw.length || raw.subarray(offset + size, offset + padded).some(byte => byte !== 0)) fail('Archive padding is invalid');
    offset += padded;
  }
  return fail('Archive terminator is missing');
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255]! ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}
function requireDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > UPLOAD_LIMITS.maxImageDimension || height > UPLOAD_LIMITS.maxImageDimension) fail('Image dimensions exceed the limit');
}
function pngDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') fail('PNG signature and header must match the extension');
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
  requireDimensions(width, height);
  const depth = bytes[24]!; const color = bytes[25]!; const interlace = bytes[28]!;
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
  if (!channels || ![1, 2, 4, 8, 16].includes(depth) || interlace > 1) fail('PNG header is invalid');
  let offset = 8; let ended = false; const compressed: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset); const end = offset + 12 + length;
    if (end > bytes.length) fail('PNG chunk is truncated');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) fail('PNG checksum differs');
    if (type === 'IHDR' && offset !== 8) fail('PNG contains a repeated header');
    if (type === 'IDAT') compressed.push(bytes.subarray(offset + 8, end - 4));
    if (type === 'IEND') {
      if (length !== 0 || end !== bytes.length) fail('PNG has trailing data');
      ended = true; break;
    }
    offset = end;
  }
  if (!ended || !compressed.length) fail('PNG is incomplete');
  let expected = 0;
  if (!interlace) expected = (Math.ceil(width * channels * depth / 8) + 1) * height;
  else {
    const passes = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
    for (const [x, y, dx, dy] of passes as Array<[number, number, number, number]>) {
      const columns = Math.max(0, Math.ceil((width - x) / dx)); const rows = Math.max(0, Math.ceil((height - y) / dy));
      if (columns && rows) expected += (Math.ceil(columns * channels * depth / 8) + 1) * rows;
    }
  }
  // pngjs uses an unbounded inflater for Adam7; preflight bounds that branch too.
  if (inflateSync(Buffer.concat(compressed), { maxOutputLength: expected }).length !== expected) fail('PNG pixel stream has the wrong length');
  const decoded = PNG.sync.read(bytes, { checkCRC: true });
  if (decoded.width !== width || decoded.height !== height) fail('PNG decoded dimensions differ');
  return { width, height };
}
function jpegDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) fail('JPEG signature must match the extension');
  let offset = 2; let dimensions: { width: number; height: number } | undefined; let ended = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 255) fail('JPEG marker is malformed');
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217) { ended = offset === bytes.length; break; }
    if (marker === undefined || marker === 0 || marker === 216 || marker >= 208 && marker <= 215 || offset + 2 > bytes.length) fail('JPEG marker is invalid');
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) fail('JPEG segment is truncated');
    if ([192, 193, 194].includes(marker)) {
      if (length < 8 || dimensions) fail('JPEG frame is invalid');
      dimensions = { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
      requireDimensions(dimensions.width, dimensions.height);
    }
    offset += length;
    if (marker === 218) {
      // Entropy bytes may contain escaped FF or restart markers, never arbitrary trailers.
      while (offset < bytes.length) {
        if (bytes[offset] !== 255) { offset++; continue; }
        let end = offset + 1; while (bytes[end] === 255) end++;
        if (bytes[end] === 0 || bytes[end]! >= 208 && bytes[end]! <= 215) { offset = end + 1; continue; }
        break;
      }
    }
  }
  if (!ended || !dimensions) fail('JPEG is incomplete or has trailing data');
  const decoded = jpeg.decode(bytes, { tolerantDecoding: false, useTArray: true, maxResolutionInMP: UPLOAD_LIMITS.maxImageDimension ** 2 / 1e6, maxMemoryUsageInMB: 512 });
  if (decoded.width !== dimensions.width || decoded.height !== dimensions.height) fail('JPEG decoded dimensions differ');
  return dimensions;
}
export function parseImage(path: string, bytes: Uint8Array): { mimeType: string; width: number; height: number } {
  if (bytes.byteLength === 0 || bytes.byteLength > UPLOAD_LIMITS.imageBytes) fail('Image bytes exceed the limit');
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (/\.png$/iu.test(path)) return { mimeType: 'image/png', ...pngDimensions(buffer) };
  if (/\.jpe?g$/iu.test(path)) return { mimeType: 'image/jpeg', ...jpegDimensions(buffer) };
  return fail('Screenshots require PNG or JPEG');
}

export function boundedJson(bytes: Uint8Array): unknown {
  if (!bytes.byteLength || bytes.byteLength > 1024 * 1024) fail('JSON document exceeds the limit');
  const text = utf8(bytes);
  let depth = 0; let quoted = false; let escaped = false;
  for (const character of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{' || character === '[') { if (++depth > 32) fail('JSON nesting exceeds the limit'); }
    else if (character === '}' || character === ']') depth--;
  }
  return JSON.parse(text) as unknown;
}
