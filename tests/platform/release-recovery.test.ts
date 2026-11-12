import { expect, it, vi } from 'vitest';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { realRegistry, workerHarness } from './t06-support.js';

it('does not publish a framework package before its missing company dependency becomes reachable', async () => {
  const h = await workerHarness(fixture => { fixture.manifest.packages[0]!.dependencies['@company/t06-absent-dependency'] = '0.0.1'; });
  try {
    const registry = await realRegistry(); const publish = vi.spyOn(registry, 'ensurePackage');
    await new ReleaseWorker(h.db, h.store, registry).runOnce(h.jobId);
    expect(publish).not.toHaveBeenCalled();
    expect((await h.db.query('SELECT state,stage,missing_artifacts FROM release_jobs')).rows[0]).toEqual({
      state: 'RETRY_WAIT', stage: 'ENSURE_PACKAGES', missing_artifacts: [h.fixture.manifest.packages[0]!.tarball.path],
    });
  } finally { await h.close(); }
});

it('atomically registers Ready, preserves manual evidence and queues indexing and tags separately', async () => {
  const h = await workerHarness();
  try {
    const registry = await realRegistry(); const worker = new ReleaseWorker(h.db, h.store, registry);
    expect(await worker.runOnce(h.jobId)).toBe(true);
    expect(await worker.runOnce(h.jobId)).toBe(false);
    const status = await h.request(`/v1/releases/${h.jobId}`, undefined, h.auth, 'GET');
    expect(await status.json()).toMatchObject({ state: 'READY', stage: 'READY', attempt: 1, missingArtifacts: [] });
    expect((await h.db.query('SELECT state FROM package_releases')).rows.every(r => r.state === 'READY')).toBe(true);
    expect((await h.db.query('SELECT availability FROM variant_releases')).rows.every(r => r.availability === 'Ready')).toBe(true);
    expect((await h.db.query('SELECT DISTINCT source FROM screenshots')).rows).toEqual([{ source: 'manual-upload' }]);
    expect((await h.db.query('SELECT count(*) FROM baseline_heads')).rows[0]!.count).toBe('0');
    expect((await h.db.query('SELECT state FROM release_outbox')).rows).toEqual([{ state: 'pending' }]);
    expect((await h.db.query('SELECT applied_generation FROM release_tags')).rows.every(r => r.applied_generation === '0')).toBe(true);
    const failedTag = vi.spyOn(registry, 'promote').mockRejectedValueOnce(new Error('sensitive upstream message'));
    await worker.tags.runOnce(); failedTag.mockRestore();
    expect((await h.db.query('SELECT state FROM release_jobs')).rows[0]!.state).toBe('READY');
    expect((await h.db.query('SELECT last_error FROM release_tags WHERE last_error IS NOT NULL')).rows).toEqual([{ last_error: 'INFRA_UNAVAILABLE' }]);
    await h.db.query('UPDATE release_tags SET next_attempt_at=now()');
    while (await worker.tags.runOnce()) { /* drain independent durable tag work */ }
    expect((await h.db.query('SELECT generation=applied_generation AS applied FROM release_tags')).rows.every(r => r.applied)).toBe(true);
    expect((await h.db.query("SELECT count(*) FROM audit_events WHERE event='RELEASE_READY'")).rows[0]!.count).toBe('1');
  } finally { await h.close(); }
});

it.each(['ENSURE_PACKAGES', 'REGISTER_ASSETS', 'CHECK_AVAILABILITY', 'READY_TX'] as const)('resumes from %s after a stopped worker without duplicating assets', async stage => {
  const h = await workerHarness();
  try {
    const registry = await realRegistry(); const first = new ReleaseWorker(h.db, h.store, registry);
    const checkpoint = first.leases.checkpoint.bind(first.leases);
    vi.spyOn(first.leases, 'checkpoint').mockImplementation(async (lease, next) => {
      await checkpoint(lease, next); if (next === stage) throw new Error('simulated stop after persistent checkpoint');
    });
    await first.runOnce(h.jobId);
    const row = (await h.db.query('SELECT state,stage FROM release_jobs')).rows[0]!;
    expect(row).toEqual({ state: 'RETRY_WAIT', stage });
    expect((await h.db.query("SELECT count(*) FROM variant_releases WHERE availability='Ready'")).rows[0]!.count).toBe('0');
    expect((await h.request(`/v1/releases/${h.jobId}/retry`, {}, h.auth)).status).toBe(202);
    await h.restart();
    await new ReleaseWorker(h.db, h.store, registry).runOnce(h.jobId);
    expect((await h.db.query('SELECT state,attempt FROM release_jobs')).rows[0]).toEqual({ state: 'READY', attempt: 2 });
    expect((await h.db.query('SELECT count(*) FROM variant_releases')).rows[0]!.count).toBe('3');
    for (const pkg of h.fixture.manifest.packages) await registry.verifyPackage(pkg);
  } finally { await h.close(); }
});

it('rolls back Ready and outbox together when PostgreSQL rejects the final transaction', async () => {
  const h = await workerHarness();
  try {
    const registry = await realRegistry(); const worker = new ReleaseWorker(h.db, h.store, registry);
    await h.db.query(`CREATE FUNCTION t06_fail_ready() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected commit boundary'; END $$;
      CREATE TRIGGER t06_fail_ready BEFORE INSERT ON release_outbox FOR EACH ROW EXECUTE FUNCTION t06_fail_ready()`);
    await worker.runOnce(h.jobId);
    expect((await h.db.query('SELECT state,stage FROM release_jobs')).rows[0]).toEqual({ state: 'RETRY_WAIT', stage: 'READY_TX' });
    expect((await h.db.query('SELECT count(*) FROM release_outbox')).rows[0]!.count).toBe('0');
    expect((await h.db.query("SELECT count(*) FROM package_releases WHERE state='READY'")).rows[0]!.count).toBe('0');
    await h.db.query('DROP TRIGGER t06_fail_ready ON release_outbox; DROP FUNCTION t06_fail_ready()');
    await h.request(`/v1/releases/${h.jobId}/retry`, {}, h.auth);
    await worker.runOnce(h.jobId);
    expect((await h.db.query('SELECT state FROM release_jobs')).rows[0]!.state).toBe('READY');
  } finally { await h.close(); }
});

it('does not allow an expired concurrent worker to commit Ready or failure over its successor', async () => {
  const h = await workerHarness();
  try {
    const registry = await realRegistry(); const first = new ReleaseWorker(h.db, h.store, registry);
    let unblock!: () => void; const gate = new Promise<void>(resolve => { unblock = resolve; });
    let reached!: () => void; const paused = new Promise<void>(resolve => { reached = resolve; });
    const publish = registry.ensurePackage.bind(registry);
    vi.spyOn(registry, 'ensurePackage').mockImplementationOnce(async (...args) => { reached(); await gate; return publish(...args); });
    const running = first.runOnce(h.jobId); await paused;
    await h.db.query("UPDATE release_jobs SET lease_until=now()-interval '1 second'");
    await new ReleaseWorker(h.db, h.store, await realRegistry()).runOnce(h.jobId);
    unblock(); await running;
    expect((await h.db.query('SELECT state,attempt FROM release_jobs')).rows[0]).toEqual({ state: 'READY', attempt: 2 });
    expect((await h.db.query("SELECT count(*) FROM audit_events WHERE event='RELEASE_READY'")).rows[0]!.count).toBe('1');
  } finally { await h.close(); }
});

it('rechecks availability on READY_TX recovery and refuses a missing preview resource', async () => {
  const h = await workerHarness();
  try {
    const worker = new ReleaseWorker(h.db, h.store, await realRegistry()); const checkpoint = worker.leases.checkpoint.bind(worker.leases);
    vi.spyOn(worker.leases, 'checkpoint').mockImplementation(async (lease, next) => { await checkpoint(lease, next); if (next === 'READY_TX') throw new Error('stop'); });
    await worker.runOnce(h.jobId);
    const preview = h.fixture.manifest.variants[0]!.examples[0]!.previewEntry;
    await h.store.client.send(new DeleteObjectCommand({ Bucket: h.store.config.bucket, Key: `releases/${h.jobId}/${preview}` }));
    await h.request(`/v1/releases/${h.jobId}/retry`, {}, h.auth);
    await new ReleaseWorker(h.db, h.store, await realRegistry()).runOnce(h.jobId);
    expect((await h.db.query('SELECT state,missing_artifacts FROM release_jobs')).rows[0]).toEqual({ state: 'RETRY_WAIT', missing_artifacts: [preview] });
  } finally { await h.close(); }
});
