import { it, expect } from 'vitest';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { workerHarness, realRegistry } from './t06-support.js';
import { upload, release } from './http-support.js';
import { createValidBundle, packageBytes, replaceBundleArtifact } from '../fixtures/t05-artifacts.js';

it('uses the exact release ID when a variant migrates package name without changing its version', async () => {
  const h = await workerHarness();
  try {
    const worker = new ReleaseWorker(h.db, h.store, await realRegistry());
    await worker.runOnce(h.jobId);
    const fixture = await createValidBundle();
    for (const [i, pkg] of fixture.manifest.packages.entries()) {
      const old = pkg.name; pkg.name = `${h.fixture.manifest.packages[i]!.name}-moved`;
      for (const variant of fixture.manifest.variants) if (variant.packageName === old) variant.packageName = pkg.name;
      replaceBundleArtifact(fixture, pkg.tarball.path, await packageBytes(fixture, i));
      await h.db.query("INSERT INTO package_permissions(subject,package_name) VALUES ('alice',$1)", [pkg.name]);
    }
    replaceBundleArtifact(fixture, 'docs/line-vue.md', Buffer.from('# moved package documentation'));
    const posted = await release(h, await upload(h, fixture, h.auth), h.auth);
    expect(posted.status).toBe(202); const second = (await posted.json()).jobId;
    await worker.runOnce(second);
    const records = (await h.db.query(`SELECT vr.id,p.name,p.job_id FROM variant_releases vr JOIN package_releases p ON p.id=vr.package_release_id WHERE vr.variant_id='line-vue'`)).rows;
    expect(records).toHaveLength(2);
    expect((await h.request('/v1/me/variants/line-vue/releases/0.0.1', undefined, h.auth, 'GET')).status).toBe(409);
    for (const record of records) {
      const base = `/v1/me/variant-releases/${record.id}`;
      const detail = await h.request(base, undefined, h.auth, 'GET');
      expect(detail.status).toBe(200);
      expect(await detail.json()).toMatchObject({ variantReleaseId: record.id, package: { name: record.name }, variant: { packageName: record.name } });
      const docs = await h.request(`${base}/artifacts?path=docs/line-vue.md`, undefined, h.auth, 'GET');
      expect(await docs.text()).toBe(record.job_id === second ? '# moved package documentation' : '# synthetic');
      expect((await (await h.request(`${base}/reports`, undefined, h.auth, 'GET')).json()).variantReleaseId).toBe(record.id);
      expect((await h.request(`/v1/variant-releases/${record.id}`, undefined, h.auth, 'GET')).status).toBe(404);
    }
    await h.db.query('UPDATE components SET public=true');
    const publicDetail = await h.request(`/v1/variant-releases/${records[0]!.id}`, undefined, undefined, 'GET');
    expect(publicDetail.status).toBe(200);
  } finally { await h.close(); }
});
