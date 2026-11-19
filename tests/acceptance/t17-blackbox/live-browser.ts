import { chromium, type Page } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { arch } from 'node:os';
import { join } from 'node:path';
import type { ArtifactRef, EnvironmentV1 } from '@company/contracts';
import { canonicalJson, sha256 } from './support.mjs';
import type { LiveProject } from './live-support.js';

export const LIVE_VIEWPORT = { width: 800, height: 480 };
export const LIVE_READY = '[data-live-ready="true"]';
export const LIVE_POINT = '[data-live-point="true"]';

/** Independent browser observation. This never consumes a CLI verification report. */
export async function observeLivePage(project: LiveProject, origin: string, kind: 'reference' | 'generated') {
  const browser = await chromium.launch({ headless: true });
  try {
    const cdp = await browser.newBrowserCDPSession();
    const browserIdentity = await cdp.send('Browser.getVersion');
    await cdp.detach();
    const context = await browser.newContext({ viewport: LIVE_VIEWPORT, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', colorScheme: 'light' });
    const page = await context.newPage(), errors: string[] = [];
    const assets: Array<{ path: string; sha256: string; bytes: number }> = [], pending: Promise<void>[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.origin === origin && url.pathname.endsWith('.js')) pending.push((async () => {
        const bytes = await response.body(); assets.push({ path: url.pathname.slice(1), sha256: sha256(bytes), bytes: bytes.length });
      })());
    });
    await context.route('**/*', async route => { if (new URL(route.request().url()).origin !== origin) { errors.push('unexpected outbound request'); await route.abort(); } else await route.continue(); });
    await page.goto(origin + (kind === 'reference' ? '/reference.html' : '/'), { waitUntil: 'load' });
    await page.locator(LIVE_READY).waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator(LIVE_POINT).click();
    await page.locator('[data-live-count]').filter({ hasText: /^1$/ }).waitFor({ state: 'visible' });
    const count = (await page.locator('[data-live-count]').textContent())?.trim();
    if (count !== '1') throw new Error('Independent real chart click did not reach the application event handler.');
    await Promise.all(pending);
    const sources: string[] = [];
    for (const asset of assets) {
      const bytes = await readFile(join(project.root, 'dist', asset.path));
      if (sha256(bytes) !== asset.sha256) throw new Error('Browser-loaded JS differs from the actual build.');
      const map = JSON.parse(await readFile(join(project.root, 'dist', asset.path + '.map'), 'utf8')) as { sources?: string[] };
      if (!Array.isArray(map.sources)) throw new Error('Browser-loaded build is missing its source map.');
      sources.push(...map.sources.map(source => source.replaceAll('\\', '/')));
    }
    const usesGenerated = sources.some(source => source.endsWith(project.generatedPath));
    if (kind === 'reference' && usesGenerated || kind === 'generated' && !usesGenerated) throw new Error('Independent reference/generated entry source provenance is invalid.');
    if (!sources.some(source => source.includes('@company/charts-' + project.framework))) throw new Error('Browser entry did not load the actually installed SDK.');
    if (errors.length) throw new Error('Independent browser runtime failed: ' + errors.join('; '));
    const font = await measureLiveFonts(page);
    const environment: EnvironmentV1 = { os: process.platform === 'win32' ? 'windows' : process.platform, arch: arch(),
      browserVersion: browser.version(), browserRevision: browserIdentity.revision, fontDigest: sha256(canonicalJson(font)),
      locale: 'zh-CN', timezone: 'Asia/Shanghai', deviceScaleFactor: 1, renderer: 'svg', ...LIVE_VIEWPORT, theme: 'light',
      frameworkVersion: project.framework === 'vue' ? '3.5.45' : '19.3.1', echartsVersion: '6.1.0' };
    const bytes = await page.screenshot({ fullPage: false });
    const path = kind === 'reference' ? 'baselines/independent-direct-sdk.png' : 'observed-generated.png';
    await mkdir(join(project.artifactRoot, 'baselines'), { recursive: true });
    await writeFile(join(project.artifactRoot, path), bytes, { flag: 'wx' });
    const image: ArtifactRef = { path, sha256: sha256(bytes), bytes: bytes.length };
    const evidence = { kind, image, environment, fontMeasurement: font, assets, sources, realPointEventCount: 1, productionAcceptance: false,
      baselinePolicy: 'Independent direct-SDK fixture, explicitly selected by this test; temporary synthetic business data. No generated screenshot is accepted as a baseline.' };
    await writeFile(join(project.artifactRoot, kind + '-observation.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
    return evidence;
  } finally { await browser.close(); }
}

async function measureLiveFonts(page: Page) {
  return page.evaluate(async selector => {
    await document.fonts.ready;
    const target = document.querySelector(selector);
    if (!target) throw new Error('Missing independent font measurement target');
    const stack = getComputedStyle(target).fontFamily.trim().normalize('NFC');
    const names = [...new Set([...stack.split(',').map(name => name.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean), 'sans-serif', 'serif', 'monospace'])];
    const strings = ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', '中文图表标签折线柱状饼图散点排行榜占比趋势卡片暂无数据', 'iIlL1.,;:!|'];
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
    if (!context) throw new Error('Missing font measurement canvas');
    const families = names.map(family => { const font = '16px ' + JSON.stringify(family); context.font = font;
      return { family, available: document.fonts.check(font), advances: strings.map(value => Math.round(context.measureText(value).width * 1000) / 1000) }; });
    const loadedFonts = Array.from(document.fonts as unknown as Iterable<FontFace>).map(face => face.family + ' ' + face.style + ' ' + face.weight + ' ' + face.status).sort();
    return { kind: 'font-fingerprint-v1', stack, families, loadedFonts };
  }, LIVE_READY);
}
