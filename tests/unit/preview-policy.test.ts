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
