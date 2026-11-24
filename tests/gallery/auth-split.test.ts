import { describe, expect, it } from 'vitest';
import { companyLoginUrl as galleryLoginUrl } from '../../apps/gallery/app/lib/auth.js';
import { companyLoginUrl as adminLoginUrl } from '../../apps/admin/app/lib/auth.js';

describe('independent gallery and admin auth helpers', () => {
  it('binds gallery login URL to ?target=gallery', () => {
    const parsed = new URL(galleryLoginUrl);
    expect(parsed.pathname).toBe('/v1/auth/oidc/start');
    expect(parsed.searchParams.get('target')).toBe('gallery');
  });

  it('binds admin login URL to ?target=admin', () => {
    const parsed = new URL(adminLoginUrl);
    expect(parsed.pathname).toBe('/v1/auth/oidc/start');
    expect(parsed.searchParams.get('target')).toBe('admin');
  });
});
