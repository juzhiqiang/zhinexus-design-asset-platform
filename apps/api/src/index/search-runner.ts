import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Database } from '../db/database.js';
import { SearchIndexer } from './search-indexer.js';

/** Separate derived-index worker; migrations are an explicit deployment step. */
export async function runSearchWorker(once = false, rebuildJobId?: string): Promise<void> {
  const connection = process.env.PLATFORM_DATABASE_URL;
  if (!connection) throw new Error('Search database configuration is required');
  const db = new Database(connection); const indexer = new SearchIndexer(db);
  let stopping = false; const stop = () => { stopping = true; };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  try {
    if (rebuildJobId) { await indexer.rebuild(rebuildJobId); return; }
    do { await indexer.runOnce(); if (!once && !stopping) await delay(1000); } while (!once && !stopping);
  } finally { process.off('SIGTERM', stop); process.off('SIGINT', stop); await db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runSearchWorker(process.argv.includes('--once'), process.env.PLATFORM_SEARCH_REBUILD_JOB_ID).catch(() => {
    console.error('Search worker failed; inspect index state without exposing credentials.'); process.exitCode = 1;
  });
}
