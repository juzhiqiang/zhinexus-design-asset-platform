import type { JWTVerifyGetKey } from 'jose';
import { OidcVerifier, type OidcConfig, type Principal } from './auth/oidc.js';
import { requireRole } from './auth/roles.js';
import { Database } from './db/database.js';
import { audit, type RequestContext } from './db/access.js';
import { ArtifactStore, type StorageConfig } from './storage/artifact-store.js';
import { UploadService } from './uploads/service.js';
import { PlatformError } from './errors.js';
import { validatePreviewConfig, type PreviewConfig } from '@company/contracts/preview';
import { PlatformEvents } from './observability/events.js';

export type PlatformOptions = { databaseUrl?: string; storage?: StorageConfig; oidc?: OidcConfig; keyResolver?: JWTVerifyGetKey; preview?: PreviewConfig; events?: PlatformEvents; metricsToken?: string };
export function environmentOptions(): PlatformOptions {
  const env = process.env;
  const result: PlatformOptions = {};
  if (env.PLATFORM_METRICS_TOKEN) result.metricsToken = env.PLATFORM_METRICS_TOKEN;
  if (env.PLATFORM_PREVIEW_ORIGIN) result.preview = { previewOrigin: env.PLATFORM_PREVIEW_ORIGIN,
    platformOrigin: env.PLATFORM_GALLERY_ORIGIN ?? '', apiOrigin: env.PLATFORM_API_ORIGIN ?? '' };
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
  constructor(options: PlatformOptions) {
    this.events = options.events ?? new PlatformEvents();
    if (options.metricsToken && !/^[A-Za-z0-9_-]{32,256}$/.test(options.metricsToken)) throw new PlatformError('INVALID_SCHEMA');
    this.metricsToken = options.metricsToken;
    if (options.preview) this.preview = validatePreviewConfig(options.preview);
    this.verifier = new OidcVerifier(options.oidc, options.keyResolver);
    if (options.databaseUrl) this.db = new Database(options.databaseUrl);
    if (options.storage) this.store = new ArtifactStore(options.storage);
    if (this.db && this.store) this.uploads = new UploadService(this.db, this.store);
  }
  async run<T>(authorization: string | undefined, action: 'read'|'upload'|'baseline'|'deprecate', requestId: string,
    operation: (context: RequestContext, uploads: UploadService, db: Database) => Promise<T>): Promise<T> {
    let principal: Principal | undefined;
    try {
      principal = await this.verifier.verify(authorization);
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
