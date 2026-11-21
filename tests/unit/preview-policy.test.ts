import { describe, expect, it } from 'vitest';
import * as contracts from '@company/contracts/preview';
import { resourcePath, resourceMime } from '../../apps/preview-gateway/dist/path-policy.js';
const config = { platformOrigin: 'https://gallery.platform.test', apiOrigin: 'https://api.platform.test', previewOrigin: 'https://preview.assets.test' };
describe('preview deployment isolation', () => {
  it('accepts a separate registered domain and pins the version origin', () => {
    expect(contracts.validatePreviewConfig?.(config)).toEqual(config);
    expect(contracts.previewOriginFor?.('12345678-1234-4234-8234-123456789abc', config)).toBe('https://r-12345678-1234-4234-8234-123456789abc.preview.assets.test');
  });
  it.each(['https://preview.platform.test','http://preview.assets.test','https://user@preview.assets.test','https://preview.assets.test/path','https://preview.assets.test/?x=1','https://127.0.0.1'])('rejects unsafe domain config %s', previewOrigin => {
    expect(() => contracts.validatePreviewConfig?.({ ...config, previewOrigin })).toThrow();
  });
  it('rejects different private hosting suffixes on the same registered domain', () => {
    expect(() => contracts.validatePreviewConfig?.({ ...config, platformOrigin: 'https://one.github.io', previewOrigin: 'https://two.github.io' })).toThrow();
  });
});
describe('explicit IP port preview configuration', () => {
  const pilot = { mode: 'ip-port' as const, platformOrigin: 'https://192.0.2.8', apiOrigin: 'https://192.0.2.8:8444', previewOrigin: 'https://192.0.2.8:8443' };
  const id = '12345678-1234-4234-8234-123456789abc';
  it('accepts the configured HTTPS preview port on the same numeric IP', () => {
    expect(contracts.validatePreviewConfig(pilot)).toEqual(pilot);
    expect(contracts.previewOriginFor(id, pilot)).toBe(pilot.previewOrigin);
    const ipv6 = { ...pilot, platformOrigin: 'https://[2001:db8::8]', apiOrigin: 'https://[2001:db8::8]:8444', previewOrigin: 'https://[2001:db8::8]:8443' };
    expect(() => contracts.validatePreviewConfig(ipv6)).toThrow();
  });
  it.each(['https://192.0.2.8', 'https://192.0.2.8:8444', 'https://192.0.2.9:8443', 'http://192.0.2.8:8443', 'https://192.0.2.8:8443/path', 'https://preview.assets.test:8443'])('rejects invalid pilot origin %s', previewOrigin => {
    expect(() => contracts.validatePreviewConfig({ ...pilot, previewOrigin })).toThrow();
  });
  it('requires explicit opt-in and rejects unknown modes', () => {
    expect(() => contracts.validatePreviewConfig({ ...pilot, mode: 'domain' })).toThrow();
    expect(() => contracts.previewConfigFromEnv({ PLATFORM_PREVIEW_MODE: 'unknown' })).toThrow();
    expect(() => contracts.previewConfigFromEnv({ PLATFORM_PREVIEW_MODE: 'ip-port' })).toThrow();
    expect(contracts.previewConfigFromEnv({ PLATFORM_PREVIEW_MODE: '' })).toBeUndefined();
  });
  it('requires a non-default preview port and parses all origins together', () => {
    expect(() => contracts.validatePreviewConfig({ ...pilot, platformOrigin: 'https://192.0.2.8:8445', previewOrigin: 'https://192.0.2.8' })).toThrow();
    expect(contracts.previewConfigFromEnv({ PLATFORM_PREVIEW_MODE: 'ip-port', PLATFORM_GALLERY_ORIGIN: pilot.platformOrigin,
      PLATFORM_API_ORIGIN: pilot.apiOrigin, PLATFORM_PREVIEW_ORIGIN: pilot.previewOrigin })).toEqual(pilot);
  });
});
describe('published static path and MIME compatibility', () => {
  it.each([
    ['/preview/%E5%9B%BE%E8%A1%A8.html', 'preview/图表.html'],
    ['/preview/icon.PNG', 'preview/icon.PNG'],
    ['/preview/index.HTML', 'preview/index.HTML'],
  ])('decodes a valid published path once: %s', (url, path) => expect(resourcePath(url)).toBe(path));
  it.each([
    ['preview/index.HTML', 'text/html; charset=utf-8'], ['preview/icon.PNG', 'image/png'],
    ['preview/image.webp','image/webp'], ['preview/image.gif','image/gif'],
    ['preview/font.ttf','font/ttf'], ['preview/font.otf','font/otf'], ['preview/file.wasm','application/wasm'],
  ])('serves the accurate MIME for %s', (path, mime) => expect(resourceMime(path)).toBe(mime));
  it.each(['/preview/%252e%252e/x','/preview/%2e%2e/x','/preview%2fother/x','/preview/%5cx','/preview/a%00.html','/preview/a%3f.html','/preview/my%20icon.png'])('still rejects encoded path bypass %s', path => expect(() => resourcePath(path)).toThrow());
});
