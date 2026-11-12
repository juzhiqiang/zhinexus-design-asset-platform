import { createHash } from 'node:crypto';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { StorageConfig } from './config.js';
import { PreviewDenied } from './path-policy.js';

/** Only GetObject is used: no upload, bucket creation, execution or presigned public URLs. */
export class PreviewStorage {
  private readonly client: S3Client;
  constructor(private readonly config: StorageConfig) {
    const endpoint = new URL(config.endpoint);
    if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/' ||
      (endpoint.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)) ||
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket) || !config.accessKeyId || !config.secretAccessKey || !config.region) throw new Error('Invalid preview storage');
    this.client = new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: true, maxAttempts: 2,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, responseChecksumValidation: 'WHEN_REQUIRED' });
  }
  async read(key: string, expected: { bytes: number; sha256: string }): Promise<Buffer> {
    if (!Number.isSafeInteger(expected.bytes) || expected.bytes < 0 || expected.bytes > 50 * 1024 ** 2) throw new PreviewDenied();
    const signal = AbortSignal.timeout(15_000);
    const object = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), { abortSignal: signal });
    const body = object.Body;
    if (!body || !('destroy' in body)) throw new PreviewDenied();
    const close = () => body.destroy(); signal.addEventListener('abort', close, { once: true });
    try {
      if (signal.aborted || object.ContentLength !== expected.bytes) throw new PreviewDenied();
      const chunks: Buffer[] = []; let count = 0;
      for await (const chunk of body) {
        count += chunk.length; if (count > expected.bytes) throw new PreviewDenied(); chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks, count);
      if (count !== expected.bytes || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw new PreviewDenied();
      return bytes;
    } finally { signal.removeEventListener('abort', close); close(); }
  }
  close(): void { this.client.destroy(); }
}
