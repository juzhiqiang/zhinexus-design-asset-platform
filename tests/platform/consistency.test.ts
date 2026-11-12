import { expect,it } from 'vitest';
import { workerHarness,realRegistry } from './t06-support.js';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { checkConsistency } from '../../infra/scripts/consistency.js';

it.each(['missing-screenshot','missing-report','changed-report','wrong-variant'] as const)('detects restored evidence corruption: %s',async corruption=>{
  const h=await workerHarness(undefined,{},'cli');
  try {
    const registry=await realRegistry();await new ReleaseWorker(h.db,h.store,registry).runOnce(h.jobId);
    expect(await checkConsistency(h.db,h.store,registry)).toMatchObject({packages:2,variants:3});
    // Corrupt only this isolated test DB, representing an incomplete restore. Never a recovery operation.
    if(corruption==='missing-screenshot') await h.db.query('DELETE FROM screenshots WHERE id=(SELECT id FROM screenshots LIMIT 1)');
    if(corruption==='missing-report') {await h.db.query('UPDATE screenshots SET report_id=NULL');await h.db.query('DELETE FROM check_reports');}
    if(corruption==='changed-report') await h.db.query("UPDATE check_reports SET content=jsonb_set(content,'{id}','\"corrupted\"')");
    if(corruption==='wrong-variant') await h.db.query(`UPDATE screenshots s SET variant_release_id=(SELECT id FROM variant_releases WHERE id<>s.variant_release_id LIMIT 1)
      WHERE s.id=(SELECT id FROM screenshots LIMIT 1)`);
    await expect(checkConsistency(h.db,h.store,registry)).rejects.toThrow('inconsistent');
  } finally {await h.close();}
});
