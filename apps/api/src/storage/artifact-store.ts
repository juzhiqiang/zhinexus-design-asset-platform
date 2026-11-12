import {
  S3Client, CreateBucketCommand, PutObjectCommand, GetObjectCommand, HeadObjectCommand,
  CreateMultipartUploadCommand, UploadPartCommand, ListPartsCommand, CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { UPLOAD_LIMITS, type ApiMessages } from '@company/contracts';
import { PlatformError } from '../errors.js';

export type StorageConfig = { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string };
export type UploadPlan = Omit<ApiMessages['createUploadResponse']['files'][number], 'path'>;
const httpStatus = (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
const errorName = (error: unknown) => error instanceof Error ? error.name : '';

export class ArtifactStore {
  readonly client: S3Client;
  constructor(readonly config: StorageConfig) {
    let endpoint: URL;
    try { endpoint = new URL(config.endpoint); } catch { throw new PlatformError('INFRA_UNAVAILABLE'); }
    if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/' ||
      (endpoint.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) ||
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket) || !config.accessKeyId || !config.secretAccessKey || !config.region) throw new PlatformError('INFRA_UNAVAILABLE');
    this.client = new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: true, maxAttempts: 2,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
  }
  private async operation<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { reject(new PlatformError('INFRA_UNAVAILABLE')); controller.abort(); }, 15_000);
    });
    try { return await Promise.race([fn(controller.signal), timeout]); }
    finally { clearTimeout(timer); }
  }
  async ensureBucket(): Promise<void> {
    try { await this.operation(signal => this.client.send(new CreateBucketCommand({ Bucket: this.config.bucket }), { abortSignal: signal })); }
    catch (error) { if (errorName(error) !== 'BucketAlreadyOwnedByYou') throw new PlatformError('INFRA_UNAVAILABLE'); }
  }
  async planUpload(key: string, bytes: number): Promise<UploadPlan> {
    const expiresAt = new Date(Date.now() + 900_000).toISOString();
    const params = { Bucket: this.config.bucket, Key: key };
    if (bytes <= UPLOAD_LIMITS.multipartThreshold) {
      return { uploadUrl: await getSignedUrl(this.client, new PutObjectCommand({ ...params, ContentLength: bytes }), { expiresIn: 900 }), expiresAt };
    }
    try {
      const created = await this.operation(signal => this.client.send(new CreateMultipartUploadCommand(params), { abortSignal: signal }));
      if (!created.UploadId) throw new PlatformError('INFRA_UNAVAILABLE');
      const count = Math.ceil(bytes / UPLOAD_LIMITS.partBytes);
      const parts = [];
      for (let i = 1; i <= count; i++) {
        parts.push({ partNumber: i, expiresAt, uploadUrl: await getSignedUrl(this.client, new UploadPartCommand({ ...params,
          UploadId: created.UploadId, PartNumber: i, ContentLength: Math.min(UPLOAD_LIMITS.partBytes, bytes - (i - 1) * UPLOAD_LIMITS.partBytes),
        }), { expiresIn: 900 }) });
      }
      return { uploadUrl: parts[0]!.uploadUrl, expiresAt, multipart: { uploadId: created.UploadId, partSize: UPLOAD_LIMITS.partBytes, parts } };
    } catch { throw new PlatformError('INFRA_UNAVAILABLE'); }
  }
  async abortMultipart(key: string, uploadId: string): Promise<void> {
    await this.operation(signal => this.client.send(new AbortMultipartUploadCommand({ Bucket: this.config.bucket, Key: key, UploadId: uploadId }), { abortSignal: signal }));
  }
  async completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[], bytes: number): Promise<void> {
    const count = Math.ceil(bytes / UPLOAD_LIMITS.partBytes);
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    if (ordered.length !== count || ordered.some((part, i) => part.partNumber !== i + 1 || !part.etag)) throw new PlatformError('UPLOAD_INCOMPLETE');
    const params = { Bucket: this.config.bucket, Key: key, UploadId: uploadId };
    try {
      const actual = await this.operation(signal => this.client.send(new ListPartsCommand({ ...params, MaxParts: 1000 }), { abortSignal: signal }));
      if (actual.IsTruncated || actual.Parts?.length !== count || actual.Parts.some((part, i) => part.PartNumber !== ordered[i]!.partNumber ||
        part.ETag !== ordered[i]!.etag || part.Size !== Math.min(UPLOAD_LIMITS.partBytes, bytes - i * UPLOAD_LIMITS.partBytes))) throw new PlatformError('UPLOAD_INCOMPLETE');
      await this.operation(signal => this.client.send(new CompleteMultipartUploadCommand({ ...params,
        MultipartUpload: { Parts: ordered.map(part => ({ PartNumber: part.partNumber, ETag: part.etag })) },
      }), { abortSignal: signal }));
    } catch (error) {
      // Completion may have succeeded before the caller lost its response. Actual bytes are verified next.
      if (errorName(error) === 'NoSuchUpload') {
        try {
          const object = await this.operation(signal => this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }), { abortSignal: signal }));
          if (object.ContentLength === bytes) return;
        } catch { /* Missing object is still an incomplete upload. */ }
      }
      if (error instanceof PlatformError) throw error;
      throw new PlatformError(httpStatus(error) === 400 || httpStatus(error) === 404 ? 'UPLOAD_INCOMPLETE' : 'INFRA_UNAVAILABLE');
    }
  }
  async read(key: string, expectedBytes: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > UPLOAD_LIMITS.totalBytes) throw new PlatformError('LIMIT_EXCEEDED');
    try {
      return await this.operation(async signal => {
        const object = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), { abortSignal: signal });
        const body = object.Body;
        if (!body || !('destroy' in body)) throw new PlatformError('UPLOAD_INCOMPLETE');
        const close = () => body.destroy();
        signal.addEventListener('abort', close, { once: true });
        try {
          if (signal.aborted) throw new PlatformError('INFRA_UNAVAILABLE');
          if (object.ContentLength !== undefined && object.ContentLength > expectedBytes) throw new PlatformError('LIMIT_EXCEEDED');
          const chunks: Buffer[] = [];
          let total = 0;
          for await (const chunk of body) {
            total += chunk.length;
            if (total > expectedBytes) throw new PlatformError('LIMIT_EXCEEDED');
            chunks.push(Buffer.from(chunk));
          }
          if (total !== expectedBytes) throw new PlatformError('DIGEST_MISMATCH');
          return Buffer.concat(chunks, total);
        } finally { signal.removeEventListener('abort', close); close(); }
      });
    } catch (error) {
      if (error instanceof PlatformError) throw error;
      throw new PlatformError(httpStatus(error) === 404 ? 'UPLOAD_INCOMPLETE' : 'INFRA_UNAVAILABLE');
    }
  }
  async freeze(key: string, bytes: Uint8Array, mimeType: string): Promise<void> {
    try {
      await this.operation(signal => this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key,
        Body: bytes, ContentLength: bytes.byteLength, ContentType: mimeType, IfNoneMatch: '*',
      }), { abortSignal: signal }));
    } catch (error) { throw new PlatformError(httpStatus(error) === 412 ? 'CONFLICT' : 'INFRA_UNAVAILABLE'); }
  }
  close(): void { this.client.destroy(); }
}
