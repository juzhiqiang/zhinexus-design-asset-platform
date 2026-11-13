import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  connectError: false, createError: false, bucketExists: false, bucketCreated: true,
  clients: [] as Array<{ ended: boolean }>, databases: new Set<string>(),
  buckets: [] as string[], storeClosed: false, storeCloseError: false,
}));
vi.mock('pg', () => ({ Client: class {
  ended = false;
  constructor() { state.clients.push(this); }
  async connect() { if (state.connectError) throw new Error('connect failed'); }
  async query(sql: string) {
    const name = sql.match(/t05_[a-f0-9]+/)?.[0];
    if (sql.startsWith('CREATE DATABASE')) {
      state.databases.add(name!);
      if (state.createError) throw new Error('create response lost');
    }
    if (sql.startsWith('DROP DATABASE')) state.databases.delete(name!);
    return { rows: [] };
  }
  async end() { this.ended = true; }
} }));
vi.mock('../../apps/api/dist/db/database.js', () => ({ Database: class { async close() {} } }));
vi.mock('../../apps/api/dist/db/migrate.js', () => ({ migrateRegistry: async () => {} }));
vi.mock('../../apps/api/dist/app.js', () => ({ buildServer: vi.fn() }));
vi.mock('../../apps/api/dist/platform.js', () => ({ Platform: class {} }));
vi.mock('../../apps/api/dist/storage/artifact-store.js', () => ({ ArtifactStore: class {
  constructor(readonly config: { bucket: string }) {}
  async ensureBucket() { state.bucketExists = state.bucketCreated; throw new Error('bucket response lost'); }
  client = { send: async (command: { input: { Bucket: string }; constructor: { name: string } }) => {
    state.buckets.push(command.input.Bucket);
    if (!state.bucketExists) throw Object.assign(new Error('missing bucket'), { name: 'NoSuchBucket' });
    if (command.constructor.name === 'DeleteBucketCommand') state.bucketExists = false;
    return {};
  } };
  close() { state.storeClosed = true; if (state.storeCloseError) throw new Error('store close failed'); }
} }));

import { isolatedDatabase } from '../platform/support.js';
import { platformHarness } from '../platform/http-support.js';

const services = { credentials: { postgresPassword: 'test', minioUser: 'test', minioPassword: 'test', publisherPassword: 'test', readerPassword: 'test' },
  postgresPort: 12345, storageEndpoint: 'http://127.0.0.1:12346', registryOrigin: 'http://127.0.0.1:12347' };

beforeEach(() => {
  state.connectError = false; state.createError = false; state.bucketExists = false; state.bucketCreated = true;
  state.clients.length = 0; state.databases.clear(); state.buckets.length = 0; state.storeClosed = false; state.storeCloseError = false;
});

it('closes the admin connection when database connection setup fails', async () => {
  state.connectError = true;
  await expect(isolatedDatabase(services)).rejects.toThrow('connect failed');
  expect(state.clients.every(client => client.ended)).toBe(true);
});

it('removes only its database if CREATE succeeds but the response is lost', async () => {
  state.createError = true;
  state.databases.add('unrelated_database');
  await expect(isolatedDatabase(services)).rejects.toThrow('create response lost');
  expect([...state.databases]).toEqual(['unrelated_database']);
  expect(state.clients.every(client => client.ended)).toBe(true);
});

it('cleans its bucket and database if bucket creation succeeds but the response is lost', async () => {
  await expect(platformHarness({}, services)).rejects.toThrow('bucket response lost');
  expect(state.bucketExists).toBe(false);
  expect(new Set(state.buckets).size).toBe(1);
  expect(state.buckets[0]).toMatch(/^t05-[a-f0-9-]{36}$/);
  expect(state.databases.size).toBe(0);
  expect(state.clients.every(client => client.ended)).toBe(true);
  expect(state.storeClosed).toBe(true);
});

it('preserves the setup error and closes resources if the intended bucket never existed', async () => {
  state.bucketCreated = false;
  await expect(platformHarness({}, services)).rejects.toThrow('bucket response lost');
  expect(state.databases.size).toBe(0);
  expect(state.clients.every(client => client.ended)).toBe(true);
  expect(state.storeClosed).toBe(true);
});

it('still closes database resources when the storage client cleanup throws', async () => {
  state.storeCloseError = true;
  await expect(platformHarness({}, services)).rejects.toThrow('store close failed');
  expect(state.bucketExists).toBe(false);
  expect(state.databases.size).toBe(0);
  expect(state.clients.every(client => client.ended)).toBe(true);
});
