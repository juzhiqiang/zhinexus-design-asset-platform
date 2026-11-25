import { createLocalJWKSet,type JSONWebKeySet,type JWTVerifyGetKey } from 'jose';
import { OidcVerifier, AuthFailure, type OidcConfig, type Principal } from './auth/oidc.js';
import { requireRole } from './auth/roles.js';
import { Database } from './db/database.js';
import { audit, requireCurrentIdentity, type RequestContext } from './db/access.js';
import { ArtifactStore, type StorageConfig } from './storage/artifact-store.js';
import { UploadService } from './uploads/service.js';
import { PlatformError } from './errors.js';
import { previewConfigFromEnv, validatePreviewConfig, type PreviewConfig } from '@company/contracts/preview';
import { PlatformEvents } from './observability/events.js';
import { retentionPolicy, type RetentionPolicy } from './operations/retention.js';
import { AccessSettingsService, validateAccessOptions, type AccessOptions } from './access/service.js';
import { CompanyOidc } from './access/oidc.js';
import { readFileSync } from 'node:fs';
import { probePreview } from './access/preview.js';
import { RestrictedHttps } from './access/outbound.js';
import { ManagedAccountsService, type ManagedAccountsOptions } from './accounts/service.js';
import { KeycloakIdentityAdapter, type KeycloakOptions } from './identity/keycloak.js';
import type { IdentityAdapter } from './identity/adapter.js';
import { IdentityWorker } from './identity/worker.js';
import { LocalIdentityService, type LocalIdentityOptions } from './identity/local/service.js';
import { LocalIdentityStore } from './identity/local/store.js';
import { LocalSigningKeys } from './identity/local/keys.js';
import { LocalIdentityAdapter } from './identity/local/adapter.js';
import { CategoryService } from './categories/service.js';

export type PlatformOptions = { databaseUrl?: string; storage?: StorageConfig; oidc?: OidcConfig; keyResolver?: JWTVerifyGetKey; preview?: PreviewConfig; galleryOrigin?: string; adminOrigin?: string; events?: PlatformEvents; metricsToken?: string; retention?: RetentionPolicy; access?: AccessOptions;accessLookup?:(hostname:string)=>Promise<{address:string;family:number}[]>;managedAccounts?: ManagedAccountsOptions;identity?: KeycloakOptions;identityAdapter?: IdentityAdapter;localIdentity?: LocalIdentityOptions };
function validateWebOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new PlatformError('INVALID_SCHEMA'); }
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!localHttp && url.protocol !== 'https:') || url.username || url.password || url.hostname.includes('*') || value !== url.origin) throw new PlatformError('INVALID_SCHEMA');
  return value;
}
function validateLocalRedirectUri(value: string, channel: 'web' | 'cli'): string {
  if (/[\\?#]/u.test(value)) throw new PlatformError('INVALID_SCHEMA');
  let url: URL;
  try { url = new URL(value); } catch { throw new PlatformError('INVALID_SCHEMA'); }
  const cliLoopback = channel === 'cli' && url.protocol === 'http:' && url.hostname === '127.0.0.1' && Number(url.port) >= 1024;
  if ((url.protocol !== 'https:' && !cliLoopback) || url.username || url.password || url.hostname.includes('*') || url.pathname === '/' || url.href !== value) {
    throw new PlatformError('INVALID_SCHEMA');
  }
  return value;
}
export function environmentOptions(): PlatformOptions {
  const env = process.env;
  const result: PlatformOptions = {};
  if (env.PLATFORM_GALLERY_ORIGIN) result.galleryOrigin = env.PLATFORM_GALLERY_ORIGIN;
  if (env.PLATFORM_ADMIN_ORIGIN !== undefined) result.adminOrigin = env.PLATFORM_ADMIN_ORIGIN;
  result.retention = retentionPolicy(env);
  if (env.PLATFORM_METRICS_TOKEN) result.metricsToken = env.PLATFORM_METRICS_TOKEN;
  result.preview = previewConfigFromEnv(env);
  if (env.PLATFORM_DATABASE_URL) result.databaseUrl = env.PLATFORM_DATABASE_URL;
  if (env.PLATFORM_S3_ENDPOINT) result.storage = {
    endpoint: env.PLATFORM_S3_ENDPOINT, bucket: env.PLATFORM_S3_BUCKET ?? '', region: env.PLATFORM_S3_REGION ?? 'us-east-1',
    accessKeyId: env.PLATFORM_S3_ACCESS_KEY ?? '', secretAccessKey: env.PLATFORM_S3_SECRET_KEY ?? '',
  };
  if (env.PLATFORM_OIDC_ISSUER) result.oidc = {
    issuer: env.PLATFORM_OIDC_ISSUER, audience: env.PLATFORM_OIDC_AUDIENCE ?? '', jwksUri: env.PLATFORM_OIDC_JWKS_URI ?? '',
    webClientIds: (env.PLATFORM_OIDC_WEB_CLIENT_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean),
    cliClientIds: (env.PLATFORM_OIDC_CLI_CLIENT_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean),
  };
  if (env.PLATFORM_ACCESS_ADMINISTRATORS) {
    try {
      result.access = { apiOrigin:env.PLATFORM_API_ORIGIN ?? '',administrators:JSON.parse(env.PLATFORM_ACCESS_ADMINISTRATORS),outbound:JSON.parse(env.PLATFORM_ACCESS_OUTBOUND ?? '[]'),gatewayId:env.PLATFORM_PREVIEW_DEPLOYMENT_ID,...(env.PLATFORM_ACCESS_CA_FILE ? {ca:readFileSync(env.PLATFORM_ACCESS_CA_FILE,'utf8')} : {}),...(env.PLATFORM_ACCESS_INITIAL_OIDC ? {initialOidc:JSON.parse(env.PLATFORM_ACCESS_INITIAL_OIDC)} : {}) };
    } catch { throw new PlatformError('INVALID_SCHEMA'); }
  }
  if (env.PLATFORM_SELF_MANAGED_ISSUER) {
    // The self-managed issuer and realm are deployment configuration, never taken from a request.
    const base = new URL(env.PLATFORM_SELF_MANAGED_ISSUER);
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new PlatformError('INVALID_SCHEMA');
    const mode = env.PLATFORM_IDENTITY_MODE ?? 'keycloak';
    if (mode === 'local') {
      // Both public gallery and internal admin logins return to the API OIDC callback first,
      // then CompanyOidc redirects to galleryOrigin/library or adminOrigin/upload by web_target.
      const list = (value: string | undefined, fallback: string[]): string[] => {
        const parsed = (value ?? '').split(',').map(item => item.trim()).filter(Boolean);
        return parsed.length ? parsed : fallback;
      };
      const apiOrigin = env.PLATFORM_API_ORIGIN?.replace(/\/$/, '');
      const webRedirects = list(env.PLATFORM_IDENTITY_WEB_REDIRECT_URIS, apiOrigin ? [`${apiOrigin}/v1/auth/oidc/callback`] : []);
      const cliRedirects = list(env.PLATFORM_IDENTITY_CLI_REDIRECT_URIS, []);
      if (!webRedirects.length || !cliRedirects.length) throw new PlatformError('INVALID_SCHEMA');
      webRedirects.forEach(uri => validateLocalRedirectUri(uri, 'web'));
      cliRedirects.forEach(uri => validateLocalRedirectUri(uri, 'cli'));
      result.managedAccounts = { issuer: env.PLATFORM_SELF_MANAGED_ISSUER, realm: 'local' };
      result.localIdentity = {
        issuer: env.PLATFORM_SELF_MANAGED_ISSUER,
        audience: env.PLATFORM_IDENTITY_AUDIENCE ?? env.PLATFORM_API_ORIGIN ?? env.PLATFORM_SELF_MANAGED_ISSUER,
        webClientId: env.PLATFORM_IDENTITY_WEB_CLIENT_ID ?? 'zhinexus-web',
        cliClientId: env.PLATFORM_IDENTITY_CLI_CLIENT_ID ?? 'zhinexus-cli',
        webRedirectUris: webRedirects,
        cliRedirectUris: cliRedirects,
      };
    } else {
      if (mode !== 'keycloak') throw new PlatformError('INVALID_SCHEMA');
      const realm = /^\/realms\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})$/.exec(base.pathname)?.[1];
      if (!realm || !env.PLATFORM_IDENTITY_BASE_URL || !env.PLATFORM_IDENTITY_ADMIN_CLIENT_ID || !env.PLATFORM_IDENTITY_ADMIN_SECRET_REF) throw new PlatformError('INVALID_SCHEMA');
      const secret = process.env['PLATFORM_IDENTITY_ADMIN_SECRET_' + env.PLATFORM_IDENTITY_ADMIN_SECRET_REF];
      if (!secret) throw new PlatformError('INVALID_SCHEMA');
      const identityBase = new URL(env.PLATFORM_IDENTITY_BASE_URL);
      if (identityBase.protocol !== 'https:' || identityBase.username || identityBase.password || identityBase.search || identityBase.hash || !identityBase.pathname.startsWith('/realms/')) throw new PlatformError('INVALID_SCHEMA');
      result.managedAccounts = { issuer: env.PLATFORM_SELF_MANAGED_ISSUER, realm };
      result.identity = { baseUrl: env.PLATFORM_IDENTITY_BASE_URL, realm, adminClientId: env.PLATFORM_IDENTITY_ADMIN_CLIENT_ID, adminClientSecret: secret };
    }
  }
  return result;
}
export class Platform {
  readonly events: PlatformEvents;
  readonly metricsToken?: string;
  readonly verifier: OidcVerifier;
  readonly db?: Database;
  readonly store?: ArtifactStore;
  readonly uploads?: UploadService;
  readonly preview?: PreviewConfig;
  readonly galleryOrigin?: string;
  readonly adminOrigin: string;
  readonly access?: AccessSettingsService;
  readonly companyOidc?: CompanyOidc;
  readonly accounts?: ManagedAccountsService;
  readonly identityWorker?: IdentityWorker;
  /** Present when the platform issues its own tokens instead of delegating to Keycloak. */
  readonly localIdentity?: LocalIdentityService;
  constructor(options: PlatformOptions) {
    if (options.access) validateAccessOptions(options.access);
    if (options.localIdentity) {
      if (!options.localIdentity.webRedirectUris.length || !options.localIdentity.cliRedirectUris.length) throw new PlatformError('INVALID_SCHEMA');
      options.localIdentity.webRedirectUris.forEach(uri => validateLocalRedirectUri(uri, 'web'));
      options.localIdentity.cliRedirectUris.forEach(uri => validateLocalRedirectUri(uri, 'cli'));
    }
    this.events = options.events ?? new PlatformEvents();
    if (options.metricsToken && !/^[A-Za-z0-9_-]{32,256}$/.test(options.metricsToken)) throw new PlatformError('INVALID_SCHEMA');
    this.metricsToken = options.metricsToken;
    if (options.preview) this.preview = validatePreviewConfig(options.preview);
    this.adminOrigin = validateWebOrigin(options.adminOrigin ?? 'http://127.0.0.1:5177');
    const galleryOrigin = options.galleryOrigin ?? this.preview?.platformOrigin;
    if (galleryOrigin !== undefined) {
      this.galleryOrigin = validateWebOrigin(galleryOrigin);
      if (this.preview && this.galleryOrigin !== this.preview.platformOrigin) throw new PlatformError('INVALID_SCHEMA');
    }
    const bootstrapResolver:JWTVerifyGetKey | undefined=options.access && options.oidc && !options.keyResolver ? async (header,token)=>{
      const network=new RestrictedHttps(options.access!.outbound,options.access!.ca,options.accessLookup);
      const value=await network.json(options.oidc!.jwksUri);
      if (!value || typeof value!=='object' || !('keys' in value) || !Array.isArray(value.keys) || !value.keys.length || value.keys.length>32 || value.keys.some(key=>!key || typeof key!=='object' || 'd' in key || 'k' in key)) throw new AuthFailure('UNAUTHENTICATED');
      return createLocalJWKSet(value as JSONWebKeySet)(header,token);
    } : undefined;
    this.verifier = new OidcVerifier(options.oidc, options.keyResolver ?? bootstrapResolver);
    if (options.databaseUrl) this.db = new Database(options.databaseUrl);
    if (options.storage) this.store = new ArtifactStore(options.storage);
    if (this.db && this.store) this.uploads = new UploadService(this.db, this.store, options.retention);
    if (this.db && options.access) {
      this.access = new AccessSettingsService(this.db, options.access, this.galleryOrigin,async (section,config) => section === 'oidc' ? this.companyOidc!.probe(config as import('@company/contracts').OidcAccessConfig) : probePreview(this.db!,this.access!,this.companyOidc!.network,config as import('@company/contracts').PreviewAccessConfig),this.adminOrigin);
      if (options.managedAccounts && (options.identity || options.localIdentity)) {
        const network = new RestrictedHttps(options.access.outbound, options.access.ca, options.accessLookup);
        if (options.localIdentity) {
          const store = new LocalIdentityStore(this.db);
          this.localIdentity = new LocalIdentityService(store, new LocalSigningKeys(this.db), options.localIdentity);
          this.accounts = new ManagedAccountsService(this.db, this.access, options.managedAccounts,
            options.identityAdapter ?? new LocalIdentityAdapter(store, { issuer: options.managedAccounts.issuer }));
        } else {
          this.accounts = new ManagedAccountsService(this.db, this.access, options.managedAccounts,
            options.identityAdapter ?? new KeycloakIdentityAdapter(network, options.identity!));
        }
      }
      this.companyOidc = new CompanyOidc(this.db,this.access,this.verifier,options.accessLookup,this.accounts,this.localIdentity ? {authorizationEndpoint:this.localIdentity.authorizationEndpoint,loginUrl:this.adminOrigin+'/login'} : undefined);
      if (this.accounts) this.identityWorker = new IdentityWorker(this.accounts);
    }
  }
  allowsWebOrigin(origin: string | undefined): boolean {
    return origin !== undefined && (origin === this.galleryOrigin || origin === this.adminOrigin);
  }
  async requireAccessConfiguration():Promise<void> {
    if (this.companyOidc || !this.db) return;
    const exists=(await this.db.query("SELECT to_regclass('access_active') AS name")).rows[0]?.name;
    if (exists && (await this.db.query('SELECT 1 FROM access_active WHERE active_revision_id IS NOT NULL LIMIT 1')).rowCount) throw new AuthFailure('UNAUTHENTICATED');
  }
  async authenticate(authorization:string | undefined) {
    if (this.companyOidc) return this.companyOidc.authenticate(authorization);
    await this.requireAccessConfiguration();
    const principal=await this.verifier.verify(authorization);
    await this.requireAccessConfiguration();
    return principal;
  }
  async runAdministrator<T>(authorization: string | undefined, requestId: string, operation: (service: AccessSettingsService, context: RequestContext) => Promise<T>): Promise<T> {
    let principal: Principal | undefined;
    try {
      principal = await this.authenticate(authorization);
      if (!this.db || !this.access) throw new PlatformError('INFRA_UNAVAILABLE');
      const context = { principal, requestId };
      this.access.administrator(context);
      if ((await this.db.query('SELECT 1 FROM disabled_subjects WHERE subject=$1', [principal.subject])).rowCount) throw new PlatformError('FORBIDDEN');
      if (this.companyOidc && (await this.access!.current('oidc')).generation!==principal.generation) throw new AuthFailure('UNAUTHENTICATED');
      return await operation(this.access, context);
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code === 'UNAUTHENTICATED' || code === 'FORBIDDEN') await this.db?.query('SELECT 1').then(()=>audit(this.db!,principal?.subject,'AUTH_DENIED','access-settings',{code},requestId)).catch(()=>{});
      throw error;
    }
  }
  async run<T>(authorization: string | undefined, action: 'read'|'upload'|'baseline'|'deprecate', requestId: string,
    operation: (context: RequestContext, uploads: UploadService, db: Database) => Promise<T>): Promise<T> {
    let principal: Principal | undefined;
    try {
      principal = await this.authenticate(authorization);
      requireRole(principal, action);
      if (!this.db || !this.uploads) throw new PlatformError('INFRA_UNAVAILABLE');
      if ((await this.db.query('SELECT 1 FROM disabled_subjects WHERE subject=$1', [principal.subject])).rowCount) throw new PlatformError('FORBIDDEN');
      await requireCurrentIdentity(this.db,{principal,requestId},action);
      return await operation({ principal, requestId }, this.uploads, this.db);
    } catch (error) {
      const code = error instanceof PlatformError && error.authorizationDenied ? 'FORBIDDEN'
        : error instanceof Error && 'code' in error ? error.code : undefined;
      if (code === 'UNAUTHENTICATED' || code === 'FORBIDDEN') {
        await this.db?.query('SELECT 1').then(() => audit(this.db!, principal?.subject, 'AUTH_DENIED', action, { code }, requestId)).catch(() => {});
      }
      throw error;
    }
  }
  async onApplicationShutdown(): Promise<void> { this.identityWorker?.stop(); this.store?.close(); await this.db?.close(); }
  async runCategories<T>(authorization: string | undefined, requestId: string, operation: (service: CategoryService, context: RequestContext) => Promise<T>): Promise<T> {
    let principal: Principal | undefined;
    try {
      principal = await this.authenticate(authorization);
      if (!this.db) throw new PlatformError('INFRA_UNAVAILABLE');
      return await operation(new CategoryService(this.db, this.access, this.accounts?.selfManagedIssuer), { principal, requestId });
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code === 'UNAUTHENTICATED' || code === 'FORBIDDEN') await this.db?.query('SELECT 1').then(() => audit(this.db!, principal?.subject, 'AUTH_DENIED', 'categories', { code }, requestId)).catch(() => {});
      throw error;
    }
  }
  /** Member management: the directory itself decides administrator authority, not a business role. */
  async runManaged<T>(authorization: string | undefined, requestId: string, operation: (service: ManagedAccountsService, context: RequestContext) => Promise<T>): Promise<T> {
    let principal: Principal | undefined;
    try {
      principal = await this.authenticate(authorization);
      if (!this.accounts) throw new PlatformError('INFRA_UNAVAILABLE');
      return await operation(this.accounts, { principal, requestId });
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code === 'UNAUTHENTICATED' || code === 'FORBIDDEN') await this.db?.query('SELECT 1').then(()=>audit(this.db!,principal?.subject,'AUTH_DENIED','managed-accounts',{code},requestId)).catch(()=>{});
      throw error;
    }
  }
}
