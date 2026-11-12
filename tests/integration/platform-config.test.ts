import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { expect, it } from 'vitest';
import { validateApiMessage } from '@company/contracts';
import { buildServer } from '../../apps/api/dist/app.js';

it('fails closed on every business route without OIDC while health remains liveness only', async () => {
  const app = await buildServer({});
  try {
    await app.listen(0, '127.0.0.1'); const origin = await app.getUrl();
    const routes = ['uploads', 'uploads/invalid/complete', 'releases', 'releases/invalid/retry', 'baselines', 'variant-releases/invalid/deprecate'];
    for (const route of routes) {
      const response = await fetch(`${origin}/v1/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(response.status).toBe(401);
      const error = await response.json(); expect(validateApiMessage('error', error).ok).toBe(true);
      expect(error.requestId).toBe(response.headers.get('x-request-id'));
    }
    expect((await fetch(`${origin}/v1/releases/invalid`)).status).toBe(401);
    expect((await fetch(`${origin}/healthz`)).status).toBe(200);
  } finally { await app.close(); }
});

it('reports missing storage and invalid/oversized JSON using sanitized contract errors', async () => {
  const key = await generateKeyPair('RS256');
  const oidc = { issuer: 'https://id.config.test', audience: 'api', jwksUri: 'https://id.config.test/jwks', webClientIds: ['web'], cliClientIds: ['cli'] };
  const token = await new SignJWT({ roles: ['publisher'], azp: 'web' }).setProtectedHeader({ alg: 'RS256' }).setSubject('alice')
    .setIssuer(oidc.issuer).setAudience('api').setIssuedAt().setExpirationTime('5m').sign(key.privateKey);
  const app = await buildServer({ oidc, keyResolver: createLocalJWKSet({ keys: [await exportJWK(key.publicKey)] }) });
  try {
    await app.listen(0, '127.0.0.1'); const origin = await app.getUrl();
    for (const [body, status, code] of [
      ['{}', 503, 'INFRA_UNAVAILABLE'], ['{', 400, 'INVALID_SCHEMA'], [JSON.stringify({ data: 'x'.repeat(9 * 1024 ** 2) }), 413, 'LIMIT_EXCEEDED'],
    ] as const) {
      const response = await fetch(`${origin}/v1/uploads`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body });
      expect(response.status).toBe(status); const error = await response.json();
      expect(error).toMatchObject({ code }); expect(validateApiMessage('error', error).ok).toBe(true);
      expect(JSON.stringify(error)).not.toContain(token);
      expect(error).not.toHaveProperty('stack');
    }
  } finally { await app.close(); }
});
