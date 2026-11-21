import { validatePreviewConfig, type PreviewConfig } from '@company/contracts/preview';

export type AccessConfig = {
  oidc: { issuer: string; webClientId: string; cliClientId: string } | null;
  preview: PreviewConfig | null;
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected configuration object');
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${field}`);
  return value;
}
function https(value: unknown, field: string): string {
  const input = text(value, field);
  let url: URL;
  try { url = new URL(input); } catch { throw new Error(`Invalid ${field}`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error(`Unsafe ${field}`);
  return input;
}
export function validateAccessConfig(input: unknown): AccessConfig {
  const config = object(input);
  const result: AccessConfig = { oidc: null, preview: null };
  if (config.oidc != null) {
    const oidc = object(config.oidc);
    result.oidc = { issuer: https(oidc.issuer, 'issuer'), webClientId: text(oidc.webClientId, 'webClientId'), cliClientId: text(oidc.cliClientId, 'cliClientId') };
  }
  if (config.preview != null) {
    const preview = object(config.preview);
    const mode = preview.mode;
    if (mode !== undefined && mode !== 'domain' && mode !== 'ip-port') throw new Error('Invalid preview mode');
    const origins = {
      platformOrigin: text(preview.platformOrigin, 'platformOrigin'),
      apiOrigin: text(preview.apiOrigin, 'apiOrigin'),
      previewOrigin: text(preview.previewOrigin, 'previewOrigin'),
    };
    result.preview = validatePreviewConfig(mode === undefined ? origins : { ...origins, mode });
  }
  return result;
}
export function validateOidcMetadata(input: unknown, issuer: string): void {
  const metadata = object(input);
  if (metadata.issuer !== issuer) throw new Error('OIDC issuer mismatch');
  for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) https(metadata[field], field);
  if (!Array.isArray(metadata.response_types_supported) || !metadata.response_types_supported.includes('code')) throw new Error('OIDC authorization code support missing');
  if (!Array.isArray(metadata.code_challenge_methods_supported) || !metadata.code_challenge_methods_supported.includes('S256')) throw new Error('OIDC PKCE S256 support missing');
}
export function validateOidcJwks(input: unknown): void {
  const { keys } = object(input);
  if (!Array.isArray(keys) || keys.length === 0) throw new Error('OIDC JWKS has no verification keys');
  const usable = keys.map(value => {
    const key = object(value);
    if (['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some(field => field in key)) throw new Error('OIDC JWKS must contain only public keys');
    if (key.use && key.use !== 'sig') return false;
    const fields = key.kty === 'RSA' ? ['n', 'e'] : key.kty === 'EC' ? ['crv', 'x', 'y'] : key.kty === 'OKP' ? ['crv', 'x'] : [];
    return fields.length > 0 && fields.every(field => typeof key[field] === 'string' && key[field].length > 0);
  });
  if (!usable.some(Boolean)) throw new Error('OIDC JWKS has no public signature key');
}
