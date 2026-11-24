import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { validateDeployment } from '../../scripts/verify-deployment.js';

const template = parse(await readFile('infra/compose.production.yaml', 'utf8'), { merge: true });
const digest = `sha256:${'a'.repeat(64)}`;
function environment(): Record<string, string> {
  return {
    PLATFORM_API_IMAGE: digest, PLATFORM_PREVIEW_IMAGE: digest, PLATFORM_MINIO_IMAGE: digest,
    PLATFORM_DATABASE_URL: 'postgresql://api:private-api@postgres/zhinexus',
    PREVIEW_DATABASE_URL: 'postgresql://preview:private-preview@postgres/zhinexus',
    PLATFORM_S3_ENDPOINT: 'https://objects.example.com', PLATFORM_S3_BUCKET: 'private-assets',
    PLATFORM_S3_ACCESS_KEY: 'api-storage', PLATFORM_S3_SECRET_KEY: 'private-api-storage',
    PREVIEW_S3_ACCESS_KEY: 'preview-storage', PREVIEW_S3_SECRET_KEY: 'private-preview-storage',
    PLATFORM_OIDC_ISSUER: 'https://identity.example.com/realm', PLATFORM_OIDC_AUDIENCE: 'platform',
    PLATFORM_OIDC_JWKS_URI: 'https://identity.example.com/realm/keys',
    PLATFORM_OIDC_WEB_CLIENT_IDS: 'gallery', PLATFORM_OIDC_CLI_CLIENT_IDS: 'component-cli',
    PLATFORM_GALLERY_ORIGIN: 'https://gallery.example.com', PLATFORM_API_ORIGIN: 'https://api.example.com',
    PLATFORM_ADMIN_ORIGIN: 'https://admin.example.com',
    PLATFORM_PREVIEW_ORIGIN: 'https://preview.example-assets.net',
    PLATFORM_METRICS_TOKEN: 'm'.repeat(48), PLATFORM_REGISTRY_ORIGIN: 'https://registry.example.com',
    PLATFORM_REGISTRY_TOKEN: 'private-publishing-token', PLATFORM_EDGE_NETWORK: 'managed-edge',
    POSTGRES_PASSWORD_FILE: '/private/postgres', REGISTRY_USERS_FILE: '/private/registry',
    MINIO_USER_FILE: '/private/minio-user', MINIO_PASSWORD_FILE: '/private/minio-password',
  };
}

it('requires exact HTTPS admin origins in production', () => {
  for (const origin of ['http://127.0.0.1:5177', 'https://admin.example.com/', 'https://admin.example.com/path', 'https://*.example.com', 'https://user:password@admin.example.com']) {
    expect(validateDeployment(template, { ...environment(), PLATFORM_ADMIN_ORIGIN: origin })).toContain('Invalid PLATFORM_ADMIN_ORIGIN HTTPS origin');
  }
  const invalid = structuredClone(template);
  delete invalid.services.api.environment.PLATFORM_ADMIN_ORIGIN;
  expect(validateDeployment(invalid)).toContain('api: internal admin origin configuration required');
});

it('rejects identity configuration that the actual OIDC verifier cannot use', () => {
  expect(validateDeployment(template, environment())).toEqual([]);
  for (const change of [
    { PLATFORM_OIDC_WEB_CLIENT_IDS: 'gallery,gallery' },
    { PLATFORM_OIDC_CLI_CLIENT_IDS: 'gallery' },
    { PLATFORM_OIDC_WEB_CLIENT_IDS: ' , ' },
    { PLATFORM_OIDC_CLI_CLIENT_IDS: 'bad client' },
    { PLATFORM_OIDC_AUDIENCE: 'bad audience' },
    { PLATFORM_OIDC_ISSUER: ' https://identity.example.com/realm' },
    { PLATFORM_OIDC_JWKS_URI: 'https://identity.example.com\\keys' },
  ]) expect(validateDeployment(template, { ...environment(), ...change }).length).toBeGreaterThan(0);
});

it('rejects disguised endpoints and the same preview database role with a different password', () => {
  for (const change of [
    { PLATFORM_S3_ENDPOINT: ' https://objects.example.com' },
    { PLATFORM_REGISTRY_ORIGIN: 'https://registry.example.com\\private' },
    { PREVIEW_DATABASE_URL: 'postgresql://api:different-password@postgres/zhinexus' },
    { PLATFORM_DATABASE_URL: 'not-a-database-url' },
    { PLATFORM_S3_BUCKET: '   ' },
  ]) expect(validateDeployment(template, { ...environment(), ...change }).length).toBeGreaterThan(0);
});

it('rejects database URLs that override the role through a query parameter', () => {
  const result = validateDeployment(template, {
    ...environment(),
    PREVIEW_DATABASE_URL: 'postgresql://preview:different-password@postgres/zhinexus?user=api',
  });
  expect(result.length).toBeGreaterThan(0);
});

it('reports missing resources and valid preparation without ever asserting production acceptance', async () => {
  const { productionPreflight } = await import('../../scripts/production-preflight.js');
  const missing = productionPreflight(template);
  expect(missing.exitCode).toBe(2);
  expect(missing.environment.status).toBe('unconfigured');
  expect(missing.productionAcceptance).toBe(false);
  expect(missing.pendingAcceptance).toContain('company-oidc-login-revocation');
  const prepared = productionPreflight(template, environment());
  expect(prepared.exitCode).toBe(0);
  expect(prepared.environment.status).toBe('passed');
  expect(prepared.productionAcceptance).toBe(false);
  expect(prepared.pendingAcceptance).toContain('production-dns-tls-browser-isolation');
});

it('keeps missing fields, malformed templates and invalid configuration out of success without leaking values', async () => {
  const { productionPreflight } = await import('../../scripts/production-preflight.js');
  expect(productionPreflight(template, {}).exitCode).toBe(2);
  const secret = 'sensitive-value-that-must-not-leak';
  const broken = productionPreflight(template, { ...environment(), PLATFORM_OIDC_ISSUER: secret });
  expect(broken.exitCode).toBe(1);
  expect(JSON.stringify(broken)).not.toContain(secret);
  for (const bad of [null, {}, { services: { api: null } }]) {
    const report = productionPreflight(bad, environment());
    expect(report.exitCode).toBe(1);
    expect(report.template.status).toBe('failed');
  }
});

it('selects the opt-in same-IP HTTPS preview port in both services and preflight', async () => {
  for (const service of ['api', 'worker', 'preview-gateway']) {
    expect(template.services[service].environment.PLATFORM_PREVIEW_MODE).toBe('${PLATFORM_PREVIEW_MODE:-domain}');
  }
  const env = {
    ...environment(), PLATFORM_PREVIEW_MODE: 'ip-port',
    PLATFORM_GALLERY_ORIGIN: 'https://192.0.2.13', PLATFORM_API_ORIGIN: 'https://192.0.2.13:8444',
    PLATFORM_PREVIEW_ORIGIN: 'https://192.0.2.13:8443',
  };
  expect(validateDeployment(template, env)).toEqual([]);
  const { productionPreflight } = await import('../../scripts/production-preflight.js');
  const result = productionPreflight(template, env);
  expect(result).toMatchObject({ previewMode: 'ip-port', productionAcceptance: false, exitCode: 0 });
  expect(result.pendingAcceptance).toContain('production-dns-tls-browser-isolation');
  const defaultMode = productionPreflight(template, { ...environment(), PLATFORM_PREVIEW_MODE: '' });
  expect(defaultMode).toMatchObject({ previewMode: 'domain', productionAcceptance: false, exitCode: 0 });
  for (const change of [
    { PLATFORM_PREVIEW_MODE: '' },
    { PLATFORM_PREVIEW_MODE: 'domain' },
    { PLATFORM_PREVIEW_MODE: 'unsupported' },
    { PLATFORM_PREVIEW_ORIGIN: 'https://192.0.2.13:8444' },
    { PLATFORM_PREVIEW_ORIGIN: 'https://192.0.2.13' },
    { PLATFORM_PREVIEW_ORIGIN: 'https://192.0.2.14:8443' },
    { PLATFORM_PREVIEW_ORIGIN: 'https://preview.example.net:8443' },
    { PLATFORM_PREVIEW_ORIGIN: 'http://192.0.2.13:8443' },
  ]) expect(validateDeployment(template, { ...env, ...change })).toContain('Invalid preview origin or mode configuration');
  expect(validateDeployment(template, { ...environment(), PLATFORM_PREVIEW_MODE: 'unsupported' }))
    .toContain('Invalid preview origin or mode configuration');
});
