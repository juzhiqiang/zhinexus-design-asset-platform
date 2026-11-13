import * as zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { detectEnvironment, computeEnvironmentKey } from '../../packages/component-cli/src/local/environment.js';
import { compareBaseline } from '../../packages/component-cli/src/local/compare.js';

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

function makePngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createSolidRgbaPng(
  width: number,
  height: number,
  rgba: [number, number, number, number],
  overridePixel?: { x: number; y: number; rgba: [number, number, number, number] },
): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = 1 + width * 4;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter None
    for (let x = 0; x < width; x++) {
      const px = overridePixel && overridePixel.x === x && overridePixel.y === y ? overridePixel.rgba : rgba;
      const offset = rowStart + 1 + x * 4;
      raw[offset] = px[0];
      raw[offset + 1] = px[1];
      raw[offset + 2] = px[2];
      raw[offset + 3] = px[3];
    }
  }

  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idat),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('T04: compareBaseline 本地视觉基线比对', () => {
  const baseEnv = detectEnvironment({
    os: 'windows',
    arch: 'x64',
    browserVersion: '130.0.0.0',
    browserRevision: '1000',
    framework: 'vue',
    frameworkVersion: '3.5.45',
    echartsVersion: '6.1.0',
  });

  it('无基线时返回 NEW 且 diffRatio 为 0', () => {
    const img = createSolidRgbaPng(10, 10, [10, 20, 30, 255]);
    const res = compareBaseline({ environment: baseEnv, imageBuffer: img }, null);
    expect(res.result).toBe('NEW');
    expect(res.diffRatio).toBe(0);
    expect(res.diffImage).toBeUndefined();
    expect(res.currentEnvironmentKey).toBe(computeEnvironmentKey(baseEnv));
  });

  it('同环境同图像返回 PASS 且 diffRatio 为 0', () => {
    const imgA = createSolidRgbaPng(10, 10, [10, 20, 30, 255]);
    const imgB = createSolidRgbaPng(10, 10, [10, 20, 30, 255]);
    const res = compareBaseline(
      { environment: baseEnv, imageBuffer: imgA },
      { environment: baseEnv, imageBuffer: imgB },
    );
    expect(res.result).toBe('PASS');
    expect(res.diffRatio).toBe(0);
    expect(res.diffPixelCount).toBe(0);
    expect(res.totalPixels).toBe(100);
    expect(res.diffImage).toBeUndefined();
  });

  it('同环境像素差异超过阈值时返回 DIFF 并生成有效差异图 PNG 与 diffRatio', () => {
    const baselineImg = createSolidRgbaPng(10, 10, [0, 0, 0, 255]);
    const changedImg = createSolidRgbaPng(10, 10, [0, 0, 0, 255], { x: 5, y: 5, rgba: [255, 255, 255, 255] });

    // 1 / 100 = 0.01 > 0.001 (maxDiffPixelRatio)
    const res = compareBaseline(
      { environment: baseEnv, imageBuffer: changedImg },
      { environment: baseEnv, imageBuffer: baselineImg },
    );
    expect(res.result).toBe('DIFF');
    expect(res.diffPixelCount).toBe(1);
    expect(res.totalPixels).toBe(100);
    expect(res.diffRatio).toBeCloseTo(0.01, 5);
    expect(res.diffImage).toBeInstanceOf(Buffer);
    // 验证 diffImage 是合法 PNG 文件头
    expect(res.diffImage!.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it('font_or_os_mismatch_is_incompatible: 字体或系统环境不一致时绝不返回 PASS，即使像素完全一致', () => {
    const img = createSolidRgbaPng(10, 10, [40, 80, 120, 255]);
    const linuxEnv = detectEnvironment({ ...baseEnv, framework: 'vue', os: 'linux' });
    const resOs = compareBaseline(
      { environment: linuxEnv, imageBuffer: img },
      { environment: baseEnv, imageBuffer: img },
    );
    expect(resOs.result).toBe('INCOMPATIBLE');
    expect(resOs.result).not.toBe('PASS');

    const diffFontEnv = detectEnvironment({
      ...baseEnv,
      framework: 'vue',
      fontDigest: 'b'.repeat(64),
    });
    const resFont = compareBaseline(
      { environment: diffFontEnv, imageBuffer: img },
      { environment: baseEnv, imageBuffer: img },
    );
    expect(resFont.result).toBe('INCOMPATIBLE');
    expect(resFont.result).not.toBe('PASS');
  });

  it('engine_upgrade_compares_existing_baseline: 仅 ECharts 或框架版本变化时仍保持相同 environmentKey 并执行图像对比', () => {
    const baselineImg = createSolidRgbaPng(10, 10, [10, 20, 30, 255]);
    const upgradedIdentical = createSolidRgbaPng(10, 10, [10, 20, 30, 255]);
    const upgradedDifferent = createSolidRgbaPng(10, 10, [200, 200, 200, 255]);

    const upgradedEnv = detectEnvironment({
      ...baseEnv,
      framework: 'vue',
      echartsVersion: '6.2.0',
      frameworkVersion: '3.5.46',
    });

    expect(computeEnvironmentKey(upgradedEnv)).toBe(computeEnvironmentKey(baseEnv));

    const passRes = compareBaseline(
      { environment: upgradedEnv, imageBuffer: upgradedIdentical },
      { environment: baseEnv, imageBuffer: baselineImg },
    );
    expect(passRes.result).toBe('PASS');

    const diffRes = compareBaseline(
      { environment: upgradedEnv, imageBuffer: upgradedDifferent },
      { environment: baseEnv, imageBuffer: baselineImg },
    );
    expect(diffRes.result).toBe('DIFF');
    expect(diffRes.diffRatio).toBe(1);
  });

  it('手动上传来源 (unknown-manual) 绝不能判定为 PASS，返回 INCOMPATIBLE', () => {
    const img = createSolidRgbaPng(10, 10, [10, 20, 30, 255]);
    const res = compareBaseline(
      { environment: baseEnv, environmentKey: 'unknown-manual', imageBuffer: img },
      { environment: baseEnv, imageBuffer: img },
    );
    expect(res.result).toBe('INCOMPATIBLE');
  });
});
