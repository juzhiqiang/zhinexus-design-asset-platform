// Local test driver only. It is never included in a service package/image.
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { Database } from '../../apps/api/dist/db/database.js';
import { ArtifactStore } from '../../apps/api/dist/storage/artifact-store.js';
import { RegistryClient } from '../../apps/api/dist/releases/registry-client.js';
import { PlatformEvents } from '../../apps/api/dist/observability/events.js';

const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
const options = JSON.parse(Buffer.concat(chunks).toString());
const db = new Database(options.databaseUrl); const store = new ArtifactStore(options.storage);
try {
  const events = new PlatformEvents(line => {
    const event = JSON.parse(line);
    if (event.event === 'RELEASE_STAGE' && event.stage === 'ENSURE_PACKAGES' && event.outcome === 'success') process.kill(process.pid, 'SIGKILL');
  });
  await new ReleaseWorker(db, store, new RegistryClient({ origin: options.registryOrigin, token: options.token }), 1000, events).runOnce(options.jobId);
} finally { store.close(); await db.close(); }
