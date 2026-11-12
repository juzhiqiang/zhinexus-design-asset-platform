import { describe, expect, it } from 'vitest';
import * as contracts from '@company/contracts';
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
