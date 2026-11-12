import * as os from 'node:os';
import { computeBufferSha256 } from './digest.js';
import type { EnvironmentV1 } from '../contracts/reports.js';
import type { Renderer } from '../contracts/examples.js';
import type { Framework } from '../contracts/release-manifest.js';

export type DetectEnvironmentOptions = {
  os?: string;
  arch?: string;
  browserVersion?: string;
  browserRevision?: string;
  fontDigest?: string;
  locale?: string;
  timezone?: string;
  deviceScaleFactor?: number;
  renderer?: Renderer;
  width?: number;
  height?: number;
  theme?: string;
  framework: Framework;
  frameworkVersion?: string;
  echartsVersion?: string;
};

/**
 * 标准字体签名：当无外部指定字体摘要时，使用确定性基线签名
 */
const DEFAULT_FONT_DIGEST = computeBufferSha256('system-ui,sans-serif;regular,bold;zh-CN');

/**
 * 探测并归一化执行环境指纹，满足 EnvironmentV1 规范。
 */
export function detectEnvironment(options: DetectEnvironmentOptions): EnvironmentV1 {
  const currentPlatform = options.os ?? (process.platform === 'win32' ? 'windows' : process.platform);
  const currentArch = options.arch ?? os.arch();

  const frameworkVersion =
    options.frameworkVersion ??
    (options.framework === 'vue' ? '3.5.45' : '19.3.1');

  const echartsVersion = options.echartsVersion ?? '6.1.0';

  return {
    os: currentPlatform,
    arch: currentArch,
    browserVersion: options.browserVersion ?? '130.0.0.0',
    browserRevision: options.browserRevision ?? '1000',
    fontDigest: options.fontDigest ?? DEFAULT_FONT_DIGEST,
    locale: options.locale ?? 'zh-CN',
    timezone: options.timezone ?? 'Asia/Shanghai',
    deviceScaleFactor: options.deviceScaleFactor ?? 1,
    renderer: options.renderer ?? 'canvas',
    width: options.width ?? 800,
    height: options.height ?? 400,
    theme: options.theme ?? 'light',
    frameworkVersion,
    echartsVersion,
  };
}

/**
 * 计算确定性环境签名 key：返回 64 位小写 SHA-256 十六进制字符串。
 */
export function computeEnvironmentKey(env: EnvironmentV1): string {
  // 按固定键顺序序列化确保跨平台一致
  const canonical = JSON.stringify({
    arch: env.arch,
    browserRevision: env.browserRevision,
    browserVersion: env.browserVersion,
    deviceScaleFactor: env.deviceScaleFactor,
    echartsVersion: env.echartsVersion,
    fontDigest: env.fontDigest,
    frameworkVersion: env.frameworkVersion,
    height: env.height,
    locale: env.locale,
    os: env.os,
    renderer: env.renderer,
    theme: env.theme,
    timezone: env.timezone,
    width: env.width,
  });
  return computeBufferSha256(canonical);
}

