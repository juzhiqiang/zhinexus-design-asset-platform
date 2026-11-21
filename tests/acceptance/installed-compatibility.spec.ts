import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { validateApiMessage, type ReleaseManifestV1 } from '@company/contracts';
import { createRecoveryStack } from '../../infra/scripts/recovery-stack.js';
import { platformHarness, grant, upload, release } from '../platform/http-support.js';
import { realRegistry } from '../platform/t06-support.js';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';

it('persists installed CLI compatibility for all 14 frozen implementations, then survives API restart and visibility changes', async () => {
  const bundleInput = process.env.A10_FROZEN_BUNDLE;
  const evidenceInput = process.env.INSTALLED_CLI_EVIDENCE;
  if (!bundleInput || !evidenceInput) throw new Error('A10_FROZEN_BUNDLE and INSTALLED_CLI_EVIDENCE are required');
  const bundleRoot = resolve(bundleInput);
  const manifest = JSON.parse(await readFile(join(bundleRoot, 'manifest.json'), 'utf8')) as ReleaseManifestV1;
  const componentIds = ['line', 'bar', 'pie', 'scatter', 'trend-card', 'ranking', 'proportion'];
  const implementationKeys = componentIds.flatMap(componentId => ['vue', 'react'].map(framework => componentId + '/' + framework)).sort();
  expect(manifest.variants.map(variant => variant.componentId + '/' + variant.framework).sort()).toEqual(implementationKeys);
  expect(new Set(manifest.variants.map(variant => variant.variantId)).size).toBe(14);
  const evidenceBytes = await readFile(resolve(evidenceInput), 'utf8');
  const evidence = JSON.parse(evidenceBytes);
  expect(evidence.probe.packaged).toBe(true);
  expect(evidence.recommendation).toBe('adopt');
  const files = new Map<string, Uint8Array>();
  for (const artifact of manifest.files) {
    const bytes = await readFile(join(bundleRoot, artifact.path));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);
    expect(bytes.length).toBe(artifact.bytes);
    files.set(artifact.path, bytes);
  }
  const stack = await createRecoveryStack();
  let h: Awaited<ReturnType<typeof platformHarness>> | undefined;
  try {
    const services = { credentials: stack.secrets, postgresPort: stack.ports.postgres,
      storageEndpoint: `http://127.0.0.1:${stack.ports.minio}`, registryOrigin: `http://127.0.0.1:${stack.ports.verdaccio}` };
    h = await platformHarness({}, services);
    await grant(h, 'acceptance-maintainer', true);
    for (const pkg of manifest.packages) await h.db.query('INSERT INTO package_permissions(subject,package_name) VALUES ($1,$2) ON CONFLICT DO NOTHING', ['acceptance-maintainer', pkg.name]);
    const token = await h.token('acceptance-maintainer', ['publisher', 'maintainer'], 'cli');
    const body = await upload(h, { manifest, files }, token);
    const submitted = await release(h, body, token);
    expect(submitted.status, JSON.stringify(await submitted.clone().json())).toBe(202);
    const { jobId } = await submitted.json();
    const worker = new ReleaseWorker(h.db, h.store, await realRegistry(services));
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      await worker.runOnce(); await worker.tags.runOnce();
      const status = await h.request(`/v1/releases/${jobId}`, undefined, token, 'GET');
      const job = await status.json();
      if (job.state === 'READY') { ready = true; break; }
      if (['REJECTED', 'CONFLICT'].includes(job.state)) throw new Error(`Release ${job.state}: ${JSON.stringify(job.lastError)}`);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    expect(ready).toBe(true);
    const variants = (await h.db.query<{ id: string; variantId: string; componentId: string; framework: string; name: string; version: string; sha256: string }>(
      'SELECT vr.id, v.id AS "variantId", v.component_id AS "componentId", v.framework, p.name, p.version, p.sha256 ' +
      'FROM variant_releases vr JOIN variants v ON v.id=vr.variant_id ' +
      'JOIN package_releases p ON p.id=vr.package_release_id WHERE p.job_id=$1 ORDER BY v.id', [jobId],
    )).rows;
    expect(variants.map(target => target.componentId + '/' + target.framework).sort()).toEqual(implementationKeys);
    expect(new Set(variants.map(target => target.id)).size).toBe(14);
    const identities = (targets: { variantId: string; componentId: string; framework: string; name: string; version: string; sha256: string }[]) =>
      targets.map(target => [target.variantId, target.componentId, target.framework, target.name, target.version, target.sha256].join('/')).sort();
    expect(identities(variants)).toEqual(identities(manifest.variants.map(variant => ({
      variantId: variant.variantId, componentId: variant.componentId, framework: variant.framework,
      name: variant.packageName, version: variant.packageVersion,
      sha256: manifest.packages.find(pkg => pkg.name === variant.packageName && pkg.version === variant.packageVersion)!.tarball.sha256,
    }))));
    const compatibilityIds = new Map<string, string>();
    for (const target of variants) {
      const payload = { packageSha256: target.sha256, reason: 'Actual installed CLI Windows acceptance',
        candidate: { version: evidence.candidate.version, source: evidence.candidate.source, integrity: evidence.candidate.integrity }, evidence };
      expect(validateApiMessage('createCompatibilityRequest', payload).ok).toBe(true);
      const accepted = await h.request(`/v1/variant-releases/${target.id}/compatibility`, payload, token);
      const acceptedBody = await accepted.json();
      expect(accepted.status, JSON.stringify(acceptedBody)).toBe(201);
      expect(validateApiMessage('createCompatibilityResponse', acceptedBody).ok).toBe(true);
      expect(acceptedBody).toMatchObject({ variantReleaseId: target.id, variantId: target.variantId,
        packageName: target.name, packageVersion: target.version, packageSha256: target.sha256,
        framework: target.framework, echartsVersion: evidence.candidate.version, status: 'passed' });
      compatibilityIds.set(target.id, acceptedBody.compatibilityId);
      expect((await h.request(`/v1/variant-releases/${target.id}/compatibility`, payload, token)).status).toBe(409);
      const wrong = structuredClone(payload);
      wrong.evidence.combinations[0].consumer.resolved.echarts = '0.0.0';
      expect((await h.request(`/v1/variant-releases/${target.id}/compatibility`, wrong, token)).status).toBe(400);
    }
    await h.restart();
    for (const target of variants) {
      // Newly granted components are private until explicitly made public.
      expect((await h.request(`/v1/variant-releases/${target.id}/compatibility`, undefined, undefined, 'GET')).status).toBe(404);
      const privateResponse = await h.request(`/v1/me/variant-releases/${target.id}/compatibility`, undefined, token, 'GET');
      expect(privateResponse.status).toBe(200);
      const privateRecords = await privateResponse.json();
      expect(validateApiMessage('myVariantCompatibilityResponse', privateRecords).ok).toBe(true);
      expect(privateRecords.items).toHaveLength(1);
      expect(privateRecords.variantReleaseId).toBe(target.id);
      expect(privateRecords.items[0].compatibilityId).toBe(compatibilityIds.get(target.id));
      expect(privateRecords.items[0].packageSha256).toBe(target.sha256);
      expect(privateRecords.items[0].subject).toBe('acceptance-maintainer');
      expect(privateRecords.items[0].reason).toBe('Actual installed CLI Windows acceptance');
    }
    await h.db.query('UPDATE components SET public=true WHERE id=ANY($1::text[])', [componentIds]);
    for (const target of variants) {
      const response = await h.request(`/v1/variant-releases/${target.id}/compatibility`, undefined, undefined, 'GET');
      expect(response.status).toBe(200);
      const records = await response.json();
      expect(validateApiMessage('variantCompatibilityResponse', records).ok).toBe(true);
      expect(records.items).toHaveLength(1);
      expect(records.variantReleaseId).toBe(target.id);
      expect(records.items[0].compatibilityId).toBe(compatibilityIds.get(target.id));
      expect(records.items[0].packageSha256).toBe(target.sha256);
      expect(records.items[0]).not.toHaveProperty('subject');
      expect(records.items[0]).not.toHaveProperty('reason');
    }
    expect(await readFile(resolve(evidenceInput), 'utf8')).toBe(evidenceBytes);
  } finally {
    try { await h?.close(); } finally { await stack.close(); }
  }
});
