import * as zlib from 'node:zlib';
import type { EnvironmentV1 } from '../contracts/reports.js';
import { computeEnvironmentKey } from './environment.js';

export type BaselineScreenshotInput = {
  environment: EnvironmentV1;
  environmentKey?: string;
  imageBuffer: Buffer;
};

export type CompareBaselineOptions = {
  pixelThreshold?: number;
  maxDiffPixelRatio?: number;
  generateDiffImage?: boolean;
};

export type CompareBaselineResult = {
  result: 'PASS' | 'DIFF' | 'NEW' | 'INCOMPATIBLE';
  diffRatio: number;
  diffPixelCount: number;
  totalPixels: number;
  currentEnvironmentKey: string;
  baselineEnvironmentKey?: string;
  diffImage?: Buffer;
  reason?: string;
};

type DecodedPng = {
  width: number;
  height: number;
  rgba: Uint8Array;
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PNG_DIMENSION = 8192;
const MAX_PNG_PIXELS = 67_108_864;

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodePngRgba(buffer: Buffer): DecodedPng {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('INVALID_PNG: 缺少合法的 PNG 文件签名');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let seenIhdr = false;
  let seenIend = false;
  let plte: Buffer | undefined;
  let trns: Buffer | undefined;
  const idatChunks: Buffer[] = [];

  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) {
      throw new Error('INVALID_PNG: PNG chunk 头部截断');
    }
    const length = buffer.readUInt32BE(offset);
    const typeBuf = buffer.subarray(offset + 4, offset + 8);
    const type = typeBuf.toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) {
      throw new Error(`INVALID_PNG: PNG chunk ${type} 长度越界`);
    }
    const data = buffer.subarray(dataStart, dataEnd);
    const storedCrc = buffer.readUInt32BE(dataEnd);
    const computedCrc = crc32(Buffer.concat([typeBuf, data]));
    if (storedCrc !== computedCrc) {
      throw new Error(`INVALID_PNG: PNG chunk ${type} CRC32 校验失败`);
    }

    if (!seenIhdr) {
      if (type !== 'IHDR') {
        throw new Error('INVALID_PNG: 首个 chunk 必须为 IHDR');
      }
      if (data.length !== 13) {
        throw new Error('INVALID_PNG: IHDR 长度必须为 13 字节');
      }
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      const compressionMethod = data[10]!;
      const filterMethod = data[11]!;
      interlace = data[12]!;
      if (compressionMethod !== 0 || filterMethod !== 0) {
        throw new Error('UNSUPPORTED_PNG: 不支持的压缩或滤波方法');
      }
      seenIhdr = true;
    } else if (type === 'IHDR') {
      throw new Error('INVALID_PNG: 存在重复的 IHDR chunk');
    } else if (type === 'PLTE') {
      if (data.length === 0 || data.length % 3 !== 0 || data.length > 256 * 3) {
        throw new Error('INVALID_PNG: PLTE chunk 长度无效');
      }
      plte = data;
    } else if (type === 'tRNS') {
      trns = data;
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      if (data.length !== 0) {
        throw new Error('INVALID_PNG: IEND chunk 必须为空');
      }
      seenIend = true;
      offset = dataEnd + 4;
      break;
    }

    offset = dataEnd + 4;
  }

  if (!seenIhdr || !seenIend || idatChunks.length === 0) {
    throw new Error('INVALID_PNG: 缺少必需的 IHDR/IDAT/IEND chunk');
  }
  if (width <= 0 || height <= 0 || width > MAX_PNG_DIMENSION || height > MAX_PNG_DIMENSION || width * height > MAX_PNG_PIXELS) {
    throw new Error(`INVALID_PNG: PNG 尺寸无效或超出安全上限 (${width}x${height})`);
  }
  if (bitDepth !== 8) {
    throw new Error(`UNSUPPORTED_PNG: 仅支持 8-bit PNG，当前为 ${bitDepth}-bit`);
  }
  if (interlace !== 0) {
    throw new Error('UNSUPPORTED_PNG: 暂不支持交错隔行扫描 PNG');
  }

  let channels: number;
  if (colorType === 0) channels = 1;
  else if (colorType === 2) channels = 3;
  else if (colorType === 3) {
    if (!plte) throw new Error('INVALID_PNG: 索引色 PNG 缺少 PLTE chunk');
    channels = 1;
  } else if (colorType === 4) channels = 2;
  else if (colorType === 6) channels = 4;
  else throw new Error(`UNSUPPORTED_PNG: 不支持的 colorType=${colorType}`);

  const rowBytes = width * channels;
  const expectedLength = (rowBytes + 1) * height;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks), { maxOutputLength: expectedLength });
  if (raw.length !== expectedLength) {
    throw new Error(`INVALID_PNG: IDAT 解压字节长度不匹配 (expected=${expectedLength}, actual=${raw.length})`);
  }

  const unfiltered = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)]!;
    const rowIn = y * (rowBytes + 1) + 1;
    const rowOut = y * rowBytes;
    const prevRowOut = (y - 1) * rowBytes;

    for (let i = 0; i < rowBytes; i++) {
      const x = raw[rowIn + i]!;
      const a = i >= channels ? unfiltered[rowOut + i - channels]! : 0;
      const b = y > 0 ? unfiltered[prevRowOut + i]! : 0;
      const c = y > 0 && i >= channels ? unfiltered[prevRowOut + i - channels]! : 0;

      let val: number;
      if (filter === 0) val = x;
      else if (filter === 1) val = (x + a) & 0xff;
      else if (filter === 2) val = (x + b) & 0xff;
      else if (filter === 3) val = (x + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) val = (x + paethPredictor(a, b, c)) & 0xff;
      else throw new Error(`INVALID_PNG: 未知扫描行滤波器 ${filter}`);

      unfiltered[rowOut + i] = val;
    }
  }

  // 解析 tRNS 透明色信息
  let transparentGray: number | undefined;
  let transparentRgb: [number, number, number] | undefined;
  if (trns) {
    if (colorType === 0) {
      if (trns.length !== 2) throw new Error('INVALID_PNG: 灰度图 tRNS chunk 长度必须为 2');
      transparentGray = trns.readUInt16BE(0) & 0xff;
    } else if (colorType === 2) {
      if (trns.length !== 6) throw new Error('INVALID_PNG: RGB 图 tRNS chunk 长度必须为 6');
      transparentRgb = [trns.readUInt16BE(0) & 0xff, trns.readUInt16BE(2) & 0xff, trns.readUInt16BE(4) & 0xff];
    } else if (colorType === 3) {
      if (trns.length > plte!.length / 3) throw new Error('INVALID_PNG: 索引色 tRNS 长度超过调色板条目数');
    } else {
      throw new Error(`INVALID_PNG: colorType=${colorType} 不允许携带 tRNS chunk`);
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    const s = i * channels;
    if (colorType === 6) {
      rgba[p] = unfiltered[s]!;
      rgba[p + 1] = unfiltered[s + 1]!;
      rgba[p + 2] = unfiltered[s + 2]!;
      rgba[p + 3] = unfiltered[s + 3]!;
    } else if (colorType === 2) {
      const r = unfiltered[s]!;
      const g = unfiltered[s + 1]!;
      const b = unfiltered[s + 2]!;
      const isTransparent =
        transparentRgb !== undefined && r === transparentRgb[0] && g === transparentRgb[1] && b === transparentRgb[2];
      rgba[p] = r;
      rgba[p + 1] = g;
      rgba[p + 2] = b;
      rgba[p + 3] = isTransparent ? 0 : 255;
    } else if (colorType === 4) {
      const g = unfiltered[s]!;
      rgba[p] = g;
      rgba[p + 1] = g;
      rgba[p + 2] = g;
      rgba[p + 3] = unfiltered[s + 1]!;
    } else if (colorType === 3) {
      const idx = unfiltered[s]!;
      if (idx * 3 + 2 >= plte!.length) {
        throw new Error(`INVALID_PNG: 调色板索引越界 (${idx})`);
      }
      rgba[p] = plte![idx * 3]!;
      rgba[p + 1] = plte![idx * 3 + 1]!;
      rgba[p + 2] = plte![idx * 3 + 2]!;
      rgba[p + 3] = trns && idx < trns.length ? trns[idx]! : 255;
    } else {
      const g = unfiltered[s]!;
      rgba[p] = g;
      rgba[p + 1] = g;
      rgba[p + 2] = g;
      rgba[p + 3] = transparentGray !== undefined && g === transparentGray ? 0 : 255;
    }
  }

  return { width, height, rgba };
}

function makeChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePngRgba(width: number, height: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = 1 + width * 4;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0;
    const srcStart = y * width * 4;
    raw.set(rgba.subarray(srcStart, srcStart + width * 4), rowStart + 1);
  }

  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    PNG_SIGNATURE,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * 本地视觉基线比对（T04）：
 * - 始终重算 environmentKey 并核对外部传入的 environmentKey（如有），禁止信任伪造 key；
 * - 无基线返回 NEW；
 * - 环境签名不一致或包含 unknown-manual 绝不返回 PASS，固定返回 INCOMPATIBLE；
 * - 仅框架或 ECharts 版本变更保持相同 environmentKey，正常进入像素对比；
 * - 同环境像素差异在 maxDiffPixelRatio (默认 0.001) 与 pixelThreshold (默认 0.1) 内返回 PASS，否则返回 DIFF 并生成差异图。
 */
export function compareBaseline(
  current: BaselineScreenshotInput,
  baseline: BaselineScreenshotInput | null | undefined,
  options: CompareBaselineOptions = {},
): CompareBaselineResult {
  const pixelThreshold = options.pixelThreshold ?? 0.1;
  const maxDiffPixelRatio = options.maxDiffPixelRatio ?? 0.001;
  const generateDiffImage = options.generateDiffImage ?? true;

  const computedCurrentKey = computeEnvironmentKey(current.environment);
  if (
    current.environmentKey === 'unknown-manual' ||
    (current.environmentKey !== undefined && current.environmentKey !== computedCurrentKey)
  ) {
    return {
      result: 'INCOMPATIBLE',
      diffRatio: 1,
      diffPixelCount: 0,
      totalPixels: 0,
      currentEnvironmentKey: current.environmentKey ?? computedCurrentKey,
      reason:
        current.environmentKey === 'unknown-manual'
          ? '手动上传截图 (unknown-manual) 不可用于自动视觉基线比对'
          : `当前 environmentKey (${current.environmentKey}) 与环境指纹计算结果 (${computedCurrentKey}) 不一致`,
    };
  }

  if (!baseline) {
    return {
      result: 'NEW',
      diffRatio: 0,
      diffPixelCount: 0,
      totalPixels: 0,
      currentEnvironmentKey: computedCurrentKey,
      reason: '尚未建立该环境基线',
    };
  }

  const computedBaselineKey = computeEnvironmentKey(baseline.environment);
  if (
    baseline.environmentKey === 'unknown-manual' ||
    (baseline.environmentKey !== undefined && baseline.environmentKey !== computedBaselineKey) ||
    computedCurrentKey !== computedBaselineKey
  ) {
    return {
      result: 'INCOMPATIBLE',
      diffRatio: 1,
      diffPixelCount: 0,
      totalPixels: 0,
      currentEnvironmentKey: computedCurrentKey,
      baselineEnvironmentKey: baseline.environmentKey ?? computedBaselineKey,
      reason: `环境签名不一致或疑似伪造 (current=${computedCurrentKey}, baseline=${computedBaselineKey})，禁止判定为 PASS`,
    };
  }

  const curPng = decodePngRgba(current.imageBuffer);
  const basePng = decodePngRgba(baseline.imageBuffer);

  if (curPng.width !== basePng.width || curPng.height !== basePng.height) {
    const maxPixels = Math.max(curPng.width * curPng.height, basePng.width * basePng.height);
    return {
      result: 'DIFF',
      diffRatio: 1,
      diffPixelCount: maxPixels,
      totalPixels: maxPixels,
      currentEnvironmentKey: computedCurrentKey,
      baselineEnvironmentKey: computedBaselineKey,
      reason: `截图分辨率不一致 (${curPng.width}x${curPng.height} vs ${basePng.width}x${basePng.height})`,
    };
  }

  const totalPixels = curPng.width * curPng.height;
  const diffRgba = generateDiffImage ? new Uint8Array(totalPixels * 4) : null;
  let diffPixelCount = 0;

  for (let i = 0; i < totalPixels; i++) {
    const p = i * 4;
    const dr = Math.abs(curPng.rgba[p]! - basePng.rgba[p]!) / 255;
    const dg = Math.abs(curPng.rgba[p + 1]! - basePng.rgba[p + 1]!) / 255;
    const db = Math.abs(curPng.rgba[p + 2]! - basePng.rgba[p + 2]!) / 255;
    const da = Math.abs(curPng.rgba[p + 3]! - basePng.rgba[p + 3]!) / 255;
    const delta = Math.max(dr, dg, db, da);

    if (delta > pixelThreshold) {
      diffPixelCount++;
      if (diffRgba) {
        diffRgba[p] = 255;
        diffRgba[p + 1] = 0;
        diffRgba[p + 2] = 0;
        diffRgba[p + 3] = 255;
      }
    } else if (diffRgba) {
      const gray = Math.round(
        0.299 * curPng.rgba[p]! + 0.587 * curPng.rgba[p + 1]! + 0.114 * curPng.rgba[p + 2]!,
      );
      diffRgba[p] = gray;
      diffRgba[p + 1] = gray;
      diffRgba[p + 2] = gray;
      diffRgba[p + 3] = 100;
    }
  }

  const diffRatio = totalPixels > 0 ? diffPixelCount / totalPixels : 0;
  if (diffRatio <= maxDiffPixelRatio) {
    return {
      result: 'PASS',
      diffRatio,
      diffPixelCount,
      totalPixels,
      currentEnvironmentKey: computedCurrentKey,
      baselineEnvironmentKey: computedBaselineKey,
    };
  }

  return {
    result: 'DIFF',
    diffRatio,
    diffPixelCount,
    totalPixels,
    currentEnvironmentKey: computedCurrentKey,
    baselineEnvironmentKey: computedBaselineKey,
    diffImage: diffRgba ? encodePngRgba(curPng.width, curPng.height, diffRgba) : undefined,
    reason: `像素差异比例 ${(diffRatio * 100).toFixed(4)}% 超过阈值 ${(maxDiffPixelRatio * 100).toFixed(4)}%`,
  };
}
