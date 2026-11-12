import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { validateApiMessage, type ApiMessages } from '@company/contracts';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { PlatformEvents } from '../../apps/api/dist/observability/events.js';
import { summarizeRequests, type RequestSample } from '../../scripts/capacity-metrics.js';
import { platformHarness } from './http-support.js';
import { workerHarness, realRegistry } from './t06-support.js';

// Every direct test invocation also gets a new directory; stale success files are never reused.
const reportDir = process.env.PLATFORM_CAPACITY_REPORT_DIR ?? join('.tools', 'operations', 'capacity', randomUUID());
async function report(name: string, data: unknown) {
  await mkdir(reportDir, { recursive: true });
  await writeFile(join(reportDir, `${name}.json`), JSON.stringify(data, null, 2) + '\n');
}

it('measures 200 synthetic catalog components and 400 implementations with 20 concurrent HTTP readers', async () => {
  const h = await workerHarness();
  try {
    await new ReleaseWorker(h.db, h.store, await realRegistry()).runOnce(h.jobId);
    // Cardinality-only fixture: package/object publication is measured separately below.
    // These synthetic catalog rows do not assert that 400 SDK exports were built or released.
    await h.db.transaction(async db => {
      await db.query(`INSERT INTO components(id,public,category)
        SELECT 'capacity-' || lpad(n::text,3,'0'),true,'capacity' FROM generate_series(1,200) n`);
      await db.query(`INSERT INTO variants(id,component_id,framework)
        SELECT c.id || '-' || f,c.id,f FROM components c CROSS JOIN unnest(ARRAY['vue','react']) f WHERE c.category='capacity'`);
      for (const framework of ['vue', 'react']) {
        const template = (await db.query(`SELECT vr.package_release_id,vr.metadata FROM variant_releases vr
          JOIN variants v ON v.id=vr.variant_id WHERE v.id=$1`, [`line-${framework}`])).rows[0]!;
        await db.query(`INSERT INTO variant_releases(id,variant_id,package_release_id,metadata,availability)
          SELECT gen_random_uuid(),v.id,$1,$2::jsonb || jsonb_build_object('variantId',v.id,'componentId',v.component_id),'Ready'
          FROM variants v JOIN components c ON c.id=v.component_id WHERE c.category='capacity' AND v.framework=$3`,
        [template.package_release_id, JSON.stringify(template.metadata), framework]);
      }
    });
    expect((await h.db.query("SELECT count(*) FROM variants v JOIN components c ON c.id=v.component_id WHERE c.category='capacity'")).rows[0]!.count).toBe('400');
    const samples: RequestSample[] = [];
    for (let round = 0; round < 10; round++) {
      await Promise.all(Array.from({ length: 20 }, async (_, reader) => {
        const framework = ['', 'vue', 'react'][reader % 3]!;
        const page = reader % 2 + 1;
        const started = performance.now(); let ok = false;
        try {
          const response = await h.request(`/v1/components?category=capacity&pageSize=20&page=${page}${framework ? `&framework=${framework}` : ''}`, undefined, undefined, 'GET');
          const body = await response.json() as ApiMessages['componentsResponse'];
          const expectedIds = Array.from({ length: 20 }, (_, i) => `capacity-${String((page - 1) * 20 + i + 1).padStart(3, '0')}`);
          ok = response.status === 200 && validateApiMessage('componentsResponse', body).ok && body.total === 200 &&
            body.items.length === 20 && body.items.every((item, i) => item.componentId === expectedIds[i] &&
              item.variants.length === (framework ? 1 : 2) &&
              (framework ? item.variants[0]?.framework === framework : new Set(item.variants.map(v => v.framework)).size === 2));
        } catch { /* Failed/timeout requests remain in the percentile and denominator. */ }
        samples.push({ durationMs: performance.now() - started, ok });
      }));
    }
    const metrics = summarizeRequests(samples, 500);
    await report('catalog', { scope: 'synthetic-db-catalog-cardinality', components: 200, implementations: 400,
      concurrency: 20, rounds: 10, network: 'loopback', metrics, samples, productionAcceptance: false });
    expect(metrics.count).toBe(200); expect(metrics.failures).toBe(0); expect(metrics.passed).toBe(true);
  } finally { await h.close(); }
}, 120_000);

it('resumes a 100MiB submission after interrupted multipart PUT and API restart without retransmitting confirmed parts', async () => {
  const h = await platformHarness();
  const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
  try {
    const started = performance.now(); const auth = await h.token();
    const contents = [40, 40, 20].map((mib, i) => Buffer.alloc(mib * 1024 ** 2, 65 + i));
    const refs = contents.map((bytes, i) => ({ path: `assets/capacity-${i}.bin`, bytes: bytes.length, sha256: hash(bytes) }));
    const response = await h.request('/v1/uploads', { manifestDigest: 'a'.repeat(64), files: refs }, auth);
    expect(response.status).toBe(201);
    const plan = await response.json() as ApiMessages['createUploadResponse'];
    const parts: ApiMessages['completeUploadRequest']['parts'] = [];
    const puts = new Map<string, number>();
    const put = async (index: number, partNumber: number) => {
      const file = plan.files[index]!; const multipart = file.multipart!;
      const part = multipart.parts.find(p => p.partNumber === partNumber)!;
      const key = `${file.path}/${partNumber}`; puts.set(key, (puts.get(key) ?? 0) + 1);
      const offset = (partNumber - 1) * multipart.partSize;
      const uploaded = await fetch(part.uploadUrl, { method: 'PUT', body: contents[index]!.subarray(offset, offset + multipart.partSize), signal: AbortSignal.timeout(30_000) });
      expect(uploaded.status).toBe(200);
      const etag = uploaded.headers.get('etag'); expect(etag).toBeTruthy();
      parts.push({ path: file.path, partNumber, etag: etag! });
    };
    for (let i = 0; i < 3; i++) { expect(plan.files[i]!.multipart).toBeDefined(); await put(i, 1); }
    const interruptedPart = plan.files[0]!.multipart!.parts[1]!;
    await new Promise<void>((resolve, reject) => {
      const req = httpRequest(interruptedPart.uploadUrl, { method: 'PUT', headers: { 'content-length': 5 * 1024 ** 2 } });
      const timer = setTimeout(() => { req.destroy(); reject(new Error('Interrupted PUT did not close')); }, 10_000);
      req.on('error', () => { clearTimeout(timer); resolve(); });
      req.write(contents[0]!.subarray(0, 16_384), () => req.destroy());
    });
    const retained = parts.map(p => ({ ...p }));
    await h.restart();
    const complete = `/v1/uploads/${plan.uploadSessionId}/complete`;
    expect((await h.request(complete, { parts }, await h.token('alice', ['publisher'], 'cli'))).status).toBe(404);
    expect((await h.request(complete, { parts }, auth)).status).toBe(409);
    for (let i = 0; i < 3; i++) for (const part of plan.files[i]!.multipart!.parts.slice(1)) await put(i, part.partNumber);
    const completed = await h.request(complete, { parts }, auth);
    expect(completed.status).toBe(200); expect(await completed.json()).toEqual({ status: 'complete', verifiedFiles: refs });
    expect((await h.request(complete, { parts }, auth)).status).toBe(200);
    for (const first of retained) expect(puts.get(`${first.path}/${first.partNumber}`)).toBe(1);
    for (const ref of refs) {
      const file = (await h.db.query('SELECT frozen_key FROM upload_files WHERE session_id=$1 AND path=$2', [plan.uploadSessionId, ref.path])).rows[0]!;
      expect(hash(await h.store.read(file.frozen_key, ref.bytes))).toBe(ref.sha256);
    }
    expect((await h.db.query("SELECT count(*) FROM audit_events WHERE event='UPLOAD_VERIFIED'")).rows[0]!.count).toBe('1');
    await report('upload', { scope: 'real-s3-upload-only', totalBytes: 104857600, fileBytes: refs.map(r => r.bytes),
      partCount: parts.length, retainedParts: retained.length, interruptedPuts: 1, apiRestart: true,
      sameSession: true, confirmedPartsRetransmitted: 0, frozenDigestsMatch: true,
      durationMs: performance.now() - started, passed: true, productionAcceptance: false });
  } finally { await h.close(); }
}, 180_000);

it('measures five real protocol releases from PENDING through READY without component execution', async () => {
  const samples: RequestSample[] = [];
  for (let i = 0; i < 5; i++) {
    const h = await workerHarness();
    try {
      const worker = new ReleaseWorker(h.db, h.store, await realRegistry(), 30_000, new PlatformEvents(() => {}));
      const started = performance.now();
      await worker.runOnce(h.jobId);
      const state = (await h.db.query('SELECT state FROM release_jobs WHERE id=$1', [h.jobId])).rows[0]!.state;
      samples.push({ durationMs: performance.now() - started, ok: state === 'READY' });
    } finally { await h.close(); }
  }
  const metrics = summarizeRequests(samples, 30_000);
  await report('release', { scope: 'real-three-storage-protocol-fixtures', metrics, samples,
    packagesPerRelease: 2, implementationsPerRelease: 3,
    exclusions: ['local-build', 'capture', 'upload', 'business-projects', 'production-scale'],
    sampleWarning: 'Five samples are a local smoke measurement, not a production latency distribution.', productionAcceptance: false });
  expect(metrics.passed).toBe(true);
}, 180_000);
