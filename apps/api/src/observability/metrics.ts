import { API_ERROR_CODES, RELEASE_STATES, PUBLISHING_CHECKPOINTS } from '@company/contracts';
import type { Database } from '../db/database.js';

/** Current durable state, not a process-local approximation; errors must propagate. */
export async function metrics(db: Database): Promise<string> {
  const result = await db.query(`SELECT
    (SELECT coalesce(jsonb_object_agg(state,n),'{}') FROM (SELECT state,count(*) n FROM release_jobs GROUP BY state) s) states,
    (SELECT coalesce(jsonb_object_agg(code,n),'{}') FROM (SELECT last_error->>'code' code,count(*) n FROM release_jobs WHERE last_error IS NOT NULL GROUP BY 1) e) errors,
    (SELECT coalesce(jsonb_object_agg(state,n),'{}') FROM (SELECT state,count(*) n FROM release_outbox GROUP BY state) s) indexes,
    (SELECT coalesce(sum(attempt-1) FILTER(WHERE attempt>0),0) FROM release_jobs) retries,
    (SELECT coalesce(sum(jsonb_array_length(missing_artifacts)),0) FROM release_jobs) missing,
    (SELECT count(*) FROM release_jobs WHERE state IN ('PENDING','PUBLISHING','RETRY_WAIT')) backlog,
    (SELECT count(*) FROM release_tags WHERE generation<>applied_generation) tags`);
  const row = result.rows[0]!;
  const lines: string[] = [];
  for (const [name, keys, values] of [
    ['platform_release_jobs', RELEASE_STATES, row.states],
    ['platform_release_errors', API_ERROR_CODES, row.errors],
    ['platform_index_jobs', ['pending','indexed','failed'], row.indexes],
  ] as const) {
    lines.push(`# TYPE ${name} gauge`);
    for (const key of keys) lines.push(`${name}{${name === 'platform_release_errors' ? 'code' : 'state'}="${key}"} ${Number(values[key] ?? 0)}`);
  }
  for (const key of ['retries','missing','backlog','tags'] as const) lines.push(`# TYPE platform_release_${key} gauge`, `platform_release_${key} ${Number(row[key])}`);
  const stages = await db.query(`SELECT data->>'stage' stage, data->>'outcome' outcome, count(*) n,
    sum((data->>'durationMs')::double precision)/1000 seconds FROM audit_events WHERE event='RELEASE_STAGE' GROUP BY 1,2 ORDER BY 1,2`);
  lines.push('# TYPE platform_release_stage_duration_seconds summary');
  for (const row of stages.rows) if (PUBLISHING_CHECKPOINTS.includes(row.stage) && ['success','failure'].includes(row.outcome)) {
    const labels = `stage="${row.stage}",outcome="${row.outcome}"`;
    lines.push(`platform_release_stage_duration_seconds_count{${labels}} ${Number(row.n)}`,
      `platform_release_stage_duration_seconds_sum{${labels}} ${Number(row.seconds)}`);
  }
  return lines.join('\n') + '\n';
}
