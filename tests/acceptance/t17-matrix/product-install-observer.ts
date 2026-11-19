import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { sanitizeProductOutput } from './product-process.js';
type Log = { path: string; operationId: string; text: string };
/** Read-only diagnostics of a fresh owned parent; npmrc and process credentials are never read. */
export async function observeProductInstallLogs(parent: string, secrets: readonly string[]) {
  const root = resolve(parent), rootInfo = await lstat(root, { bigint: true });
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || await realpath(root) !== root) throw new Error('Install observation requires an ordinary owned parent.');
  const initial = new Set(await readdir(root)), collected = new Map<string, Log>();
  let stopped = false, observationError: unknown;
  const scan = async () => {
    const now = await lstat(root, { bigint: true });
    if (!now.isDirectory() || now.isSymbolicLink() || now.dev !== rootInfo.dev || now.ino !== rootInfo.ino) throw new Error('Install observation parent identity changed.');
    for (const name of await readdir(root)) {
      if (initial.has(name) || !name.startsWith('.t16-env-')) continue;
      try {
        const env = join(root, name), envInfo = await lstat(env);
        if (!envInfo.isDirectory() || envInfo.isSymbolicLink()) throw new Error('Install observation environment is linked.');
        const markerPath = join(env, '.t16-owner.json'), markerInfo = await lstat(markerPath);
        if (!markerInfo.isFile() || markerInfo.isSymbolicLink() || markerInfo.nlink !== 1) throw new Error('Install observation marker is unsafe.');
        const marker = JSON.parse(await readFile(markerPath, 'utf8')) as Record<string, unknown>;
        if (marker.kind !== 't16-external-root' || marker.role !== 'env' || typeof marker.operationId !== 'string' || !marker.operationId.startsWith('apply-')) throw new Error('Install observation marker operation is invalid.');
        const directory = join(env, 'cache/_logs');
        for (const path of [join(env, 'cache'), directory]) {
          const info = await lstat(path);
          if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) throw new Error('Install diagnostic parent is linked or unsafe.');
        }
        for (const log of await readdir(directory, { withFileTypes: true })) {
          if (!log.name.endsWith('-debug-0.log')) continue;
          const path = join(directory, log.name), before = await lstat(path, { bigint: true });
          if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > 16n * 1024n * 1024n) throw new Error('Install diagnostic log is unsafe.');
          const text = sanitizeProductOutput(await readFile(path, 'utf8'), secrets), after = await lstat(path, { bigint: true });
          if (!after.isFile() || after.isSymbolicLink() || after.dev !== before.dev || after.ino !== before.ino) throw new Error('Install diagnostic log identity changed.');
          collected.set(marker.operationId + '/' + log.name, { path: name + '/cache/_logs/' + log.name, operationId: marker.operationId, text });
        }
      } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
    }
  };
  const observing = (async () => { while (!stopped) { await scan(); if (!stopped) await new Promise(done => setTimeout(done, 20)); } })().catch(error => { observationError = error; stopped = true; });
  return async (operationId?: string) => {
    stopped = true; await observing;
    if (observationError) throw observationError;
    if (!operationId && collected.size || [...collected.values()].some(log => log.operationId !== operationId)) throw new Error('Install diagnostic operation identity differs from apply output.');
    return { schemaVersion: 1, kind: 'owned-product-install-log-observation', credentialsRead: false,
      operationId, logs: [...collected.values()] };
  };
}
