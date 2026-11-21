import type { JWTVerifyGetKey } from 'jose';
import { OidcVerifier, type OidcConfig, type Principal } from './auth/oidc.js';
import { requireRole } from './auth/roles.js';
import { Database } from './db/database.js';
import { audit, type RequestContext } from './db/access.js';
import { ArtifactStore, type StorageConfig } from './storage/artifact-store.js';
import { UploadService } from './uploads/service.js';
import { PlatformError } from './errors.js';
import { previewConfigFromEnv, validatePreviewConfig, type PreviewConfig } from '@company/contracts/preview';
import { PlatformEvents } from './observability/events.js';
import { retentionPolicy, type RetentionPolicy } from './operations/retention.js';
import { AccessSettingsService, type AccessOptions } from './access/service.js';
import { CompanyOidc } from './access/oidc.js';
import { readFileSync } from 'node:fs';

export type PlatformOptions = { databaseUrl?: string; storage?: StorageConfig; oidc?: OidcConfig; keyResolver?: JWTVerifyGetKey; preview?: PreviewConfig; galleryOrigin?: string; events?: PlatformEvents; metricsToken?: string; retention?: RetentionPolicy; access?: AccessOptions };
function validateGalleryOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new PlatformError('INVALID_SCHEMA'); }
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!localHttp && url.protocol !== 'https:') || url.username || url.password || value !== url.origin) throw new PlatformError('INVALID_SCHEMA');
  return value;
}
export function environmentOptions(): PlatformOptions {
  const env = process.env;
  const result: PlatformOptions = {};
  if (env.PLATFORM_GALLERY_ORIGIN) result.galleryOrigin = env.PLATFORM_GALLERY_ORIGIN;
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
      result.access = { apiOrigin:env.PLATFORM_API_ORIGIN ?? '',administrators:JSON.parse(env.PLATFORM_ACCESS_ADMINISTRATORS),outbound:JSON.parse(env.PLATFORM_ACCESS_OUTBOUND ?? '[]'),...(env.PLATFORM_ACCESS_CA_FILE ? {ca:readFileSync(env.PLATFORM_ACCESS_CA_FILE,'utf8')} : {}),...(env.PLATFORM_ACCESS_INITIAL_OIDC ? {initialOidc:JSON.parse(env.PLATFORM_ACCESS_INITIAL_OIDC)} : {}) };
    } catch { throw new PlatformError('INVALID_SCHEMA'); }
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
  readonly access?: AccessSettingsService;
  readonly companyOidc?: CompanyOidc;
  constructor(options: PlatformOptions) {
    this.events = options.events ?? new PlatformEvents();
    if (options.metricsToken && !/^[A-Za-z0-9_-]{32,256}$/.test(options.metricsToken)) throw new PlatformError('INVALID_SCHEMA');
    this.metricsToken = options.metricsToken;
    if (options.preview) this.preview = validatePreviewConfig(options.preview);
    const galleryOrigin = options.galleryOrigin ?? this.preview?.platformOrigin;
    if (galleryOrigin !== undefined) {
      this.galleryOrigin = validateGalleryOrigin(galleryOrigin);
      if (this.preview && this.galleryOrigin !== this.preview.platformOrigin) throw new PlatformError('INVALID_SCHEMA');
    }
    this.verifier = new OidcVerifier(options.oidc, options.keyResolver);
    if (options.databaseUrl) this.db = new Database(options.databaseUrl);
    if (options.storage) this.store = new ArtifactStore(options.storage);
    if (this.db && this.store) this.uploads = new UploadService(this.db, this.store, options.retention);
    if (this.db && options.access) {
      this.access = new AccessSettingsService(this.db, options.access, this.galleryOrigin,async (section,config) => section === 'oidc' ? this.companyOidc!.probe(config as import('@company/contracts').OidcAccessConfig) : {});
      this.companyOidc = new CompanyOidc(this.db,this.access,this.verifier);
    }
  }
  authenticate(authorization:string | undefined) { return this.companyOidc ? this.companyOidc.authenticate(authorization) : this.verifier.verify(authorization); }
  async runAdministrator<T>(authorization: string | undefined, requestId: string, operation: (service: AccessSettingsService, context: RequestContext) => Promise<T>): Promise<T> {
    const principal = await this.authenticate(authorization);
    if (!this.db || !this.access) throw new PlatformError('INFRA_UNAVAILABLE');
    const context = { principal, requestId };
    this.access.administrator(context);
    if ((await this.db.query('SELECT 1 FROM disabled_subjects WHERE subject=$1', [principal.subject])).rowCount) throw new PlatformError('FORBIDDEN');
    return operation(this.access, context);
  }
  async run<T>(authorization: string | undefined, action: 'read'|'upload'|'baseline'|'deprecate', requestId: string,
    operation: (context: RequestContext, uploads: UploadService, db: Database) => Promise<T>): Promise<T> {
    let principal: Principal | undefined;
    try {
      principal = await this.authenticate(authorization);
      requireRole(principal, action);
      if (!this.db || !this.uploads) throw new PlatformError('INFRA_UNAVAILABLE');
      if ((await this.db.query('SELECT 1 FROM disabled_subjects WHERE subject=$1', [principal.subject])).rowCount) throw new PlatformError('FORBIDDEN');
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
  async onApplicationShutdown(): Promise<void> { this.store?.close(); await this.db?.close(); }
}
