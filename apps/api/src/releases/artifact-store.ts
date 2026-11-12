import type { ArtifactRef } from '@company/contracts';
import type { Database } from '../db/database.js';
import type { ArtifactStore } from '../storage/artifact-store.js';
import { PlatformError } from '../errors.js';
import { requireSafePath } from '../uploads/artifact-parser.js';
import { ReleaseLeases, type ReleaseLease } from './leases.js';
import { digestBytes } from './registry-client.js';

export class ReleaseArtifacts {
  constructor(private readonly db: Database, private readonly store: ArtifactStore, private readonly leases: ReleaseLeases) {}
  private key(lease: ReleaseLease, ref: ArtifactRef): string {
    try { requireSafePath(ref.path); } catch { throw new PlatformError('INVALID_PATH'); }
    return `releases/${lease.id}/${ref.path}`;
  }
  private async checked(key: string, ref: ArtifactRef): Promise<Uint8Array> {
    let bytes: Uint8Array;
    try { bytes = await this.store.read(key, ref.bytes); }
    catch (error) {
      if (error instanceof PlatformError && ['DIGEST_MISMATCH','LIMIT_EXCEEDED'].includes(error.code)) throw new PlatformError('CONFLICT');
      throw error;
    }
    if (digestBytes(bytes) !== ref.sha256) throw new PlatformError('CONFLICT');
    return bytes;
  }
  async read(lease: ReleaseLease, ref: ArtifactRef): Promise<Uint8Array> {
    const key = this.key(lease, ref);
    const record = (await this.db.query('SELECT object_key,sha256,bytes FROM release_artifacts WHERE job_id=$1 AND path=$2', [lease.id, ref.path])).rows[0];
    if (!record) throw new PlatformError('UPLOAD_INCOMPLETE');
    if (record.object_key !== key || record.sha256 !== ref.sha256 || Number(record.bytes) !== ref.bytes) throw new PlatformError('CONFLICT');
    return this.checked(key, ref);
  }
  async finalize(lease: ReleaseLease): Promise<void> {
    for (const ref of lease.manifest.files) {
      await this.leases.assert(lease);
      const key = this.key(lease, ref);
      try { await this.checked(key, ref); }
      catch (error) {
        if (!(error instanceof PlatformError) || error.code !== 'UPLOAD_INCOMPLETE') throw error;
        const source = (await this.db.query(`SELECT f.frozen_key,f.mime_type,f.sha256,f.bytes FROM upload_files f
          JOIN upload_sessions s ON s.id=f.session_id WHERE s.id=$1 AND s.state='COMPLETE' AND f.path=$2`, [lease.upload_session_id, ref.path])).rows[0];
        if (!source?.frozen_key || source.sha256 !== ref.sha256 || Number(source.bytes) !== ref.bytes) throw new PlatformError('ARTIFACT_MISMATCH');
        const bytes = await this.checked(source.frozen_key, ref);
        await this.leases.assert(lease);
        try { await this.store.freeze(key, bytes, source.mime_type ?? 'application/octet-stream'); }
        catch (writeError) {
          if (!(writeError instanceof PlatformError) || !['CONFLICT','INFRA_UNAVAILABLE'].includes(writeError.code)) throw writeError;
          // Conditional PUT may have completed before its response was lost.
          await this.checked(key, ref);
        }
        await this.checked(key, ref);
      }
      await this.db.transaction(async sql => {
        await this.leases.assert(lease, sql);
        await sql.query(`INSERT INTO release_artifacts(job_id,path,object_key,sha256,bytes) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT(job_id,path) DO NOTHING`, [lease.id, ref.path, key, ref.sha256, ref.bytes]);
        const saved = (await sql.query('SELECT object_key,sha256,bytes FROM release_artifacts WHERE job_id=$1 AND path=$2', [lease.id, ref.path])).rows[0]!;
        if (saved.object_key !== key || saved.sha256 !== ref.sha256 || Number(saved.bytes) !== ref.bytes) throw new PlatformError('CONFLICT');
      });
    }
  }
}
