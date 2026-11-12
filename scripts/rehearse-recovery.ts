import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Developer-machine verification only. No npm execution is introduced into either service.
const started = performance.now();
const test = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)), 'run',
  '--config', 'tests/platform/vitest.config.ts', 'tests/platform/platform-acceptance.test.ts', 'tests/platform/preview.test.ts'],
  { stdio: 'inherit', windowsHide: true, shell: false });
console.log(JSON.stringify({ rehearsal: 'release-recovery', passed: test.status === 0, durationMs: Math.round(performance.now() - started),
  evidence: 'local-real-services-and-protocol-fixtures', productionAcceptance: false }));
process.exitCode = test.status === 0 ? 0 : 1;
