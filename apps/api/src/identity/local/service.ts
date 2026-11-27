import { randomBytes } from 'node:crypto';
import { PlatformError } from '../../errors.js';
import type { ManagedAccountRole, ValidationIssue } from '@company/contracts';
import { DUMMY_PASSWORD_HASH, PasswordPolicyError, assertPasswordPolicy, hashPassword, verifyPassword } from './password.js';
import { LocalSigningKeys } from './keys.js';
import { ACCESS_TOKEN_SECONDS, issueAccessToken, issueIdToken } from './tokens.js';
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
  /**
   * OIDC nonce, echoed back in the id_token. The web flow always sends one (`CompanyOidc.start`);
   * the CLI loopback flow does not and never receives an id_token, so it stays optional.
   */
  nonce?: unknown;
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
/**
 * The nonce has the shape `CompanyOidc.start` generates (32 random bytes, base64url). A nonce that
 * is present but malformed is rejected rather than dropped: silently ignoring it would strand the
 * web callback with a token it cannot verify, which is far harder to diagnose than a 400.
 */
const nonce = (value: unknown): string => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new PlatformError('INVALID_SCHEMA');
  return value;
};
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

  /**
   * Where a browser is sent to authenticate. The same value is published as the discovery
   * document's `authorization_endpoint`, so there is exactly one place that builds it.
   */
  get authorizationEndpoint(): string { return this.options.issuer.replace(/\/$/, '') + '/authorize'; }

  discovery(): Record<string, unknown> {
    const base = this.options.issuer.replace(/\/$/, '');
    return {
      issuer: this.options.issuer,
      authorization_endpoint: this.authorizationEndpoint,
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
   * Describes the authorization request as JSON. No browser is sent here any more: a web login is
   * redirected to the admin login page (`CompanyOidc.start`), which posts the credentials back to
   * `POST /identity/authorize` on this same endpoint. The GET therefore only serves clients that
   * want to validate a request before building a form of their own, and it deliberately accepts
   * nothing and stores nothing.
   */
  describeAuthorization(value: AuthorizationRequest): { clientId: string; redirectUri: string; state: string; codeChallenge: string; nonce: string; scope: string } {
    const request = this.request(value);
    return { ...request, scope: 'openid' };
  }

  /** Validates an authorization request before any credential is shown or accepted. */
  private request(value: AuthorizationRequest): { clientId: string; redirectUri: string; codeChallenge: string; state: string; nonce: string } {
    const id = clientId(value.clientId);
    const allowed = id === this.options.webClientId ? this.options.webRedirectUris : id === this.options.cliClientId ? this.options.cliRedirectUris : [];
    const redirect = typeof value.redirectUri === 'string' && allowed.includes(value.redirectUri) ? value.redirectUri : undefined;
    const proof = challenge(value.codeChallenge);
    const browser = state(value.state);
    if (!id || !redirect || !proof || !browser) throw new PlatformError('INVALID_SCHEMA');
    return { clientId: id, redirectUri: redirect, codeChallenge: proof, state: browser, nonce: nonce(value.nonce) };
  }

  /** Shared credential verification with constant-time dummy fallback and first-login replacement. */
  private async verifyCredentials(value: { username: unknown; password: unknown; newPassword?: unknown }) {
    const username = typeof value.username === 'string' ? value.username.trim().toLowerCase() : '';
    if (!username || typeof value.password !== 'string') throw new PlatformError('UNAUTHENTICATED', [detail('username', GENERIC_LOGIN_FAILURE)]);
    const candidate = await this.store.loginCandidate(this.options.issuer, username);
    const credential = candidate ? await this.store.credential(candidate.accountId) : undefined;
    // Unknown account and missing credential both burn the same work, so timing matches a real check.
    const passwordOk = await verifyPassword(value.password, credential?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!candidate || !credential || !passwordOk) throw new PlatformError('UNAUTHENTICATED', [detail('username', GENERIC_LOGIN_FAILURE)]);
    if (!candidate.enabled) throw new PlatformError('FORBIDDEN', [detail('username', GENERIC_LOGIN_FAILURE)]);
    if (credential.mustChange) {
      if (value.newPassword === undefined || value.newPassword === '') throw new PlatformError('UNAUTHENTICATED', [detail('newPassword', '首次登录必须设置新密码')]);
      const replacement = policy(value.newPassword);
      if (replacement === value.password) throw new PlatformError('INVALID_SCHEMA', [detail('newPassword', '新密码不能与当前密码相同')]);
      await this.store.putCredential(candidate.accountId, await hashPassword(replacement), false);
    }
    // Revocation uses whole seconds. A fresh password must not produce a token at the old
    // authentication floor; wait at most one second, then recheck the account before issuance.
    const wait = (candidate.authTimeFloor + 1) * 1000 - Date.now();
    if (wait > 0) {
      if (wait > 1000) throw new PlatformError('UNAUTHENTICATED');
      await new Promise(resolve => setTimeout(resolve, wait));
      const current = await this.store.loginCandidate(this.options.issuer, username);
      if (!current?.enabled || current.version !== candidate.version || Math.floor(Date.now() / 1000) <= current.authTimeFloor) throw new PlatformError('UNAUTHENTICATED');
      return current;
    }
    return candidate;
  }

  /**
   * Verifies credentials and, on success, mints a single-use authorization code bound to the
   * request. A first login must supply a replacement password in the same submission, otherwise
   * the platform-issued temporary credential could never be retired.
   */
  async authorize(value: AuthorizationSubmission): Promise<AuthorizationGrant> {
    const request = this.request(value);
    const candidate = await this.verifyCredentials(value);
    const now = Math.floor(Date.now() / 1000);
    const code = randomBytes(32).toString('base64url');
    await this.store.putAuthorizationCode(code, {
      accountId: candidate.accountId, clientId: request.clientId, redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge, accountVersion: candidate.version, authTime: now, nonce: request.nonce,
    });
    return { code, state: request.state, redirectUri: request.redirectUri };
  }

  /** Direct username/password sign-in for the registered web or CLI client. */
  async passwordLogin(value: { username: unknown; password: unknown; newPassword?: unknown; clientId?: unknown }): Promise<{ access_token: string; token_type: 'Bearer'; expires_in: number; scope: string }> {
    const requestedClient = value.clientId === undefined ? this.options.webClientId : value.clientId;
    if (requestedClient !== this.options.webClientId && requestedClient !== this.options.cliClientId) throw new PlatformError('INVALID_SCHEMA');
    const candidate = await this.verifyCredentials(value);
    const { kid, key } = await this.keys.active();
    const now = Math.floor(Date.now() / 1000);
    const accessToken = await issueAccessToken(key, kid, {
      subject: candidate.subject, managedUserId: candidate.managedUserId, roles: candidate.roles as ManagedAccountRole[],
      accountVersion: candidate.version, authTime: now,
    }, { issuer: this.options.issuer, audience: this.options.audience, clientId: requestedClient }, now);
    return { access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TOKEN_SECONDS, scope: 'openid' };
  }

  /**
   * Exchanges a code for tokens. Every mismatch fails closed and silently.
   *
   * The id_token is issued only when the authorization request carried a nonce, which is exactly
   * the web flow: `access/oidc.ts` requires an id_token, verifies it against the web client as
   * audience, and compares its `sub` with the access token's subject and its `nonce` with the nonce
   * it generated. The CLI loopback flow sends no nonce and consumes only the access token, so it
   * keeps receiving a response with no id_token.
   */
  async token(value: { code: unknown; codeVerifier: unknown; clientId: unknown; redirectUri: unknown }): Promise<{ access_token: string; id_token?: string; token_type: 'Bearer'; expires_in: number; scope: string }> {
    const id = clientId(value.clientId);
    const verifier = typeof value.codeVerifier === 'string' ? value.codeVerifier : '';
    if (!id || typeof value.code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(verifier) || typeof value.redirectUri !== 'string') throw new PlatformError('INVALID_SCHEMA');
    const claimed = await this.store.consumeAuthorizationCode(value.code, verifier, id, value.redirectUri);
    if (!claimed) throw new PlatformError('UNAUTHENTICATED');
    // The account is re-read so a disable that happened after the code was issued still blocks it.
    const active = await this.accountFor(claimed.accountId);
    if (!active || !active.enabled) throw new PlatformError('UNAUTHENTICATED');
    const { kid, key } = await this.keys.active();
    const now = Math.floor(Date.now() / 1000);
    const accessToken = await issueAccessToken(key, kid, {
      subject: active.subject, managedUserId: active.managedUserId, roles: active.roles as ManagedAccountRole[],
      accountVersion: claimed.accountVersion, authTime: claimed.authTime,
    }, { issuer: this.options.issuer, audience: this.options.audience, clientId: claimed.clientId }, now);
    const response: { access_token: string; id_token?: string; token_type: 'Bearer'; expires_in: number; scope: string } = {
      access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TOKEN_SECONDS, scope: 'openid',
    };
    if (claimed.nonce) {
      response.id_token = await issueIdToken(key, kid, { subject: active.subject, nonce: claimed.nonce }, { issuer: this.options.issuer, clientId: claimed.clientId }, now);
    }
    return response;
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
