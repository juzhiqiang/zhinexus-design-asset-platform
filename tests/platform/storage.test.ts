import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ArtifactStore } from '../../apps/api/dist/storage/artifact-store.js';
import { localServices } from './support.js';

describe('T05 real S3 upload and frozen bytes', () => {
  it('presigns single/multipart, verifies parts, and refuses overwriting frozen content', async () => {
    const { credentials, storageEndpoint } = localServices();
    const store = new ArtifactStore({ endpoint: storageEndpoint, region: 'us-east-1', bucket: `t05-${randomUUID()}`,
      accessKeyId: credentials.minioUser, secretAccessKey: credentials.minioPassword });
    try {
      await store.ensureBucket();
      const bytes = Buffer.from('frozen original');
      const plan = await store.planUpload('uploads/single', bytes.length);
      expect((await fetch(plan.uploadUrl, { method: 'PUT', body: bytes })).status).toBe(200);
      expect(Buffer.from(await store.read('uploads/single', bytes.length))).toEqual(bytes);
      const digest = createHash('sha256').update(bytes).digest('hex');
      await store.freeze('frozen/single', bytes, 'text/plain');
      await expect(store.freeze('frozen/single', Buffer.from('changed'), 'text/plain')).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(createHash('sha256').update(await store.read('frozen/single', bytes.length)).digest('hex')).toBe(digest);
      const large = Buffer.alloc(11 * 1024 ** 2, 27);
      const multipart = await store.planUpload('uploads/multi', large.length);
      expect(multipart.multipart?.parts).toHaveLength(3);
      const completed = [];
      for (const part of multipart.multipart!.parts) {
        const start = (part.partNumber - 1) * multipart.multipart!.partSize;
        const response = await fetch(part.uploadUrl, { method: 'PUT', body: large.subarray(start, start + multipart.multipart!.partSize) });
        expect(response.status).toBe(200);
        completed.push({ partNumber: part.partNumber, etag: response.headers.get('etag')! });
      }
      await expect(store.completeMultipart('uploads/multi', multipart.multipart!.uploadId, completed.slice(0, 1), large.length)).rejects.toMatchObject({ code: 'UPLOAD_INCOMPLETE' });
      await store.completeMultipart('uploads/multi', multipart.multipart!.uploadId, completed, large.length);
      await store.completeMultipart('uploads/multi', multipart.multipart!.uploadId, completed, large.length);
      expect(createHash('sha256').update(await store.read('uploads/multi', large.length)).digest('hex')).toBe(createHash('sha256').update(large).digest('hex'));
    } finally { store.close(); }
  });
});
