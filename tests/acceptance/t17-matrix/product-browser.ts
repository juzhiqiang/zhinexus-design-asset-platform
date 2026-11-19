import { createHash } from 'node:crypto';
import { arch } from 'node:os';
import { chromium, expect } from '@playwright/test';
import { canonicalJson, type EnvironmentV1 } from '@company/contracts';
import { T17_TOOLCHAIN, T17_VISUAL, type T17PositiveScenario } from '../../fixtures/t17-matrix/scenarios.js';
import { installBrowserNetworkGuards } from './browser.js';

/** Independent implementation of the documented v1 environment probe, never copied from the target report. */
export async function captureIndependentProductBaseline(url: string, scenario: T17PositiveScenario): Promise<{ bytes: Buffer; environment: EnvironmentV1; audit: unknown }> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: T17_VISUAL.viewport, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', deviceScaleFactor: 1,
    colorScheme: scenario.visual.theme === 'dark' ? 'dark' : 'light', serviceWorkers: 'block', acceptDownloads: false });
  const errors: string[] = [];
  await installBrowserNetworkGuards(context, new URL(url).origin, () => errors.push('outbound request'));
  const page = await context.newPage();
  page.on('pageerror', () => errors.push('page error'));
  page.on('popup', () => errors.push('popup'));
  page.on('download', download => { errors.push('download'); void download.cancel(); });
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    const ready = page.locator(scenario.browser.readySelector), deadline = Date.now() + 30000;
    await ready.first().waitFor({ state: 'visible', timeout: 30000 });
    const readyCount = await ready.count();
    if (!readyCount) throw new Error('Independent reference has no ready host.');
    for (let index = 0; index < readyCount; index++) {
      await ready.nth(index).waitFor({ state: 'visible', timeout: Math.max(1, deadline - Date.now()) });
      const box = await ready.nth(index).boundingBox();
      if (!box || box.width <= 0 || box.height <= 0) throw new Error('Independent reference contains a zero-sized ready host.');
    }
    if (await ready.count() !== readyCount) throw new Error('Independent reference readiness count changed.');
    for (const action of scenario.browser.actions) {
      const locator = page.locator(action.selector);
      if (await locator.count() !== 1) throw new Error('Independent reference action is ambiguous.');
      if (action.kind === 'fill') await locator.fill(action.value); else await locator.click();
    }
    for (const assertion of scenario.browser.assertions) {
      const locator = page.locator(assertion.selector);
      if (assertion.kind === 'count') await expect(locator).toHaveCount(assertion.count, { timeout: 30000 });
      if (assertion.kind === 'text') await expect.poll(async () => (await locator.innerText()).trim(), { timeout: 30000 }).toBe(assertion.value);
      if (assertion.kind === 'visible') await expect(locator).toBeVisible({ timeout: 30000 });
    }
    const cdp = await browser.newBrowserCDPSession();
    const identity = await cdp.send('Browser.getVersion'); await cdp.detach();
    if (!/^@[0-9a-f]{7,64}$/i.test(identity.revision) || !identity.product.endsWith('/' + browser.version())) throw new Error('Independent Chromium identity is unavailable.');
    const measured = await page.evaluate(async selector => {
      await document.fonts.ready;
      const host = document.querySelector(selector); if (!host || document.fonts.status !== 'loaded') throw new Error('Font host is unavailable');
      const stack = getComputedStyle(host).fontFamily;
      const probes = ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', '中文图表标签折线柱状饼图散点排行榜占比趋势卡片暂无数据', 'iIlL1.,;:!|'];
      const families: { family: string; available: boolean; advances: number[] }[] = [], seen = new Set<string>();
      for (const raw of [...stack.split(','), 'sans-serif', 'serif', 'monospace']) {
        const family = raw.trim().replace(/^["']|["']$/g, ''); if (!family || seen.has(family)) continue; seen.add(family);
        const canvas = document.createElement('canvas').getContext('2d'); if (!canvas) throw new Error('Font context unavailable');
        canvas.font = '16px ' + JSON.stringify(family);
        families.push({ family, available: document.fonts.check('16px ' + JSON.stringify(family)), advances: probes.map(text => Math.round(canvas.measureText(text).width * 1000) / 1000) });
      }
      const loadedFonts: string[] = []; document.fonts.forEach(face => loadedFonts.push(face.family + ' ' + face.style + ' ' + face.weight + ' ' + face.status));
      return { fonts: { kind: 'font-fingerprint-v1', stack: stack.trim().normalize('NFC'), families, loadedFonts: loadedFonts.sort() },
        locale: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, deviceScaleFactor: window.devicePixelRatio,
        width: window.innerWidth, height: window.innerHeight, dark: matchMedia('(prefers-color-scheme: dark)').matches };
    }, scenario.browser.readySelector);
    if (errors.length || measured.locale !== 'zh-CN' || measured.timezone !== 'Asia/Shanghai' || measured.deviceScaleFactor !== 1
      || measured.width !== T17_VISUAL.viewport.width || measured.height !== T17_VISUAL.viewport.height || measured.dark !== (scenario.visual.theme === 'dark')) throw new Error('Independent reference browser evidence failed.');
    const canonical = canonicalJson(measured.fonts);
    const environment: EnvironmentV1 = { os: process.platform === 'win32' ? 'windows' : process.platform, arch: arch(), browserVersion: browser.version(), browserRevision: identity.revision,
      fontDigest: createHash('sha256').update(canonical).digest('hex'), locale: measured.locale, timezone: measured.timezone, deviceScaleFactor: measured.deviceScaleFactor,
      width: measured.width, height: measured.height, renderer: scenario.visual.renderer, theme: scenario.visual.theme,
      frameworkVersion: scenario.framework === 'vue' ? T17_TOOLCHAIN.vue : T17_TOOLCHAIN.react, echartsVersion: T17_TOOLCHAIN.echarts };
    return { bytes: await page.screenshot({ fullPage: false }), environment, audit: { environment, browser: identity, fontFingerprint: { measurements: measured.fonts, canonical } } };
  } finally { await context.close(); await browser.close(); }
}
