import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Database } from '../db/database.js';
import { ArtifactStore } from '../storage/artifact-store.js';
import { environmentOptions } from '../platform.js';
import { RegistryClient } from './registry-client.js';
import { ReleaseWorker } from './worker.js';

export async function runWorker(once = false, jobId?: string): Promise<void> {
  const options = environmentOptions();
  if (!options.databaseUrl || !options.storage || !process.env.PLATFORM_REGISTRY_ORIGIN || !process.env.PLATFORM_REGISTRY_TOKEN) throw new Error('Worker configuration is incomplete');
  const registry = new RegistryClient({ origin: process.env.PLATFORM_REGISTRY_ORIGIN, token: process.env.PLATFORM_REGISTRY_TOKEN });
  const store = new ArtifactStore(options.storage); const db = new Database(options.databaseUrl);
  const worker = new ReleaseWorker(db, store, registry);
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  try {
    // Migrations are an explicit deployment operation; never silently run DDL here.
    do {
      try { await worker.runOnce(jobId); await worker.tags.runOnce(); }
      catch { worker.events.emit({ event: 'WORKER_UNAVAILABLE' }); if (once) throw new Error('Worker iteration failed'); }
      if (!once && !stopping) await delay(1000);
    } while (!once && !stopping);
  } finally { process.off('SIGTERM', stop); process.off('SIGINT', stop); store.close(); await db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runWorker(process.argv.includes('--once'), process.env.PLATFORM_WORKER_JOB_ID).catch(() => { console.error('Release worker failed; inspect configuration and persisted job status'); process.exitCode = 1; });
}
