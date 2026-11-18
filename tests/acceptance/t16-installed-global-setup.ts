import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import type { TestProject } from 'vitest/node';
import type {} from '../platform/global-setup.js';
import { RecoveryStack } from '../../infra/scripts/recovery-stack.js';

// Only this isolated installation suite needs a real public npm uplink. Reuse
// resource ownership, credential handling, readiness and teardown unchanged.
class InstalledAcceptanceStack extends RecoveryStack {
  override docker(args: string[]): string {
    const source = resolve('infra/verdaccio/config.yaml');
    const target = resolve('tests/acceptance/t16-registry.yaml');
    const original = `type=bind,src=${source},dst=/verdaccio/conf/config.yaml,readonly`;
    return super.docker(args.map(arg => arg === original
      ? `type=bind,src=${target},dst=/verdaccio/conf/config.yaml,readonly` : arg));
  }
}

export default async function setup(project: TestProject) {
  const password = () => randomBytes(32).toString('base64url');
  const stack = new InstalledAcceptanceStack({ postgresPassword: password(), publisherPassword: password(),
    readerPassword: password(), minioUser: 'recovery-user', minioPassword: password() });
  try { await stack.start(); } catch (error) { await stack.close(); throw error; }
  project.provide('platformServices', { credentials: stack.secrets, postgresPort: stack.ports.postgres,
    storageEndpoint: `http://127.0.0.1:${stack.ports.minio}`, registryOrigin: `http://127.0.0.1:${stack.ports.verdaccio}` });
  console.log(JSON.stringify({ event: 'T16_ISOLATED_INSTALL_SERVICES', id: stack.id,
    publicDependencySource: 'https://registry.npmjs.org/', productionAcceptance: false }));
  return async () => { await stack.close(); };
}
