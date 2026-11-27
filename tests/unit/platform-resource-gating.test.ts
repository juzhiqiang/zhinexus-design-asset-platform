import { expect, it } from 'vitest';
import { Platform } from '../../apps/api/dist/platform.js';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';

async function platformWithDatabase() {
  const statements: string[] = [];
  const database = {
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.includes('SELECT generation FROM access_active')) return { rows: [{ generation: '0' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    close: async () => {},
  };
  const keys = await generateKeyPair('ES256');
  const issuer = 'https://catalog.test';
  const platform = new Platform({ oidc: { issuer, audience: 'api', jwksUri: issuer + '/jwks', webClientIds: ['web'], cliClientIds: ['cli'] }, keyResolver: createLocalJWKSet({ keys: [{ ...await exportJWK(keys.publicKey), alg: 'ES256' }] }) });
  const token = await new SignJWT({ roles: ['reader', 'publisher'], azp: 'web' }).setProtectedHeader({ alg: 'ES256' }).setIssuer(issuer).setAudience('api').setSubject('catalog-test').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
  Object.defineProperty(platform, 'db', { value: database });
  return { platform, database, statements, token };
}

it('allows authenticated catalog reads with PostgreSQL even when upload storage is not configured', async () => {
  const { platform, database, statements, token } = await platformWithDatabase();

  try {
    const result = await platform.run(`Bearer ${token}`, 'read', 'catalog-request', async (_context, _uploads, db) => {
      expect(db).toBe(database);
      return 'catalog-readable';
    });

    expect(result).toBe('catalog-readable');
    expect(statements.some((sql) => sql.includes('access_active'))).toBe(true);
  } finally {
    await platform.onApplicationShutdown();
  }
});

it('keeps upload actions unavailable when their storage service is not configured', async () => {
  const { platform, token } = await platformWithDatabase();

  try {
    await expect(platform.run(`Bearer ${token}`, 'upload', 'upload-request', async () => 'unreachable'))
      .rejects.toMatchObject({ code: 'INFRA_UNAVAILABLE', status: 503 });
  } finally {
    await platform.onApplicationShutdown();
  }
});
