import type { Sql } from '../db/access.js';

/** Enqueued in READY_TX. Search/index processing is independent of asset availability. */
export async function enqueueReady(sql: Sql, jobId: string): Promise<void> {
  await sql.query(`INSERT INTO release_outbox(job_id,topic,payload)
    VALUES ($1::uuid,'RELEASE_READY',jsonb_build_object('jobId',$1::uuid::text))`, [jobId]);
}
