import { createHash, timingSafeEqual } from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair, jwtVerify, createLocalJWKSet, type CryptoKey } from 'jose';
import { AuthFailure, type Principal } from '../../auth/oidc.js';
import { PlatformError } from '../../errors.js';

export type DevAdminConfig = { username: string; password: string };

const DEV_ADMIN_ISSUER = 'http://127.0.0.1:3000/identity';
const DEV_ADMIN_AUDIENCE = 'zhinexus-admin';
const DEV_ADMIN_ROLES = ['reader', 'publisher', 'maintainer'] as const;
const DEV_ADMIN_TOKEN_SECONDS = 3600;

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Local-development-only default administrator sign-in.
 * Never enabled when NODE_ENV=production or when real OIDC / access settings are configured.
 */
export class DevAdminAuth {
  readonly subject: string;
  private keysPromise?: Promise<{ privateKey: CryptoKey; jwks: ReturnType<typeof createLocalJWKSet> }>;

  constructor(private readonly config: DevAdminConfig) {
    this.subject = config.username.trim().toLowerCase();
  }

  private keys() {
    if (!this.keysPromise) {
      this.keysPromise = (async () => {
        const pair = await generateKeyPair('ES256');
        const pub = await exportJWK(pair.publicKey);
        return {
          privateKey: pair.privateKey,
          jwks: createLocalJWKSet({ keys: [{ ...pub, alg: 'ES256', kid: 'dev-admin-key', use: 'sig' }] }),
        };
      })();
    }
    return this.keysPromise;
  }

  async login(username: unknown, password: unknown): Promise<{ access_token: string; token_type: 'Bearer'; expires_in: number; scope: string }> {
    const normalized = typeof username === 'string' ? username.trim().toLowerCase() : '';
    const secret = typeof password === 'string' ? password : '';
    const userOk = safeEqual(normalized, this.subject);
    const passOk = safeEqual(secret, this.config.password);
    if (!userOk || !passOk) {
      throw new PlatformError('UNAUTHENTICATED', [{ code: 'INVALID_SCHEMA', path: 'username', message: '用户名或密码不正确' }]);
    }
    const { privateKey } = await this.keys();
    const now = Math.floor(Date.now() / 1000);
    const accessToken = await new SignJWT({
      roles: [...DEV_ADMIN_ROLES],
      azp: 'zhinexus-web',
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'dev-admin-key' })
      .setSubject(this.subject)
      .setIssuer(DEV_ADMIN_ISSUER)
      .setAudience(DEV_ADMIN_AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + DEV_ADMIN_TOKEN_SECONDS)
      .sign(privateKey);
    return { access_token: accessToken, token_type: 'Bearer', expires_in: DEV_ADMIN_TOKEN_SECONDS, scope: 'openid' };
  }

  async verify(authorization: string | undefined): Promise<Principal> {
    if (!authorization?.startsWith('Bearer ')) throw new AuthFailure('UNAUTHENTICATED');
    const token = authorization.slice(7).trim();
    if (!token) throw new AuthFailure('UNAUTHENTICATED');
    try {
      const { jwks } = await this.keys();
      const { payload } = await jwtVerify(token, jwks, {
        issuer: DEV_ADMIN_ISSUER,
        audience: DEV_ADMIN_AUDIENCE,
        algorithms: ['ES256'],
      });
      if (payload.sub !== this.subject) throw new AuthFailure('UNAUTHENTICATED');
      return {
        subject: this.subject,
        identitySubject: this.subject,
        issuer: DEV_ADMIN_ISSUER,
        roles: [...DEV_ADMIN_ROLES],
        channel: 'web',
        clientId: 'zhinexus-web',
      };
    } catch {
      throw new AuthFailure('UNAUTHENTICATED');
    }
  }
}
