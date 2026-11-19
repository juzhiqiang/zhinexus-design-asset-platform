import { describe, expect, it } from 'vitest';
import type { Browser, Page } from '@playwright/test';
import { captureBrowserEnvironment, fontFingerprintCanonical } from '../../packages/component-cli/src/integration/browser-environment.js';

const measurements = () => ({
  stack: '  Arial, sans-serif  ',
  families: [
    { family: 'Arial', available: true, advances: [100.1234, 200.5678, 30] },
    { family: 'sans-serif', available: true, advances: [101, 201, 31] },
    { family: 'serif', available: false, advances: [102, 202, 32] },
    { family: 'monospace', available: true, advances: [103, 203, 33] },
  ],
  loadedFonts: ['Z brand normal 400 loaded', 'A brand italic 700 loaded'],
});

describe('T17 measured browser environment', () => {
  it('normalizes real glyph advances and loaded webfonts using the independent T10 v1 projection', () => {
    expect(fontFingerprintCanonical(measurements())).toBe(
      '{"families":[{"advances":[100.123,200.568,30],"available":true,"family":"Arial"},{"advances":[101,201,31],"available":true,"family":"sans-serif"},{"advances":[102,202,32],"available":false,"family":"serif"},{"advances":[103,203,33],"available":true,"family":"monospace"}],"kind":"font-fingerprint-v1","loadedFonts":["A brand italic 700 loaded","Z brand normal 400 loaded"],"stack":"Arial, sans-serif"}',
    );
    const withoutWebfonts = { ...measurements(), loadedFonts: [] };
    const changedFallback = measurements();
    changedFallback.families[1]!.advances[1] = 199;
    expect(fontFingerprintCanonical(withoutWebfonts)).not.toBe(fontFingerprintCanonical(measurements()));
    expect(fontFingerprintCanonical(changedFallback)).not.toBe(fontFingerprintCanonical(measurements()));
  });

  it('rejects absent, malformed, nonfinite or incomplete font evidence instead of using a default', () => {
    for (const input of [null, {}, { ...measurements(), stack: ' ' }, { ...measurements(), loadedFonts: undefined },
      { ...measurements(), loadedFonts: [null] }, { ...measurements(), families: [] },
      { ...measurements(), families: measurements().families.slice(0, -1) },
      { ...measurements(), families: [...measurements().families, measurements().families[0]] },
      { ...measurements(), families: measurements().families.map((family, index) => index === 0 ? { ...family, advances: [1, Number.NaN, 3] } : family) },
      { ...measurements(), families: measurements().families.map((family, index) => index === 0 ? { ...family, advances: [1, 2] } : family) },
    ]) {
      expect(() => fontFingerprintCanonical(input)).toThrow(/BROWSER_ENVIRONMENT/);
    }
  });

  it('rejects unavailable or mismatched running Chromium identity before claiming an environment', async () => {
    for (const identity of [
      { revision: '', product: 'Chrome/158.0.8127.18' },
      { revision: '1000', product: 'Chrome/158.0.8127.18' },
      { revision: '@' + 'a'.repeat(40), product: 'Chrome/157.0.0.0' },
    ]) {
      const browser = { version: () => '158.0.8127.18', newBrowserCDPSession: async () => ({ send: async () => identity, detach: async () => {} }) } as unknown as Browser;
      await expect(captureBrowserEnvironment({ browser, page: {} as Page, readySelector: 'main', timeoutMs: 100,
        viewport: { width: 640, height: 480 }, renderer: 'canvas', theme: 'light', frameworkVersion: '3.5.45', echartsVersion: '6.1.0' })).rejects.toThrow(/Chromium identity/);
    }
  });
});
