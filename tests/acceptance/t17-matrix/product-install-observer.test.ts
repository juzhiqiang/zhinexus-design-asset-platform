import { afterEach, expect, it } from 'vitest';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createOwnedRun } from '../t17-host/host.js';
import { observeProductInstallLogs } from './product-install-observer.js';
const runs: Awaited<ReturnType<typeof createOwnedRun>>[] = [];
afterEach(async () => { for (const run of runs.splice(0)) {
  for (const root of Object.values(run.projectRoots)) { const names = (await readdir(root)).filter(name => name !== '.t17-owner.json'); if (names.length) await run.registerOwnedPath(root, names); }
  await run.abortForTest();
} });
it('captures only this owned operation log and redacts credentials before retention', async () => {
  const run = await createOwnedRun(); runs.push(run);
  const project = run.projectRoots.vue, env = join(project, '.t16-env-observed'), logs = join(env, 'cache/_logs');
  const stop = await observeProductInstallLogs(project, ['private-secret']);
  await mkdir(logs, { recursive: true });
  await writeFile(join(env, '.t16-owner.json'), JSON.stringify({ kind: 't16-external-root', role: 'env', operationId: 'apply-owned' }));
  await writeFile(join(env, 'npmrc'), 'must-never-be-read=private-secret');
  await writeFile(join(logs, '2026-debug-0.log'), 'npm diagnostic private-secret Authorization: Bearer bearer-value');
  await new Promise(done => setTimeout(done, 100));
  const result = await stop('apply-owned');
  expect(result).toMatchObject({ credentialsRead: false, operationId: 'apply-owned', logs: [{ text: 'npm diagnostic [REDACTED] Authorization: Bearer [REDACTED]' }] });
  expect(await readFile(join(env, 'npmrc'), 'utf8')).toBe('must-never-be-read=private-secret');
});
it('rejects log evidence belonging to a different operation', async () => {
  const run = await createOwnedRun(); runs.push(run);
  const project = run.projectRoots.vue, env = join(project, '.t16-env-unrelated');
  const stop = await observeProductInstallLogs(project, []);
  await mkdir(join(env, 'cache/_logs'), { recursive: true });
  await writeFile(join(env, '.t16-owner.json'), JSON.stringify({ kind: 't16-external-root', role: 'env', operationId: 'apply-other' }));
  await writeFile(join(env, 'cache/_logs/2026-debug-0.log'), 'unrelated');
  await new Promise(done => setTimeout(done, 100));
  await expect(stop('apply-expected')).rejects.toThrow(/operation/i);
});
