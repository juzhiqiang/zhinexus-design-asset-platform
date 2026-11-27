import { describe, expect, it } from 'vitest';
import { CompanyOidc } from '../../apps/api/dist/access/oidc.js';
import { PlatformError } from '../../apps/api/dist/errors.js';
import { LocalIdentityController } from '../../apps/api/dist/identity/local/controller.js';
import { isBrowserForm, loginFailureReason, loginFailureUrl } from '../../apps/api/dist/identity/local/login-page.js';
import { hashPassword } from '../../apps/api/dist/identity/local/password.js';
import { LocalIdentityService } from '../../apps/api/dist/identity/local/service.js';

/**
 * The admin login page round trip. Two pieces live on the API side: `CompanyOidc.start` decides
 * whether a browser is sent to the page at all, and `POST /identity/authorize` decides how a
 * rejected form gets back to it. Both are exercised here without a database or a network.
 */

const ISSUER = 'https://api.example.com/identity';
const AUDIENCE = 'https://api.example.com';
const ADMIN_ORIGIN = 'https://admin.example.com';
const REDIRECT_URI = 'https://api.example.com/v1/auth/oidc/callback';
const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

const options = {
  issuer: ISSUER, audience: AUDIENCE, webClientId: 'zhinexus-web', cliClientId: 'zhinexus-cli',
  webRedirectUris: [REDIRECT_URI], cliRedirectUris: ['http://127.0.0.1:18923/callback'],
};

/** A well-formed web submission, as the admin login page posts it. */
const submission = {
  client_id: 'zhinexus-web', redirect_uri: REDIRECT_URI, state: 's'.repeat(43),
  code_challenge: 'c'.repeat(43), nonce: 'n'.repeat(43),
  username: 'Lin.Wei', password: 'temporary-pass-123',
};

const candidate = {
  accountId: 'account-1', subject: 'identity-lin.wei', platformSubject: 'oidc:lin.wei', managedUserId: 'managed-1',
  username: 'lin.wei', roles: ['reader'], enabled: true, version: '1', authTimeFloor: 0,
};

/** A store with no matching account: the generic wrong-credential failure, no database needed. */
const emptyStore = { loginCandidate: async () => undefined, credential: async () => undefined };
/** A store whose credential must be replaced on first use, as the bootstrap leaves it. */
const firstLoginStore = {
  loginCandidate: async () => candidate,
  credential: async () => ({ passwordHash: await hashPassword('temporary-pass-123'), mustChange: true }),
  putCredential: async () => undefined,
};
/** Only the failure path is exercised here, so the signing key is never reached. */
const keys = { active: async () => ({ kid: 'kid', key: {} }) };

async function authorizeAs(store: unknown, accept: string | undefined, extra: Record<string, unknown> = {}) {
  const service = new LocalIdentityService(store as never, keys as never, options);
  const controller = new LocalIdentityController({ localIdentity: service, adminOrigin: ADMIN_ORIGIN } as never);
  const redirects: { code: number; url: string }[] = [];
  const response = { redirect: (code: number, url: string) => redirects.push({ code, url }) };
  try {
    await controller.authorize({ ...submission, ...extra }, response, accept);
    return { redirect: redirects[0], thrown: undefined };
  } catch (error) { return { redirect: redirects[0], thrown: error }; }
}

const discovery = (authorizationEndpoint: string) => ({
  issuer: ISSUER, authorization_endpoint: authorizationEndpoint, token_endpoint: `${ISSUER}/token`,
  jwks_uri: `${ISSUER}/jwks`, response_types_supported: ['code'], code_challenge_methods_supported: ['S256'],
});

const oidcConfig = {
  issuer: ISSUER, audience: AUDIENCE, webClientId: 'zhinexus-web', cliClientId: 'zhinexus-cli',
  webRedirectUri: REDIRECT_URI, cliRedirectUri: 'http://127.0.0.1:18923/callback',
  roleClaim: 'roles', roleMapping: { reader: 'reader', publisher: 'publisher', maintainer: 'maintainer' },
};

function oidc(document: unknown, adminLogin?: { authorizationEndpoint: string; loginUrl: string }, database: unknown = { query: async () => ({ rows: [] }) }) {
  const settings = { options: { outbound: [], initialOidc: oidcConfig }, galleryOrigin: 'https://gallery.example.com', adminOrigin: ADMIN_ORIGIN, current: async () => ({ generation: '0' }) };
  const instance = new CompanyOidc(database as never, settings as never, {} as never, undefined, undefined, adminLogin);
  // The discovery document is the only thing `start` takes off the network, and its
  // `authorization_endpoint` is the input to the decision under test. The rest of `metadata()` is
  // the deployment allow-list and JWKS validation, which belongs to its own tests, so the document
  // is handed straight over instead of being fetched through a stubbed `RestrictedHttps`.
  const metadata = { metadata: document, keys: undefined };
  (instance as unknown as { metadata: () => Promise<typeof metadata> }).metadata = async () => metadata;
  return instance;
}

const REASON_CASES: ReadonlyArray<{ error: PlatformError; reason: string }> = [
  { error: new PlatformError('UNAUTHENTICATED', [{ code: 'INVALID_SCHEMA', path: 'username', message: 'x' }]), reason: 'credentials' },
  { error: new PlatformError('UNAUTHENTICATED', [{ code: 'INVALID_SCHEMA', path: 'newPassword', message: 'x' }]), reason: 'first-login' },
  { error: new PlatformError('FORBIDDEN', [{ code: 'INVALID_SCHEMA', path: 'username', message: 'x' }]), reason: 'disabled' },
  { error: new PlatformError('INVALID_SCHEMA'), reason: 'invalid-request' },
  { error: new PlatformError('INFRA_UNAVAILABLE'), reason: 'unavailable' },
];

it('advertises separate self-managed CLI password and browser form endpoints', async () => {
  const metadata = await oidc(discovery(ISSUER + '/authorize'), { authorizationEndpoint: ISSUER + '/authorize', loginUrl: ADMIN_ORIGIN + '/login' }).cliMetadata();
  expect(metadata).toMatchObject({ passwordLoginEndpoint: ISSUER + '/login', browserAuthorizationEndpoint: ADMIN_ORIGIN + '/login', tokenEndpoint: ISSUER + '/token' });
});

it('retains a CLI loopback callback when a browser password submission fails', () => {
  const value = loginFailureUrl(ADMIN_ORIGIN, { ...submission, nonce: '', client_id: 'zhinexus-cli', redirect_uri: 'http://127.0.0.1:18923/callback' }, 'credentials');
  expect(new URL(value).searchParams.get('redirect_uri')).toBe('http://127.0.0.1:18923/callback');
});

/** Fields the login page may echo, and a value the identity service would reject for each. */
const REJECTED_FIELDS: ReadonlyArray<{ field: string; value: string }> = [
  { field: 'client_id', value: 'not a client id' },
  { field: 'redirect_uri', value: 'http://api.example.com/v1/auth/oidc/callback' },
  { field: 'redirect_uri', value: 'https://api.example.com/v1/auth/oidc/callback?next=https://evil.example.com' },
  { field: 'redirect_uri', value: 'https://user:secret@api.example.com/v1/auth/oidc/callback' },
  { field: 'redirect_uri', value: 'https://api.example.com/' },
  { field: 'state', value: 'short' },
  { field: 'code_challenge', value: 'tooshort' },
  { field: 'nonce', value: 'tooshort' },
  { field: 'username', value: 'not a username' },
];

describe('登录失败回跳的取值与 URL', () => {
  for (const { error, reason } of REASON_CASES) {
    it(`把 ${error.code} 映射成登录页能渲染的 ${reason}`, () => {
      expect(loginFailureReason(error)).toBe(reason);
    });
  }

  it('按浏览器表单导航区分客户端，fetch 与 CLI 不算', () => {
    expect(isBrowserForm(BROWSER_ACCEPT)).toBe(true);
    expect(isBrowserForm('*/*')).toBe(false);
    expect(isBrowserForm(undefined)).toBe(false);
  });

  it('回跳 URL 只带回授权参数、规范化用户名与 reason', () => {
    const url = new URL(loginFailureUrl(ADMIN_ORIGIN, submission, 'credentials'));
    expect(url.origin + url.pathname).toBe(`${ADMIN_ORIGIN}/login`);
    expect(url.searchParams.get('client_id')).toBe('zhinexus-web');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(url.searchParams.get('state')).toBe('s'.repeat(43));
    expect(url.searchParams.get('code_challenge')).toBe('c'.repeat(43));
    expect(url.searchParams.get('nonce')).toBe('n'.repeat(43));
    expect(url.searchParams.get('username')).toBe('lin.wei');
    expect(url.searchParams.get('reason')).toBe('credentials');
    expect(url.href).not.toContain('password');
    expect(url.href).not.toContain('temporary-pass-123');
  });

  for (const { field, value } of REJECTED_FIELDS) {
    it(`丢掉畸形字段 ${field}，不把请求内容拼进 URL`, () => {
      const url = new URL(loginFailureUrl(ADMIN_ORIGIN, { ...submission, [field]: value }, 'invalid-request'));
      expect(url.searchParams.has(field), value).toBe(false);
      expect(url.searchParams.get('reason')).toBe('invalid-request');
      expect(url.href).not.toContain('evil.example.com');
      expect(url.href).not.toContain('secret');
    });
  }
});

describe('授权端点对表单失败的回跳', () => {
  it('浏览器表单被拒时 303 回登录页，并带上 reason 与用户名', async () => {
    const { redirect, thrown } = await authorizeAs(emptyStore, BROWSER_ACCEPT);
    expect(thrown).toBeUndefined();
    expect(redirect?.code).toBe(303);
    const url = new URL(redirect!.url);
    expect(url.origin + url.pathname).toBe(`${ADMIN_ORIGIN}/login`);
    expect(url.searchParams.get('reason')).toBe('credentials');
    expect(url.searchParams.get('username')).toBe('lin.wei');
    expect(url.href).not.toContain('temporary-pass-123');
  });

  it('首次登录未带新密码时回跳 reason=first-login，仍不出现任何口令', async () => {
    const { redirect, thrown } = await authorizeAs(firstLoginStore, BROWSER_ACCEPT);
    expect(thrown).toBeUndefined();
    expect(new URL(redirect!.url).searchParams.get('reason')).toBe('first-login');
    expect(redirect!.url).not.toContain('temporary-pass-123');
  });

  it('非浏览器客户端照旧收到 JSON 错误，不发生跳转', async () => {
    for (const accept of [undefined, '*/*', 'application/json']) {
      const { redirect, thrown } = await authorizeAs(emptyStore, accept);
      expect(redirect).toBeUndefined();
      expect(thrown).toBeInstanceOf(PlatformError);
      expect((thrown as PlatformError).code).toBe('UNAUTHENTICATED');
    }
  });
});

describe('网页登录把浏览器送到后台登录页', () => {
  const local = { authorizationEndpoint: `${ISSUER}/authorize`, loginUrl: `${ADMIN_ORIGIN}/login` };

  it('本地身份模式下 target=admin 落到登录页，并带上同一组 OIDC 参数', async () => {
    const result = await oidc(discovery(`${ISSUER}/authorize`), local).start(undefined, undefined, 'admin');
    const url = new URL(result.location);
    expect(url.origin + url.pathname).toBe(`${ADMIN_ORIGIN}/login`);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('zhinexus-web');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(url.searchParams.get('scope')).toBe('openid');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.cookie.startsWith('__Host-oidc=')).toBe(true);
  });

  it('本地画廊登录同样经过账号表单，避免停留在 JSON 授权描述页', async () => {
    const result = await oidc(discovery(`${ISSUER}/authorize`), local).start(undefined, undefined, 'gallery');
    expect(new URL(result.location).origin + new URL(result.location).pathname).toBe(`${ADMIN_ORIGIN}/login`);
  });

  it('公司 issuer 的部署与没有本地身份的部署保持原样', async () => {
    const company = discovery('https://id.example.com/realms/zhinexus/protocol/openid-connect/auth');
    expect((await oidc(company, local).start(undefined, undefined, 'admin')).location.startsWith('https://id.example.com/realms/zhinexus/protocol/openid-connect/auth?')).toBe(true);
    expect((await oidc(discovery(`${ISSUER}/authorize`)).start(undefined, undefined, 'admin')).location.startsWith(`${ISSUER}/authorize?`)).toBe(true);
  });

  it('候选配置的网页验证同样落到登录页', async () => {
    const candidateDatabase = { query: async () => ({ rows: [{ config: oidcConfig }] }) };
    const result = await oidc(discovery(`${ISSUER}/authorize`), local, candidateDatabase).start('revision-1', '0');
    expect(new URL(result.location).origin + new URL(result.location).pathname).toBe(`${ADMIN_ORIGIN}/login`);
  });
});
