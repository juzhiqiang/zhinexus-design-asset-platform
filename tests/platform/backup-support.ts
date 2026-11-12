import { randomUUID } from 'node:crypto';
import { manifestDigest } from '@company/contracts';
import type { RecoveryStack } from '../../infra/scripts/recovery-stack.js';
import { migrateRegistry } from '../../apps/api/dist/db/migrate.js';
import { UploadService } from '../../apps/api/dist/uploads/service.js';
import { ReleaseService } from '../../apps/api/dist/releases/service.js';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { createValidBundle, packageBytes, replaceBundleArtifact } from '../fixtures/t05-artifacts.js';

export async function seedRecovery(stack: RecoveryStack): Promise<void> {
  await stack.clients(async ({db,store,registry}) => {
    await migrateRegistry(db); await store.ensureBucket();
    const fixture = await createValidBundle('web');
    for (const [i,pkg] of fixture.manifest.packages.entries()) {
      const old = pkg.name; pkg.name = `@company/recovery-${randomUUID()}`;
      for (const v of fixture.manifest.variants) if (v.packageName===old) v.packageName=pkg.name;
      replaceBundleArtifact(fixture,pkg.tarball.path,await packageBytes(fixture,i));
      await db.query("INSERT INTO package_permissions(subject,package_name) VALUES ('recovery',$1)",[pkg.name]);
    }
    for (const component of new Set(fixture.manifest.variants.map(v=>v.componentId))) {
      await db.query('INSERT INTO components(id) VALUES ($1)',[component]);
      await db.query("INSERT INTO component_permissions(subject,component_id,can_publish) VALUES ('recovery',$1,true)",[component]);
    }
    const context = {requestId:randomUUID(),principal:{subject:'recovery',roles:['publisher'] as const,clientId:'web',channel:'web' as const}};
    const uploads = new UploadService(db,store);
    const plan = await uploads.create({manifestDigest:await manifestDigest(fixture.manifest),files:fixture.manifest.files},context);
    for (const file of plan.files) {
      if (!(await fetch(file.uploadUrl,{method:'PUT',body:Buffer.from(fixture.files.get(file.path)!)})).ok) throw new Error('Recovery seed upload failed');
    }
    await uploads.complete(plan.uploadSessionId,{parts:[]},context);
    const job = await new ReleaseService(db,uploads).create({uploadSessionId:plan.uploadSessionId,manifest:fixture.manifest},randomUUID(),context);
    await new ReleaseWorker(db,store,registry).runOnce(job.jobId);
    if ((await db.query('SELECT state FROM release_jobs WHERE id=$1',[job.jobId])).rows[0]!.state!=='READY') throw new Error('Recovery seed release failed');
  });
}
