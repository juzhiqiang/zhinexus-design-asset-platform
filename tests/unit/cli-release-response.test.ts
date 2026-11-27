import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFixture } from '../fixtures/releases/g1/factory.js';
import { manifestDigest } from '../../packages/component-cli/src/contracts/digests.js';
import {
  executeReleaseCommand, executeStatusCommand, loadReleaseSession, saveReleaseSession,
} from '../../packages/component-cli/src/local/release.js';

type Stage = 'upload' | 'complete' | 'release' | 'poll' | 'renew';
type Harness = {
  server: Server; origin: string; bundleDir: string;
  fixture: ReturnType<typeof makeFixture>;
  responses: Record<Stage, unknown>;
  rawResponses: Partial<Record<Stage, string>>;
  requests: string[]; uploads: Map<string, Buffer>;
  authorization: Map<string, string | undefined>;
};

const readyJob = { state: 'READY', stage: 'READY', attempt: 0, missingArtifacts: [], pollAfterMs: 1 };
const sessionPath = (h: Harness) => path.join(h.bundleDir, '.release-session.json');
const releaseOptions = (h: Harness) => ({
  bundleDir: h.bundleDir, apiUrl: h.origin, token: 'test-token',
  idempotencyKey: 'response-validation-test', timeoutMs: 1000, pollIntervalMs: 1,
});

async function createHarness(): Promise<Harness> {
  const fixture = makeFixture('cli');
  const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-response-validation-'));
  fs.writeFileSync(path.join(bundleDir, 'manifest.json'), JSON.stringify(fixture.manifest));
  for (const [logicalPath, bytes] of fixture.files) {
    const filePath = path.join(bundleDir, logicalPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, bytes);
  }
  const requests: string[] = [];
  const authorization = new Map<string, string | undefined>();
  const uploads = new Map<string, Buffer>();
  const rawResponses: Partial<Record<Stage, string>> = {};
  const responses: Record<Stage, unknown> = {
    upload: undefined,
    complete: { status: 'complete', verifiedFiles: fixture.manifest.files },
    release: { jobId: 'job-valid', state: 'VALIDATING' },
    poll: { ...readyJob },
    renew: undefined,
  };
  const server = createServer(async (request, response) => {
    const requestPath = request.url ?? '';
    requests.push(`${request.method} ${requestPath}`);
    authorization.set(`${request.method} ${requestPath}`, request.headers.authorization);
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    if (request.method === 'PUT' && requestPath.startsWith('/objects/')) {
      uploads.set(decodeURIComponent(requestPath.slice('/objects/'.length)), Buffer.concat(chunks));
      response.writeHead(200).end();
      return;
    }
    let stage: Stage;
    if (request.method === 'POST' && requestPath === '/v1/uploads') stage = 'upload';
    else if (request.method === 'POST' && requestPath === '/v1/auth/oidc/renew') stage = 'renew';
    else if (request.method === 'POST' && requestPath.endsWith('/complete')) stage = 'complete';
    else if (request.method === 'POST' && requestPath === '/v1/releases') stage = 'release';
    else if (request.method === 'GET' && requestPath.startsWith('/v1/releases/')) stage = 'poll';
    else { response.writeHead(404).end(); return; }
    response.writeHead(stage === 'release' ? 202 : 200, { 'content-type': 'application/json' });
    response.end(rawResponses[stage] ?? JSON.stringify(responses[stage]));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  responses.upload = {
    uploadSessionId: 'upload-valid',
    files: fixture.manifest.files.map(file => ({
      path: file.path, uploadUrl: `${origin}/objects/${encodeURIComponent(file.path)}`,
      expiresAt: '2026-11-21T12:00:00.000Z',
    })),
  };
  return { server, origin, bundleDir, fixture, responses, rawResponses, requests, uploads, authorization };
}

async function seedSession(h: Harness, withJob = false): Promise<string> {
  await saveReleaseSession(h.bundleDir, {
    manifestDigest: await manifestDigest(h.fixture.manifest),
    idempotencyKey: 'preserved-key', uploadSessionId: 'upload-valid',
    uploadComplete: true,
    ...(withJob ? { jobId: 'job-valid' } : {}), state: 'VALIDATING', updatedAt: '',
  });
  return fs.readFileSync(sessionPath(h), 'utf8');
}

describe('CLI release successful response validation', () => {
  let h: Harness;
  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve, reject) => h.server.close(error => error ? reject(error) : resolve()));
    fs.rmSync(h.bundleDir, { recursive: true, force: true });
  });

  it('accepts complete wire responses, uploads the declared bytes and persists only validated identities', async () => {
    const result = await executeReleaseCommand(releaseOptions(h));
    expect(result).toMatchObject({ ok: true, jobId: 'job-valid', state: 'READY', stage: 'READY' });
    expect(await loadReleaseSession(h.bundleDir)).toMatchObject({
      uploadSessionId: 'upload-valid', jobId: 'job-valid', state: 'READY',
      idempotencyKey: 'response-validation-test',
    });
    expect(h.uploads.size).toBe(h.fixture.files.size);
    for (const [logicalPath, bytes] of h.fixture.files) expect(h.uploads.get(logicalPath)).toEqual(Buffer.from(bytes));
    expect(h.requests.slice(-3)).toEqual([
      'POST /v1/uploads/upload-valid/complete', 'POST /v1/releases', 'GET /v1/releases/job-valid',
    ]);
  });

  it('renews after a long upload and uses the new JWT for completion, submission and polling without leaking it to storage', async () => {
    let now = Math.floor(Date.now() / 1000) * 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const token = (seconds: number) => 'header.' + Buffer.from(JSON.stringify({ exp: now / 1000 + seconds })).toString('base64url') + '.signature';
    const original = token(600), renewed = token(7200);
    h.responses.renew = { accessToken: renewed, expiresIn: 7200 };
    const result = await executeReleaseCommand({ ...releaseOptions(h), token: original, timeoutMs: 720_000, onProgress: message => {
      if (message.startsWith('所有文件传输完成')) now += 310_000;
    } });
    expect(result).toMatchObject({ ok: true, state: 'READY' });
    expect(h.authorization.get('POST /v1/uploads')).toBe('Bearer ' + original);
    expect(h.authorization.get('POST /v1/auth/oidc/renew')).toBe('Bearer ' + original);
    for (const request of ['POST /v1/uploads/upload-valid/complete', 'POST /v1/releases', 'GET /v1/releases/job-valid']) {
      expect(h.authorization.get(request), request).toBe('Bearer ' + renewed);
    }
    for (const [request, authorization] of h.authorization) if (request.startsWith('PUT ')) expect(authorization).toBeUndefined();
  });

  it.each([
    ['empty file inventory', { uploadSessionId: 'upload-valid', files: [] }, '/files'],
    ['invalid session identity', { uploadSessionId: 123, files: [] }, '/uploadSessionId'],
  ])('rejects an upload response with %s before persisting the session identity or uploading', async (_name, response, pointer) => {
    h.responses.upload = response;
    await expect(executeReleaseCommand(releaseOptions(h))).rejects.toThrow(new RegExp(`INVALID_SCHEMA.*${pointer}`));
    expect(h.requests).toEqual(['POST /v1/uploads']);
    expect(await loadReleaseSession(h.bundleDir)).not.toHaveProperty('uploadSessionId');
  });

  it('rejects invalid upload expiration before uploading or persisting the plan', async () => {
    const plan = h.responses.upload as { uploadSessionId: string; files: Record<string, unknown>[] };
    h.responses.upload = { ...plan, files: [{ ...plan.files[0], expiresAt: 'tomorrow' }] };
    await expect(executeReleaseCommand(releaseOptions(h))).rejects.toThrow(new RegExp('INVALID_SCHEMA.*/files/0/expiresAt'));
    expect(h.requests).toEqual(['POST /v1/uploads']);
    expect(await loadReleaseSession(h.bundleDir)).not.toHaveProperty('uploadSessionId');
  });

  it.each([
    ['missing verified files', { status: 'complete' }, '/verifiedFiles'],
    ['empty verified files', { status: 'complete', verifiedFiles: [] }, '/verifiedFiles'],
  ])('rejects upload completion with %s before submitting a release', async (_name, response, pointer) => {
    h.responses.complete = response;
    await expect(executeReleaseCommand(releaseOptions(h))).rejects.toThrow(new RegExp(`INVALID_SCHEMA.*${pointer}`));
    expect(h.requests.at(-1)).toBe('POST /v1/uploads/upload-valid/complete');
    expect(h.requests).not.toContain('POST /v1/releases');
    expect(await loadReleaseSession(h.bundleDir)).not.toHaveProperty('jobId');
  });

  it.each([
    ['numeric job identity', { jobId: 123, state: 'VALIDATING' }, '/jobId'],
    ['missing job identity', { state: 'VALIDATING' }, '/jobId'],
    ['unknown initial state', { jobId: 'job-valid', state: 'BROKEN' }, '/state'],
  ])('rejects a release response with %s without changing the saved session or polling', async (_name, response, pointer) => {
    const originalSession = await seedSession(h);
    h.responses.release = response;
    await expect(executeReleaseCommand(releaseOptions(h))).rejects.toThrow(new RegExp(`INVALID_SCHEMA.*${pointer}`));
    expect(h.requests).toEqual(['POST /v1/releases']);
    expect(fs.readFileSync(sessionPath(h), 'utf8')).toBe(originalSession);
  });

  it('rejects a non-JSON upload completion with a root contract issue before submitting a release', async () => {
    h.rawResponses.complete = 'not-json';
    await expect(executeReleaseCommand(releaseOptions(h))).rejects.toThrow(/INVALID_SCHEMA.*""/);
    expect(h.requests.at(-1)).toBe('POST /v1/uploads/upload-valid/complete');
    expect(h.requests).not.toContain('POST /v1/releases');
    expect(await loadReleaseSession(h.bundleDir)).not.toHaveProperty('jobId');
  });

  it.each([
    ['missing job fields', { state: 'READY' }, '/stage'],
    ['negative attempt', { ...readyJob, attempt: -1 }, '/attempt'],
    ['unknown state', { ...readyJob, state: 'BROKEN' }, '/state'],
  ])('rejects poll response with %s without replacing the saved valid state', async (_name, response, pointer) => {
    const originalSession = await seedSession(h, true);
    h.responses.poll = response;
    await expect(executeReleaseCommand(releaseOptions(h))).rejects.toThrow(new RegExp(`INVALID_SCHEMA.*${pointer}`));
    expect(h.requests).toEqual(['GET /v1/releases/job-valid']);
    expect(fs.readFileSync(sessionPath(h), 'utf8')).toBe(originalSession);
  });

  it('returns a validated job status without modifying the saved session', async () => {
    const originalSession = await seedSession(h, true);
    expect(await executeStatusCommand(releaseOptions(h))).toEqual({ ok: true, status: readyJob });
    expect(fs.readFileSync(sessionPath(h), 'utf8')).toBe(originalSession);
  });

  it.each([
    ['missing fields', {}, '/state'],
    ['invalid polling interval', { ...readyJob, pollAfterMs: 0 }, '/pollAfterMs'],
    ['unknown stage', { ...readyJob, stage: 'BROKEN' }, '/stage'],
  ])('returns a failed status with contract code and pointer for %s', async (_name, response, pointer) => {
    const originalSession = await seedSession(h, true);
    h.responses.poll = response;
    const result = await executeStatusCommand(releaseOptions(h));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(new RegExp(`INVALID_SCHEMA.*${pointer}`));
    expect(result).not.toHaveProperty('status');
    expect(fs.readFileSync(sessionPath(h), 'utf8')).toBe(originalSession);
  });

  it('returns a failed status with a root contract issue for a non-JSON response', async () => {
    const originalSession = await seedSession(h, true);
    h.rawResponses.poll = 'not-json';
    const result = await executeStatusCommand(releaseOptions(h));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/INVALID_SCHEMA.*""/);
    expect(result).not.toHaveProperty('status');
    expect(fs.readFileSync(sessionPath(h), 'utf8')).toBe(originalSession);
  });
});
