import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const result = spawnSync(process.execPath,[fileURLToPath(new URL('../node_modules/vitest/vitest.mjs',import.meta.url)),
  'run','--config','tests/platform/vitest.config.ts','tests/platform/backup-restore.test.ts'],{stdio:'inherit',windowsHide:true,shell:false});
process.exitCode = result.status===0 ? 0 : 1;
