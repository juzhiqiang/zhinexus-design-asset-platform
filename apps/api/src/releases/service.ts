import { randomUUID } from 'node:crypto';
import { manifestDigest, validateApiMessage, type ApiMessages, type CheckReportV1, type ReleaseManifestV1 } from '@company/contracts';
import type { Database } from '../db/database.js';
import { audit, requireComponents, requirePackages, uuid, type RequestContext, type Sql } from '../db/access.js';
import type { UploadService } from '../uploads/service.js';
import { validatePlatformBundle } from '../uploads/validator.js';
import { PlatformError } from '../errors.js';

type Job = { id: string; subject: string; client_id: string; channel: string; state: ApiMessages['releaseJobResponse']['state']; stage: ApiMessages['releaseJobResponse']['stage']; attempt: number; last_error: ApiMessages['releaseJobResponse']['lastError'] | null; request_digest: string; manifest: ReleaseManifestV1; lease_until: Date | null };
export class ReleaseService {
  constructor(private readonly db: Database, private readonly uploads: UploadService) {}
  async create(input: unknown, key: string | undefined, context: RequestContext): Promise<ApiMessages['createReleaseResponse']> {
    if (!key || !/^[A-Za-z0-9._:-]{1,256}$/.test(key)) throw new PlatformError('INVALID_SCHEMA');
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'manifest,uploadSessionId' ||
      !('uploadSessionId' in input) || typeof input.uploadSessionId !== 'string' || !('manifest' in input)) throw new PlatformError('INVALID_SCHEMA');
    // These buffers and the HTTP body are owned by this request. Only immutable frozen objects are read.
    const frozen = await this.uploads.frozen(input.uploadSessionId, context);
    const checked = await validatePlatformBundle(input.manifest, frozen.files, context.principal.channel);
    if (!checked.ok) throw new PlatformError(checked.issues[0]?.code ?? 'INVALID_SCHEMA', checked.issues);
    const manifest = checked.value;
    const reports: Record<string, CheckReportV1> = Object.fromEntries(manifest.reports.map(ref =>
      [ref.path, JSON.parse(new TextDecoder().decode(frozen.files.get(ref.path)!)) as CheckReportV1]));
    const validated = validateApiMessage('createReleaseRequest', input, { reports });
    if (!validated.ok) throw new PlatformError('INVALID_SCHEMA', validated.issues);
    const digest = await manifestDigest(manifest);
    if (digest !== frozen.session.manifest_digest) throw new PlatformError('DIGEST_MISMATCH');
    const requestDigest = await manifestDigest(validated.value);
    return this.db.transaction(async client => {
      await requireComponents(client, context.principal.subject, manifest.variants.map(variant => variant.componentId));
      await requirePackages(client, context.principal.subject, manifest.packages.map(pkg => pkg.name));
      // Serialize matching keys across API processes, with the unique constraint as the final guard.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([context.principal.subject, key])]);
      const existing = await client.query<Job>('SELECT * FROM release_jobs WHERE subject=$1 AND idempotency_key=$2', [context.principal.subject, key]);
      if (existing.rowCount) {
        const job = existing.rows[0]!;
        if (job.request_digest !== requestDigest || job.client_id !== context.principal.clientId || job.channel !== context.principal.channel) throw new PlatformError('CONFLICT');
        return { jobId: job.id, state: job.state };
      }
      const jobId = randomUUID();
      await client.query("INSERT INTO release_jobs(id,subject,client_id,channel,upload_session_id,manifest_digest,manifest,idempotency_key,request_digest,state,stage) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING','PENDING')",
        [jobId, context.principal.subject, context.principal.clientId, context.principal.channel, frozen.session.id, digest, JSON.stringify(manifest), key, requestDigest]);
      const packageIds = new Map<string, string>();
      for (const pkg of manifest.packages) {
        const id = randomUUID();
        // A reserved/published package version cannot be reassigned, even by a new idempotency key.
        await client.query('INSERT INTO package_releases(id,job_id,name,version,sha256,metadata) VALUES ($1,$2,$3,$4,$5,$6)',
          [id, jobId, pkg.name, pkg.version, pkg.tarball.sha256, JSON.stringify(pkg)]);
        packageIds.set(JSON.stringify([pkg.name, pkg.version]), id);
      }
      const variantIds = new Map<string, string>();
      for (const variant of manifest.variants) {
        await client.query('INSERT INTO variants(id,component_id,framework) VALUES ($1,$2,$3) ON CONFLICT(id) DO NOTHING', [variant.variantId, variant.componentId, variant.framework]);
        const identity = (await client.query('SELECT component_id,framework FROM variants WHERE id=$1', [variant.variantId])).rows[0]!;
        if (identity.component_id !== variant.componentId || identity.framework !== variant.framework) throw new PlatformError('CONFLICT');
        const id = randomUUID();
        await client.query('INSERT INTO variant_releases(id,variant_id,package_release_id,metadata) VALUES ($1,$2,$3,$4)', [id, variant.variantId, packageIds.get(JSON.stringify([variant.packageName, variant.packageVersion])), JSON.stringify(variant)]);
        variantIds.set(variant.variantId, id);
      }
      for (const report of Object.values(reports)) await client.query('INSERT INTO check_reports(id,job_id,variant_id,content) VALUES ($1,$2,$3,$4)', [report.id, jobId, report.variantId, JSON.stringify(report)]);
      for (const variant of manifest.variants) for (const shot of variant.screenshots) {
        await client.query('INSERT INTO screenshots(id,variant_release_id,example_id,environment_key,source,report_id,object_key,sha256,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [shot.id, variantIds.get(variant.variantId), shot.exampleId, shot.environmentKey, shot.source, shot.reportId ?? null, frozen.keys.get(shot.image.path), shot.image.sha256, JSON.stringify(shot)]);
      }
      await audit(client, context.principal.subject, 'RELEASE_CREATED', jobId, { state: 'PENDING', manifestDigest: digest }, context.requestId);
      return { jobId, state: 'PENDING' };
    });
  }
  private async readable(sql: Sql, jobId: string, context: RequestContext, lock = false): Promise<Job> {
    const result = await sql.query<Job>(`SELECT * FROM release_jobs WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [uuid(jobId)]);
    const job = result.rows[0];
    if (!job) throw new PlatformError('NOT_FOUND');
    if (job.subject !== context.principal.subject) {
      if (!context.principal.roles.includes('maintainer')) throw new PlatformError('NOT_FOUND');
      try {
        await requireComponents(sql, context.principal.subject, job.manifest.variants.map(variant => variant.componentId), true);
        await requirePackages(sql, context.principal.subject, job.manifest.packages.map(pkg => pkg.name));
      } catch (error) {
        if (error instanceof PlatformError && error.code === 'FORBIDDEN') throw new PlatformError('NOT_FOUND');
        throw error;
      }
    }
    return job;
  }
  async get(jobId: string, context: RequestContext): Promise<ApiMessages['releaseJobResponse']> {
    const job = await this.readable(this.db, jobId, context);
    return { state: job.state, stage: job.stage, attempt: job.attempt, ...(job.last_error ? { lastError: job.last_error } : {}), missingArtifacts: [], pollAfterMs: 2000 };
  }
  async retry(jobId: string, context: RequestContext): Promise<ApiMessages['retryReleaseResponse']> {
    return this.db.transaction(async client => {
      const job = await this.readable(client, jobId, context, true);
      await requireComponents(client, context.principal.subject, job.manifest.variants.map(variant => variant.componentId));
      await requirePackages(client, context.principal.subject, job.manifest.packages.map(pkg => pkg.name));
      if (job.state !== 'RETRY_WAIT' || job.lease_until && job.lease_until.getTime() > Date.now()) throw new PlatformError('CONFLICT');
      await client.query("UPDATE release_jobs SET state='PENDING',fencing_token=fencing_token+1,lease_until=NULL,updated_at=now() WHERE id=$1", [jobId]);
      await audit(client, context.principal.subject, 'RELEASE_RETRIED', jobId, { state: 'PENDING' }, context.requestId);
      return { jobId, state: 'PENDING' };
    });
  }
}
