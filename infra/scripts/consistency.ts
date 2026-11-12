import { createHash } from 'node:crypto';
import { manifestDigest, validateManifest, type ReleaseManifestV1, type CheckReportV1 } from '@company/contracts';
import type { Database } from '../../apps/api/dist/db/database.js';
import type { ArtifactStore } from '../../apps/api/dist/storage/artifact-store.js';
import type { RegistryClient } from '../../apps/api/dist/releases/registry-client.js';

/** Read-only restored-reference audit; no package execution and no repair writes. */
export async function checkConsistency(db: Database, store: ArtifactStore, registry: RegistryClient) {
  let packages = 0; let variants = 0;
  const fail = () => { throw new Error('Restored references or immutable digests are inconsistent'); };
  const rows = (await db.query('SELECT * FROM release_artifacts')).rows;
  for (const row of rows) {
    if (row.object_key !== `releases/${row.job_id}/${row.path}`) fail();
    const bytes = await store.read(row.object_key,Number(row.bytes));
    if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) fail();
  }
  for (const job of (await db.query("SELECT * FROM release_jobs WHERE state='READY'")).rows) {
    const manifest = job.manifest as ReleaseManifestV1;
    const reports: Record<string,CheckReportV1> = {};
    for (const ref of manifest.reports) {
      const row = rows.find(r=>r.job_id===job.id && r.path===ref.path); if (!row) fail();
      reports[ref.path] = JSON.parse(Buffer.from(await store.read(row!.object_key,ref.bytes)).toString());
    }
    if (!validateManifest(manifest,{reports}).ok) fail();
    if (await manifestDigest(manifest) !== job.manifest_digest) fail();
    for (const file of manifest.files) if (!rows.some(r => r.job_id === job.id && r.path === file.path && r.sha256 === file.sha256 && Number(r.bytes) === file.bytes)) fail();
    const registered = (await db.query('SELECT * FROM package_releases WHERE job_id=$1',[job.id])).rows;
    const implementations = (await db.query('SELECT v.* FROM variant_releases v JOIN package_releases p ON p.id=v.package_release_id WHERE p.job_id=$1',[job.id])).rows;
    if (registered.length !== manifest.packages.length || implementations.length !== manifest.variants.length) fail();
    for (const pkg of manifest.packages) {
      const row = registered.find(p => p.name===pkg.name && p.version===pkg.version && p.sha256===pkg.tarball.sha256 && p.state==='READY');
      if (!row || await manifestDigest(row.metadata) !== await manifestDigest(pkg)) fail();
      await registry.verifyPackage(pkg); packages++;
      for (const variant of manifest.variants.filter(v=>v.packageName===pkg.name && v.packageVersion===pkg.version)) {
        const rowV = implementations.find(v=>v.variant_id===variant.variantId && v.package_release_id===row!.id && ['Ready','DEPRECATED'].includes(v.availability));
        if (!rowV || await manifestDigest(rowV.metadata) !== await manifestDigest(variant)) fail();
        variants++;
      }
    }
  }
  for (const shot of (await db.query('SELECT * FROM screenshots')).rows) {
    const ref = shot.metadata.image;
    if (shot.sha256 !== ref.sha256 || createHash('sha256').update(await store.read(shot.object_key,ref.bytes)).digest('hex') !== ref.sha256) fail();
  }
  for (const row of (await db.query('SELECT * FROM upload_files WHERE frozen_key IS NOT NULL')).rows) {
    if (createHash('sha256').update(await store.read(row.frozen_key,Number(row.bytes))).digest('hex') !== row.sha256) fail();
  }
  return { packages, variants, objects: rows.length };
}
