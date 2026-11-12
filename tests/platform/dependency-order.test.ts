import { expect, it } from 'vitest';
import { ReleaseLeases } from '../../apps/api/dist/releases/leases.js';
import { ReleaseArtifacts } from '../../apps/api/dist/releases/artifact-store.js';
import { checkAvailability } from '../../apps/api/dist/releases/availability.js';
import { realRegistry, workerHarness } from './t06-support.js';

it('freezes all real S3 objects idempotently and never claims availability without packages or dependencies', async () => {
  const h = await workerHarness();
  try {
    const leases = new ReleaseLeases(h.db); const lease = (await leases.claim(h.jobId))!;
    const artifacts = new ReleaseArtifacts(h.db, h.store, leases); const registry = await realRegistry();
    await artifacts.finalize(lease); await artifacts.finalize(lease);
    expect((await h.db.query('SELECT count(*) FROM release_artifacts WHERE job_id=$1', [h.jobId])).rows[0]!.count).toBe(String(h.fixture.manifest.files.length));
    expect((await checkAvailability(lease, artifacts, registry)).ok).toBe(false);
    for (const pkg of lease.manifest.packages) {
      const result = await registry.ensurePackage(pkg, await artifacts.read(lease, pkg.tarball), `candidate-${h.jobId}`);
      expect(result.status).toBe('published');
      expect((await registry.ensurePackage(pkg, h.fixture.files.get(pkg.tarball.path)!, `candidate-${h.jobId}`)).status).toBe('already-identical');
    }
    expect(await checkAvailability(lease, artifacts, registry)).toEqual({ ok: true, missing: [] });
    await expect(registry.verifyDependencies({ name: '@company/t06-missing-core', version: '0.0.1' })).rejects.toMatchObject({ code: 'UPLOAD_INCOMPLETE' });
    // Upload evidence expiration cannot invalidate an already accepted release.
    await h.db.query("UPDATE upload_sessions SET expires_at=now()-interval '1 day' WHERE id=$1", [h.uploadSessionId]);
    await artifacts.finalize(lease);
  } finally { await h.close(); }
});

it('refuses an existing object with another digest instead of overwriting it', async () => {
  const h = await workerHarness();
  try {
    const leases = new ReleaseLeases(h.db); const lease = (await leases.claim(h.jobId))!;
    const ref = lease.manifest.files[0]!;
    await h.store.freeze(`releases/${h.jobId}/${ref.path}`, new Uint8Array(ref.bytes).fill(1), 'application/octet-stream');
    await expect(new ReleaseArtifacts(h.db, h.store, leases).finalize(lease)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(Buffer.from(await h.store.read(`releases/${h.jobId}/${ref.path}`, ref.bytes))).toEqual(Buffer.alloc(ref.bytes, 1));
  } finally { await h.close(); }
});
