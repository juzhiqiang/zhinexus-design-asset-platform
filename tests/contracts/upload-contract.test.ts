import { describe, expect, it } from 'vitest';
import { UPLOAD_LIMITS, validateApiMessage } from '@company/contracts';

describe('T05 upload transport contract', () => {
  const file = { path: 'packages/chart.tgz', uploadUrl: 'https://objects.example.com/upload', expiresAt: '2026-11-12T12:00:00Z' };
  it('accepts old single PUT and explicit multipart plans', () => {
    expect(validateApiMessage('createUploadResponse', { uploadSessionId: 'session', files: [file] }).ok).toBe(true);
    expect(validateApiMessage('createUploadResponse', { uploadSessionId: 'session', files: [{ ...file, multipart: { uploadId: 's3-id', partSize: 5242880, parts: [{ partNumber: 1, uploadUrl: file.uploadUrl, expiresAt: file.expiresAt }] } }] }).ok).toBe(true);
  });
  it('rejects empty multipart plans and invalid part numbers', () => {
    for (const parts of [[], [{ partNumber: 0, uploadUrl: file.uploadUrl, expiresAt: file.expiresAt }]]) {
      expect(validateApiMessage('createUploadResponse', { uploadSessionId: 'session', files: [{ ...file, multipart: { uploadId: 's3-id', partSize: 5242880, parts } }] }).ok).toBe(false);
    }
  });
  it('exports the shared limits used by both API and clients', () => {
    expect(UPLOAD_LIMITS.tarballBytes).toBe(50 * 1024 ** 2);
    expect(UPLOAD_LIMITS.imageBytes).toBe(10 * 1024 ** 2);
    expect(UPLOAD_LIMITS.totalBytes).toBe(500 * 1024 ** 2);
    expect(UPLOAD_LIMITS.maxImageDimension).toBe(8192);
  });
});
