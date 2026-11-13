import type { TestProject } from 'vitest/node';
import { createRecoveryStack } from '../../infra/scripts/recovery-stack.js';
import type { PlatformServices } from './support.js';

declare module 'vitest' {
  export interface ProvidedContext { platformServices: PlatformServices }
}

/** Credentials travel only in Vitest's worker context; shared G2 files and ports are never adopted. */
export default async function setup(project: TestProject) {
  const stack = await createRecoveryStack();
  project.provide('platformServices', {
    credentials: stack.secrets, postgresPort: stack.ports.postgres,
    storageEndpoint: `http://127.0.0.1:${stack.ports.minio}`,
    registryOrigin: `http://127.0.0.1:${stack.ports.verdaccio}`,
  });
  console.log(JSON.stringify({ event: 'PLATFORM_ISOLATED_SERVICES', id: stack.id, productionAcceptance: false }));
  return async () => { await stack.close(); };
}
