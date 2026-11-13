import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

export type LocalCredentials = { postgresPassword: string; minioUser: string; minioPassword: string; publisherPassword: string; readerPassword: string };
export type PlatformServices = { credentials: LocalCredentials; postgresPort: number; storageEndpoint: string; registryOrigin: string };

export function localCredentials(): LocalCredentials {
  try { return JSON.parse(readFileSync(fileURLToPath(new URL('../../.tools/g2-local/credentials.json', import.meta.url)), 'utf8')); }
  catch { throw new Error('Run infra:up before test:platform; real storage is required'); }
}
export function localServices(): PlatformServices {
  return { credentials: localCredentials(), postgresPort: 15432, storageEndpoint: 'http://127.0.0.1:19000', registryOrigin: 'http://127.0.0.1:14873' };
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
