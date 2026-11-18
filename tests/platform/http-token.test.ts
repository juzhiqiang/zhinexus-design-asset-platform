import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeJwt, jwtVerify } from 'jose';
import { platformHarness } from './http-support.js';

describe('acceptance token lifetime', () => {
  let h: Awaited<ReturnType<typeof platformHarness>> | undefined;
  beforeAll(async () => { h = await platformHarness(); });
  afterAll(async () => { await h?.close(); });

  it('keeps the existing five-minute default', async () => {
    const claims = decodeJwt(await h!.token('t16-acceptance', ['publisher'], 'cli'));
    expect(claims.exp! - claims.iat!).toBe(300);
  });

  it('allows a fresh CLI token to cover the fifteen-minute process budget', async () => {
    const token = await h!.token('t16-acceptance', ['publisher'], 'cli', '20m');
    const claims = decodeJwt(token);
    expect(claims.exp! - claims.iat!).toBe(1_200);
    expect(claims.exp! - Math.floor(Date.now() / 1_000)).toBeGreaterThan(900);
    const verified = await jwtVerify(token, h!.options.keyResolver, {
      issuer: h!.options.oidc.issuer, audience: h!.options.oidc.audience,
    });
    expect(verified.payload.sub).toBe('t16-acceptance');
    expect(verified.payload.azp).toBe('cli');
  });
});
