import * as os from 'node:os';
import type { Browser, Page } from '@playwright/test';
import type { EnvironmentV1 } from '../contracts/reports.js';
import { canonicalJson } from '../contracts/schema.js';
import { sha256Hex } from './report.js';

/** These are applied to the actual isolated context, then verified on its page. */
export const VERIFICATION_BROWSER_CONTEXT = { locale: 'zh-CN', timezoneId: 'Asia/Shanghai', deviceScaleFactor: 1 } as const;
export const FONT_PROBE_STRINGS = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  '中文图表标签折线柱状饼图散点排行榜占比趋势卡片暂无数据',
  'iIlL1.,;:!|',
] as const;
export const FONT_REFERENCE_FAMILIES = ['sans-serif', 'serif', 'monospace'] as const;
type FontMeasurements = { stack: string; families: { family: string; available: boolean; advances: number[] }[]; loadedFonts: string[] };

/** Same v1 normalization as the independently maintained T10 browser probe. */
export function fontFingerprintCanonical(input: unknown): string {
  const value = input as Partial<FontMeasurements> | null;
  if (!value || typeof value.stack !== 'string' || !value.stack.trim()) throw new Error('BROWSER_ENVIRONMENT: missing font stack');
  if (!Array.isArray(value.families) || !value.families.length) throw new Error('BROWSER_ENVIRONMENT: missing font families');
  if (!Array.isArray(value.loadedFonts) || value.loadedFonts.some(font => typeof font !== 'string')) throw new Error('BROWSER_ENVIRONMENT: missing loadedFonts');
  const families = value.families.map(family => {
    if (!family || typeof family.family !== 'string' || !family.family.trim() || typeof family.available !== 'boolean'
      || !Array.isArray(family.advances) || family.advances.length !== FONT_PROBE_STRINGS.length
      || family.advances.some(advance => typeof advance !== 'number' || !Number.isFinite(advance) || advance <= 0)) {
      throw new Error('BROWSER_ENVIRONMENT: invalid font measurements');
    }
    return { family: family.family, available: family.available, advances: family.advances.map(advance => Math.round(advance * 1000) / 1000) };
  });
  const names = new Set(families.map(family => family.family));
  if (names.size !== families.length || FONT_REFERENCE_FAMILIES.some(family => !names.has(family))) throw new Error('BROWSER_ENVIRONMENT: incomplete font reference families');
  return canonicalJson({ kind: 'font-fingerprint-v1', stack: value.stack.trim().normalize('NFC'), families, loadedFonts: [...value.loadedFonts].sort() });
}

export async function captureBrowserEnvironment(input: {
  browser: Browser; page: Page; readySelector: string; timeoutMs: number;
  viewport: { width: number; height: number }; renderer: 'canvas' | 'svg'; theme: string; frameworkVersion: string; echartsVersion: string;
}) {
  const cdp = await input.browser.newBrowserCDPSession();
  let browserIdentity: { revision: string; product: string };
  try {
    const identity = await cdp.send('Browser.getVersion');
    if (typeof identity.revision !== 'string' || !/^@[0-9a-f]{7,64}$/i.test(identity.revision)
      || typeof identity.product !== 'string' || !identity.product.endsWith('/' + input.browser.version())) {
      throw new Error('BROWSER_ENVIRONMENT: Chromium identity is unavailable');
    }
    browserIdentity = { revision: identity.revision, product: identity.product };
  } finally { await cdp.detach(); }

  const measured = await input.page.locator(input.readySelector).first().evaluate(async (host, { probes, references, timeoutMs }) => {
    if (!document.fonts || !document.fonts.ready) throw new Error('Font readiness is unavailable');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([document.fonts.ready, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Font readiness timed out')), timeoutMs); })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
    if (document.fonts.status !== 'loaded') throw new Error('Fonts are not ready');
    const stack = getComputedStyle(host).fontFamily;
    const families: { family: string; available: boolean; advances: number[] }[] = [];
    const seen = new Set<string>();
    for (const raw of [...stack.split(','), ...references]) {
      const family = raw.trim().replace(/^["']|["']$/g, '');
      if (!family || seen.has(family)) continue;
      seen.add(family);
      const context = document.createElement('canvas').getContext('2d');
      if (!context) throw new Error('Font measurement context is unavailable');
      context.font = `16px ${JSON.stringify(family)}`;
      families.push({ family, available: document.fonts.check(`16px ${JSON.stringify(family)}`), advances: probes.map(text => context.measureText(text).width) });
    }
    const loadedFonts: string[] = [];
    document.fonts.forEach(face => { loadedFonts.push(`${face.family} ${face.style} ${face.weight} ${face.status}`); });
    return { fonts: { stack, families, loadedFonts }, locale: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      deviceScaleFactor: window.devicePixelRatio, width: window.innerWidth, height: window.innerHeight, dark: matchMedia('(prefers-color-scheme: dark)').matches };
  }, { probes: [...FONT_PROBE_STRINGS], references: [...FONT_REFERENCE_FAMILIES], timeoutMs: input.timeoutMs }, { timeout: input.timeoutMs });
  const expected = VERIFICATION_BROWSER_CONTEXT;
  if (measured.locale !== expected.locale || measured.timezone !== expected.timezoneId || measured.deviceScaleFactor !== expected.deviceScaleFactor
    || measured.width !== input.viewport.width || measured.height !== input.viewport.height || measured.dark !== (input.theme === 'dark')) {
    throw new Error('BROWSER_ENVIRONMENT: page context does not match the declared capture');
  }
  const canonical = fontFingerprintCanonical(measured.fonts);
  const environment: EnvironmentV1 = {
    os: process.platform === 'win32' ? 'windows' : process.platform, arch: os.arch(),
    browserVersion: input.browser.version(), browserRevision: browserIdentity.revision, fontDigest: sha256Hex(canonical),
    locale: measured.locale, timezone: measured.timezone, deviceScaleFactor: measured.deviceScaleFactor,
    width: measured.width, height: measured.height, renderer: input.renderer, theme: input.theme,
    frameworkVersion: input.frameworkVersion, echartsVersion: input.echartsVersion,
  };
  return { environment, browser: browserIdentity, fontFingerprint: { measurements: measured.fonts, canonical } };
}
