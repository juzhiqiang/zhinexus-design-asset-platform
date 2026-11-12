import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { sha256 } from '@company/contracts';
import { prepareReleaseBundle, loadReleaseBundle } from '../../packages/component-cli/src/local/manifest.js';
import { platformHarness, grant, upload, release } from './http-support.js';

it('replays recorded SDK tarballs installed in clean consumers and all four real captured implementations', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const evidenceDir = join(root, '.tools', 't05', 'real-' + randomUUID());
  await mkdir(evidenceDir, { recursive: true });
  // Immutable real 0.0.2 evidence generated before T09 added ./pie; see fixture README.
  const bundleDir = join(root, 'tests', 'fixtures', 'releases', 't05-verified-sdk', 'bundle');
  const prepared = { ...await loadReleaseBundle(bundleDir), bundleDir };
  expect(prepared.manifest.packages).toHaveLength(3);
  expect(prepared.manifest.variants).toHaveLength(4);
  const h = await platformHarness();
  try {
    await grant(h, 'alice', true);
    await h.db.query("INSERT INTO package_permissions(subject,package_name) VALUES ('alice','@company/charts-core')");
    const token = await h.token('alice', ['maintainer'], 'cli');
    const body = await upload(h, { manifest: prepared.manifest, files: prepared.filesMap }, token);
    const response = await release(h, body, token);
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(202);
    expect(result.state).toBe('PENDING');
    for (const file of prepared.manifest.files) {
      expect(await sha256(await readFile(join(prepared.bundleDir, file.path)))).toBe(file.sha256);
      const stored = (await h.db.query('SELECT frozen_key FROM upload_files WHERE session_id=$1 AND path=$2', [body.uploadSessionId, file.path])).rows[0]!;
      expect(await sha256(await h.store.read(stored.frozen_key, file.bytes))).toBe(file.sha256);
    }
    expect((await h.db.query('SELECT count(*) FROM variant_releases')).rows[0]!.count).toBe('4');
    expect((await h.db.query("SELECT count(*) FROM variant_releases WHERE availability='Ready'")).rows[0]!.count).toBe('0');
    await writeFile(join(evidenceDir, 'evidence.json'), JSON.stringify({
      verifiedAt: new Date().toISOString(), state: result.state, variantIds: prepared.manifest.variants.map(v => v.variantId),
      packages: prepared.manifest.packages.map(pkg => ({ name: pkg.name, version: pkg.version, ...pkg.tarball })),
      screenshots: prepared.manifest.variants.flatMap(v => v.screenshots.map(s => ({ id: s.id, variantId: s.variantId, source: s.source, packageSha256: s.packageSha256, ...s.image }))),
      fileCount: prepared.manifest.files.length, frozenBytesMatch: true,
      limitations: ['OIDC is a real signed local fixture, not company login', 'T06 publishing and T07 live isolated preview are not exercised', 'CLI preview HTML currently remains a placeholder'],
    }, null, 2) + '\n');
  } finally { await h.close(); }
}, 300_000);

it('rejects current SDK bundles that omit the newly exported pie implementations', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const bundleDir = join(root, '.tools', 't05', 'incomplete-' + randomUUID());
  // Local build/install/capture only. Intentionally omit pie to exercise real tar export coverage.
  const prepared = await prepareReleaseBundle({ repoRoot: root, bundleDir, components: ['line', 'bar'], frameworks: ['vue', 'react'] });
  expect(prepared.ok, JSON.stringify(prepared.issues)).toBe(true);
  const h = await platformHarness();
  try {
    await grant(h);
    await h.db.query("INSERT INTO package_permissions(subject,package_name) VALUES ('alice','@company/charts-core')");
    const token = await h.token('alice', ['publisher'], 'cli');
    const response = await release(h, await upload(h, { manifest: prepared.manifest, files: prepared.filesMap }, token), token);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'ARTIFACT_MISMATCH', details: [{ message: 'npm runtime component subpath has no declared implementation' }] });
    expect((await h.db.query('SELECT count(*) FROM release_jobs')).rows[0]!.count).toBe('0');
  } finally { await h.close(); }
}, 300_000);
