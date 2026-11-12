import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import * as tar from 'tar-stream';
import { sha256, type PackageRef, type ReleaseManifestV1 } from '@company/contracts';
import { RegistryClient } from '../../apps/api/src/releases/registry-client.js';
import { localCredentials } from './support.js';
import { PlatformError } from '../../apps/api/src/errors.js';

async function createTarball(packageName: string, version: string, extraContent = 'hello'): Promise<Uint8Array> {
  const pack = tar.pack();
  pack.entry(
    { name: 'package/package.json' },
    JSON.stringify({ name: packageName, version, description: 'Test probe' }),
  );
  pack.entry({ name: 'package/README.md' }, `# Test probe ${extraContent}\n`);
  pack.finalize();

  const chunks: Buffer[] = [];
  const gzip = zlib.createGzip();
  pack.pipe(gzip);

  await new Promise<void>((resolve, reject) => {
    gzip.on('data', (c) => chunks.push(c));
    gzip.on('end', () => resolve());
    gzip.on('error', reject);
  });

  return new Uint8Array(Buffer.concat(chunks));
}

describe('T06: RegistryClient and topological dependency availability adapter', () => {
  const creds = localCredentials();
  const client = new RegistryClient({
    registryUrl: 'http://127.0.0.1:14873',
    publisherUser: 'g2publisher',
    publisherPassword: creds.publisherPassword,
    readerUser: 'g2reader',
    readerPassword: creds.readerPassword,
  });

  it('authenticates with publisher and reader roles returning valid Verdaccio auth tokens', async () => {
    const pubToken = await client.ensureToken('publisher');
    const readToken = await client.ensureToken('reader');

    expect(pubToken).toBeDefined();
    expect(pubToken.length).toBeGreaterThan(10);
    expect(readToken).toBeDefined();
    expect(readToken.length).toBeGreaterThan(10);
  });

  it('publishes a new package version, accepts idempotent identical publish, and rejects differing bytes with CONFLICT', async () => {
    const pkgName = `@g2-probe/pkg-${randomUUID().slice(0, 8)}`;
    const version = '1.0.0';
    const tarballBytes = await createTarball(pkgName, version, 'v1 original');
    const tarballSha = await sha256(tarballBytes);

    const pkgRef: PackageRef = {
      name: pkgName,
      version,
      tarball: {
        path: `packages/${path.basename(pkgName)}-${version}.tgz`,
        sha256: tarballSha,
        bytes: tarballBytes.byteLength,
      },
      sourceDigest: 'a'.repeat(64),
      dependencies: {},
      peerDependencies: {},
    };

    // 1. 首次发布：返回 published
    const pubResult = await client.ensurePackage(pkgRef, tarballBytes, 'candidate-test');
    expect(pubResult.status).toBe('published');
    expect(pubResult.integrity).toBe(tarballSha);

    // 2. 幂等发布同一产物：返回 already-identical，禁止重复发布或抛出异常
    const repubResult = await client.ensurePackage(pkgRef, tarballBytes, 'candidate-test');
    expect(repubResult.status).toBe('already-identical');
    expect(repubResult.integrity).toBe(tarballSha);

    // 3. 尝试发布同名同版本但不同字节的篡改产物：必须抛出 CONFLICT，绝不覆盖已有版本
    const tamperedBytes = await createTarball(pkgName, version, 'tampered bytes diff content');
    const tamperedSha = await sha256(tamperedBytes);
    const tamperedPkgRef: PackageRef = {
      ...pkgRef,
      tarball: {
        ...pkgRef.tarball,
        sha256: tamperedSha,
        bytes: tamperedBytes.byteLength,
      },
    };

    await expect(
      client.ensurePackage(tamperedPkgRef, tamperedBytes, 'candidate-test'),
    ).rejects.toThrowError(PlatformError);
  });

  it('checks topological availability and reports missing packages or dependencies', async () => {
    const manifest: ReleaseManifestV1 = {
      schemaVersion: 1,
      channel: 'cli',
      packages: [
        {
          name: '@company/charts-core',
          version: '0.0.2',
          tarball: { path: 'packages/core.tgz', sha256: 'a'.repeat(64), bytes: 100 },
          sourceDigest: 'a'.repeat(64),
          dependencies: {},
          peerDependencies: {},
        },
        {
          name: '@company/charts-vue',
          version: '0.0.2',
          tarball: { path: 'packages/vue.tgz', sha256: 'b'.repeat(64), bytes: 100 },
          sourceDigest: 'b'.repeat(64),
          dependencies: { '@company/charts-core': '0.0.2' },
          peerDependencies: {},
        },
      ],
      variants: [],
      reports: [],
      files: [],
    };

    // 0.0.2 在本地环境先前已发布过，因此应完全可用
    const availResult = await client.checkAvailability(manifest);
    expect(availResult.ok).toBe(true);
    expect(availResult.missing).toHaveLength(0);

    // 反例：当包含未发布的幽灵版本时，准确标记 missing
    const missingManifest: ReleaseManifestV1 = {
      ...manifest,
      packages: [
        ...manifest.packages,
        {
          name: '@g2-probe/nonexistent-package',
          version: '99.99.99',
          tarball: { path: 'packages/ghost.tgz', sha256: 'c'.repeat(64), bytes: 100 },
          sourceDigest: 'c'.repeat(64),
          dependencies: {},
          peerDependencies: {},
        },
      ],
    };

    const missingResult = await client.checkAvailability(missingManifest);
    expect(missingResult.ok).toBe(false);
    expect(missingResult.missing.length).toBeGreaterThanOrEqual(1);
    expect(missingResult.missing[0]!.ref).toContain('nonexistent-package');
  });
});

