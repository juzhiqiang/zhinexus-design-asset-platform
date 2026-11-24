import { createHash } from 'node:crypto';
import type { Queryable } from './keys.js';

/** Credential record for one managed account; the hash is opaque to every other module. */
export type StoredCredential = { accountId: string; passwordHash: string; mustChange: boolean };
export type AuthorizationCode = { accountId: string; clientId: string; accountVersion: string; authTime: number };
export const AUTHORIZATION_CODE_SECONDS = 60;
/** An account as the identity service sees it: enough to decide a login and sign a token. */
export type LoginCandidate = {
  accountId: string; subject: string; managedUserId: string; username: string;
  roles: string[]; enabled: boolean; version: string; authTimeFloor: number;
};

const digest = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

export class LocalIdentityStore {
  constructor(private readonly db: Queryable) {}

  async putCredential(accountId: string, passwordHash: string, mustChange: boolean): Promise<void> {
    await this.db.query(`INSERT INTO local_credentials(account_id,password_hash,must_change) VALUES ($1,$2,$3)
      ON CONFLICT (account_id) DO UPDATE SET password_hash=EXCLUDED.password_hash,must_change=EXCLUDED.must_change,updated_at=clock_timestamp()`,
      [accountId, passwordHash, mustChange]);
  }

  async credential(accountId: string): Promise<StoredCredential | undefined> {
    const found = (await this.db.query<{ account_id: string; password_hash: string; must_change: boolean }>(
      'SELECT account_id,password_hash,must_change FROM local_credentials WHERE account_id=$1', [accountId])).rows[0];
    return found ? { accountId: found.account_id, passwordHash: found.password_hash, mustChange: found.must_change } : undefined;
  }

  async clearMustChange(accountId: string): Promise<void> {
    await this.db.query('UPDATE local_credentials SET must_change=false,updated_at=clock_timestamp() WHERE account_id=$1', [accountId]);
  }

  /** Re-read at token time so a disable issued after the code was created still blocks the grant. */
  async account(accountId: string): Promise<{ subject: string; managedUserId: string; roles: string[]; enabled: boolean } | undefined> {
    const found = (await this.db.query<Record<string, unknown>>('SELECT platform_subject,roles,enabled FROM managed_accounts WHERE id=$1', [accountId])).rows[0];
    if (!found) return undefined;
    const roles = Array.isArray(found['roles']) ? found['roles'].filter((value): value is string => typeof value === 'string') : [];
    return { subject: String(found['platform_subject']), managedUserId: accountId, roles, enabled: found['enabled'] === true };
  }

  async usernameOf(accountId: string): Promise<string> {
    const found = (await this.db.query<{ username: string }>('SELECT username FROM managed_accounts WHERE id=$1', [accountId])).rows[0];
    if (!found) throw new Error('Local identity account no longer exists');
    return found.username;
  }

  /** Scoped by issuer so a username can never resolve against another identity source. */
  async loginCandidate(issuer: string, username: string): Promise<LoginCandidate | undefined> {
    const found = (await this.db.query<Record<string, unknown>>(
      'SELECT id,platform_subject,username,display_name,roles,enabled,version,auth_time_floor FROM managed_accounts WHERE issuer=$1 AND username=$2',
      [issuer, username])).rows[0];
    if (!found) return undefined;
    const roles = Array.isArray(found['roles']) ? found['roles'].filter((value): value is string => typeof value === 'string') : [];
    return {
      accountId: String(found['id']), subject: String(found['platform_subject']), managedUserId: String(found['id']),
      username: String(found['username']), roles, enabled: found['enabled'] === true,
      version: String(found['version']), authTimeFloor: Number(found['auth_time_floor'] ?? 0),
    };
  }

  /**
   * Stores a code bound to the client, redirect URI and PKCE challenge. The code itself is never
   * persisted — only its digest — so a leaked table cannot be replayed.
   */
  async putAuthorizationCode(code: string, value: { accountId: string; clientId: string; redirectUri: string; codeChallenge: string; accountVersion: string; authTime: number }): Promise<void> {
    await this.db.query(`INSERT INTO local_authorization_codes(code_hash,account_id,client_id,redirect_uri,code_challenge,account_version,auth_time,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+interval '${AUTHORIZATION_CODE_SECONDS} seconds')`,
      [digest(code), value.accountId, value.clientId, value.redirectUri, value.codeChallenge, value.accountVersion, value.authTime]);
  }

  /**
   * Single-use consumption. The UPDATE is the guard: a code can only be returned once, so a
   * replayed code finds `consumed_at` already set and fails closed. The PKCE challenge is compared
   * in SQL, so a wrong `code_verifier` never reaches token issuance.
   */
  async consumeAuthorizationCode(code: string, verifier: string, clientId: string, redirectUri: string): Promise<AuthorizationCode | undefined> {
    const challenge = createHash('sha256').update(verifier, 'utf8').digest('base64url');
    const claimed = (await this.db.query<Record<string, unknown>>(
      `UPDATE local_authorization_codes SET consumed_at=clock_timestamp() WHERE code_hash=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp()
        AND client_id=$2 AND redirect_uri=$3 AND code_challenge=$4
       RETURNING account_id,account_version,auth_time`,
      [digest(code), clientId, redirectUri, challenge])).rows[0];
    if (!claimed) return undefined;
    return { accountId: String(claimed['account_id']), clientId, accountVersion: String(claimed['account_version']), authTime: Number(claimed['auth_time']) };
  }

  /** Drops every live session and preview grant for one subject; used by revocation. */
  async revokeSubjectAccess(subject: string): Promise<void> {
    await this.db.query("DELETE FROM oidc_sessions WHERE principal->>'subject'=$1", [subject]);
    await this.db.query('DELETE FROM preview_grants WHERE subject=$1', [subject]);
  }
}
