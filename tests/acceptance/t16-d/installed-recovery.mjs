// tests/acceptance/t16-d/installed-recovery.mjs
import { checkWrongSHA } from './installed-recovery-cold.mjs';
import { recover } from './installed-recovery-result.mjs';
import { checkRestored } from './installed-recovery-source.mjs';

export async function checkRecovery(ctx) {
  const { s, ref } = ctx;
  console.error(`[t16-d/recovery] area=${s.area} evidence=${s.evidence} ref=${ref.id}`);
  await checkWrongSHA(ctx);
  const json = await recover(ctx);
  await checkRestored(ctx);
  return json;
}
