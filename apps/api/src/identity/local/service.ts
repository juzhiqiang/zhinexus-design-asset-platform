import { randomBytes } from 'node:crypto';
import { PlatformError } from '../../errors.js';
import type { ManagedAccountRole, ValidationIssue } from '@company/contracts';
import { DUMMY_PASSWORD_HASH, PasswordPolicyError, assertPasswordPolicy, hashPassword, verifyPassword } from './password.js';
import { LocalSigningKeys } from './keys.js';
import { ACCESS_TOKEN_SECONDS, issueAccessToken } from './tokens.js';
import type { LocalIdentityStore } from './store.js';

export type LocalIdentityOptions = {
  /** Issuer written into tokens and discovery; also the managed-account scope. */
  issuer: string;
  audience: string;
  webClientId: string;
  cliClientId: string;
  /** Exact redirect URIs per client; anything else fails closed. */
  webRedirectUris: readonly string[];
  cliRedirectUris: readonly string[];
};
export type AuthorizationRequest = {
  clientId: unknown; redirectUri: unknown; state: unknown; codeChallenge: unknown; scope?: unknown;
};
/** Credential submission; every field arrives from an untrusted request body. */
export type AuthorizationSubmission = AuthorizationRequest & { username: unknown; password: unknown; newPassword?: unknown };
export type AuthorizationGrant = { code: string; state: string; redirectUri: string };
/** One error text for every failed login, so account existence is never observable. */
const GENERIC_LOGIN_FAILURE = '用户名或密码不正确';
/**
 * Field-level detail in the shape `ApiError.details` requires: `ValidationIssue` is an object
 * (`{ code, path, message }`), not a `[path, message]` tuple — the tuple form compiles nowhere
 * and was caught only by a real `tsc` run, because the sandbox executor strips types.
 *
 * The detail's `code` is always `INVALID_SCHEMA`, because `ValidationIssue['code']` is the
 * narrower `ContractErrorCode` set, which has no member for an authentication outcome. The
 * machine-readable outcome is the `PlatformError`'s own code; the detail only names the field.
 */
const detail = (path: string, message: string): ValidationIssue => ({ code: 'INVALID_SCHEMA', path, message });

const clientId = (value: unknown): string | undefined => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value) ? value : undefined;
const challenge = (value: unknown): string | undefined => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
const state = (value: unknown): string | undefined => typeof value === 'string' && /^[A-Za-z0-9_-]{8,512}$/.test(value) ? value : undefined;
/** Policy failures must surface as a 400 schema error, never as an unhandled exception. */
const policy = (value: unknown): string => {
  try { assertPasswordPolicy(value); } catch (error) {
    if (error instanceof PasswordPolicyError) throw new PlatformError('INVALID_SCHEMA', [detail('newPassword', error.message)]);
    throw error;
  }
  return value as string;
};

export class LocalIdentityService {
  constructor(private readonly store: LocalIdentityStore, private readonly keys: LocalSigningKeys, private readonly options: LocalIdentityOptions) {}

  discovery(): Record<string, unknown> {
    const base = this.options.issuer.replace(/\/$/, '');
    return {
      issuer: this.options.issuer,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      jwks_uri: `${base}/jwks`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['openid'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['ES256'],
    };
  }

  async jwks(): Promise<{ keys: unknown[] }> { return this.keys.publicJwks(); }

  /**
   * Validates an authorization request and returns what a credential form must render. The form
   * itself is rendered by the gallery: this round ships a JSON descriptor rather than a native
   * HTML login page, which is recorded as a known limitation.
   */
  describeAuthorization(value: AuthorizationRequest): { clientId: string; redirectUri: string; state: string; codeChallenge: string; scope: string } {
    const request = this.request(value);
    return { ...request, scope: 'openid' };
  }

  /** Validates an authorization request before any credential is shown or accepted. */
  private request(value: AuthorizationRequest): { clientId: string; redirectUri: string; codeChallenge: string; state: string } {
    const id = clientId(value.clientId);
    const allowed = id === this.options.webClientId ? this.options.webRedirectUris : id === this.options.cliClientId ? this.options.cliRedirectUris : [];
    const redirect = typeof value.redirectUri === 'string' && allowed.includes(value.redirectUri) ? value.redirectUri : undefined;
    const proof = challenge(value.codeChallenge);
    const nonce = state(value.state);
    if (!id || !redirect || !proof || !nonce) throw new PlatformError('INVALID_SCHEMA');
    return { clientId: id, redirectUri: redirect, codeChallenge: proof, state: nonce };
  }

  /**
   * Verifies credentials and, on success, mints a single-use authorization code bound to the
   * request. A first login must supply a replacement password in the same submission, otherwise
   * the platform-issued temporary credential could never be retired.
   */
  async authorize(value: AuthorizationSubmission): Promise<AuthorizationGrant> {
    const request = this.request(value);
    const username = typeof value.username === 'string' ? value.username.trim().toLowerCase() : '';
    if (!username || typeof value.password !== 'string') throw new PlatformError('UNAUTHENTICATED', [detail('username', GENERIC_LOGIN_FAILURE)]);
    const candidate = await this.store.loginCandidate(this.options.issuer, username);
    const credential = candidate ? await this.store.credential(candidate.accountId) : undefined;
    // Unknown account and missing credential both burn the same work, so timing matches a real check.
    const passwordOk = await verifyPassword(value.password, credential?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!candidate || !credential || !passwordOk) throw new PlatformError('UNAUTHENTICATED', [detail('username', GENERIC_LOGIN_FAILURE)]);
    if (!candidate.enabled) throw new PlatformError('FORBIDDEN', [detail('username', GENERIC_LOGIN_FAILURE)]);
    if (credential.mustChange) {
      if (value.newPassword === undefined) throw new PlatformError('UNAUTHENTICATED', [detail('newPassword', '首次登录必须设置新密码')]);
      const replacement = policy(value.newPassword);
      if (replacement === value.password) throw new PlatformError('INVALID_SCHEMA', [detail('newPassword', '新密码不能与当前密码相同')]);
      await this.store.putCredential(candidate.accountId, await hashPassword(replacement), false);
    }
    const now = Math.floor(Date.now() / 1000);
    const code = randomBytes(32).toString('base64url');
    await this.store.putAuthorizationCode(code, {
      accountId: candidate.accountId, clientId: request.clientId, redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge, accountVersion: candidate.version, authTime: now,
    });
    return { code, state: request.state, redirectUri: request.redirectUri };
  }

  /** Exchanges a code for an access token. Every mismatch fails closed and silently. */
  async token(value: { code: unknown; codeVerifier: unknown; clientId: unknown; redirectUri: unknown }): Promise<{ access_token: string; token_type: 'Bearer'; expires_in: number; scope: string }> {
    const id = clientId(value.clientId);
    const verifier = typeof value.codeVerifier === 'string' ? value.codeVerifier : '';
    if (!id || typeof value.code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(verifier) || typeof value.redirectUri !== 'string') throw new PlatformError('INVALID_SCHEMA');
    const claimed = await this.store.consumeAuthorizationCode(value.code, verifier, id, value.redirectUri);
    if (!claimed) throw new PlatformError('UNAUTHENTICATED');
    // The account is re-read so a disable that happened after the code was issued still blocks it.
    const active = await this.accountFor(claimed.accountId);
    if (!active || !active.enabled) throw new PlatformError('UNAUTHENTICATED');
    const { kid, key } = await this.keys.active();
    const accessToken = await issueAccessToken(key, kid, {
      subject: active.subject, managedUserId: active.managedUserId, roles: active.roles as ManagedAccountRole[],
      accountVersion: claimed.accountVersion, authTime: claimed.authTime,
    }, { issuer: this.options.issuer, audience: this.options.audience, clientId: claimed.clientId });
    return { access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TOKEN_SECONDS, scope: 'openid' };
  }

  private async accountFor(accountId: string) { return this.store.account(accountId); }

  /** First-login replacement: the current password must still be correct. */
  async changePassword(value: { username: unknown; currentPassword: unknown; newPassword: unknown }): Promise<{ changed: true }> {
    const username = typeof value.username === 'string' ? value.username.trim().toLowerCase() : '';
    if (!username || typeof value.currentPassword !== 'string') throw new PlatformError('UNAUTHENTICATED');
    const replacement = policy(value.newPassword);
    if (replacement === value.currentPassword) throw new PlatformError('INVALID_SCHEMA', [detail('newPassword', '新密码不能与当前密码相同')]);
    const candidate = await this.store.loginCandidate(this.options.issuer, username);
    const credential = candidate ? await this.store.credential(candidate.accountId) : undefined;
    if (!candidate || !credential || !(await verifyPassword(value.currentPassword, credential.passwordHash))) throw new PlatformError('UNAUTHENTICATED');
    await this.store.putCredential(candidate.accountId, await hashPassword(replacement), false);
    return { changed: true };
  }
}
