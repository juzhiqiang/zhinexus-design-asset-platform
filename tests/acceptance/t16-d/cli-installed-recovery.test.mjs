// tests/acceptance/t16-d/cli-installed-recovery.test.mjs
import { test } from 'node:test';
import { start } from './installed-start.mjs';
import { checkBackup } from './installed-backup.mjs';
import { checkFields } from './installed-fields.mjs';
import { checkRecovery } from './installed-recovery.mjs';

test('t16-d cli-installed-recovery', { timeout: 1200000 }, async () => {
  const ctx = await start();
  console.log('[t16-d][area] tests/acceptance/t16-d/installed-start.mjs start 完成');
  const enrichedCtx = await checkBackup(ctx);
  console.log('[t16-d][area] tests/acceptance/t16-d/installed-backup.mjs checkBackup 完成，取得完整 enriched ctx');
  await checkFields(enrichedCtx);
  console.log('[t16-d][area] tests/acceptance/t16-d/installed-fields.mjs checkFields 完成（field-cases 与 stale 两个控制均已实际调用）');
  await checkRecovery(enrichedCtx);
  console.log('[t16-d][evidence] tests/acceptance/t16-d/cli-installed-recovery.test.mjs 四段实际调用全部完成');
});
