import { createHash, randomBytes } from 'node:crypto';
import { Pool,type PoolClient } from 'pg';
import type { VariantRef } from '@company/contracts';
import { previewOriginFor, validatePreviewConfig, type PreviewConfig } from '@company/contracts/preview';
import { isLoopbackDevPreview, type GatewayOptions } from './config.js';
import { PreviewStorage } from './storage.js';
import { PreviewDenied, resourcePath, resourceMime } from './path-policy.js';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
type Access = { variant_release_id: string; subject: string | null; origin: string; expires_at: Date; metadata: VariantRef; job_id: string; preview_generation:string;oidc_generation:string;account_version:string|null };
/** A grant issued for a self-managed account stays valid only while that account version does. */
async function accountCurrent(sql:Pool | PoolClient, subject:string | null, version:string|null):Promise<boolean> {
  if (version === null) return true;
  if (subject === null) return false;
  const row=(await sql.query<{version:string;enabled:boolean}>('SELECT version,enabled FROM managed_accounts WHERE platform_subject=$1',[subject])).rows[0];
  return !!row && row.enabled && row.version === version;
}
export class PreviewRuntime {
  readonly config?: PreviewConfig;
  private readonly pool?: Pool;
  private readonly storage?: PreviewStorage;
  readonly deploymentId?:string;
  constructor(options: GatewayOptions) {
    if (options.preview) {
      const loopbackDev = process.env.NODE_ENV !== 'production' && process.env.PLATFORM_BIND_HOST !== '0.0.0.0' && isLoopbackDevPreview(options.preview);
      this.config = loopbackDev ? { ...options.preview } : validatePreviewConfig(options.preview);
    }
    this.deploymentId=options.deploymentId;
    if (options.storage) this.storage = new PreviewStorage(options.storage);
    if (options.databaseUrl) {
      this.pool = new Pool({ connectionString: options.databaseUrl, max: 8, connectionTimeoutMillis: 5000, query_timeout: 15_000, statement_timeout: 15_000 });
      this.pool.on('error', () => {});
    }
  }
  async currentConfig(sql:Pool | PoolClient | undefined=this.pool):Promise<{config:PreviewConfig;previewGeneration:string;oidcGeneration:string}> {
    if(!sql || !this.config)throw new PreviewDenied();
    const states=(await sql.query('SELECT a.section,a.generation,r.config FROM access_active a LEFT JOIN access_revisions r ON r.id=a.active_revision_id ORDER BY a.section')).rows;
    const preview=states.find(r=>r.section==='preview'),oidc=states.find(r=>r.section==='oidc');
    if(!preview || !oidc)throw new PreviewDenied();
    const config=preview.config ? validatePreviewConfig({...this.config,...preview.config}) : this.config;
    if(sql===this.pool)await sql.query("UPDATE access_active SET gateway_generation=generation WHERE section='preview' AND generation=$1",[preview.generation]);
    return{config,previewGeneration:preview.generation,oidcGeneration:oidc.generation};
  }
  private origin(id: string, host: string | undefined,config:PreviewConfig): string {
    const origin = previewOriginFor(id, config);
    if (host !== new URL(origin).host) throw new PreviewDenied();
    return origin;
  }
  async redeem(token: string, host: string | undefined): Promise<{ token: string; expires: Date; entry: string;config:PreviewConfig }> {
    if (!this.pool || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new PreviewDenied();
    const sql = await this.pool.connect();
    try {
      await sql.query('BEGIN');
      await sql.query('SELECT section FROM access_active ORDER BY section FOR SHARE');
      const current=await this.currentConfig(sql);
      const grant = (await sql.query<Access>(`SELECT g.*,vr.metadata FROM preview_grants g JOIN variant_releases vr ON vr.id=g.variant_release_id
        WHERE token_hash=$1 AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp()
          AND preview_can_read(g.variant_release_id,g.subject)
          AND (
            (g.subject IS NULL AND cardinality(g.read_roles)=0)
            OR (g.subject IS NOT NULL AND EXISTS(SELECT 1 FROM unnest(g.read_roles) AS granted(read_role) WHERE NOT EXISTS(SELECT 1 FROM subject_role_restrictions r WHERE r.subject=g.subject AND r.role=granted.read_role)))
          ) FOR UPDATE OF g`, [hash(token)])).rows[0];
      if (!grant || grant.origin !== this.origin(grant.variant_release_id, host,current.config) || grant.preview_generation!==current.previewGeneration || (grant.subject!==null && grant.oidc_generation!==current.oidcGeneration)) throw new PreviewDenied();
      if (!await accountCurrent(sql,grant.subject,grant.account_version)) throw new PreviewDenied();
      const entry = grant.metadata.examples[0]?.previewEntry;
      if (!entry || resourcePath(`/${entry}`) !== entry) throw new PreviewDenied();
      const session = randomBytes(32).toString('base64url');
      await sql.query('UPDATE preview_grants SET redeemed_at=clock_timestamp() WHERE token_hash=$1', [hash(token)]);
      await sql.query('INSERT INTO preview_sessions(token_hash,grant_hash) VALUES ($1,$2)', [hash(session), hash(token)]);
      await sql.query('COMMIT');
      return { token: session, expires: grant.expires_at, entry,config:current.config };
    } catch (error) { await sql.query('ROLLBACK').catch(() => {}); throw error; }
    finally { sql.release(); }
  }
  private async access(token: string, host: string | undefined): Promise<Access> {
    if (!this.pool) throw new PreviewDenied();
    const access = (await this.pool.query<Access>(`SELECT g.*,vr.metadata,p.job_id FROM preview_sessions s
      JOIN preview_grants g ON g.token_hash=s.grant_hash JOIN variant_releases vr ON vr.id=g.variant_release_id
      JOIN package_releases p ON p.id=vr.package_release_id
      WHERE s.token_hash=$1 AND g.redeemed_at IS NOT NULL AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()
        AND preview_can_read(g.variant_release_id,g.subject)
        AND (
          (g.subject IS NULL AND cardinality(g.read_roles)=0)
          OR (g.subject IS NOT NULL AND EXISTS(SELECT 1 FROM unnest(g.read_roles) AS granted(read_role) WHERE NOT EXISTS(SELECT 1 FROM subject_role_restrictions r WHERE r.subject=g.subject AND r.role=granted.read_role)))
        )`, [hash(token)])).rows[0];
    const current=await this.currentConfig();
    if (!access || access.origin !== this.origin(access.variant_release_id, host,current.config) || access.preview_generation!==current.previewGeneration || (access.subject!==null && access.oidc_generation!==current.oidcGeneration)) throw new PreviewDenied();
    if (!await accountCurrent(this.pool!,access.subject,access.account_version)) throw new PreviewDenied();
    return access;
  }
  async resource(path: string, token: string, host: string | undefined): Promise<{ bytes: Buffer; mime: string;config:PreviewConfig }> {
    const access = await this.access(token, host);
    const ref = access.metadata.examples.flatMap(example => example.previewFiles).find(file => file.path === path);
    if (!ref || !this.pool || !this.storage) throw new PreviewDenied();
    const mime = resourceMime(path);
    const stored = (await this.pool.query('SELECT object_key,bytes,sha256 FROM release_artifacts WHERE job_id=$1 AND path=$2', [access.job_id, path])).rows[0];
    if (!stored || stored.object_key !== `releases/${access.job_id}/${path}` || Number(stored.bytes) !== ref.bytes || stored.sha256 !== ref.sha256) throw new PreviewDenied();
    const bytes = await this.storage.read(stored.object_key, ref);
    await this.access(token, host);
    const current=await this.currentConfig();
    if(current.previewGeneration!==access.preview_generation || (access.subject!==null && current.oidcGeneration!==access.oidc_generation))throw new PreviewDenied();
    return { bytes, mime,config:current.config };
  }
  async onApplicationShutdown(): Promise<void> { this.storage?.close(); await this.pool?.end(); }
  async recordFailure(host: string | undefined, requestId: string, denied: boolean): Promise<void> {
    if (!this.pool) return;
    let target = 'preview';
    const id = /^r-([a-f0-9-]{36})\./.exec(host ?? '')?.[1];
    try { if (id && this.config) { this.origin(id, host,this.config); target = id; } } catch { /* Never log an untrusted Host. */ }
    await this.pool.query('INSERT INTO audit_events(event,target_id,request_id,data) VALUES ($1,$2,$3,$4)',
      [denied ? 'PREVIEW_DENIED' : 'PREVIEW_UNAVAILABLE', target, requestId, '{}']).catch(() => {});
  }
}
