import { expect, it } from 'vitest';
import { isolatedDatabase, localServices } from './support.js';

it('connects to runner-owned PostgreSQL, MinIO and Verdaccio without shared fixed ports', async () => {
  const services = localServices();
  expect(services.postgresPort).not.toBe(15432);
  expect(services.storageEndpoint).not.toBe('http://127.0.0.1:19000');
  expect(services.registryOrigin).not.toBe('http://127.0.0.1:14873');
  const database = await isolatedDatabase();
  try {
    expect(new URL(database.url).port).toBe(String(services.postgresPort));
    expect((await fetch(`${services.storageEndpoint}/minio/health/ready`)).status).toBe(200);
    expect((await fetch(`${services.registryOrigin}/-/ping`)).status).toBe(200);
  } finally { await database.close(); }
});
