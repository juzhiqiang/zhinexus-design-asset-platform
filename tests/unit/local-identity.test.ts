import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { LocalIdentityService } from '../../apps/api/src/identity/local/service.js';
import { LocalIdentityStore } from '../../apps/api/src/identity/local/store.js';
import { LocalSigningKeys } from '../../apps/api/src/identity/local/keys.js';
import { LocalIdentityAdapter } from '../../apps/api/src/identity/local/adapter.js';
import { hashPassword, verifyPassword } from '../../apps/api/src/identity/local/password.js';
import { issueAccessToken } from '../../apps/api/src/identity/local/tokens.js';
import type { Queryable } from '../../apps/api/src/identity/local/keys.js';
import { Platform, environmentOptions } from '../../apps/api/src/platform.js';

/**
 * Local identity service behaviour. The database is an in-memory fake that honours the
 * constraints the real SQL relies on — the single-active signing key, single-use authorization
 * codes and the PKCE challenge comparison — so these tests never need PostgreSQL.
 *
 * Execution status: the same scenarios were executed in a sandbox against the real `jose` 6.2.17
 * before this file was written, but THIS FILE has not been run under vitest, because the
 * authoring environment has neither vitest nor a built @company/contracts. Run it on the host
 * before treating it as passing.
 */
const ISSUER = 'https://api.example.com/identity';
const AUDIENCE = 'https://api.example.com';
const options = {
  issuer: ISSUER, audience: AUDIENCE, webClientId: 'zhinexus-web', cliClientId: 'zhinexus-cli',
  webRedirectUris: ['https://gallery.example.com/auth/callback'], cliRedirectUris: ['http://127.0.0.1:18923/callback'],
};

type Account = { id: string; subject: string; platform_subject: string; username: string; roles: string[]; enabled: boolean; version: string; auth_time_floor: number };

/** Captures a rejection and returns it, so error codes can be asserted without leaking throws. */
async function capture(operation: () => Promise<unknown>): Promise<unknown> {
  try { await operation(); return undefined; } catch (error) { return error; }
}
const codeOf = (error: unknown): string | undefined => (error instanceof Error && 'code' in error ? String((error as { code?: unknown }).code) : undefined);

function fakeDatabase() {
  const accounts = new Map<string, Account>();
  const credentials = new Map<string, { passwordHash: string; mustChange: boolean }>();
  const codes = new Map<string, { account_id: string; client_id: string; redirect_uri: string; code_challenge: string; account_version: string; auth_time: number; nonce: string; consumed: boolean; expires: number }>();
  const signingKeys: { kid: string; public_jwk: unknown; private_pem: string; state: string }[] = [];
  const sessions = new Set<string>();
  const grants = new Set<string>();
  /**
   * The statements the modules under test issue, answered from memory. Returns plain records so
   * the wrapper below can present them through the generic `Queryable` signature — a
   * non-generic `query` is not assignable to it, and typing the fake as `Queryable['query']`
   * with a cast would hide exactly the shape drift these tests exist to catch.
   */
  const raw = async (sql: string, values: unknown[] = []): Promise<Record<string, unknown>[]> => {
    const v = values as string[];
    if (/INSERT INTO local_credentials/.test(sql)) { credentials.set(v[0]!, { passwordHash: v[1]!, mustChange: values[2] === true || values[2] === 'true' }); return []; }
    if (/UPDATE local_credentials SET must_change=false/.test(sql)) { const c = credentials.get(v[0]!); if (c) c.mustChange = false; return []; }
    if (/SELECT account_id,password_hash,must_change/.test(sql)) { const c = credentials.get(v[0]!); return c ? [{ account_id: v[0]!, password_hash: c.passwordHash, must_change: c.mustChange }] : []; }
    if (/SELECT id,subject,platform_subject,username,display_name,roles,enabled,version,auth_time_floor/.test(sql)) {
      const account = [...accounts.values()].find(a => a.username === v[1]);
      return account ? [{ id: account.id, subject: account.subject, platform_subject: account.platform_subject, username: account.username, display_name: 'x', roles: account.roles, enabled: account.enabled, version: account.version, auth_time_floor: account.auth_time_floor }] : [];
    }
    if (/INSERT INTO local_authorization_codes/.test(sql)) {
      codes.set(v[0]!, { account_id: v[1]!, client_id: v[2]!, redirect_uri: v[3]!, code_challenge: v[4]!, account_version: v[5]!, auth_time: Number(v[6]), nonce: String(v[7] ?? ''), consumed: false, expires: Date.now() + 60_000 });
      return [];
    }
    if (/UPDATE local_authorization_codes SET consumed_at/.test(sql)) {
      const row = codes.get(v[0]!);
      if (!row || row.consumed || row.expires < Date.now() || row.client_id !== v[1] || row.redirect_uri !== v[2] || row.code_challenge !== v[3]) return [];
      row.consumed = true;
      return [{ account_id: row.account_id, account_version: row.account_version, auth_time: row.auth_time, nonce: row.nonce }];
    }
    if (/SELECT subject,platform_subject,roles,enabled FROM managed_accounts WHERE id=\$1/.test(sql)) {
      const account = accounts.get(v[0]!);
      return account ? [{ subject: account.subject, platform_subject: account.platform_subject, roles: account.roles, enabled: account.enabled }] : [];
    }
    if (/SELECT username FROM managed_accounts WHERE id=\$1/.test(sql)) { const a = accounts.get(v[0]!); return a ? [{ username: a.username }] : []; }
    if (/DELETE FROM oidc_sessions/.test(sql)) { sessions.delete(v[0]!); return []; }
    if (/DELETE FROM preview_grants/.test(sql)) { grants.delete(v[0]!); return []; }
    if (/INSERT INTO local_signing_keys/.test(sql)) {
      if (signingKeys.some(k => k.state === 'active') && v[3] === 'active') { const error = new Error('duplicate'); (error as { code?: string }).code = '23505'; throw error; }
      signingKeys.push({ kid: v[0]!, public_jwk: JSON.parse(v[1]!), private_pem: v[2]!, state: v[3]! });
      return [];
    }
    if (/UPDATE local_signing_keys SET state='retired'/.test(sql)) { const k = signingKeys.find(x => x.kid === v[0]); if (k) k.state = 'retired'; return []; }
    if (/local_signing_keys ORDER BY created_at DESC/.test(sql)) return [...signingKeys].reverse().slice(0, 8);
    if (/local_signing_keys WHERE kid=\$1/.test(sql)) return signingKeys.filter(k => k.kid === v[0]);
    if (/local_signing_keys WHERE state='active'/.test(sql)) return signingKeys.filter(k => k.state === 'active').slice(0, 1);
    throw new Error('unhandled SQL: ' + sql.slice(0, 80));
  };
  const db: Queryable = {
    query: async <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, values: unknown[] = []) => ({ rows: (await raw(sql, values)) as T[] }),
  };
  return { db, accounts, credentials, codes, signingKeys, sessions, grants };
}

const challengeOf = (verifier: string) => createHash('sha256').update(verifier, 'utf8').digest('base64url');

describe('password hashing', () => {
  it('verifies a correct password and rejects near misses', async () => {
    const encoded = await hashPassword('correct-horse-battery');
    expect(await verifyPassword('correct-horse-battery', encoded)).toBe(true);
    expect(await verifyPassword('correct-horse-batterX', encoded)).toBe(false);
    expect(await verifyPassword('CORRECT-HORSE-BATTERY', encoded)).toBe(false);
    expect(await verifyPassword('', encoded)).toBe(false);
    expect(await verifyPassword(null, encoded)).toBe(false);
  });

  it('salts each hash so equal passwords differ', async () => {
    const a = await hashPassword('another-password-here');
    const b = await hashPassword('another-password-here');
    expect(a).not.toBe(b);
    expect(await verifyPassword('another-password-here', b)).toBe(true);
  });

  it('rejects malformed and foreign records without throwing', async () => {
    const encoded = await hashPassword('correct-horse-battery');
    const malformed = ['bcrypt$1$2$3$4$aa$bb', 'scrypt$65536$8$1$64$SHORT$aa', 'scrypt$99999999$8$1$64$' + Buffer.alloc(16).toString('base64url') + '$aa', null, 42];
    for (const record of malformed) expect(await verifyPassword('correct-horse-battery', record)).toBe(false);
    expect(encoded.startsWith('scrypt$')).toBe(true);
  });

  it('enforces length policy using unicode length', async () => {
    expect(await capture(() => hashPassword('short'))).toBeInstanceOf(Error);
    expect(await capture(() => hashPassword('😀'.repeat(6) + 'a'))).toBeInstanceOf(Error);
    expect(await hashPassword('😀'.repeat(12))).toContain('scrypt$');
  });
});

describe('signing keys and token issuance', () => {
  it('publishes a JWKS that carries no private material', async () => {
    const { db } = fakeDatabase();
    const keys = new LocalSigningKeys(db);
    const active = await keys.active();
    const jwks = await keys.publicJwks();
    expect(jwks.keys).toHaveLength(1);
    const jwk = jwks.keys[0] as Record<string, unknown>;
    expect(jwk['kid']).toBe(active.kid);
    expect(jwk['kty']).toBe('EC');
    expect(jwk['alg']).toBe('ES256');
    expect('d' in jwk).toBe(false);
    expect('k' in jwk).toBe(false);
  });

  it('keeps a retired key published so outstanding tokens stay verifiable', async () => {
    const { db } = fakeDatabase();
    const keys = new LocalSigningKeys(db);
    const first = await keys.active();
    const rotated = await keys.rotate();
    expect(rotated.kid).not.toBe(first.kid);
    const jwks = await keys.publicJwks();
    expect(jwks.keys).toHaveLength(2);
    expect(jwks.keys.some(key => (key as { kid?: string }).kid === first.kid)).toBe(true);
  });

  it('issues a token that satisfies the platform verifier', async () => {
    const { db } = fakeDatabase();
    const keys = new LocalSigningKeys(db);
    const { kid, key } = await keys.active();
    const now = Math.floor(Date.now() / 1000);
    const token = await issueAccessToken(key, kid, { subject: 'managed:lin.wei', managedUserId: 'acct-1', roles: ['reader'], accountVersion: '7', authTime: now }, { issuer: ISSUER, audience: AUDIENCE, clientId: 'zhinexus-web' }, now);
    const verified = await jwtVerify(token, createLocalJWKSet(await keys.publicJwks()), { algorithms: ['RS256', 'ES256'], issuer: ISSUER, audience: AUDIENCE, requiredClaims: ['exp', 'sub', 'iat'], clockTolerance: 0 });
    expect(verified.protectedHeader.alg).toBe('ES256');
    expect(verified.protectedHeader.kid).toBe(kid);
    expect(verified.payload.sub).toBe('managed:lin.wei');
    expect(verified.payload.roles).toEqual(['reader']);
    expect(verified.payload.platform_account_version).toBe('7');
    expect(verified.payload.platform_managed_user_id).toBe('acct-1');
    expect(verified.payload.auth_time).toBe(now);
    expect(verified.payload.exp).toBe(now + 300);
  });

  it('refuses subjects that would produce an invalid token', async () => {
    const { db } = fakeDatabase();
    const keys = new LocalSigningKeys(db);
    const { kid, key } = await keys.active();
    const now = Math.floor(Date.now() / 1000);
    const base = { subject: 's', managedUserId: 'm', roles: ['reader' as const], accountVersion: '1', authTime: now };
    const config = { issuer: 'i', audience: 'a', clientId: 'c' };
    expect(await capture(() => issueAccessToken(key, kid, { ...base, authTime: now + 60 }, config, now))).toBeInstanceOf(Error);
    expect(await capture(() => issueAccessToken(key, kid, { ...base, accountVersion: '1.5' }, config, now))).toBeInstanceOf(Error);
    expect(await capture(() => issueAccessToken(key, kid, { ...base, roles: ['root' as never] }, config, now))).toBeInstanceOf(Error);
  });
});

describe('local identity authorization flow', () => {
  const verifier = 'a'.repeat(43);
  /** Shape `CompanyOidc.start` generates: 32 random bytes, base64url. */
  const nonce = 'n'.repeat(43);
  const base = { clientId: 'zhinexus-web', redirectUri: 'https://gallery.example.com/auth/callback', state: 'state-token-value', codeChallenge: challengeOf(verifier), nonce };

  async function seeded() {
    const state = fakeDatabase();
    state.accounts.set('acct-1', { id: 'acct-1', subject: 'identity-lin.wei', platform_subject: 'managed:lin.wei', username: 'lin.wei', roles: ['reader'], enabled: true, version: '3', auth_time_floor: 0 });
    state.credentials.set('acct-1', { passwordHash: await hashPassword('temporary-pass-123'), mustChange: true });
    const store = new LocalIdentityStore(state.db);
    return { state, service: new LocalIdentityService(store, new LocalSigningKeys(state.db), options), store };
  }

  it('rejects malformed authorization requests before any credential work', async () => {
    const { service } = await seeded();
    expect(codeOf(await capture(() => service.authorize({ ...base, clientId: 'unknown', username: 'lin.wei', password: 'x' })))).toBe('INVALID_SCHEMA');
    expect(codeOf(await capture(() => service.authorize({ ...base, redirectUri: 'https://evil.example.com/cb', username: 'lin.wei', password: 'x' })))).toBe('INVALID_SCHEMA');
    expect(codeOf(await capture(() => service.authorize({ ...base, codeChallenge: 'tooshort', username: 'lin.wei', password: 'x' })))).toBe('INVALID_SCHEMA');
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    const { service } = await seeded();
    expect(codeOf(await capture(() => service.authorize({ ...base, username: 'lin.wei', password: 'wrong-password-xyz' })))).toBe('UNAUTHENTICATED');
    expect(codeOf(await capture(() => service.authorize({ ...base, username: 'no.such.user', password: 'temporary-pass-123' })))).toBe('UNAUTHENTICATED');
  });

  it('requires a replacement password on first login', async () => {
    const { service, state } = await seeded();
    expect(codeOf(await capture(() => service.authorize({ ...base, username: 'lin.wei', password: 'temporary-pass-123' })))).toBe('UNAUTHENTICATED');
    expect(codeOf(await capture(() => service.authorize({ ...base, username: 'lin.wei', password: 'temporary-pass-123', newPassword: 'short' })))).toBe('INVALID_SCHEMA');
    expect(codeOf(await capture(() => service.authorize({ ...base, username: 'lin.wei', password: 'temporary-pass-123', newPassword: 'temporary-pass-123' })))).toBe('INVALID_SCHEMA');
    expect(state.credentials.get('acct-1')!.mustChange).toBe(true);
  });

  it('completes a first login and retires the temporary credential', async () => {
    const { service, state } = await seeded();
    const grant = await service.authorize({ ...base, username: 'lin.wei', password: 'temporary-pass-123', newPassword: 'replacement-pass-456' });
    expect(grant.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(grant.state).toBe(base.state);
    expect(state.credentials.get('acct-1')!.mustChange).toBe(false);
    expect(await verifyPassword('replacement-pass-456', state.credentials.get('acct-1')!.passwordHash)).toBe(true);
    expect(await verifyPassword('temporary-pass-123', state.credentials.get('acct-1')!.passwordHash)).toBe(false);
  });

  it('fails closed on a wrong PKCE verifier and on a replayed code', async () => {
    const { service } = await seeded();
    const grant = await service.authorize({ ...base, username: 'lin.wei', password: 'temporary-pass-123', newPassword: 'replacement-pass-456' });
    expect(codeOf(await capture(() => service.token({ code: grant.code, codeVerifier: 'b'.repeat(43), clientId: 'zhinexus-web', redirectUri: base.redirectUri })))).toBe('UNAUTHENTICATED');
    expect(codeOf(await capture(() => service.token({ code: grant.code, codeVerifier: verifier, clientId: 'zhinexus-cli', redirectUri: base.redirectUri })))).toBe('UNAUTHENTICATED');
    const tokens = await service.token({ code: grant.code, codeVerifier: verifier, clientId: 'zhinexus-web', redirectUri: base.redirectUri });
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.expires_in).toBe(300);
    expect(codeOf(await capture(() => service.token({ code: grant.code, codeVerifier: verifier, clientId: 'zhinexus-web', redirectUri: base.redirectUri })))).toBe('UNAUTHENTICATED');
  });

  it('refuses a disabled account', async () => {
    const { service, state } = await seeded();
    state.accounts.get('acct-1')!.enabled = false;
    expect(codeOf(await capture(() => service.authorize({ ...base, username: 'lin.wei', password: 'temporary-pass-123', newPassword: 'replacement-pass-456' })))).toBe('FORBIDDEN');
  });

  it('signs the access token with the identity subject, which is what the account is looked up by', async () => {
    const { service, state } = await seeded();
    const grant = await service.authorize({ ...base, username: 'lin.wei', password: 'temporary-pass-123', newPassword: 'replacement-pass-456' });
    const tokens = await service.token({ code: grant.code, codeVerifier: verifier, clientId: 'zhinexus-web', redirectUri: base.redirectUri });
    const keys = new LocalSigningKeys(state.db);
    const verified = await jwtVerify(tokens.access_token, createLocalJWKSet(await keys.publicJwks()), { algorithms: ['RS256', 'ES256'], issuer: ISSUER, audience: AUDIENCE, requiredClaims: ['exp', 'iat', 'sub'], clockTolerance: 0 });
    // `resolveSelfManaged` matches managed_accounts.subject; the platform subject is a different column.
    expect(verified.payload.sub).toBe('identity-lin.wei');
    expect(verified.payload.sub).not.toBe('managed:lin.wei');
    expect(verified.payload.platform_managed_user_id).toBe('acct-1');
  });

  it('echoes the nonce in an id_token the web callback would accept', async () => {
    const { service, state } = await seeded();
    const grant = await service.authorize({ ...base, username: 'lin.wei', password: 'temporary-pass-123', newPassword: 'replacement-pass-456' });
    const tokens = await service.token({ code: grant.code, codeVerifier: verifier, clientId: 'zhinexus-web', redirectUri: base.redirectUri });
    expect(tokens.id_token).toBeTypeOf('string');
    const keys = new LocalSigningKeys(state.db);
    // The same rules access/oidc.ts applies to the id_token.
    const idVerified = await jwtVerify(tokens.id_token!, createLocalJWKSet(await keys.publicJwks()), {
      issuer: ISSUER, audience: 'zhinexus-web', algorithms: ['RS256', 'ES256'], requiredClaims: ['exp', 'iat', 'sub', 'nonce'], clockTolerance: 0,
    });
    expect(idVerified.payload.nonce).toBe(nonce);
    const accessVerified = await jwtVerify(tokens.access_token, createLocalJWKSet(await keys.publicJwks()), { algorithms: ['ES256'], issuer: ISSUER, audience: AUDIENCE });
    expect(idVerified.payload.sub).toBe(accessVerified.payload.sub);
  });

  it('issues no id_token for the CLI loopback flow, which sends no nonce', async () => {
    const { service } = await seeded();
    const { nonce: _omitted, ...withoutNonce } = base;
    const grant = await service.authorize({ ...withoutNonce, username: 'lin.wei', password: 'temporary-pass-123', newPassword: 'replacement-pass-456' });
    const tokens = await service.token({ code: grant.code, codeVerifier: verifier, clientId: 'zhinexus-web', redirectUri: base.redirectUri });
    expect(tokens.id_token).toBeUndefined();
    expect(tokens.access_token).toBeTypeOf('string');
  });

  it('rejects a malformed nonce instead of silently dropping it', async () => {
    const { service } = await seeded();
    expect(codeOf(await capture(() => service.authorize({ ...base, nonce: 'too-short', username: 'lin.wei', password: 'temporary-pass-123' })))).toBe('INVALID_SCHEMA');
    expect(codeOf(await capture(() => service.authorize({ ...base, nonce: 42, username: 'lin.wei', password: 'temporary-pass-123' })))).toBe('INVALID_SCHEMA');
  });

  it('advertises a discovery document whose issuer matches exactly', async () => {
    const { service } = await seeded();
    const discovery = service.discovery();
    expect(discovery.issuer).toBe(ISSUER);
    expect(discovery.authorization_endpoint).toBe(`${ISSUER}/authorize`);
    expect(discovery.token_endpoint).toBe(`${ISSUER}/token`);
    expect(discovery.jwks_uri).toBe(`${ISSUER}/jwks`);
    expect(discovery.response_types_supported).toContain('code');
    expect(discovery.code_challenge_methods_supported).toContain('S256');
  });
});

describe('local identity adapter', () => {
  it('echoes requested state and clears sessions on revocation', async () => {
    const { db, accounts, credentials, sessions, grants } = fakeDatabase();
    const store = new LocalIdentityStore(db);
    const adapter = new LocalIdentityAdapter(store, { issuer: ISSUER });
    const created = await adapter.createAccount({ username: 'new.user', displayName: '新人', roles: ['publisher'], managedUserId: 'acct-2', accountVersion: '1' });
    expect(created).toMatchObject({ id: 'acct-2', enabled: false, roles: ['publisher'] });
    accounts.set('acct-2', { id: 'acct-2', subject: 'identity-new.user', platform_subject: 'managed:new.user', username: 'new.user', roles: ['publisher'], enabled: false, version: '1', auth_time_floor: 0 });
    expect(await adapter.findByUsername('new.user')).toMatchObject({ id: 'acct-2' });
    expect(await adapter.findByUsername('ghost')).toBeUndefined();
    await adapter.setTemporaryPassword('acct-2', 'temp-pass-abc', '1');
    expect(credentials.get('acct-2')!.mustChange).toBe(true);
    expect(await adapter.updateAccount('acct-2', { enabled: true, accountVersion: '2' })).toMatchObject({ id: 'acct-2', enabled: true });
    sessions.add('managed:new.user');
    grants.add('managed:new.user');
    // The identity subject is what tokens carry; grants are filed under the platform subject, so a
    // session keyed by the identity subject must survive revocation.
    sessions.add('identity-new.user');
    await adapter.revokeSessions('acct-2');
    expect(sessions.size).toBe(1);
    expect([...sessions][0]).toBe('identity-new.user');
    expect(grants.size).toBe(0);
  });
});

describe('standalone password change', () => {
  it('requires the current password and rejects reuse', async () => {
    const { db, accounts, credentials } = fakeDatabase();
    const store = new LocalIdentityStore(db);
    const service = new LocalIdentityService(store, new LocalSigningKeys(db), options);
    accounts.set('acct-1', { id: 'acct-1', subject: 'identity-lin.wei', platform_subject: 'managed:lin.wei', username: 'lin.wei', roles: ['reader'], enabled: true, version: '3', auth_time_floor: 0 });
    credentials.set('acct-1', { passwordHash: await hashPassword('current-pass-123'), mustChange: false });
    expect(codeOf(await capture(() => service.changePassword({ username: 'lin.wei', currentPassword: 'wrong-pass-1234', newPassword: 'another-pass-789' })))).toBe('UNAUTHENTICATED');
    expect(codeOf(await capture(() => service.changePassword({ username: 'lin.wei', currentPassword: 'current-pass-123', newPassword: 'current-pass-123' })))).toBe('INVALID_SCHEMA');
    await service.changePassword({ username: 'lin.wei', currentPassword: 'current-pass-123', newPassword: 'another-pass-789' });
    expect(await verifyPassword('another-pass-789', credentials.get('acct-1')!.passwordHash)).toBe(true);
  });
});

describe('direct password login', () => {
  it('issues a verifiable ES256 access token and enforces first-login password replacement', async () => {
    const { db, accounts, credentials } = fakeDatabase();
    const store = new LocalIdentityStore(db);
    const keys = new LocalSigningKeys(db);
    const service = new LocalIdentityService(store, keys, options);
    accounts.set('acct-1', { id: 'acct-1', subject: 'remote-lin', platform_subject: 'managed:lin.wei', username: 'lin.wei', roles: ['publisher'], enabled: true, version: '2', auth_time_floor: 0 });
    credentials.set('acct-1', { passwordHash: await hashPassword('temp-pass-1234'), mustChange: true });

    expect(codeOf(await capture(() => service.passwordLogin({ username: 'lin.wei', password: 'wrong-password' })))).toBe('UNAUTHENTICATED');
    expect(codeOf(await capture(() => service.passwordLogin({ username: 'lin.wei', password: 'temp-pass-1234' })))).toBe('UNAUTHENTICATED');

    const issued = await service.passwordLogin({ username: 'lin.wei', password: 'temp-pass-1234', newPassword: 'fresh-pass-5678' });
    expect(issued.token_type).toBe('Bearer');
    const jwks = await service.jwks();
    const { payload } = await jwtVerify(issued.access_token, createLocalJWKSet(jwks as never), { issuer: ISSUER, audience: AUDIENCE });
    expect(payload.sub).toBe('remote-lin');
    expect(payload['roles']).toEqual(['publisher']);
    expect(payload['platform_managed_user_id']).toBe('acct-1');
    expect(credentials.get('acct-1')!.mustChange).toBe(false);

    accounts.get('acct-1')!.enabled = false;
    expect(codeOf(await capture(() => service.passwordLogin({ username: 'lin.wei', password: 'fresh-pass-5678' })))).toBe('FORBIDDEN');
  });
});

describe('local identity environment configuration and dual-origin wiring', () => {
  const keys = [
    'PLATFORM_SELF_MANAGED_ISSUER', 'PLATFORM_IDENTITY_MODE', 'PLATFORM_API_ORIGIN',
    'PLATFORM_GALLERY_ORIGIN', 'PLATFORM_ADMIN_ORIGIN', 'PLATFORM_IDENTITY_AUDIENCE',
    'PLATFORM_IDENTITY_WEB_CLIENT_ID', 'PLATFORM_IDENTITY_CLI_CLIENT_ID',
    'PLATFORM_IDENTITY_WEB_REDIRECT_URIS', 'PLATFORM_IDENTITY_CLI_REDIRECT_URIS',
  ] as const;

  function withEnv(values: Partial<Record<(typeof keys)[number], string>>, run: () => void) {
    const previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
    for (const k of keys) delete process.env[k];
    for (const [k, v] of Object.entries(values)) if (v !== undefined) process.env[k] = v;
    try { run(); } finally {
      for (const k of keys) {
        if (previous[k] === undefined) delete process.env[k];
        else process.env[k] = previous[k];
      }
    }
  }

  const baseEnv = {
    PLATFORM_SELF_MANAGED_ISSUER: 'https://api.example.com/identity',
    PLATFORM_IDENTITY_MODE: 'local',
    PLATFORM_API_ORIGIN: 'https://api.example.com',
    PLATFORM_GALLERY_ORIGIN: 'https://gallery.example.com',
    PLATFORM_ADMIN_ORIGIN: 'https://admin.internal.example.com',
    PLATFORM_IDENTITY_CLI_REDIRECT_URIS: 'http://127.0.0.1:18923/callback',
  };

  it('derives the API OIDC callback by default and preserves gallery/admin origins', () => {
    withEnv(baseEnv, () => {
      const parsed = environmentOptions();
      expect(parsed.galleryOrigin).toBe('https://gallery.example.com');
      expect(parsed.adminOrigin).toBe('https://admin.internal.example.com');
      expect(parsed.managedAccounts).toEqual({ issuer: 'https://api.example.com/identity', realm: 'local' });
      expect(parsed.localIdentity).toEqual({
        issuer: 'https://api.example.com/identity',
        audience: 'https://api.example.com',
        webClientId: 'zhinexus-web',
        cliClientId: 'zhinexus-cli',
        webRedirectUris: ['https://api.example.com/v1/auth/oidc/callback'],
        cliRedirectUris: ['http://127.0.0.1:18923/callback'],
      });
      const platform = new Platform({
        ...parsed,
        databaseUrl: 'postgres://user:pass@127.0.0.1:5432/zhinexus',
        access: {
          apiOrigin: 'https://api.example.com',
          administrators: [{ issuer: 'https://api.example.com/identity', subject: 'admin' }],
          outbound: [{ hostname: 'api.example.com', port: 443, networks: ['192.0.2.0/24'] }],
        },
      });
      expect(platform.localIdentity).toBeDefined();
      expect(platform.accounts).toBeDefined();
      expect(platform.allowsWebOrigin('https://gallery.example.com')).toBe(true);
      expect(platform.allowsWebOrigin('https://admin.internal.example.com')).toBe(true);
      expect(platform.allowsWebOrigin('https://evil.example.com')).toBe(false);
    });
  });

  it('accepts explicit HTTPS web redirect URIs with paths and rejects unsafe redirect URIs', () => {
    withEnv({ ...baseEnv, PLATFORM_IDENTITY_WEB_REDIRECT_URIS: 'https://api.example.com/v1/auth/oidc/callback,https://api-alt.example.com/v1/auth/oidc/callback' }, () => {
      expect(environmentOptions().localIdentity?.webRedirectUris).toEqual([
        'https://api.example.com/v1/auth/oidc/callback',
        'https://api-alt.example.com/v1/auth/oidc/callback',
      ]);
    });

    for (const badWeb of [
      'http://127.0.0.1:3000/v1/auth/oidc/callback',
      'https://api.example.com',
      'https://api.example.com/',
      'https://api.example.com/v1/auth/oidc/callback?next=/admin',
      'https://api.example.com/v1/auth/oidc/callback#frag',
      'https://user:pass@api.example.com/v1/auth/oidc/callback',
    ]) {
      withEnv({ ...baseEnv, PLATFORM_IDENTITY_WEB_REDIRECT_URIS: badWeb }, () => {
        expect(() => environmentOptions()).toThrow();
      });
    }

    for (const badCli of [
      '',
      'http://127.0.0.1:80/callback',
      'http://127.0.0.1:18923',
      'http://127.0.0.1:18923/',
      'http://example.com:18923/callback',
      'http://127.0.0.1:18923/callback?x=1',
    ]) {
      withEnv({ ...baseEnv, PLATFORM_IDENTITY_CLI_REDIRECT_URIS: badCli }, () => {
        expect(() => environmentOptions()).toThrow();
      });
    }
  });
});
