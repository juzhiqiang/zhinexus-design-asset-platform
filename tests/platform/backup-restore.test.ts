import { expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRecoveryStack } from '../../infra/scripts/recovery-stack.js';
import { backupStack, restoreStack } from '../../infra/scripts/backup.js';
import { checkConsistency } from '../../infra/scripts/consistency.js';
import { seedRecovery } from './backup-support.js';

it('restores real PostgreSQL, Verdaccio and MinIO backups into a new stack and checks every published reference', async () => {
  const source = await createRecoveryStack(); let target: Awaited<ReturnType<typeof createRecoveryStack>> | undefined;
  try {
    await seedRecovery(source);
    const before = await source.clients(async c => checkConsistency(c.db,c.store,c.registry));
    expect(before.packages).toBe(2); expect(before.variants).toBe(3); expect(before.objects).toBeGreaterThan(10);
    const dir = join(source.directory, 'backup'); const start = performance.now();
    const backup = await backupStack(source,dir);
    await expect(restoreStack(source,dir)).rejects.toThrow();
    target = await createRecoveryStack(source.secrets);
    const restored = await restoreStack(target,dir);
    expect(restored).toMatchObject(before);
    await expect(restoreStack(target,dir)).rejects.toThrow();
    const durationMs = Math.round(performance.now() - start);
    const report = { backupBytes: Object.values(backup.files).reduce((sum,f)=>sum+f.bytes,0), ...restored, durationMs,
      isolatedRestore: true, productionAcceptance: false };
    await mkdir('.tools/operations', {recursive:true});
    await writeFile('.tools/operations/backup-report.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally { await target?.close(); await source.close(); }
}, 180_000);
