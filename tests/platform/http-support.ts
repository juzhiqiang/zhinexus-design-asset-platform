import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { manifestDigest, type ReleaseManifestV1 } from '@company/contracts';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { AbortMultipartUploadCommand, DeleteBucketCommand, DeleteObjectsCommand, ListMultipartUploadsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { buildServer } from '../../apps/api/dist/app.js';
import { Platform } from '../../apps/api/dist/platform.js';
import { Database } from '../../apps/api/dist/db/database.js';
import { migrateRegistry } from '../../apps/api/dist/db/migrate.js';
import { ArtifactStore } from '../../apps/api/dist/storage/artifact-store.js';
import { isolatedDatabase, localCredentials } from './support.js';

export async function platformHarness(overrides: Record<string, unknown> = {}) {
  const isolated = await isolatedDatabase();
  const db = new Database(isolated.url);
  await migrateRegistry(db);
  const credentials = localCredentials();
  const storage = { endpoint: 'http://127.0.0.1:19000', region: 'us-east-1', bucket: `t05-${randomUUID()}`,
    accessKeyId: credentials.minioUser, secretAccessKey: credentials.minioPassword };
  const store = new ArtifactStore(storage);
  await store.ensureBucket();
  // Exact ownership is captured at creation; never enumerate or clean other buckets.
  const ownedBucket = storage.bucket;
  const cleanOwnedBucket = async () => {
    const options = () => ({ abortSignal: AbortSignal.timeout(15_000) });
    for (;;) {
      const listed = await store.client.send(new ListMultipartUploadsCommand({ Bucket: ownedBucket, MaxUploads: 1000 }), options());
      if (!listed.Uploads?.length) break;
      for (const pending of listed.Uploads) await store.client.send(new AbortMultipartUploadCommand({
        Bucket: ownedBucket, Key: pending.Key!, UploadId: pending.UploadId!,
      }), options());
    }
    for (;;) {
      const listed = await store.client.send(new ListObjectsV2Command({ Bucket: ownedBucket, MaxKeys: 1000 }), options());
      if (!listed.Contents?.length) break;
      const removed = await store.client.send(new DeleteObjectsCommand({ Bucket: ownedBucket,
        Delete: { Objects: listed.Contents.map(item => ({ Key: item.Key! })), Quiet: true },
      }), options());
      if (removed.Errors?.length) throw new Error('Owned test bucket cleanup failed');
    }
    await store.client.send(new DeleteBucketCommand({ Bucket: ownedBucket }), options());
  };
  const keys = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const oidc = { issuer: 'https://issuer.t05.test', audience: 'platform-api', jwksUri: 'https://issuer.t05.test/jwks', webClientIds: ['web'], cliClientIds: ['cli'] };
  const options = { databaseUrl: isolated.url, storage, oidc, keyResolver: createLocalJWKSet({ keys: [jwk] }), ...overrides };
  let app = await buildServer(options);
  await app.listen(0, '127.0.0.1');
  let origin = await app.getUrl();
  const token = (subject = 'alice', roles = ['publisher'], client = 'web') => new SignJWT({ roles, azp: client })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(oidc.issuer).setAudience(oidc.audience)
    .setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
  return {
    db, store, token, options, origin: () => origin, platform: () => app.get(Platform),
    request: (path: string, body: unknown, auth?: string, method = 'POST', extra: Record<string, string> = {}) => fetch(`${origin}${path}`, {
      method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
    }),
    restart: async () => { await app.close(); app = await buildServer(options); await app.listen(0, '127.0.0.1'); origin = await app.getUrl(); },
    close: async () => {
      try { await app.close(); }
      finally {
        try { await cleanOwnedBucket(); }
        finally { store.close(); try { await db.close(); } finally { await isolated.close(); } }
      }
    },
  };
}
type Harness = Awaited<ReturnType<typeof platformHarness>>;
export async function grant(h: Harness, subject = 'alice', maintain = false) {
  for (const id of ['line', 'bar', 'pie', 'scatter', 'trend-card']) {
    await h.db.query('INSERT INTO components(id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
    await h.db.query('INSERT INTO component_permissions(subject,component_id,can_publish,can_maintain) VALUES ($1,$2,true,$3) ON CONFLICT(subject,component_id) DO UPDATE SET can_maintain=$3', [subject, id, maintain]);
  }
  for (const name of ['@company/charts-vue', '@company/charts-react']) await h.db.query('INSERT INTO package_permissions(subject,package_name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [subject, name]);
}
export async function upload(h: Harness, fixture: { manifest: ReleaseManifestV1; files: ReadonlyMap<string, Uint8Array> }, token: string, digest?: string) {
  const response = await h.request('/v1/uploads', { manifestDigest: digest ?? await manifestDigest(fixture.manifest), files: fixture.manifest.files }, token);
  expect(response.status).toBe(201);
  const plan = await response.json();
  for (const file of plan.files) expect((await fetch(file.uploadUrl, { method: 'PUT', body: Buffer.from(fixture.files.get(file.path)!) })).status).toBe(200);
  const complete = await h.request(`/v1/uploads/${plan.uploadSessionId}/complete`, { parts: [] }, token);
  expect(complete.status, JSON.stringify(await complete.json())).toBe(200);
  return { uploadSessionId: plan.uploadSessionId as string, manifest: fixture.manifest };
}
export const release = (h: Harness, body: { uploadSessionId: string; manifest: ReleaseManifestV1 }, token: string, key: string = randomUUID()) =>
  h.request('/v1/releases', body, token, 'POST', { 'Idempotency-Key': key });
