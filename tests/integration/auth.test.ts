import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CompactSign, createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { JSONWebKeySet, JWTVerifyGetKey } from 'jose';
import { AuthFailure, OidcVerifier } from '../../apps/api/dist/auth/oidc.js';
import type { OidcConfig, Principal } from '../../apps/api/dist/auth/oidc.js';
import { requireRole } from '../../apps/api/dist/auth/roles.js';

const config: OidcConfig = {
  issuer: 'https://identity.company.example/oidc',
  audience: 'component-platform-api',
  jwksUri: 'https://identity.company.example/oidc/jwks',
  webClientIds: ['gallery-web'],
  cliClientIds: ['component-cli'],
};
let rsa: Awaited<ReturnType<typeof generateKeyPair>>;
let ec: Awaited<ReturnType<typeof generateKeyPair>>;
let rogue: Awaited<ReturnType<typeof generateKeyPair>>;
let rsa512: Awaited<ReturnType<typeof generateKeyPair>>;
let resolver: JWTVerifyGetKey;
let jwks: JSONWebKeySet;

beforeAll(async () => {
  [rsa, ec, rogue, rsa512] = await Promise.all([
    generateKeyPair('RS256'), generateKeyPair('ES256'), generateKeyPair('RS256'), generateKeyPair('RS512'),
  ]);
  jwks = { keys: [
    { ...await exportJWK(rsa.publicKey), kid: 'rsa', alg: 'RS256' },
    { ...await exportJWK(ec.publicKey), kid: 'ec', alg: 'ES256' },
  ] };
  resolver = createLocalJWKSet(jwks);
});
afterEach(() => vi.restoreAllMocks());

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return { iss: config.issuer, aud: config.audience, sub: 'operator-123', iat: now - 10,
    exp: now + 300, azp: 'gallery-web', roles: ['reader'], ...overrides };
}
async function sign(overrides: Record<string, unknown> = {}, algorithm = 'RS256', wrongKey = false): Promise<string> {
  const key = algorithm === 'HS256' ? new Uint8Array(32).fill(7)
    : algorithm === 'ES256' ? ec.privateKey : algorithm === 'RS512' ? rsa512.privateKey
      : wrongKey ? rogue.privateKey : rsa.privateKey;
  return new SignJWT(claims(overrides)).setProtectedHeader({ alg: algorithm,
    kid: algorithm === 'ES256' ? 'ec' : 'rsa', typ: 'at+jwt' }).sign(key);
}
function verifier(): OidcVerifier {
  return new OidcVerifier(config, resolver);
}
async function denied(operation: Promise<unknown>, token?: string): Promise<void> {
  try {
    await operation;
    throw new Error('Protected access unexpectedly succeeded');
  } catch (error) {
    expect(error).toBeInstanceOf(AuthFailure);
    expect(error).toMatchObject({ code: 'UNAUTHENTICATED' });
    if (token) expect(String(error)).not.toContain(token);
    expect(String(error)).not.toContain(config.issuer);
  }
}

describe('OIDC signature and claims verification', () => {
  it('rejects business access when OIDC is unconfigured even with a valid signed token', async () => {
    const token = await sign();
    await denied(new OidcVerifier(undefined, resolver).verify(`Bearer ${token}`), token);
  });

  it.each([undefined, '', 'Basic secret', 'Bearer', 'Bearer ', 'Bearer not-a-jwt', 'Bearer a.b.c extra'])
    ('rejects absent or malformed authorization %s', async authorization => {
      await denied(verifier().verify(authorization));
    });

  it.each(['RS256', 'ES256'])('accepts a %s access token and takes identity from verified claims', async algorithm => {
    const token = await sign({ sub: 'signed-subject', roles: ['publisher', 'reader'] }, algorithm);
    expect(await verifier().verify(`Bearer ${token}`)).toEqual({
      subject: 'signed-subject', clientId: 'gallery-web', channel: 'web', roles: ['publisher', 'reader'],
    });
  });

  it('accepts case insensitive bearer scheme', async () => {
    expect((await verifier().verify(`bearer ${await sign()}`)).subject).toBe('operator-123');
  });

  it.each(['HS256', 'RS512'])('rejects a valid signature using forbidden %s algorithm', async algorithm => {
    const token = await sign({}, algorithm);
    await denied(verifier().verify(`Bearer ${token}`), token);
  });

  it('rejects an unsigned JWT', async () => {
    const token = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims())).toString('base64url')}.`;
    await denied(verifier().verify(`Bearer ${token}`), token);
  });

  it('rejects a forged signature with a trusted key identifier', async () => {
    const token = await sign({}, 'RS256', true);
    await denied(verifier().verify(`Bearer ${token}`), token);
  });

  it('rejects a payload changed after signing including a forged subject', async () => {
    const token = await sign();
    const parts = token.split('.');
    parts[1] = Buffer.from(JSON.stringify(claims({ sub: 'forged-maintainer', roles: ['maintainer'] }))).toString('base64url');
    await denied(verifier().verify(`Bearer ${parts.join('.')}`), parts.join('.'));
  });

  it.each([
    ['wrong issuer', { iss: 'https://attacker.example/oidc' }],
    ['issuer prefix match', { iss: `${config.issuer}/other` }],
    ['issuer trailing slash difference', { iss: `${config.issuer}/` }],
    ['missing issuer', { iss: undefined }],
    ['wrong audience', { aud: 'other-api' }],
    ['ID token audience', { aud: 'gallery-web' }],
    ['missing audience', { aud: undefined }],
    ['mixed type audience', { aud: [config.audience, 123] }],
    ['missing expiry', { exp: undefined }],
    ['non numeric expiry', { exp: 'tomorrow' }],
    ['expired token', { exp: 1 }],
    ['not before in future', { nbf: 4_102_444_800 }],
    ['non numeric not before', { nbf: 'tomorrow' }],
    ['missing issued time', { iat: undefined }],
    ['future issued time', { iat: 4_102_444_800 }],
    ['non numeric issued time', { iat: 'yesterday' }],
    ['missing subject', { sub: undefined }],
    ['empty subject', { sub: '' }],
    ['whitespace subject', { sub: '   ' }],
    ['non string subject', { sub: 123 }],
  ])('rejects %s', async (_name, overrides) => {
    const token = await sign(overrides);
    await denied(verifier().verify(`Bearer ${token}`), token);
  });

  it.each([['exp', '1e400'], ['nbf', '-1e400'], ['iat', '-1e400']])
    ('rejects a signed JSON numeric overflow in %s', async (claim, numericLiteral) => {
      const bytes = Buffer.from(JSON.stringify(claims({ [claim]: 'numeric-overflow' }))
        .replace('"numeric-overflow"', numericLiteral));
      const token = await new CompactSign(bytes).setProtectedHeader({ alg: 'RS256', kid: 'rsa' }).sign(rsa.privateKey);
      await denied(verifier().verify(`Bearer ${token}`), token);
    });

  it('accepts an audience list containing the dedicated API audience', async () => {
    expect((await verifier().verify(`Bearer ${await sign({ aud: [config.audience, 'other-api'] })}`)).channel).toBe('web');
  });
});

describe('verified client and role claims', () => {
  it.each([
    ['azp web', { azp: 'gallery-web' }, 'gallery-web', 'web'],
    ['client_id CLI', { azp: undefined, client_id: 'component-cli' }, 'component-cli', 'cli'],
    ['matching client claims', { azp: 'component-cli', client_id: 'component-cli' }, 'component-cli', 'cli'],
  ])('maps %s through configured clients', async (_name, overrides, clientId, channel) => {
    expect(await verifier().verify(`Bearer ${await sign(overrides)}`)).toMatchObject({ clientId, channel });
  });

  it.each([
    ['missing client', { azp: undefined }],
    ['unknown client', { azp: 'untrusted-client' }],
    ['mismatched clients', { azp: 'gallery-web', client_id: 'component-cli' }],
    ['unknown secondary client', { azp: 'gallery-web', client_id: 'untrusted-client' }],
    ['empty azp', { azp: '', client_id: 'gallery-web' }],
    ['non string azp', { azp: 1, client_id: 'gallery-web' }],
    ['non string client_id', { azp: 'gallery-web', client_id: 1 }],
    ['null azp', { azp: null, client_id: 'gallery-web' }],
    ['roles string', { roles: 'maintainer' }],
    ['roles object', { roles: { maintainer: true } }],
    ['non string role', { roles: ['reader', 1] }],
    ['unknown role', { roles: ['administrator'] }],
    ['null roles', { roles: null }],
  ])('rejects %s', async (_name, overrides) => {
    await denied(verifier().verify(`Bearer ${await sign(overrides)}`));
  });

  it('does not use a token channel claim to override trusted web identity', async () => {
    expect((await verifier().verify(`Bearer ${await sign({ channel: 'cli' })}`)).channel).toBe('web');
  });

  it.each([{ name: 'missing roles', roles: undefined }, { name: 'empty roles', roles: [] }])
    ('grants no default roles for $name even if scope requests maintenance', async ({ roles }) => {
    const principal = await verifier().verify(`Bearer ${await sign({ roles, scope: 'reader publisher maintainer' })}`);
    expect(principal.roles).toEqual([]);
    expect(() => requireRole(principal, 'read')).toThrow(AuthFailure);
  });

  it('copies configuration so external mutation cannot authorize an untrusted client', async () => {
    const mutable = { ...config, webClientIds: [...config.webClientIds], cliClientIds: [...config.cliClientIds] };
    const auth = new OidcVerifier(mutable, resolver);
    mutable.webClientIds.push('attacker-client');
    await denied(auth.verify(`Bearer ${await sign({ azp: 'attacker-client' })}`));
  });
});

describe('trusted runtime OIDC configuration', () => {
  it.each([
    ['HTTP issuer', { issuer: 'http://identity.company.example/oidc' }],
    ['HTTP JWKS', { jwksUri: 'http://identity.company.example/jwks' }],
    ['invalid issuer', { issuer: 'not a URL' }],
    ['issuer credentials', { issuer: 'https://secret:credential@identity.company.example/oidc' }],
    ['JWKS credentials', { jwksUri: 'https://secret:credential@identity.company.example/jwks' }],
    ['issuer query', { issuer: `${config.issuer}?secret=value` }],
    ['JWKS query', { jwksUri: `${config.jwksUri}?secret=value` }],
    ['issuer fragment', { issuer: `${config.issuer}#secret` }],
    ['JWKS fragment', { jwksUri: `${config.jwksUri}#secret` }],
    ['empty query', { jwksUri: `${config.jwksUri}?` }],
    ['leading whitespace', { issuer: ` ${config.issuer}` }],
    ['empty audience', { audience: '' }],
    ['empty web clients', { webClientIds: [] }],
    ['empty CLI clients', { cliClientIds: [] }],
    ['ambiguous client channel', { cliClientIds: ['gallery-web'] }],
    ['empty client ID', { webClientIds: [''] }],
    ['duplicate client IDs', { webClientIds: ['gallery-web', 'gallery-web'] }],
  ])('fails closed for %s without disclosing configuration', (_name, overrides) => {
    let failure: unknown;
    try { new OidcVerifier({ ...config, ...overrides }, resolver); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AuthFailure);
    expect(String(failure)).not.toMatch(/secret|credential|identity\.company\.example/);
  });

  it('uses remote JWKS for runtime verification and reuses its bounded cache', async () => {
    let requests = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      requests += 1;
      if (String(input) !== config.jwksUri) throw new Error('Unexpected JWKS destination');
      return new Response(JSON.stringify(jwks), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const auth = new OidcVerifier(config);
    const authorization = `Bearer ${await sign()}`;
    expect((await auth.verify(authorization)).subject).toBe('operator-123');
    expect((await auth.verify(authorization)).subject).toBe('operator-123');
    expect(requests).toBe(1);
  });

  it('reloads expired JWKS cache and rejects a removed signing key', async () => {
    let requests = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      requests += 1;
      return new Response(JSON.stringify(requests === 1 ? jwks : { keys: [] }), { status: 200 });
    });
    const auth = new OidcVerifier(config);
    const authorization = `Bearer ${await sign()}`;
    expect((await auth.verify(authorization)).subject).toBe('operator-123');
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 301_000);
    await denied(auth.verify(authorization));
    expect(requests).toBe(2);
  });

  it('fails closed on JWKS redirects without following another destination', async () => {
    let requests = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, options) => {
      requests += 1;
      if (options?.redirect !== 'manual') throw new Error('Redirects may expose the trust boundary');
      return new Response(null, { status: 302, headers: { location: 'https://attacker.example/jwks' } });
    });
    await denied(new OidcVerifier(config).verify(`Bearer ${await sign()}`));
    expect(requests).toBe(1);
  });

  it.each(['unavailable', 'invalid JSON', 'invalid keys'])('rejects %s remote JWKS without leaking details', async mode => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      if (mode === 'unavailable') throw new Error('private upstream details');
      return new Response(mode === 'invalid JSON' ? '<private upstream details>' : JSON.stringify({ keys: [] }), { status: 200 });
    });
    const token = await sign();
    await denied(new OidcVerifier(config).verify(`Bearer ${token}`), token);
  });
});

describe('action role authorization', () => {
  const actions = ['read', 'upload', 'baseline', 'deprecate'] as const;
  const cases: [Principal['roles'], readonly boolean[]][] = [
    [[], [false, false, false, false]],
    [['reader'], [true, false, false, false]],
    [['publisher'], [true, true, false, false]],
    [['maintainer'], [true, true, true, true]],
    [['reader', 'publisher'], [true, true, false, false]],
  ];
  for (const [roles, permissions] of cases) {
    actions.forEach((action, index) => {
      it(`${roles.join('+') || 'no role'} ${permissions[index] ? 'allows' : 'forbids'} ${action}`, () => {
        const principal: Principal = { subject: 'operator-123', clientId: 'component-cli', channel: 'cli', roles };
        if (permissions[index]) expect(() => requireRole(principal, action)).not.toThrow();
        else expect(() => requireRole(principal, action)).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
      });
    });
  }
});
