import type { ApiErrorCode, PublishingCheckpoint, ReleaseManifestV1 } from '@company/contracts';
import type { Database } from '../db/database.js';
import { audit, type Sql } from '../db/access.js';
import { PlatformError } from '../errors.js';

export type ReleaseLease = {
  id: string; subject: string; manifest: ReleaseManifestV1; upload_session_id: string;
  fencing_token: string; stage: PublishingCheckpoint; attempt: number; retry_count: number;
};
const delays = [5, 15, 45, 120, 300];
export class ReleaseLeases {
  constructor(readonly db: Database, readonly leaseMs = 60_000) {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 600_000) throw new PlatformError('INVALID_SCHEMA');
  }
  async claim(jobId?: string): Promise<ReleaseLease | undefined> {
    return this.db.transaction(async sql => {
      // Bound repeated process crashes as well as handled network failures.
      const exhausted = await sql.query(`UPDATE release_jobs SET state='RETRY_WAIT',lease_until=NULL,
        fencing_token=fencing_token+1,next_attempt_at=NULL,updated_at=clock_timestamp()
        WHERE state='PUBLISHING' AND lease_until<=clock_timestamp() AND retry_count>=5 RETURNING id,subject`);
      for (const row of exhausted.rows) await audit(sql, row.subject, 'RELEASE_RETRY_EXHAUSTED', row.id, {});
      const result = await sql.query<ReleaseLease>(`WITH candidate AS (
        SELECT id FROM release_jobs WHERE ($1::uuid IS NULL OR id=$1) AND (
          state='PENDING' OR (state='RETRY_WAIT' AND next_attempt_at<=clock_timestamp()) OR
          (state='PUBLISHING' AND lease_until<=clock_timestamp()))
        ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
      ) UPDATE release_jobs j SET state='PUBLISHING',
        stage=CASE WHEN stage='PENDING' THEN 'FINALIZE_OBJECTS' ELSE stage END,
        retry_count=retry_count+CASE WHEN state='PUBLISHING' THEN 1 ELSE 0 END,
        attempt=attempt+1,fencing_token=fencing_token+1,
        lease_until=clock_timestamp()+($2::double precision * interval '1 millisecond'),next_attempt_at=NULL,
        updated_at=clock_timestamp() FROM candidate c WHERE j.id=c.id RETURNING j.*`, [jobId ?? null, this.leaseMs]);
      const lease = result.rows[0];
      if (lease) await audit(sql, lease.subject, 'RELEASE_CLAIMED', lease.id, { attempt: lease.attempt, fencingToken: lease.fencing_token });
      return lease;
    });
  }
  async assert(lease: ReleaseLease, sql: Sql = this.db): Promise<void> {
    const result = await sql.query(`SELECT id FROM release_jobs WHERE id=$1 AND fencing_token=$2
      AND state='PUBLISHING' AND lease_until>clock_timestamp()${sql === this.db ? '' : ' FOR UPDATE'}`, [lease.id, lease.fencing_token]);
    if (!result.rowCount) throw new PlatformError('LEASE_LOST');
  }
  async renew(lease: ReleaseLease): Promise<void> {
    const result = await this.db.query(`UPDATE release_jobs SET lease_until=clock_timestamp()+($3::double precision * interval '1 millisecond')
      WHERE id=$1 AND fencing_token=$2 AND state='PUBLISHING' AND lease_until>clock_timestamp()`, [lease.id, lease.fencing_token, this.leaseMs]);
    if (!result.rowCount) throw new PlatformError('LEASE_LOST');
  }
  async checkpoint(lease: ReleaseLease, stage: PublishingCheckpoint): Promise<void> {
    await this.db.transaction(async sql => {
      await this.assert(lease, sql);
      await sql.query('UPDATE release_jobs SET stage=$2,updated_at=clock_timestamp() WHERE id=$1', [lease.id, stage]);
      await audit(sql, lease.subject, 'RELEASE_CHECKPOINT', lease.id, { stage });
    });
    lease.stage = stage;
  }
  async fail(lease: ReleaseLease, code: ApiErrorCode, missing: string[] = []): Promise<void> {
    await this.db.transaction(async sql => {
      await this.assert(lease, sql);
      const terminal = code === 'CONFLICT' ? 'CONFLICT' : ['DIGEST_MISMATCH','INVALID_SCHEMA','ARTIFACT_MISMATCH','INVALID_PATH','LIMIT_EXCEEDED'].includes(code) ? 'REJECTED' : 'RETRY_WAIT';
      const retry = lease.retry_count + 1;
      const delay = terminal === 'RETRY_WAIT' && retry <= delays.length ? delays[retry - 1]! * (0.8 + Math.random() * 0.4) : null;
      const error = { code, message: code, details: [], requestId: lease.id };
      await sql.query(`UPDATE release_jobs SET state=$2,last_error=$3,missing_artifacts=$4,retry_count=$5,
        next_attempt_at=CASE WHEN $6::double precision IS NULL THEN NULL ELSE clock_timestamp()+($6 * interval '1 second') END,
        lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1`, [lease.id, terminal, JSON.stringify(error), JSON.stringify(missing), retry, delay]);
      await audit(sql, lease.subject, 'RELEASE_FAILED', lease.id, { state: terminal, code, retryCount: retry });
    });
  }
}
