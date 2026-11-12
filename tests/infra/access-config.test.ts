import { describe, expect, it } from 'vitest';
import { validateAccessConfig, validateOidcMetadata, validateOidcJwks } from '../../infra/scripts/access-config.js';

const valid = {
  oidc: { issuer: 'https://identity.example.com/realm', webClientId: 'gallery', cliClientId: 'cli' },
  preview: { platformOrigin: 'https://gallery.company.co.uk', apiOrigin: 'https://api.company.co.uk', previewOrigin: 'https://r-probe.assets-example.net' },
};
describe('G2 external access configuration', () => {
  it('reports missing external resources instead of implying readiness', () => {
    expect(validateAccessConfig({})).toEqual({ oidc: null, preview: null });
  });
  it('accepts distinct registered domains and complete OIDC metadata inputs', () => {
    expect(validateAccessConfig(valid)).toEqual(valid);
  });
  it.each([
    { oidc: { issuer: valid.oidc.issuer } },
    { oidc: { ...valid.oidc, issuer: 'http://identity.example.com' } },
    { oidc: { ...valid.oidc, issuer: 'https://user:secret@identity.example.com' } },
    { preview: { ...valid.preview, previewOrigin: 'https://preview.company.co.uk' } },
    { preview: { platformOrigin: valid.preview.platformOrigin, previewOrigin: valid.preview.previewOrigin } },
    { preview: { ...valid.preview, apiOrigin: 'https://api.assets-example.net' } },
    { preview: { ...valid.preview, previewOrigin: 'https://localhost' } },
    { preview: { ...valid.preview, previewOrigin: 'https://assets-example.net/?token=private' } },
    { preview: { ...valid.preview, platformOrigin: 'https://gallery.company.co.uk/path' } },
  ])('rejects partial or unsafe configuration without leaking its values', input => {
    expect(() => validateAccessConfig(input)).toThrow();
    try { validateAccessConfig(input); } catch (error) { expect(String(error)).not.toContain('secret'); }
  });
  it('requires matching issuer, authorization code, and PKCE S256', () => {
    const metadata = {
      issuer: valid.oidc.issuer, authorization_endpoint: 'https://identity.example.com/auth',
      token_endpoint: 'https://identity.example.com/token', jwks_uri: 'https://identity.example.com/keys',
      response_types_supported: ['code'], code_challenge_methods_supported: ['S256'],
    };
    expect(() => validateOidcMetadata(metadata, valid.oidc.issuer)).not.toThrow();
    for (const change of [{ issuer: 'https://other.example.com' }, { code_challenge_methods_supported: ['plain'] }, { response_types_supported: ['token'] }, { jwks_uri: 'http://identity.example.com/keys' }]) {
      expect(() => validateOidcMetadata({ ...metadata, ...change }, valid.oidc.issuer)).toThrow();
    }
  });
  it('requires at least one public asymmetric verification key', () => {
    for (const input of [{}, { keys: [] }, { keys: [null] }, { keys: [{ kty: 'oct', k: 'secret' }] }]) {
      expect(() => validateOidcJwks(input)).toThrow();
    }
    expect(() => validateOidcJwks({ keys: [{ kty: 'RSA', n: 'public-modulus', e: 'AQAB' }] })).not.toThrow();
  });
});
