import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  completeUploadSession, createMemoryStorage, createUploadSession, executeWebUploadWorkflow, fetchReleaseJob,
  sanitizeWebManifest, submitReleaseJob, uploadPartBytes,
} from '../../apps/gallery/app/lib/uploads/manifest-form.js';
import { makeApiFixtures } from '../fixtures/releases/g1/api.js';
import { makeFixture } from '../fixtures/releases/g1/factory.js';

afterEach(() => vi.unstubAllGlobals());
const json = (body: unknown) => Response.json(body);
const apiUrl = 'https://platform.example.test';

describe('G1 web upload response validation', () => {
  it.each([
    ['missing files', { uploadSessionId: 'upload-synthetic' }, '/files'],
    ['empty files', { uploadSessionId: 'upload-synthetic', files: [] }, '/files'],
    ['wrong identifier type', { ...makeApiFixtures().createUploadResponse as object, uploadSessionId: 123 }, '/uploadSessionId'],
  ])('rejects upload plans with %s before exposing a session', async (_name, body, path) => {
    vi.stubGlobal('fetch', vi.fn(async () => json(body)));
    await expect(createUploadSession(apiUrl, 'token', makeFixture().manifest)).rejects.toThrow(path);
  });

  it.each([
    ['missing verified files', { status: 'complete' }, '/verifiedFiles'],
    ['invalid state', { status: 'READY', verifiedFiles: makeFixture().manifest.files }, '/status'],
  ])('rejects completion with %s', async (_name, body, path) => {
    vi.stubGlobal('fetch', vi.fn(async () => json(body)));
    await expect(completeUploadSession(apiUrl, 'token', 'upload-synthetic')).rejects.toThrow(path);
  });

  it.each([
    ['wrong job type', { jobId: 123, state: 'PENDING' }, '/jobId'],
    ['invalid state', { jobId: 'job-synthetic', state: 'SUCCESS' }, '/state'],
  ])('rejects release responses with %s', async (_name, body, path) => {
    vi.stubGlobal('fetch', vi.fn(async () => json(body)));
    await expect(submitReleaseJob(apiUrl, 'token', 'upload-synthetic', makeFixture().manifest, 'key')).rejects.toThrow(path);
  });

  it('accepts the complete existing wire contracts', async () => {
    const fixtures = makeApiFixtures();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json(fixtures.createUploadResponse))
      .mockResolvedValueOnce(json(fixtures.completeUploadResponse))
      .mockResolvedValueOnce(json(fixtures.createReleaseResponse)));
    expect(await createUploadSession(apiUrl, 'token', makeFixture().manifest)).toEqual(fixtures.createUploadResponse);
    await expect(completeUploadSession(apiUrl, 'token', 'upload-synthetic')).resolves.toBeUndefined();
    expect(await submitReleaseJob(apiUrl, 'token', 'upload-synthetic', makeFixture().manifest, 'key')).toEqual(fixtures.createReleaseResponse);
  });

  it('rejects a truncated READY job instead of showing publication success', async () => {
    vi.stubGlobal('fetch', async () => json({ state: 'READY' }));
    await expect(fetchReleaseJob(apiUrl, 'token', 'job-synthetic')).rejects.toThrow('/stage');
  });

  it('preserves the storage ETag verbatim for server-side part verification', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { headers: { etag: '"part-digest"' } }));
    expect(await uploadPartBytes('https://uploads.example.test/part', new Uint8Array([1]))).toEqual({ etag: '"part-digest"' });
  });

  it('rejects a missing storage ETag instead of inventing part evidence', async () => {
    vi.stubGlobal('fetch', async () => new Response(null));
    await expect(uploadPartBytes('https://uploads.example.test/part', new Uint8Array([1]))).rejects.toThrow('UPLOAD_ETAG_REQUIRED');
  });

  it('does not store an invalid upload session or continue to PUT', async () => {
    const fixture = makeFixture();
    const storage = createMemoryStorage();
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      requests.push(url);
      if (requests.length > 1) throw new Error('unexpected subsequent request');
      return json({ uploadSessionId: 'upload-synthetic', files: [] });
    });
    await expect(executeWebUploadWorkflow({ apiUrl, token: 'token', subject: 'reviewer',
      manifest: fixture.manifest, filesMap: fixture.files, storage })).rejects.toThrow(new RegExp('INVALID_SCHEMA.*/files'));
    expect(storage.getItem('zhinexus_active_session_id')).toBeNull();
    expect(requests).toEqual([`${apiUrl}/v1/uploads`]);
  });

  it('uses wire partSize and partNumber to upload exact bytes and complete ETags', async () => {
    const fixture = makeFixture();
    const manifest = sanitizeWebManifest(fixture.manifest);
    const target = manifest.files[0]!;
    const partSize = 5 * 1024 * 1024;
    const bytes = new Uint8Array(partSize + 3).fill(7);
    bytes.set([8, 9, 10], partSize);
    fixture.files.set(target.path, bytes);
    const expiresAt = '2026-11-22T10:00:00.000Z';
    const chunks: Uint8Array[] = [];
    let completion: unknown;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url === `${apiUrl}/v1/uploads`) return json({ uploadSessionId: 'upload-synthetic', files: manifest.files.map(file => ({
        path: file.path, uploadUrl: `https://uploads.example.test/${file.path}`, expiresAt,
        ...(file.path === target.path ? { multipart: { uploadId: 'multipart-synthetic', partSize, parts: [
          { partNumber: 1, uploadUrl: 'https://uploads.example.test/part/1', expiresAt },
          { partNumber: 2, uploadUrl: 'https://uploads.example.test/part/2', expiresAt },
        ] } } : {}),
      })) });
      if (url.includes('/part/')) {
        chunks.push(new Uint8Array(init!.body as Uint8Array));
        return new Response(null, { headers: { etag: `"etag-${chunks.length}"` } });
      }
      if (url === `${apiUrl}/v1/uploads/upload-synthetic/complete`) {
        completion = JSON.parse(init!.body as string);
        return json({ status: 'complete', verifiedFiles: manifest.files });
      }
      if (url === `${apiUrl}/v1/releases`) return json({ jobId: 'job-synthetic', state: 'PENDING' });
      if (init?.method === 'PUT') return new Response(null);
      throw new Error(`Unexpected request: ${url}`);
    });
    const result = await executeWebUploadWorkflow({ apiUrl, token: 'token', subject: 'reviewer',
      manifest, filesMap: fixture.files, storage: createMemoryStorage() });
    expect(result).toEqual({ ok: true, jobId: 'job-synthetic', uploadSessionId: 'upload-synthetic' });
    expect(chunks.map(chunk => chunk.length)).toEqual([5242880, 3]);
    expect([...chunks[1]!]).toEqual([8, 9, 10]);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(bytes));
    expect(completion).toEqual({ parts: [
      { path: target.path, partNumber: 1, etag: '"etag-1"' },
      { path: target.path, partNumber: 2, etag: '"etag-2"' },
    ] });
  });
});
