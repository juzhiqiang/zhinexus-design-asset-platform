import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { packageBytes, replaceBundleArtifact } from '../fixtures/t05-artifacts.js';
import { realRegistry, registryToken, workerHarness } from './t06-support.js';
import { upload, release } from './http-support.js';

async function latest(name: string): Promise<string | undefined> {
  const response = await fetch(`http://127.0.0.1:14873/-/package/${encodeURIComponent(name)}/dist-tags`, {
    headers: { authorization: `Bearer ${await registryToken('g2reader')}` }, redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  expect(response.status).toBe(200); return (await response.json()).latest as string | undefined;
}

it('repairs a late old tag write even after the current generation was acknowledged', async () => {
  const h = await workerHarness();
  try {
    const registry = await realRegistry(); const worker = new ReleaseWorker(h.db, h.store, registry);
    await worker.runOnce(h.jobId); while (await worker.tags.runOnce()) { /* initial reconciliation */ }
    const current = h.fixture.manifest.packages[0]!;
    expect(await latest(current.name)).toBe(current.version);
    const older = structuredClone(h.fixture); const ref = older.manifest.packages[0]!; ref.version = '0.0.0';
    replaceBundleArtifact(older, ref.tarball.path, await packageBytes(older, 0));
    await registry.ensurePackage(ref, older.files.get(ref.tarball.path)!, `candidate-${randomUUID()}`);
    // Represents an old accepted PUT completing after a newer PUT was acknowledged.
    await registry.promote(ref);
    expect(await latest(current.name)).toBe('0.0.0');
    await h.db.query('UPDATE release_tags SET next_attempt_at=now() WHERE name=$1', [current.name]);
    expect(await worker.tags.runOnce()).toBe(true);
    expect(await latest(current.name)).toBe(current.version);
    expect((await h.db.query('SELECT state FROM release_jobs')).rows[0]!.state).toBe('READY');
  } finally { await h.close(); }
});

it('does not downgrade latest when an older version finishes after a newer Ready version', async () => {
  const h = await workerHarness();
  try {
    const newer = structuredClone(h.fixture);
    for (const [i, pkg] of newer.manifest.packages.entries()) {
      pkg.version = '0.0.2';
      for (const variant of newer.manifest.variants.filter(v => v.packageName === pkg.name)) {
        variant.packageVersion = pkg.version;
        for (const shot of variant.screenshots) shot.packageVersion = pkg.version;
      }
      replaceBundleArtifact(newer, pkg.tarball.path, await packageBytes(newer, i));
    }
    const accepted = await release(h, await upload(h, newer, h.auth), h.auth);
    expect(accepted.status).toBe(202); const { jobId } = await accepted.json();
    const worker = new ReleaseWorker(h.db, h.store, await realRegistry());
    await worker.runOnce(jobId); while (await worker.tags.runOnce()) { /* newer version first */ }
    await worker.runOnce(h.jobId); while (await worker.tags.runOnce()) { /* older job recovers later */ }
    for (const pkg of newer.manifest.packages) expect(await latest(pkg.name)).toBe('0.0.2');
    expect((await h.db.query("SELECT count(*) FROM release_jobs WHERE state='READY'")).rows[0]!.count).toBe('2');
  } finally { await h.close(); }
});
