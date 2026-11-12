import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { expect, it } from 'vitest';
import { platformHarness } from './http-support.js';

it('removes only its own test bucket including objects and abandoned multipart uploads on close', async () => {
  const h = await platformHarness();
  const other = await platformHarness();
  const config = h.store.config;
  const observer = new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, maxAttempts: 1 });
  let closed = false;
  try {
    await h.store.freeze('frozen/test', Buffer.from('test'), 'text/plain');
    await other.store.freeze('frozen/sentinel', Buffer.from('other test'), 'text/plain');
    const multipart = await h.store.planUpload('uploads/abandoned', 11 * 1024 ** 2);
    expect(multipart.multipart).toBeDefined();
    expect((await fetch(multipart.multipart!.parts[0]!.uploadUrl, { method: 'PUT', body: Buffer.alloc(5 * 1024 ** 2, 65) })).status).toBe(200);
    await h.close(); closed = true;
    await expect(observer.send(new HeadBucketCommand({ Bucket: config.bucket }))).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    expect(Buffer.from(await other.store.read('frozen/sentinel', 10)).toString()).toBe('other test');
  } finally { observer.destroy(); if (!closed) await h.close(); await other.close(); }
});
