import { SignJWT } from 'jose';
import type { CryptoKey } from 'jose';
import { randomUUID } from 'node:crypto';
import { MANAGED_ACCOUNT_ROLES, type ManagedAccountRole } from '@company/contracts';

/**
 * Access-token lifetime. Short by design: this platform both stores credentials and signs
 * tokens, so a leaked token must stop working quickly. Refresh-token rotation is deferred, so
 * the web session cookie — not the access token — carries the longer-lived authentication.
 */
export const ACCESS_TOKEN_SECONDS = 300;
export type TokenSubject = {
  /** Identity-service subject; the platform maps it to a platform subject after verification. */
  subject: string;
  /** Stable platform-side identifier surfaced as `platform_managed_user_id`. */
  managedUserId: string;
  roles: ManagedAccountRole[];
  /** Decimal string, matching the PostgreSQL bigint column; never a JS number. */
  accountVersion: string;
  /** Seconds since epoch; must be strictly greater than the account's auth_time floor. */
  authTime: number;
};
export type TokenIssuer = { issuer: string; audience: string; clientId: string };

/** Rejects role names the verifier would refuse, so a bad record fails at issuance not at use. */
const safeRoles = (roles: ManagedAccountRole[]): ManagedAccountRole[] => {
  const allowed = new Set<string>(MANAGED_ACCOUNT_ROLES);
  return [...new Set(roles)].filter(role => allowed.has(role));
};

/**
 * Issues an access token carrying every claim `auth/oidc.ts` and the self-managed account checks
 * require. `iat` is set explicitly rather than by the library so the value can be asserted to be
 * no later than now: the verifier uses `clockTolerance: 0` and rejects future `iat`.
 */
export async function issueAccessToken(key: CryptoKey, kid: string, subject: TokenSubject, config: TokenIssuer, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const roles = safeRoles(subject.roles);
  if (!roles.length) throw new Error('Token subject must carry at least one known role');
  if (!Number.isInteger(subject.authTime) || subject.authTime < 0 || subject.authTime > now) throw new Error('Token auth_time must be a past whole second');
  if (!/^\d+$/.test(subject.accountVersion)) throw new Error('Token account version must be a decimal string');
  return new SignJWT({
    roles,
    platform_managed_user_id: subject.managedUserId,
    platform_account_version: subject.accountVersion,
    auth_time: subject.authTime,
  })
    .setProtectedHeader({ alg: 'ES256', kid })
    .setSubject(subject.subject)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + ACCESS_TOKEN_SECONDS)
    .setJti(randomUUID())
    .sign(key);
}
