import { createHash, randomBytes } from 'node:crypto';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import type { AccessChecks, OidcAccessConfig } from '@company/contracts';
import { OidcVerifier, AuthFailure, type Principal } from '../auth/oidc.js';
import type { Database } from '../db/database.js';
import { PlatformError } from '../errors.js';
import type { AccessSettingsService } from './service.js';
import { RestrictedHttps } from './outbound.js';

export const digest = (value:string) => createHash('sha256').update(value).digest('hex');
type Discovery = { issuer:string; authorization_endpoint:string; token_endpoint:string; jwks_uri:string; response_types_supported:string[]; code_challenge_methods_supported:string[] };
const record = (value:unknown): value is Record<string,unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export class CompanyOidc {
  readonly network: RestrictedHttps;
  constructor(private readonly db:Database, private readonly settings:AccessSettingsService, private readonly fallback:OidcVerifier) {
    this.network = new RestrictedHttps(settings.options.outbound,settings.options.ca);
  }
  async metadata(config:OidcAccessConfig): Promise<{ metadata:Discovery; keys:ReturnType<typeof createLocalJWKSet> }> {
    const raw = await this.network.json(config.issuer.replace(/\/$/,'')+'/.well-known/openid-configuration');
    if (!record(raw) || raw.issuer !== config.issuer || !Array.isArray(raw.response_types_supported) || !raw.response_types_supported.includes('code') || !Array.isArray(raw.code_challenge_methods_supported) || !raw.code_challenge_methods_supported.includes('S256')) throw new AuthFailure('UNAUTHENTICATED');
    for (const key of ['authorization_endpoint','token_endpoint','jwks_uri']) {
      if (typeof raw[key] !== 'string') throw new AuthFailure('UNAUTHENTICATED');
      const url = new URL(raw[key]);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.href !== raw[key] || !this.settings.options.outbound.some(rule => rule.hostname === url.hostname && rule.port === Number(url.port || 443))) throw new AuthFailure('UNAUTHENTICATED');
    }
    const keys = await this.network.json(raw.jwks_uri as string);
    if (!record(keys) || !Array.isArray(keys.keys) || !keys.keys.length || keys.keys.length > 32 || keys.keys.some(k => !record(k) || 'd' in k || 'k' in k)) throw new AuthFailure('UNAUTHENTICATED');
    return { metadata:raw as unknown as Discovery,keys:createLocalJWKSet(keys as unknown as JSONWebKeySet) };
  }
  async probe(config:OidcAccessConfig): Promise<AccessChecks> {
    try { await this.metadata(config); return { discovery:'passed',secret:!config.secretRef || this.secret(config.secretRef) ? 'passed' : 'failed' }; }
    catch { return { discovery:'failed',secret:!config.secretRef || this.secret(config.secretRef) ? 'passed' : 'failed' }; }
  }
  private secret(reference:string): string | undefined {
    // Only an explicitly namespaced deployment reference can resolve a secret.
    return /^[A-Z][A-Z0-9_]{0,63}$/.test(reference) ? process.env['PLATFORM_OIDC_SECRET_'+reference] : undefined;
  }
  async verifier(config:OidcAccessConfig): Promise<OidcVerifier> {
    const { metadata,keys } = await this.metadata(config);
    return new OidcVerifier({ issuer:config.issuer,audience:config.audience,jwksUri:metadata.jwks_uri,webClientIds:[config.webClientId],cliClientIds:[config.cliClientId],roleClaim:config.roleClaim,roleMapping:config.roleMapping },keys);
  }
  async restricted(principal:Principal): Promise<Principal> {
    if ((await this.db.query('SELECT 1 FROM disabled_subjects WHERE subject=$1',[principal.subject])).rowCount) throw new AuthFailure('FORBIDDEN');
    const denied = (await this.db.query('SELECT role FROM subject_role_restrictions WHERE subject=$1',[principal.subject])).rows.map(r => r.role);
    return { ...principal,roles:principal.roles.filter(role => !denied.includes(role)) };
  }
  async authenticate(authorization:string | undefined): Promise<Principal> {
    const active = await this.settings.current('oidc');
    if (authorization?.startsWith('Session ')) {
      const token = authorization.slice(8);
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AuthFailure('UNAUTHENTICATED');
      const row = (await this.db.query('SELECT * FROM oidc_sessions WHERE token_hash=$1 AND generation=$2 AND expires_at>clock_timestamp()',[digest(token),active.generation])).rows[0];
      if (!row || row.issuer !== (active.revision?.config ?? this.settings.options.initialOidc)?.issuer) throw new AuthFailure('UNAUTHENTICATED');
      return this.restricted(row.principal);
    }
    if (!active.revision) return this.restricted(await this.fallback.verify(authorization));
    const principal = await (await this.verifier(active.revision.config)).verify(authorization);
    const binding = (await this.db.query('SELECT platform_subject FROM identity_bindings WHERE issuer=$1 AND identity_subject=$2',[principal.issuer,principal.identitySubject])).rows[0];
    return this.restricted({ ...principal,subject:binding?.platform_subject ?? 'oidc:'+digest(principal.issuer+'\0'+principal.identitySubject),generation:active.generation });
  }
  async start(candidate?:string): Promise<{ location:string; cookie:string }> {
    const active = await this.settings.current('oidc');
    const revision = candidate ? (await this.db.query('SELECT config FROM access_revisions WHERE id=$1 AND section=$2',[candidate,'oidc'])).rows[0] : undefined;
    const config:OidcAccessConfig | undefined = candidate ? revision?.config : active.revision?.config ?? this.settings.options.initialOidc;
    if (!config) throw new PlatformError('INFRA_UNAVAILABLE');
    const { metadata } = await this.metadata(config);
    const state = randomBytes(32).toString('base64url'), browser = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
    await this.db.query(`INSERT INTO oidc_attempts(state_hash,browser_hash,revision,generation,candidate,verifier,nonce,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+interval '5 minutes')`,[digest(state),digest(browser),candidate ?? active.revision?.id ?? null,active.generation,!!candidate,verifier,nonce]);
    const url = new URL(metadata.authorization_endpoint);
    url.search = new URLSearchParams({ response_type:'code',client_id:config.webClientId,redirect_uri:config.webRedirectUri,scope:['openid',...(config.scopes ?? [])].join(' '),state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256' }).toString();
    return { location:url.href,cookie:`__Host-oidc=${browser}; Path=/; Max-Age=300; Secure; HttpOnly; SameSite=Lax` };
  }
  async callback(state:string,code:string,browser:string): Promise<{ location:string; cookie?:string }> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(browser) || !code || code.length > 4096 || /[\u0000-\u001f\u007f]/u.test(code)) throw new AuthFailure('UNAUTHENTICATED');
    const active = await this.settings.current('oidc');
    const attempt = (await this.db.query(`UPDATE oidc_attempts SET consumed_at=clock_timestamp() WHERE state_hash=$1 AND browser_hash=$2 AND consumed_at IS NULL AND expires_at>clock_timestamp() AND generation=$3 RETURNING *`,[digest(state),digest(browser),active.generation])).rows[0];
    if (!attempt) throw new AuthFailure('UNAUTHENTICATED');
    try {
      const config:OidcAccessConfig = attempt.revision ? (await this.db.query('SELECT config FROM access_revisions WHERE id=$1',[attempt.revision])).rows[0]?.config : this.settings.options.initialOidc;
      if (!config || config.webRedirectUri !== this.settings.options.apiOrigin+'/v1/auth/oidc/callback') throw new AuthFailure('UNAUTHENTICATED');
      const { metadata,keys } = await this.metadata(config);
      const secret = config.secretRef ? this.secret(config.secretRef) : undefined;
      if (config.secretRef && !secret) throw new AuthFailure('UNAUTHENTICATED');
      const form = new URLSearchParams({ grant_type:'authorization_code',code,client_id:config.webClientId,redirect_uri:config.webRedirectUri,code_verifier:attempt.verifier,...(secret ? {client_secret:secret} : {}) });
      const tokens = await this.network.json(metadata.token_endpoint,form);
      if (!record(tokens) || typeof tokens.id_token !== 'string' || typeof tokens.access_token !== 'string' || tokens.token_type !== 'Bearer') throw new AuthFailure('UNAUTHENTICATED');
      const { payload } = await jwtVerify(tokens.id_token,keys,{ issuer:config.issuer,audience:config.webClientId,algorithms:['RS256','ES256'],requiredClaims:['exp','iat','sub','nonce'] });
      if (payload.nonce !== attempt.nonce || (payload.azp !== undefined && payload.azp !== config.webClientId) || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== config.webClientId) || typeof payload.iat !== 'number' || payload.iat > Math.floor(Date.now()/1000)) throw new AuthFailure('UNAUTHENTICATED');
      const principal = await (await this.verifier(config)).verify('Bearer '+tokens.access_token);
      if (principal.identitySubject !== payload.sub || principal.channel !== 'web') throw new AuthFailure('UNAUTHENTICATED');
      const bound = { ...principal,subject:(await this.db.query('SELECT platform_subject FROM identity_bindings WHERE issuer=$1 AND identity_subject=$2',[principal.issuer,principal.identitySubject])).rows[0]?.platform_subject ?? 'oidc:'+digest(principal.issuer+'\0'+principal.identitySubject),generation:active.generation };
      await this.restricted(bound);
      const isAdmin = this.settings.options.administrators.some(a => a.issuer === principal.issuer && a.subject === principal.identitySubject);
      if (attempt.candidate) {
        await this.settings.evidence(attempt.revision,active.generation,{webLogin:'passed',roles:principal.roles.length ? 'passed' : 'failed',...(isAdmin ? {adminLogin:'passed'} : {})});
        return { location:this.settings.galleryOrigin+'/access-settings?candidate=passed' };
      }
      const accessPayload = (await jwtVerify(tokens.access_token,keys,{ issuer:config.issuer,audience:config.audience,algorithms:['RS256','ES256'] })).payload;
      const token = randomBytes(32).toString('base64url');
      await this.db.transaction(async sql => {
        const current = await this.settings.current('oidc',sql,true);
        if (current.generation !== active.generation) throw new AuthFailure('UNAUTHENTICATED');
        await sql.query('INSERT INTO oidc_sessions(token_hash,generation,issuer,identity_subject,principal,expires_at) VALUES ($1,$2,$3,$4,$5,to_timestamp($6))',[digest(token),active.generation,principal.issuer,principal.identitySubject,JSON.stringify(bound),Math.min(accessPayload.exp!,payload.exp!)]);
      });
      return { location:this.settings.galleryOrigin+'/upload',cookie:`__Host-platform=${token}; Path=/; Max-Age=300; Secure; HttpOnly; SameSite=None` };
    } catch { throw new AuthFailure('UNAUTHENTICATED'); }
  }
  async candidateCli(input:unknown): Promise<{ passed:true }> {
    if (!record(input) || Object.keys(input).sort().join(',') !== 'accessToken,expectedGeneration,revision' || typeof input.revision !== 'string' || typeof input.expectedGeneration !== 'string' || typeof input.accessToken !== 'string' || input.accessToken.length > 16384) throw new PlatformError('INVALID_SCHEMA');
    const config = (await this.db.query('SELECT config FROM access_revisions WHERE id=$1 AND section=$2',[input.revision,'oidc'])).rows[0]?.config as OidcAccessConfig | undefined;
    if (!config) throw new PlatformError('NOT_FOUND');
    const principal = await (await this.verifier(config)).verify('Bearer '+input.accessToken);
    if (principal.channel !== 'cli') throw new AuthFailure('UNAUTHENTICATED');
    const bound = { ...principal,subject:'oidc:'+digest(principal.issuer+'\0'+principal.identitySubject) };
    await this.restricted(bound);
    await this.settings.evidence(input.revision,input.expectedGeneration,{cliLogin:'passed',roles:principal.roles.length ? 'passed' : 'failed'});
    return { passed:true };
  }
  async cliMetadata(candidate?:string) {
    const active = await this.settings.current('oidc');
    const config = (candidate ? (await this.db.query('SELECT config FROM access_revisions WHERE id=$1 AND section=$2',[candidate,'oidc'])).rows[0]?.config : active.revision?.config ?? this.settings.options.initialOidc) as OidcAccessConfig | undefined;
    if (!config) throw new PlatformError('INFRA_UNAVAILABLE');
    const { metadata } = await this.metadata(config);
    return { issuer:config.issuer,audience:config.audience,clientId:config.cliClientId,redirectUri:config.cliRedirectUri,authorizationEndpoint:metadata.authorization_endpoint,tokenEndpoint:metadata.token_endpoint,scopes:config.scopes ?? [],generation:active.generation };
  }
}
