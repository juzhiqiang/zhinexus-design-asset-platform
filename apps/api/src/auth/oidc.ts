import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';

export type Principal = {
  subject: string;
  clientId: string;
  channel: 'cli' | 'web';
  roles: readonly ('reader' | 'publisher' | 'maintainer')[];
};
export type OidcConfig = {
  issuer: string;
  audience: string;
  jwksUri: string;
  webClientIds: string[];
  cliClientIds: string[];
};
export class AuthFailure extends Error {
  constructor(readonly code: 'UNAUTHENTICATED' | 'FORBIDDEN') {
    super(code === 'UNAUTHENTICATED' ? 'Authentication required' : 'Permission denied');
    this.name = 'AuthFailure';
  }
}
export class OidcVerifier {
  private readonly config: Pick<OidcConfig, 'issuer' | 'audience'> | undefined;
  private readonly keyResolver: JWTVerifyGetKey | undefined;
  private readonly webClients = new Set<string>();
  private readonly cliClients = new Set<string>();

  /** The optional key resolver is a programmatic seam, never a runtime bypass setting. */
  constructor(config?: OidcConfig, keyResolver?: JWTVerifyGetKey) {
    if (config === undefined) return;
    try {
      validateHttpsUrl(config.issuer);
      const jwksUrl = validateHttpsUrl(config.jwksUri);
      if (!isIdentifier(config.audience)) throw new AuthFailure('UNAUTHENTICATED');
      for (const [clients, destination] of [[config.webClientIds, this.webClients], [config.cliClientIds, this.cliClients]] as const) {
        if (!Array.isArray(clients) || clients.length === 0 || !clients.every(isIdentifier)) {
          throw new AuthFailure('UNAUTHENTICATED');
        }
        for (const client of clients) destination.add(client);
        if (destination.size !== clients.length) throw new AuthFailure('UNAUTHENTICATED');
      }
      if ([...this.webClients].some(client => this.cliClients.has(client))) throw new AuthFailure('UNAUTHENTICATED');
      this.config = { issuer: config.issuer, audience: config.audience };
      this.keyResolver = keyResolver ?? createRemoteJWKSet(jwksUrl, {
        timeoutDuration: 5_000,
        cooldownDuration: 30_000,
        cacheMaxAge: 5 * 60_000,
      });
    } catch {
      throw new AuthFailure('UNAUTHENTICATED');
    }
  }

  async verify(authorization?: string): Promise<Principal> {
    try {
      if (!this.config || !this.keyResolver || typeof authorization !== 'string') throw new AuthFailure('UNAUTHENTICATED');
      const token = /^Bearer +([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization)?.[1];
      if (!token) throw new AuthFailure('UNAUTHENTICATED');
      const { payload } = await jwtVerify(token, this.keyResolver, {
        algorithms: ['RS256', 'ES256'],
        issuer: this.config.issuer,
        audience: this.config.audience,
        requiredClaims: ['exp', 'sub', 'iat'],
        clockTolerance: 0,
      });
      if (typeof payload.sub !== 'string' || payload.sub.trim().length === 0
        || typeof payload.iat !== 'number' || !Number.isFinite(payload.iat)
        || payload.iat > Math.floor(Date.now() / 1000)
        || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)
        || (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf)))
        || (!isIdentifier(payload.aud) && (!Array.isArray(payload.aud) || !payload.aud.every(isIdentifier)))) {
        throw new AuthFailure('UNAUTHENTICATED');
      }
      // Both claims, when present, must identify the same trusted OAuth client.
      if ((payload.azp !== undefined && !isIdentifier(payload.azp))
        || (payload.client_id !== undefined && !isIdentifier(payload.client_id))
        || (payload.azp !== undefined && payload.client_id !== undefined && payload.azp !== payload.client_id)) {
        throw new AuthFailure('UNAUTHENTICATED');
      }
      const clientId = payload.azp ?? payload.client_id;
      if (!isIdentifier(clientId) || (!this.webClients.has(clientId) && !this.cliClients.has(clientId))) {
        throw new AuthFailure('UNAUTHENTICATED');
      }
      const roles = payload.roles ?? [];
      if (payload.roles === null || !Array.isArray(roles) || !roles.every(isRole)) throw new AuthFailure('UNAUTHENTICATED');
      return Object.freeze({
        subject: payload.sub, clientId, channel: this.webClients.has(clientId) ? 'web' : 'cli',
        roles: Object.freeze([...roles]),
      });
    } catch {
      // Never expose JWT contents, upstream errors, URLs or authentication config.
      throw new AuthFailure('UNAUTHENTICATED');
    }
  }
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/[\s\u0000-\u001f\u007f]/u.test(value);
}

function isRole(value: unknown): value is Principal['roles'][number] {
  return value === 'reader' || value === 'publisher' || value === 'maintainer';
}

function validateHttpsUrl(value: unknown): URL {
  if (!isIdentifier(value) || /[\\?#]/u.test(value) || /^https:\/\/[^/]*@/iu.test(value)) throw new AuthFailure('UNAUTHENTICATED');
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new AuthFailure('UNAUTHENTICATED');
  }
  return url;
}
