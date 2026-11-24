import { exportJWK, exportPKCS8, generateKeyPair, importPKCS8, type CryptoKey, type JWK } from 'jose';
import { randomBytes } from 'node:crypto';
import { PlatformError } from '../../errors.js';

/**
 * Signing keys for tokens this platform issues itself. ES256 is chosen over RS256 because
 * `auth/oidc.ts` accepts both, and EC signing is materially faster and produces smaller tokens
 * for the same security level; there is no legacy RSA requirement to satisfy.
 */
export const SIGNING_ALGORITHM = 'ES256' as const;
export type SigningKeyState = 'active' | 'retired';
/** A private key is never returned to a caller; only the public JWK leaves this module. */
export type SigningKeyRow = { kid: string; public_jwk: JWK; private_pem: string; state: SigningKeyState };
/** Minimal surface the key store needs, so tests need not construct a real pool. */
export type Queryable = { query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> };

const kid = (): string => randomBytes(16).toString('base64url');
const row = (value: unknown): value is SigningKeyRow =>
  !!value && typeof value === 'object' && typeof (value as SigningKeyRow).kid === 'string'
  && !!(value as SigningKeyRow).public_jwk && typeof (value as SigningKeyRow).private_pem === 'string'
  && ((value as SigningKeyRow).state === 'active' || (value as SigningKeyRow).state === 'retired');

async function mint(): Promise<SigningKeyRow> {
  // `extractable` is required: the default CryptoKey is non-extractable and exportPKCS8 would throw.
  const pair = await generateKeyPair(SIGNING_ALGORITHM, { extractable: true });
  const publicJwk = await exportJWK(pair.publicKey);
  // Private keys are persisted as PKCS8 PEM. At-rest encryption with an external KMS is the
  // documented upgrade path; see migration 013 for the accepted tradeoff.
  const privatePem = await exportPKCS8(pair.privateKey);
  const identifier = kid();
  // The JWK must carry the same kid as its row, or JWKS consumers cannot select it.
  return { kid: identifier, public_jwk: { ...publicJwk, kid: identifier, alg: SIGNING_ALGORITHM, use: 'sig' }, private_pem: privatePem, state: 'active' };
}

export class LocalSigningKeys {
  constructor(private readonly db: Queryable) {}
  /** Every key still needed to verify an outstanding token, active first. */
  async publicJwks(): Promise<{ keys: JWK[] }> {
    const rows = (await this.db.query<SigningKeyRow>("SELECT kid,public_jwk,private_pem,state FROM local_signing_keys ORDER BY created_at DESC LIMIT 8")).rows.filter(row);
    if (!rows.length) throw new PlatformError('INFRA_UNAVAILABLE');
    return { keys: rows.map(value => value.public_jwk) };
  }
  private async load(kid: string): Promise<CryptoKey> {
    const found = (await this.db.query<SigningKeyRow>('SELECT kid,public_jwk,private_pem,state FROM local_signing_keys WHERE kid=$1', [kid])).rows.filter(row)[0];
    if (!found || found.state !== 'active') throw new PlatformError('INFRA_UNAVAILABLE');
    return importPKCS8(found.private_pem, SIGNING_ALGORITHM);
  }
  /**
   * Returns the active key, creating one on first use. Creation is serialised by the partial
   * unique index on `state='active'`, so a concurrent creator fails and retries the read.
   */
  async active(): Promise<{ kid: string; key: CryptoKey }> {
    const existing = (await this.db.query<SigningKeyRow>("SELECT kid,public_jwk,private_pem,state FROM local_signing_keys WHERE state='active' LIMIT 1")).rows.filter(row)[0];
    if (existing) return { kid: existing.kid, key: await this.load(existing.kid) };
    const created = await mint();
    try {
      await this.db.query('INSERT INTO local_signing_keys(kid,public_jwk,private_pem,state) VALUES ($1,$2,$3,$4)', [created.kid, JSON.stringify(created.public_jwk), created.private_pem, created.state]);
    } catch {
      // Another process won the race; fall through to read the winner.
      const winner = (await this.db.query<SigningKeyRow>("SELECT kid,public_jwk,private_pem,state FROM local_signing_keys WHERE state='active' LIMIT 1")).rows.filter(row)[0];
      if (!winner) throw new PlatformError('INFRA_UNAVAILABLE');
      return { kid: winner.kid, key: await this.load(winner.kid) };
    }
    return { kid: created.kid, key: await this.load(created.kid) };
  }
  /**
   * Retires the active key and mints a replacement. The retired key stays published so tokens
   * it signed remain verifiable until they expire.
   */
  async rotate(): Promise<{ kid: string }> {
    const previous = (await this.db.query<SigningKeyRow>("SELECT kid,public_jwk,private_pem,state FROM local_signing_keys WHERE state='active' LIMIT 1")).rows.filter(row)[0];
    if (previous) await this.db.query("UPDATE local_signing_keys SET state='retired',retired_at=clock_timestamp() WHERE kid=$1 AND state='active'", [previous.kid]);
    return { kid: (await this.active()).kid };
  }
}
