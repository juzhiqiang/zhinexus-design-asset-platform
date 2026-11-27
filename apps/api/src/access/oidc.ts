import { createHash, randomBytes } from 'node:crypto';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { validateOidcCandidateStart,type AccessChecks,type OidcAccessConfig } from '@company/contracts';
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
  /**
   * `adminLogin` is present only when the platform issues its own tokens, and pairs the
   * authorization endpoint the local identity service publishes with the admin page that renders
   * the credential form. `start` compares the endpoint it is about to send a browser to against
   * the first half, so a deployment whose web login points at a company issuer is untouched.
   * The form is used for both gallery and admin; web_target fixes the destination after login.
   */
  constructor(private readonly db:Database, private readonly settings:AccessSettingsService, private readonly fallback:OidcVerifier, resolveAddress?:(hostname:string)=>Promise<{address:string;family:number}[]>, private readonly accounts?:import('../accounts/service.js').ManagedAccountsService, private readonly adminLogin?:{authorizationEndpoint:string;loginUrl:string}, private readonly developmentIdentity?:import('../identity/local/service.js').LocalIdentityService) {
    this.network = new RestrictedHttps(settings.options.outbound,settings.options.ca,resolveAddress);
  }
  async metadata(config:OidcAccessConfig): Promise<{ metadata:Discovery; keys:ReturnType<typeof createLocalJWKSet> }> {
    if (this.developmentIdentity && this.developmentIdentity.discovery().issuer === config.issuer) {
      return { metadata: this.developmentIdentity.discovery() as Discovery, keys: createLocalJWKSet(await this.developmentIdentity.jwks() as JSONWebKeySet) };
    }
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
    return new OidcVerifier({ issuer:config.issuer,audience:config.audience,jwksUri:metadata.jwks_uri,webClientIds:[config.webClientId],cliClientIds:[config.cliClientId],roleClaim:config.roleClaim,roleMapping:config.roleMapping },keys, Boolean(this.developmentIdentity && this.developmentIdentity.discovery().issuer === config.issuer));
  }
  get attemptCookieName(): string { return this.developmentIdentity ? 'zhinexus-dev-oidc' : '__Host-oidc'; }
  cookie(name: 'attempt' | 'session', value: string, maxAge: number): string {
    const cookieName = name === 'attempt' ? this.attemptCookieName : this.developmentIdentity ? 'zhinexus-dev-platform' : '__Host-platform';
    return `${cookieName}=${value}; Path=/; Max-Age=${maxAge}; ${this.developmentIdentity ? '' : 'Secure; '}HttpOnly; SameSite=${name === 'session' && !this.developmentIdentity ? 'None' : 'Lax'}`;
  }
  async restricted(principal:Principal): Promise<Principal> {
    if ((await this.db.query('SELECT 1 FROM disabled_subjects WHERE subject=$1',[principal.subject])).rowCount) throw new AuthFailure('FORBIDDEN');
    const denied = (await this.db.query('SELECT role FROM subject_role_restrictions WHERE subject=$1',[principal.subject])).rows.map(r => r.role);
    return { ...principal,roles:principal.roles.filter(role => !denied.includes(role)) };
  }
  async authenticate(authorization:string | undefined): Promise<Principal> {
    const active = await this.settings.current('oidc');
    const finish = async (principal:Principal) => {
      const restricted=await this.restricted(principal);
      if ((await this.settings.current('oidc')).generation!==active.generation) throw new AuthFailure('UNAUTHENTICATED');
      return restricted;
    };
    if (authorization?.startsWith('Session ')) {
      const token = authorization.slice(8);
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AuthFailure('UNAUTHENTICATED');
      const row = (await this.db.query('SELECT * FROM oidc_sessions WHERE token_hash=$1 AND generation=$2 AND expires_at>clock_timestamp()',[digest(token),active.generation])).rows[0];
      if (!row || row.issuer !== (active.revision?.config ?? this.settings.options.initialOidc)?.issuer) throw new AuthFailure('UNAUTHENTICATED');
      // A self-managed session must still belong to an enabled account at the version it was issued for.
      if (this.accounts && row.issuer === this.accounts.selfManagedIssuer) {
        const account = await this.accounts.sessionAccount(this.db,row.principal.subject);
        if (!account) throw new AuthFailure('UNAUTHENTICATED');
        if (!account.enabled) throw new AuthFailure('FORBIDDEN');
        if (row.account_version === null || row.auth_time === null || String(row.account_version) !== account.version || Number(row.auth_time) <= Number(account.auth_time_floor)) throw new AuthFailure('UNAUTHENTICATED');
        return finish({ ...row.principal,roles:account.roles,generation:active.generation });
      }
      return finish(row.principal);
    }
    if (!active.revision) {
      // No activated configuration does not relax the self-managed claim checks.
      const initial = await this.fallback.verifyWithClaims(authorization);
      if (this.accounts && initial.principal.issuer === this.accounts.selfManagedIssuer) {
        const account = await this.accounts.verifiedAccount(initial.principal, initial.claims);
        return finish({ ...initial.principal,subject:account.platform_subject,roles:account.roles,generation:active.generation });
      }
      return finish({ ...initial.principal,generation:active.generation });
    }
    const verified = await (await this.verifier(active.revision.config)).verifyWithClaims(authorization);
    const binding = (await this.db.query('SELECT platform_subject FROM identity_bindings WHERE issuer=$1 AND identity_subject=$2',[verified.principal.issuer,verified.principal.identitySubject])).rows[0];
    // Self-managed subjects fail closed: unregistered principals are denied, and the signed
    // account version plus authentication time must still be current.
    if (this.accounts && verified.principal.issuer === this.accounts.selfManagedIssuer) {
      const account = await this.accounts.verifiedAccount(verified.principal, verified.claims);
      return finish({ ...verified.principal,subject:account.platform_subject,roles:account.roles,generation:active.generation });
    }
    return finish({ ...verified.principal,subject:binding?.platform_subject ?? 'oidc:'+digest(verified.principal.issuer+'\0'+verified.principal.identitySubject),generation:active.generation });
  }
  async candidateTicket(input:unknown,principal:Principal):Promise<{ticket:string}> {
    const parsed=validateOidcCandidateStart(input);
    if (!parsed.ok) throw new PlatformError('INVALID_SCHEMA');
    const revision=parsed.value.revision;
    const ticket=randomBytes(32).toString('base64url');
    await this.db.transaction(async sql=>{
      const active=await this.settings.current('oidc',sql,true);
      this.settings.administrator({principal,requestId:'candidate-start'});
      if (principal.generation!==active.generation || (await sql.query('SELECT 1 FROM disabled_subjects WHERE subject=$1',[principal.subject])).rowCount) throw new AuthFailure('UNAUTHENTICATED');
      if (!(await sql.query("SELECT 1 FROM access_revisions r LEFT JOIN access_active a ON a.section=r.section WHERE r.id=$1 AND r.section='oidc' AND (a.draft_revision_id=r.id OR EXISTS(SELECT 1 FROM access_activations x WHERE x.revision=r.id))",[revision])).rowCount) throw new PlatformError('NOT_FOUND');
      await sql.query(`INSERT INTO oidc_start_tickets(token_hash,revision,generation,subject,issuer,identity_subject,expires_at) VALUES ($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '60 seconds')`,[digest(ticket),revision,active.generation,principal.subject,principal.issuer,principal.identitySubject ?? principal.subject]);
    });
    return{ticket};
  }
  async consumeCandidate(ticket:string):Promise<{location:string;cookie:string}> {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(ticket)) throw new AuthFailure('UNAUTHENTICATED');
    const active=await this.settings.current('oidc');
    const row=(await this.db.query(`UPDATE oidc_start_tickets t SET consumed_at=clock_timestamp() WHERE token_hash=$1 AND generation=$2 AND consumed_at IS NULL AND expires_at>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM disabled_subjects d WHERE d.subject=t.subject) RETURNING *`,[digest(ticket),active.generation])).rows[0];
    if (!row || !this.settings.options.administrators.some(a=>a.issuer===row.issuer && a.subject===row.identity_subject)) throw new AuthFailure('UNAUTHENTICATED');
    return this.start(row.revision,active.generation);
  }
  async start(candidate?:string,expectedGeneration?:string,target:'gallery'|'admin'='gallery'): Promise<{ location:string; cookie:string }> {
    if (target !== 'gallery' && target !== 'admin') throw new PlatformError('INVALID_SCHEMA');
    const webTarget = candidate ? 'admin' : target;
    if (webTarget === 'gallery' && !this.settings.galleryOrigin) throw new PlatformError('INFRA_UNAVAILABLE');
    const active = await this.settings.current('oidc');
    if (expectedGeneration!==undefined && active.generation!==expectedGeneration) throw new AuthFailure('UNAUTHENTICATED');
    const revision = candidate ? (await this.db.query('SELECT config FROM access_revisions WHERE id=$1 AND section=$2',[candidate,'oidc'])).rows[0] : undefined;
    const config:OidcAccessConfig | undefined = candidate ? revision?.config : active.revision?.config ?? this.settings.options.initialOidc;
    if (!config) throw new PlatformError('INFRA_UNAVAILABLE');
    const { metadata } = await this.metadata(config);
    const state = randomBytes(32).toString('base64url'), browser = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
    await this.db.query(`INSERT INTO oidc_attempts(state_hash,browser_hash,revision,generation,candidate,verifier,nonce,web_target,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()+interval '5 minutes')`,[digest(state),digest(browser),candidate ?? active.revision?.id ?? null,active.generation,!!candidate,verifier,nonce,webTarget]);
    // A browser that must sign in with platform-issued credentials is sent to the admin login page
    // instead: the local identity service answers a plain GET of its authorization endpoint with a
    // JSON descriptor, which no browser can act on. The page posts the credentials straight back to
    // that endpoint, so the redirect target only changes for the human, never for the protocol.
    const adminLogin = this.adminLogin;
    const url = new URL(adminLogin && metadata.authorization_endpoint === adminLogin.authorizationEndpoint ? adminLogin.loginUrl : metadata.authorization_endpoint);
    url.search = new URLSearchParams({ response_type:'code',client_id:config.webClientId,redirect_uri:config.webRedirectUri,scope:['openid',...(config.scopes ?? [])].join(' '),state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256' }).toString();
    return { location:url.href,cookie:this.cookie('attempt',browser,300) };
  }
  async callback(state:string,code:string,browser:string,responseIssuer?:string): Promise<{ location:string; cookie?:string }> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(browser) || !code || code.length > 4096 || /[\u0000-\u001f\u007f]/u.test(code)) throw new AuthFailure('UNAUTHENTICATED');
    const active = await this.settings.current('oidc');
    const attempt = (await this.db.query(`UPDATE oidc_attempts SET consumed_at=clock_timestamp() WHERE state_hash=$1 AND browser_hash=$2 AND consumed_at IS NULL AND expires_at>clock_timestamp() AND generation=$3 RETURNING *`,[digest(state),digest(browser),active.generation])).rows[0];
    if (!attempt || (attempt.web_target !== 'gallery' && attempt.web_target !== 'admin')) throw new AuthFailure('UNAUTHENTICATED');
    try {
      const config:OidcAccessConfig = attempt.revision ? (await this.db.query('SELECT config FROM access_revisions WHERE id=$1',[attempt.revision])).rows[0]?.config : this.settings.options.initialOidc;
      if (!config || config.webRedirectUri !== this.settings.options.apiOrigin+'/v1/auth/oidc/callback' || (responseIssuer !== undefined && responseIssuer !== config.issuer)) throw new AuthFailure('UNAUTHENTICATED');
      const { metadata,keys } = await this.metadata(config);
      const secret = config.secretRef ? this.secret(config.secretRef) : undefined;
      if (config.secretRef && !secret) throw new AuthFailure('UNAUTHENTICATED');
      const form = new URLSearchParams({ grant_type:'authorization_code',code,client_id:config.webClientId,redirect_uri:config.webRedirectUri,code_verifier:attempt.verifier,...(secret ? {client_secret:secret} : {}) });
      const tokens = this.developmentIdentity && this.developmentIdentity.discovery().token_endpoint === metadata.token_endpoint
        ? await this.developmentIdentity.token({ code, codeVerifier:attempt.verifier, clientId:config.webClientId, redirectUri:config.webRedirectUri })
        : await this.network.json(metadata.token_endpoint,form);
      if (!record(tokens) || typeof tokens.id_token !== 'string' || typeof tokens.access_token !== 'string' || tokens.token_type !== 'Bearer') throw new AuthFailure('UNAUTHENTICATED');
      const { payload } = await jwtVerify(tokens.id_token,keys,{ issuer:config.issuer,audience:config.webClientId,algorithms:['RS256','ES256'],requiredClaims:['exp','iat','sub','nonce'] });
      if (payload.nonce !== attempt.nonce || (payload.azp !== undefined && payload.azp !== config.webClientId) || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== config.webClientId) || typeof payload.iat !== 'number' || payload.iat > Math.floor(Date.now()/1000)) throw new AuthFailure('UNAUTHENTICATED');
      const principal = await (await this.verifier(config)).verify('Bearer '+tokens.access_token);
      if (principal.identitySubject !== payload.sub || principal.channel !== 'web') throw new AuthFailure('UNAUTHENTICATED');
      const accessPayload = (await jwtVerify(tokens.access_token,keys,{ issuer:config.issuer,audience:config.audience,algorithms:['RS256','ES256'] })).payload;
      // A self-managed login must satisfy the signed account version and authentication time too.
      const managed = this.accounts && principal.issuer === this.accounts.selfManagedIssuer
        ? await this.accounts.verifiedAccount(principal, accessPayload) : undefined;
      const bound = { ...principal,subject:managed?.platform_subject ?? (await this.db.query('SELECT platform_subject FROM identity_bindings WHERE issuer=$1 AND identity_subject=$2',[principal.issuer,principal.identitySubject])).rows[0]?.platform_subject ?? 'oidc:'+digest(principal.issuer+'\0'+principal.identitySubject),generation:active.generation };
      const effective=await this.restricted(managed ? { ...bound,roles:managed.roles } : bound);
      const isAdmin = managed ? managed.administrator : this.settings.options.administrators.some(a => a.issuer === principal.issuer && a.subject === principal.identitySubject);
      if (attempt.candidate) {
        await this.settings.evidence(attempt.revision,active.generation,{webLogin:'passed',roles:effective.roles.length ? 'passed' : 'failed',...(isAdmin ? {adminLogin:'passed'} : {})});
        return { location:this.settings.adminOrigin+'/access-settings?candidate=passed' };
      }
      const token = randomBytes(32).toString('base64url');
      const authTime = typeof accessPayload.auth_time === 'number' && Number.isFinite(accessPayload.auth_time) ? Math.floor(accessPayload.auth_time) : null;
      await this.db.transaction(async sql => {
        const current = await this.settings.current('oidc',sql,true);
        if (current.generation !== active.generation) throw new AuthFailure('UNAUTHENTICATED');
        await sql.query('INSERT INTO oidc_sessions(token_hash,generation,issuer,identity_subject,principal,expires_at,account_version,auth_time) VALUES ($1,$2,$3,$4,$5,to_timestamp($6),$7,$8)',[digest(token),active.generation,principal.issuer,principal.identitySubject,JSON.stringify(bound),Math.min(accessPayload.exp!,payload.exp!),managed ? Number(managed.version) : null,managed ? authTime : null]);
      });
      const location = attempt.web_target === 'admin' ? this.settings.adminOrigin+'/upload' : this.settings.galleryOrigin+'/library';
      const remaining = Math.max(0, Math.floor(Math.min(accessPayload.exp!, payload.exp!) - Date.now() / 1000));
      return { location,cookie:this.cookie('session',token,remaining) };
    } catch { throw new AuthFailure('UNAUTHENTICATED'); }
  }
  async candidateCli(input:unknown): Promise<{ passed:true }> {
    if (!record(input) || Object.keys(input).sort().join(',') !== 'accessToken,expectedGeneration,revision' || typeof input.revision !== 'string' || typeof input.expectedGeneration !== 'string' || typeof input.accessToken !== 'string' || input.accessToken.length > 16384) throw new PlatformError('INVALID_SCHEMA');
    const config = (await this.db.query('SELECT config FROM access_revisions WHERE id=$1 AND section=$2',[input.revision,'oidc'])).rows[0]?.config as OidcAccessConfig | undefined;
    if (!config) throw new PlatformError('NOT_FOUND');
    const verified = await (await this.verifier(config)).verifyWithClaims('Bearer '+input.accessToken);
    if (verified.principal.channel !== 'cli') throw new AuthFailure('UNAUTHENTICATED');
    const binding = (await this.db.query('SELECT platform_subject FROM identity_bindings WHERE issuer=$1 AND identity_subject=$2',[verified.principal.issuer,verified.principal.identitySubject])).rows[0];
    // CLI tokens are stateless: only the signed account version and authentication time can retire them.
    const managed = this.accounts && verified.principal.issuer === this.accounts.selfManagedIssuer
      ? await this.accounts.verifiedAccount(verified.principal, verified.claims) : undefined;
    const bound = { ...verified.principal,subject:managed?.platform_subject ?? binding?.platform_subject ?? 'oidc:'+digest(verified.principal.issuer+'\0'+verified.principal.identitySubject) };
    const effective=await this.restricted(managed ? { ...bound,roles:managed.roles } : bound);
    await this.settings.evidence(input.revision,input.expectedGeneration,{cliLogin:'passed',roles:effective.roles.length ? 'passed' : 'failed'});
    return { passed:true };
  }
  async cliMetadata(candidate?:string) {
    const active = await this.settings.current('oidc');
    const config = (candidate ? (await this.db.query('SELECT config FROM access_revisions WHERE id=$1 AND section=$2',[candidate,'oidc'])).rows[0]?.config : active.revision?.config ?? this.settings.options.initialOidc) as OidcAccessConfig | undefined;
    if (!config) throw new PlatformError('INFRA_UNAVAILABLE');
    const { metadata } = await this.metadata(config);
    const localLogin = this.adminLogin?.authorizationEndpoint === metadata.authorization_endpoint ? this.adminLogin : undefined;
    return { issuer:config.issuer,audience:config.audience,clientId:config.cliClientId,redirectUri:config.cliRedirectUri,authorizationEndpoint:metadata.authorization_endpoint,tokenEndpoint:metadata.token_endpoint,scopes:config.scopes ?? [],generation:active.generation,
      ...(localLogin ? { passwordLoginEndpoint: new URL('login', metadata.authorization_endpoint).href, browserAuthorizationEndpoint: localLogin.loginUrl } : {}) };
  }
}
