import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

export type LocalCredentials = { postgresPassword: string; minioUser: string; minioPassword: string; publisherPassword: string; readerPassword: string };
export type PlatformServices = { credentials: LocalCredentials; postgresPort: number; storageEndpoint: string; registryOrigin: string };

let providedServices: PlatformServices | undefined;
export function configurePlatformServices(services: PlatformServices): void { providedServices = services; }
export function localServices(): PlatformServices {
  if (!providedServices) throw new Error('Isolated platform services were not provided by the test runner');
  return providedServices;
}
export async function isolatedDatabase(services = localServices()): Promise<{ url: string; close(): Promise<void> }> {
  const connection = { host: '127.0.0.1', port: services.postgresPort, user: 'zhinexus', password: services.credentials.postgresPassword, database: 'zhinexus', connectionTimeoutMillis: 5000 };
  const name = `t05_${randomUUID().replaceAll('-', '')}`;
  const admin = new Client(connection);
  let creationAttempted = false;
  try {
    await admin.connect();
    creationAttempted = true;
    await admin.query(`CREATE DATABASE ${name}`);
  } catch (error) {
    try {
      if (creationAttempted) {
        // A lost CREATE response can leave the database behind and its connection unusable.
        const cleanup = new Client(connection);
        try { await cleanup.connect(); await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); }
        finally { await cleanup.end(); }
      }
    } finally { await admin.end(); }
    throw error;
  }
  const url = new URL(`postgresql://127.0.0.1:${services.postgresPort}/${name}`);
  url.username = connection.user;
  url.password = connection.password;
  return { url: url.href, close: async () => {
    try { await admin.query(`DROP DATABASE ${name} WITH (FORCE)`); } finally { await admin.end(); }
  } };
}
