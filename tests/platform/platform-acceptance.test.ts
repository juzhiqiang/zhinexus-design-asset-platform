import { expect, it } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { Database } from '../../apps/api/dist/db/database.js';
import { ArtifactStore } from '../../apps/api/dist/storage/artifact-store.js';
import { RegistryClient } from '../../apps/api/dist/releases/registry-client.js';
import { PlatformEvents } from '../../apps/api/dist/observability/events.js';
import { faultProxy, responseLossProxy } from './fault-proxy.js';
import { platformHarness } from './http-support.js';
import { workerHarness, registryToken, realRegistry } from './t06-support.js';

it.each(['postgres','minio','verdaccio'] as const)('recovers after a real %s transport outage without modifying persisted job state', async storage => {
  const h = await workerHarness();
  const port = { postgres: 15432, minio: 19000, verdaccio: 14873 }[storage];
  const proxy = await faultProxy(port); const events = new PlatformEvents(() => {});
  const dbUrl = new URL(h.options.databaseUrl); dbUrl.port = String(proxy.port);
  const db = storage === 'postgres' ? new Database(dbUrl.href) : h.db;
  const store = storage === 'minio' ? new ArtifactStore({ ...h.store.config, endpoint: proxy.origin }) : h.store;
  const registry = storage === 'verdaccio' ? new RegistryClient({ origin: proxy.origin, token: await registryToken() }) : await realRegistry();
  try {
    proxy.block();
    const first = new ReleaseWorker(db, store, registry, 1000, events);
    if (storage === 'postgres') await expect(first.runOnce(h.jobId)).rejects.toThrow();
    else {
      await first.runOnce(h.jobId);
      expect((await h.request(`/v1/releases/${h.jobId}`, undefined, h.auth, 'GET')).status).toBe(200);
      expect((await h.db.query('SELECT state FROM release_jobs')).rows[0]!.state).toBe('RETRY_WAIT');
    }
    proxy.restore();
    if (storage !== 'postgres') expect((await h.request(`/v1/releases/${h.jobId}/retry`, {}, h.auth)).status).toBe(202);
    await new ReleaseWorker(db, store, registry, 1000, events).runOnce(h.jobId);
    expect((await h.db.query('SELECT state FROM release_jobs')).rows[0]!.state).toBe('READY');
    for (const pkg of h.fixture.manifest.packages) await registry.verifyPackage(pkg);
    expect((await h.db.query("SELECT count(*) FROM audit_events WHERE event='RELEASE_READY'")).rows[0]!.count).toBe('1');
  } finally { if (db !== h.db) await db.close(); if (store !== h.store) store.close(); await proxy.close(); await h.close(); }
});

it('verifies an accepted npm publish after its HTTP response is lost instead of resending the package', async () => {
  const h = await workerHarness(); const proxy = await responseLossProxy(14873);
  try {
    const registry = new RegistryClient({ origin: proxy.origin, token: await registryToken() });
    await new ReleaseWorker(h.db, h.store, registry).runOnce(h.jobId);
    expect(proxy.lost()).toBe(true);
    expect((await h.db.query('SELECT state FROM release_jobs')).rows[0]!.state).toBe('READY');
    expect([...proxy.writes.values()]).toEqual([1,1]);
    for (const pkg of h.fixture.manifest.packages) await registry.verifyPackage(pkg);
  } finally { await proxy.close(); await h.close(); }
});

it('retries an interrupted upload using the original signed URL and freezes the exact bytes', async () => {
  const h = await platformHarness();
  try {
    const bytes = Buffer.alloc(1024 * 1024, 65); const token = await h.token();
    const ref = { path: 'assets/test.bin', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    const plan = await (await h.request('/v1/uploads', { manifestDigest: 'a'.repeat(64), files: [ref] }, token)).json();
    await new Promise<void>(resolve => {
      const req = httpRequest(plan.files[0].uploadUrl, { method: 'PUT', headers: { 'content-length': bytes.length } });
      req.on('error', () => resolve()); req.write(bytes.subarray(0, 16384), () => req.destroy());
    });
    expect((await h.request(`/v1/uploads/${plan.uploadSessionId}/complete`, { parts: [] }, token)).status).toBe(409);
    expect((await fetch(plan.files[0].uploadUrl, { method: 'PUT', body: bytes })).status).toBe(200);
    expect((await h.request(`/v1/uploads/${plan.uploadSessionId}/complete`, { parts: [] }, token)).status).toBe(200);
    const row = (await h.db.query('SELECT frozen_key FROM upload_files')).rows[0]!;
    expect(createHash('sha256').update(await h.store.read(row.frozen_key, bytes.length)).digest('hex')).toBe(ref.sha256);
  } finally { await h.close(); }
});

it('keeps Ready available when the downstream index fails and denies a revoked reader immediately', async () => {
  const h = await workerHarness();
  try {
    await new ReleaseWorker(h.db, h.store, await realRegistry()).runOnce(h.jobId);
    // Downstream index result only: there is no search index service in the T11 C scope.
    await h.db.query("UPDATE release_outbox SET state='failed'");
    const id = (await h.db.query('SELECT id FROM variant_releases LIMIT 1')).rows[0]!.id;
    const detail = await h.request(`/v1/me/variant-releases/${id}`, undefined, h.auth, 'GET');
    expect(detail.status).toBe(200); expect(await detail.json()).toMatchObject({ availability: 'Ready', indexStatus: 'failed' });
    await h.db.query("INSERT INTO disabled_subjects(subject) VALUES ('alice')");
    expect((await h.request(`/v1/me/variant-releases/${id}`, undefined, h.auth, 'GET')).status).toBe(403);
    expect((await h.db.query('SELECT state FROM release_jobs')).rows[0]!.state).toBe('READY');
  } finally { await h.close(); }
});

it('resumes a killed worker with a naturally expired lease and preserves already published tarballs', async () => {
  const h = await workerHarness();
  try {
    const token = await registryToken();
    const child = spawn(process.execPath, ['--import','tsx', fileURLToPath(new URL('./worker-process.ts', import.meta.url))], {
      stdio: ['pipe','pipe','pipe'], windowsHide: true,
    });
    const exited = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('Worker crash rehearsal timed out')); }, 30_000);
      child.on('error', () => { clearTimeout(timer); reject(new Error('Worker child did not start')); });
      child.on('exit', code => { clearTimeout(timer); code === 0 ? reject(new Error('Expected process termination')) : resolve(); });
    });
    child.stdout.resume(); child.stderr.resume();
    child.stdin.end(JSON.stringify({ databaseUrl: h.options.databaseUrl, storage: h.store.config, jobId: h.jobId, token }));
    await exited;
    const stopped = (await h.db.query('SELECT state,stage FROM release_jobs')).rows[0];
    expect(stopped).toEqual({ state: 'PUBLISHING', stage: 'REGISTER_ASSETS' });
    await delay(1200);
    await new ReleaseWorker(h.db, h.store, await realRegistry(), 1000, new PlatformEvents(() => {})).runOnce(h.jobId);
    expect((await h.db.query('SELECT state,attempt FROM release_jobs')).rows[0]).toEqual({ state: 'READY', attempt: 2 });
    for (const pkg of h.fixture.manifest.packages) await (await realRegistry()).verifyPackage(pkg);
    expect((await h.db.query('SELECT count(*) FROM variant_releases')).rows[0]!.count).toBe('3');
  } finally { await h.close(); }
});
