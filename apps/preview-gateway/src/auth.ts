import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import type { VariantRef } from '@company/contracts';
import { previewOriginFor, validatePreviewConfig, type PreviewConfig } from '@company/contracts/preview';
import type { GatewayOptions } from './config.js';
import { PreviewStorage } from './storage.js';
import { PreviewDenied, resourcePath, resourceMime } from './path-policy.js';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
type Access = { variant_release_id: string; subject: string; origin: string; expires_at: Date; metadata: VariantRef; job_id: string };
export class PreviewRuntime {
  readonly config?: PreviewConfig;
  private readonly pool?: Pool;
  private readonly storage?: PreviewStorage;
  constructor(options: GatewayOptions) {
    if (options.preview) this.config = validatePreviewConfig(options.preview);
    if (options.storage) this.storage = new PreviewStorage(options.storage);
    if (options.databaseUrl) {
      this.pool = new Pool({ connectionString: options.databaseUrl, max: 8, connectionTimeoutMillis: 5000, query_timeout: 15_000, statement_timeout: 15_000 });
      this.pool.on('error', () => {});
    }
  }
  private origin(id: string, host: string | undefined): string {
    if (!this.config) throw new PreviewDenied();
    const origin = previewOriginFor(id, this.config);
    if (host !== new URL(origin).host) throw new PreviewDenied();
    return origin;
  }
  async redeem(token: string, host: string | undefined): Promise<{ token: string; expires: Date; entry: string }> {
    if (!this.pool || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new PreviewDenied();
    const sql = await this.pool.connect();
    try {
      await sql.query('BEGIN');
      const grant = (await sql.query<Access>(`SELECT g.*,vr.metadata FROM preview_grants g JOIN variant_releases vr ON vr.id=g.variant_release_id
        WHERE token_hash=$1 AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp()
          AND preview_can_read(g.variant_release_id,g.subject) FOR UPDATE OF g`, [hash(token)])).rows[0];
      if (!grant || grant.origin !== this.origin(grant.variant_release_id, host)) throw new PreviewDenied();
      const entry = grant.metadata.examples[0]?.previewEntry;
      if (!entry || resourcePath(`/${entry}`) !== entry) throw new PreviewDenied();
      const session = randomBytes(32).toString('base64url');
      await sql.query('UPDATE preview_grants SET redeemed_at=clock_timestamp() WHERE token_hash=$1', [hash(token)]);
      await sql.query('INSERT INTO preview_sessions(token_hash,grant_hash) VALUES ($1,$2)', [hash(session), hash(token)]);
      await sql.query('COMMIT');
      return { token: session, expires: grant.expires_at, entry };
    } catch (error) { await sql.query('ROLLBACK').catch(() => {}); throw error; }
    finally { sql.release(); }
  }
  private async access(token: string, host: string | undefined): Promise<Access> {
    if (!this.pool) throw new PreviewDenied();
    const access = (await this.pool.query<Access>(`SELECT g.*,vr.metadata,p.job_id FROM preview_sessions s
      JOIN preview_grants g ON g.token_hash=s.grant_hash JOIN variant_releases vr ON vr.id=g.variant_release_id
      JOIN package_releases p ON p.id=vr.package_release_id
      WHERE s.token_hash=$1 AND g.redeemed_at IS NOT NULL AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()
        AND preview_can_read(g.variant_release_id,g.subject)`, [hash(token)])).rows[0];
    if (!access || access.origin !== this.origin(access.variant_release_id, host)) throw new PreviewDenied();
    return access;
  }
  async resource(path: string, token: string, host: string | undefined): Promise<{ bytes: Buffer; mime: string }> {
    const access = await this.access(token, host);
    const ref = access.metadata.examples.flatMap(example => example.previewFiles).find(file => file.path === path);
    if (!ref || !this.pool || !this.storage) throw new PreviewDenied();
    const mime = resourceMime(path);
    const stored = (await this.pool.query('SELECT object_key,bytes,sha256 FROM release_artifacts WHERE job_id=$1 AND path=$2', [access.job_id, path])).rows[0];
    if (!stored || stored.object_key !== `releases/${access.job_id}/${path}` || Number(stored.bytes) !== ref.bytes || stored.sha256 !== ref.sha256) throw new PreviewDenied();
    const bytes = await this.storage.read(stored.object_key, ref);
    await this.access(token, host);
    return { bytes, mime };
  }
  async onApplicationShutdown(): Promise<void> { this.storage?.close(); await this.pool?.end(); }
}
