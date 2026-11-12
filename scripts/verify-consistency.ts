import { environmentOptions } from '../apps/api/dist/platform.js';
import { Database } from '../apps/api/dist/db/database.js';
import { ArtifactStore } from '../apps/api/dist/storage/artifact-store.js';
import { RegistryClient } from '../apps/api/dist/releases/registry-client.js';
import { checkConsistency } from '../infra/scripts/consistency.js';

let db:Database|undefined; let store:ArtifactStore|undefined;
try {
  const options=environmentOptions();
  if(!options.databaseUrl || !options.storage || !process.env.PLATFORM_REGISTRY_ORIGIN || !process.env.PLATFORM_REGISTRY_TOKEN) throw new Error();
  db=new Database(options.databaseUrl);store=new ArtifactStore(options.storage);
  const registry=new RegistryClient({origin:process.env.PLATFORM_REGISTRY_ORIGIN,token:process.env.PLATFORM_REGISTRY_TOKEN});
  console.log(JSON.stringify({consistent:true,...await checkConsistency(db,store,registry)}));
} catch {console.error('Storage consistency verification failed; check private configuration and restored references');process.exitCode=1;}
finally {store?.close();await db?.close();}
