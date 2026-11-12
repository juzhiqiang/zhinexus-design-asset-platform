import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

export function localCredentials(): { postgresPassword: string; minioUser: string; minioPassword: string } {
  try { return JSON.parse(readFileSync(fileURLToPath(new URL('../../.tools/g2-local/credentials.json', import.meta.url)), 'utf8')); }
  catch { throw new Error('Run infra:up before test:platform; real storage is required'); }
}
export async function isolatedDatabase(): Promise<{ url: string; close(): Promise<void> }> {
  const config = localCredentials();
  const connection = { host: '127.0.0.1', port: 15432, user: 'zhinexus', password: config.postgresPassword, database: 'zhinexus', connectionTimeoutMillis: 5000 };
  const name = `t05_${randomUUID().replaceAll('-', '')}`;
  const admin = new Client(connection);
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(`postgresql://127.0.0.1:15432/${name}`);
  url.username = connection.user;
  url.password = connection.password;
  return { url: url.href, close: async () => {
    try { await admin.query(`DROP DATABASE ${name} WITH (FORCE)`); } finally { await admin.end(); }
  } };
}
