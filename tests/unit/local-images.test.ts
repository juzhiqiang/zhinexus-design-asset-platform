import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { imageId } from '../../infra/scripts/local.js';

vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, writeFileSync: vi.fn(fs.writeFileSync) };
});
const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');

const directories: string[] = [];
const identity = `sha256:${'a'.repeat(64)}`;
const otherIdentity = `sha256:${'b'.repeat(64)}`;
const inspected = () => [{ Id: identity, Os: 'linux', Architecture: 'amd64', Config: { Labels: {
  'org.opencontainers.image.source': 'https://github.com/minio/minio',
  'org.opencontainers.image.revision': '9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a',
  'org.opencontainers.image.version': 'RELEASE.2025-10-15T17-29-55Z',
} } }];
function directory() { const dir = mkdtempSync(join(tmpdir(), 'local-images-')); directories.push(dir); return dir; }
afterEach(() => {
  vi.mocked(writeFileSync).mockImplementation(actualFs.writeFileSync);
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('registers a locally available pinned MinIO image by immutable identity in a clean worktree', () => {
  const dir = directory();
  expect(imageId({ directory: dir, inspect: inspected })).toBe(identity);
  expect(JSON.parse(readFileSync(join(dir, 'images.json'), 'utf8'))).toEqual({ minioImageId: identity });
});

it('keeps an existing recorded identity when its tag has moved', () => {
  const dir = directory(); const record = JSON.stringify({ minioImageId: identity });
  writeFileSync(join(dir, 'images.json'), record);
  expect(imageId({ directory: dir, inspect: reference => reference === identity ? inspected() : [{ ...inspected()[0], Id: otherIdentity }] })).toBe(identity);
  expect(readFileSync(join(dir, 'images.json'), 'utf8')).toBe(record);
});

it('never exposes a partial identity record to another first-time registrar', () => {
  const dir = directory();
  let interleaved = false;
  let concurrentResult: unknown;
  vi.mocked(writeFileSync).mockImplementation((path, data, options) => {
    if (typeof path === 'number') return actualFs.writeFileSync(path, data, options);
    const flags = typeof options === 'object' ? options?.flag : undefined;
    const fd = actualFs.openSync(path, flags ?? 'w');
    try {
      if (!interleaved) {
        interleaved = true;
        try { concurrentResult = imageId({ directory: dir, inspect: inspected }); }
        catch (error) { concurrentResult = error; }
      }
      actualFs.writeFileSync(fd, data, options);
    } finally { actualFs.closeSync(fd); }
  });
  expect(imageId({ directory: dir, inspect: inspected })).toBe(identity);
  expect(concurrentResult).toBe(identity);
  expect(JSON.parse(readFileSync(join(dir, 'images.json'), 'utf8'))).toEqual({ minioImageId: identity });
  expect(actualFs.readdirSync(dir)).toEqual(['images.json']);
});

it.each(['source', 'revision', 'version', 'architecture'] as const)('refuses a local image with mismatched %s', field => {
  const dir = directory(); const info = inspected();
  if (field === 'architecture') info[0]!.Architecture = 'arm64';
  else info[0]!.Config.Labels[`org.opencontainers.image.${field}`] = 'unexpected';
  expect(() => imageId({ directory: dir, inspect: () => info })).toThrow(/identity|pinned/i);
  expect(() => readFileSync(join(dir, 'images.json'))).toThrow();
});

it('fails closed on a malformed existing record without replacing it', () => {
  const dir = directory(); writeFileSync(join(dir, 'images.json'), '{broken');
  expect(() => imageId({ directory: dir, inspect: inspected })).toThrow(/identity|record/i);
  expect(readFileSync(join(dir, 'images.json'), 'utf8')).toBe('{broken');
});

it('reports missing local images without exposing child diagnostics', () => {
  const dir = directory();
  expect(() => imageId({ directory: dir, inspect: () => { throw new Error('secret-token'); } })).toThrow('Pinned local MinIO image unavailable; run infra:up to build it');
});
