import { PlatformError } from '../../errors.js';

/**
 * The admin login page lives in `apps/admin/app/login`, but the round trip that returns a browser
 * to it belongs to the identity service: `POST /identity/authorize` is a native form submission,
 * so a failure cannot be answered with a JSON error page the way an API client can. This module
 * builds that return URL and nothing else — it never renders, and it never talks to the database.
 */

/**
 * Closed set of outcomes the login page can render. The API sends a token, never a message: the
 * page owns the wording, and a fixed token keeps the redirect URL free of anything a request
 * controlled beyond the parameters the service already validated.
 */
export type LoginFailureReason = 'credentials' | 'first-login' | 'disabled' | 'invalid-request' | 'unavailable';

/** Maps a rejected authorization onto the token the login page renders. */
export function loginFailureReason(error: PlatformError): LoginFailureReason {
  // A first login must replace the platform-issued credential in the same submission, so this is
  // the only failure the user can act on without leaving the page.
  if (error.details.some(issue => issue.path === 'newPassword')) return 'first-login';
  if (error.code === 'FORBIDDEN') return 'disabled';
  if (error.code === 'UNAUTHENTICATED') return 'credentials';
  if (error.code === 'INVALID_SCHEMA') return 'invalid-request';
  return 'unavailable';
}

/** The same shapes `LocalIdentityService.request` accepts, so a malformed field is dropped here too. */
const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const STATE = /^[A-Za-z0-9_-]{8,512}$/;
const USERNAME = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/;

/**
 * Whether a request is a browser navigating a posted form rather than an API client. A native form
 * submission always offers `text/html`; `fetch` and the CLI do not. This is content negotiation,
 * not a security check — the credential form is equally trusted either way.
 */
export function isBrowserForm(accept: string | undefined): boolean {
  return typeof accept === 'string' && accept.includes('text/html');
}

const redirectUri = (value: unknown, development: boolean, cli: boolean): string => {
  if (typeof value !== 'string') return '';
  let url: URL;
  try { url = new URL(value); } catch { return ''; }
  const local = development && process.env.NODE_ENV !== 'production' && value === 'http://127.0.0.1:3000/v1/auth/oidc/callback';
  const loopback = cli && url.protocol === 'http:' && url.hostname === '127.0.0.1' && Number(url.port) >= 1024;
  return (url.protocol === 'https:' || local || loopback) && !url.username && !url.password && !url.search && !url.hash && url.pathname !== '/' && url.href === value ? value : '';
};

/**
 * Rebuilds the login URL for a browser whose credential submission was rejected. Every echoed
 * parameter is re-validated against the shape the service accepts, so a hostile or malformed body
 * cannot inject anything into the redirect; a field that fails is simply left out, which sends the
 * browser to the same "entry invalid" state a hand-typed URL produces.
 *
 * The username is echoed because a mistyped password is the common failure and retyping the
 * username buys nothing. It is normalised exactly as the service normalises it before lookup.
 */
export function loginFailureUrl(adminOrigin: string, submission: Record<string, unknown>, reason: LoginFailureReason, development = false): string {
  const field = (key: string, pattern: RegExp): string => {
    const value = submission[key];
    return typeof value === 'string' && pattern.test(value) ? value : '';
  };
  const params = new URLSearchParams();
  const clientId = field('client_id', CLIENT_ID);
  const redirect = redirectUri(submission['redirect_uri'], development, !submission['nonce']);
  const state = field('state', STATE);
  const challenge = field('code_challenge', TOKEN);
  const nonce = field('nonce', TOKEN);
  if (clientId) params.set('client_id', clientId);
  if (redirect) params.set('redirect_uri', redirect);
  if (state) params.set('state', state);
  if (challenge) params.set('code_challenge', challenge);
  if (nonce) params.set('nonce', nonce);
  const username = field('username', USERNAME);
  if (username) params.set('username', username.toLowerCase());
  params.set('reason', reason);
  const url = new URL('/login', adminOrigin);
  url.search = params.toString();
  return url.href;
}
