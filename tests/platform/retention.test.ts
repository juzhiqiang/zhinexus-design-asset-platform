import { expect, it } from 'vitest';
import { retentionCandidates } from '../../apps/api/dist/operations/retention.js';
import { workerHarness, realRegistry } from './t06-support.js';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';

it('never proposes deletion of published or referenced uploads even when they are old', async () => {
  const h = await workerHarness(undefined,{retention:{uploadHours:48,failedDays:30}});
  try {
    const hours = (await h.db.query('SELECT extract(epoch FROM expires_at-created_at)/3600 h FROM upload_sessions')).rows[0]!.h;
    expect(Number(hours)).toBe(48);
    await new ReleaseWorker(h.db,h.store,await realRegistry()).runOnce(h.jobId);
    await h.db.query("UPDATE upload_sessions SET expires_at=now()-interval '100 days',created_at=now()-interval '102 days'");
    await h.db.query("UPDATE release_jobs SET updated_at=now()-interval '100 days'");
    expect(await retentionCandidates(h.db,{uploadHours:24,failedDays:30})).toEqual({mode:'review-only',uploads:[],failedJobs:[]});
  } finally { await h.close(); }
});
