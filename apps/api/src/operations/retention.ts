import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Database } from '../db/database.js';

export type RetentionPolicy = {uploadHours:number;failedDays:number};
export function retentionPolicy(env: Record<string,string|undefined> = process.env): RetentionPolicy {
  const integer = (value: string|undefined, fallback:number, max:number) => {
    if (value!==undefined && !/^\d+$/.test(value)) throw new Error('Invalid retention configuration');
    const n = value===undefined ? fallback : Number(value);
    if (!Number.isSafeInteger(n) || n<1 || n>max) throw new Error('Invalid retention configuration'); return n;
  };
  return {uploadHours:integer(env.PLATFORM_UPLOAD_RETENTION_HOURS,24,720),failedDays:integer(env.PLATFORM_FAILED_RETENTION_DAYS,30,3650)};
}
/** Planning only. Never delete registry versions, objects, jobs or evidence on a time-based rule. */
export async function retentionCandidates(db: Database, policy: RetentionPolicy) {
  const uploads = (await db.query(`SELECT id FROM upload_sessions s WHERE state<>'VERIFYING' AND expires_at<clock_timestamp()
    AND created_at<clock_timestamp()-($1::double precision*interval '1 hour')
    AND NOT EXISTS(SELECT 1 FROM release_jobs j WHERE j.upload_session_id=s.id) ORDER BY id`,[policy.uploadHours])).rows.map(r=>r.id as string);
  const failedJobs = (await db.query(`SELECT id FROM release_jobs j WHERE state IN ('REJECTED','CONFLICT')
    AND updated_at<clock_timestamp()-($1::double precision*interval '1 day')
    AND NOT EXISTS(SELECT 1 FROM package_releases p WHERE p.job_id=j.id AND p.state='READY')
    ORDER BY id`,[policy.failedDays])).rows.map(r=>r.id as string);
  return {mode:'review-only' as const,uploads,failedJobs};
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const url = process.env.PLATFORM_DATABASE_URL;
  if (!url) {console.error('Retention database configuration is required');process.exitCode=1;}
  else {
    const db = new Database(url);
    try { console.log(JSON.stringify(await retentionCandidates(db,retentionPolicy()))); }
    catch {console.error('Retention report failed');process.exitCode=1;}
    finally {await db.close();}
  }
}
