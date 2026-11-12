import { createServer } from 'node:http';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { readS3Object } from '../../infra/scripts/s3-probe.js';
import { withLocalLock } from '../../infra/scripts/local.js';

describe('real S3 stalled responses', () => {
  it.each([false, true])('times out and releases the operation lock (headers sent: %s)', async sendHeaders => {
    let received = false;
    let closed = false;
    const server = createServer((_request, response) => {
      received = true;
      response.on('close', () => { closed = true; });
      if (sendHeaders) {
        response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '10' });
        response.write('x'); // Leave the body incomplete after a successful HTTP status.
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    const client = new S3Client({ endpoint: `http://127.0.0.1:${address.port}`, region: 'us-east-1', forcePathStyle: true,
      credentials: { accessKeyId: 'test-only', secretAccessKey: 'test-only' }, maxAttempts: 1 });
    const directory = mkdtempSync(join(tmpdir(), 'g2-s3-timeout-'));
    try {
      await expect(withLocalLock(() => readS3Object(client, { Bucket: 'probe', Key: 'stalled' }, 500), directory)).rejects.toThrow('S3 operation timed out');
      expect(received).toBe(true);
      await expect.poll(() => closed, { timeout: 1000 }).toBe(true);
      expect(existsSync(join(directory, 'operation.lock'))).toBe(false);
    } finally {
      client.destroy();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
