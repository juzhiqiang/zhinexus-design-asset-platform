import type { Database } from '../db/database.js';
import { audit } from '../db/access.js';
import type { ArtifactStore } from '../storage/artifact-store.js';
import { PlatformError } from '../errors.js';
import { enqueueReady } from '../index/outbox.js';
import { ReleaseLeases, type ReleaseLease } from './leases.js';
import { ReleaseArtifacts } from './artifact-store.js';
import { checkAvailability } from './availability.js';
import { dependenciesOf, orderPackages, type RegistryClient } from './registry-client.js';
import { requireCheckpoint } from './state-machine.js';
import { ReleaseTags } from './tags.js';
import { compareVersions } from './version-order.js';
import { PlatformEvents } from '../observability/events.js';

class MissingArtifacts extends PlatformError {
  constructor(readonly paths: string[]) { super('UPLOAD_INCOMPLETE'); }
}
export class ReleaseWorker {
  readonly leases: ReleaseLeases;
  readonly artifacts: ReleaseArtifacts;
  readonly tags: ReleaseTags;
  constructor(private readonly db: Database, store: ArtifactStore, private readonly registry: RegistryClient, leaseMs = 60_000, readonly events = new PlatformEvents()) {
    this.leases = new ReleaseLeases(db, leaseMs);
    this.artifacts = new ReleaseArtifacts(db, store, this.leases);
    this.tags = new ReleaseTags(db, registry);
  }
  async runOnce(jobId?: string): Promise<boolean> {
    const lease = await this.leases.claim(jobId); if (!lease) return false;
    this.events.emit({ event: 'RELEASE_CLAIMED', taskId: lease.id, requestId: lease.request_id, stage: lease.stage, attempt: lease.attempt });
    let stopped = false; let renewal: Promise<void> | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
    let renewalFailed = false;
    const schedule = () => { timer = setTimeout(() => {
      renewal = this.leases.renew(lease).catch(() => { renewalFailed = true; }).finally(() => { if (!stopped && !renewalFailed) schedule(); });
    }, Math.floor(this.leases.leaseMs / 3)); timer.unref(); };
    schedule();
    try {
      await this.advanceRelease(lease, () => { if (renewalFailed) throw new PlatformError('LEASE_LOST'); });
    } catch (error) {
      this.events.emit({ event: 'RELEASE_FAILED', taskId: lease.id, requestId: lease.request_id, stage: lease.stage, attempt: lease.attempt,
        code: error instanceof PlatformError ? error.code : 'INFRA_UNAVAILABLE' });
      if (!(error instanceof PlatformError && error.code === 'LEASE_LOST')) {
        try { await this.leases.fail(lease, error instanceof PlatformError ? error.code : 'INFRA_UNAVAILABLE', error instanceof MissingArtifacts ? error.paths : []); }
        catch (failure) { if (!(failure instanceof PlatformError && failure.code === 'LEASE_LOST')) throw failure; }
      }
    } finally { stopped = true; clearTimeout(timer); await renewal; }
    return true;
  }
  async advanceRelease(lease: ReleaseLease, checkHeartbeat: () => void = () => {}): Promise<void> {
    while (true) {
      checkHeartbeat(); await this.leases.assert(lease);
      const stage = requireCheckpoint(lease.stage); const started = performance.now(); let outcome: 'success'|'failure' = 'failure';
      try {
      switch (requireCheckpoint(lease.stage)) {
        case 'FINALIZE_OBJECTS':
          await this.artifacts.finalize(lease);
          await this.leases.checkpoint(lease, 'ENSURE_PACKAGES'); break;
        case 'ENSURE_PACKAGES':
          for (const pkg of orderPackages(lease.manifest.packages)) {
            checkHeartbeat(); await this.leases.assert(lease);
            for (const [name, version] of Object.entries(dependenciesOf(pkg))) if (name.startsWith('@company/')) {
              try { await this.registry.verifyDependencies({ name, version }); }
              catch (error) { if (error instanceof PlatformError && error.code === 'UPLOAD_INCOMPLETE') throw new MissingArtifacts([pkg.tarball.path]); throw error; }
            }
            const bytes = await this.artifacts.read(lease, pkg.tarball);
            await this.leases.assert(lease);
            await this.registry.ensurePackage(pkg, bytes, `candidate-${lease.id}`);
          }
          await this.leases.checkpoint(lease, 'REGISTER_ASSETS'); break;
        case 'REGISTER_ASSETS':
          await this.verifyRegistered(lease);
          await this.leases.checkpoint(lease, 'CHECK_AVAILABILITY'); break;
        case 'CHECK_AVAILABILITY':
          await this.available(lease);
          await this.leases.checkpoint(lease, 'READY_TX'); break;
        case 'READY_TX':
          // A prior successful availability check may precede a process outage.
          await this.available(lease); checkHeartbeat();
          await this.ready(lease); outcome = 'success'; return;
      }
      outcome = 'success';
      } finally {
        const detail = { stage, attempt: lease.attempt, outcome, durationMs: performance.now() - started };
        this.events.emit({ event: 'RELEASE_STAGE', taskId: lease.id, requestId: lease.request_id, ...detail });
        // Best effort telemetry; stdout remains available if PostgreSQL is unavailable.
        await audit(this.db, lease.subject, 'RELEASE_STAGE', lease.id, detail, lease.request_id).catch(() => {});
      }
    }
  }
  private async available(lease: ReleaseLease): Promise<void> {
    const result = await checkAvailability(lease, this.artifacts, this.registry);
    if (!result.ok) throw new MissingArtifacts([...new Set(result.missing.map(item => item.ref))]);
  }
  private async verifyRegistered(lease: ReleaseLease): Promise<void> {
    const packages = (await this.db.query('SELECT name,version,sha256 FROM package_releases WHERE job_id=$1', [lease.id])).rows;
    const variants = (await this.db.query(`SELECT v.variant_id,p.name,p.version FROM variant_releases v
      JOIN package_releases p ON p.id=v.package_release_id WHERE p.job_id=$1`, [lease.id])).rows;
    if (packages.length !== lease.manifest.packages.length || variants.length !== lease.manifest.variants.length ||
      lease.manifest.packages.some(pkg => !packages.some(p => p.name === pkg.name && p.version === pkg.version && p.sha256 === pkg.tarball.sha256)) ||
      lease.manifest.variants.some(v => !variants.some(row => row.variant_id === v.variantId && row.name === v.packageName && row.version === v.packageVersion))) throw new PlatformError('ARTIFACT_MISMATCH');
  }
  private async ready(lease: ReleaseLease): Promise<void> {
    await this.verifyRegistered(lease);
    await this.db.transaction(async sql => {
      await this.leases.assert(lease, sql);
      await sql.query("UPDATE package_releases SET state='READY' WHERE job_id=$1", [lease.id]);
      await sql.query("UPDATE variant_releases SET availability='Ready' WHERE package_release_id IN (SELECT id FROM package_releases WHERE job_id=$1) AND availability='PENDING'", [lease.id]);
      await sql.query(`UPDATE screenshots s SET object_key=a.object_key FROM release_artifacts a
        WHERE s.job_id=$1 AND a.job_id=s.job_id AND a.path=s.metadata->'image'->>'path'`, [lease.id]);
      await enqueueReady(sql, lease.id);
      // Rows are locked in a stable name order by concurrent Ready transactions.
      const packages = (await sql.query('SELECT id,name,version FROM package_releases WHERE job_id=$1 ORDER BY name', [lease.id])).rows;
      for (const pkg of packages) {
        await sql.query('INSERT INTO release_tags(name,package_release_id) VALUES ($1,$2) ON CONFLICT(name) DO NOTHING', [pkg.name, pkg.id]);
        const current = (await sql.query(`SELECT p.version FROM release_tags t JOIN package_releases p ON p.id=t.package_release_id
          WHERE t.name=$1 FOR UPDATE OF t`, [pkg.name])).rows[0]!;
        if (compareVersions(pkg.version, current.version) > 0) await sql.query(`UPDATE release_tags SET package_release_id=$2,
          generation=generation+1,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() WHERE name=$1`, [pkg.name, pkg.id]);
      }
      await sql.query(`UPDATE release_jobs SET state='READY',stage='READY',lease_until=NULL,last_error=NULL,
        missing_artifacts='[]',next_attempt_at=NULL,updated_at=clock_timestamp() WHERE id=$1`, [lease.id]);
      await audit(sql, lease.subject, 'RELEASE_READY', lease.id, { manifestDigest: (await sql.query('SELECT manifest_digest FROM release_jobs WHERE id=$1', [lease.id])).rows[0].manifest_digest });
    });
  }
}
