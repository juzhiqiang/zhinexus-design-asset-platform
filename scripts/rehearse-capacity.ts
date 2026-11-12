import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem, platform, arch, release } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runId = randomUUID();
const directory = join(root, '.tools', 'operations', 'capacity', runId);
mkdirSync(directory, { recursive: true });
const started = performance.now();
const tested = spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config',
  'tests/platform/vitest.config.ts', 'tests/platform/capacity.test.ts'], {
  cwd: root, env: { ...process.env, PLATFORM_CAPACITY_REPORT_DIR: directory },
  stdio: 'inherit', windowsHide: true, shell: false, timeout: 600_000,
});
let evidence: Record<string, unknown> = {};
let passed = tested.status === 0;
try {
  evidence = Object.fromEntries(['catalog', 'upload', 'release'].map(name => [name, JSON.parse(readFileSync(join(directory, `${name}.json`), 'utf8')) as unknown]));
} catch { passed = false; }
const summary = { runId, timestamp: new Date().toISOString(), passed, productionAcceptance: false,
  durationMs: Math.round(performance.now() - started),
  environment: { os: platform(), release: release(), arch: arch(), node: process.version,
    cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), network: 'Windows host / Docker Desktop / loopback' },
  evidence, limitations: ['Synthetic catalog cardinality; not 400 published SDK implementations.',
    '100MiB is a three-file submission within the existing 50MiB per-file limit.',
    'No company OIDC, independent production domain, real business pilot, production RPO/RTO or SLA acceptance.'] };
writeFileSync(join(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ rehearsal: 'capacity', passed, report: `.tools/operations/capacity/${runId}/summary.json`, productionAcceptance: false }));
process.exitCode = passed ? 0 : 1;
