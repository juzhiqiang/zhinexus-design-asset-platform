import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadT17HostInputs, parseT17HostInputs, publicT17HostSummary } from './e2e-config.js';
import { makeFixture } from '../../fixtures/releases/g1/factory.js';

const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const testRoots: string[] = [];
async function createTestRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  testRoots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of testRoots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function writeValidSdkBundle(root: string, addLinkedFile = false) {
  const sdk = join(root, 'sdk');
  await mkdir(sdk, { recursive: true });
  const fixture = makeFixture('web');
  for (const [path, bytes] of fixture.files) {
    const target = join(sdk, ...path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  if (addLinkedFile) fixture.manifest.files.push({ path: 'linked/escaped.js', bytes: Buffer.byteLength('outside bundle bytes'), sha256: sha('outside bundle bytes') });
  const manifestBytes = Buffer.from(JSON.stringify(fixture.manifest) + '\n');
  await writeFile(join(sdk, 'manifest.json'), manifestBytes);
  return { sdk, manifestBytes, manifest: fixture.manifest };
}
function variantMapFor(manifest: ReturnType<typeof makeFixture>['manifest']) {
  return { schemaVersion: 1, variants: manifest.variants.map(variant => ({
    componentId: variant.componentId, framework: variant.framework, variantReleaseId: `release-${variant.variantId}`,
  })) };
}
const valid = {
  T17_HOST_CLI_TARBALL: 'C:/acceptance/cli.tgz', T17_HOST_CLI_SHA256: 'a'.repeat(64), T17_HOST_CLI_VERSION: '0.0.16',
  T17_HOST_SDK_BUNDLE: 'C:/acceptance/sdk', T17_HOST_SDK_MANIFEST_SHA256: 'b'.repeat(64),
  T17_HOST_API_URL: 'http://127.0.0.1:3000', T17_HOST_REGISTRY_URL: 'http://127.0.0.1:4873',
  T17_HOST_VARIANTS_FILE: 'C:/acceptance/variants.json', ZHINEXUS_API_TOKEN: 'api-secret-for-test', ZHINEXUS_REGISTRY_TOKEN: 'registry-secret-for-test',
  T17_HOST_VARIANTS_SHA256: 'd'.repeat(64),
};

describe('T17 frozen host acceptance inputs', () => {
  it('requires frozen inputs and loopback services and keeps secrets out of public summaries', () => {
    expect(() => parseT17HostInputs({})).toThrow(/T17_HOST_CLI_TARBALL/);
    expect(() => parseT17HostInputs({ ...valid, T17_HOST_CLI_TARBALL: 'cli.tgz' })).toThrow(/absolute/i);
    expect(() => parseT17HostInputs({ ...valid, T17_HOST_CLI_SHA256: 'a'.repeat(63) })).toThrow(/SHA-256/i);
    expect(() => parseT17HostInputs({ ...valid, T17_HOST_CLI_VERSION: 'latest' })).toThrow(/version/i);
    expect(() => parseT17HostInputs({ ...valid, T17_HOST_API_URL: 'https://api.example.com' })).toThrow(/loopback/i);
    expect(() => parseT17HostInputs({ ...valid, T17_HOST_REGISTRY_URL: 'http://127.0.0.1:4873/path' })).toThrow(/origin/i);
    const summary = JSON.stringify(publicT17HostSummary(parseT17HostInputs(valid)));
    expect(summary).toContain('0.0.16');
    expect(summary).not.toContain(valid.ZHINEXUS_API_TOKEN);
    expect(summary).not.toContain(valid.ZHINEXUS_REGISTRY_TOKEN);
    expect(summary).not.toContain('authorization');
  });

  it('verifies frozen bytes and a digest-pinned variant map', async () => {
    const root = await createTestRoot('t17-host-inputs-');
    const tarball = join(root, 'cli.tgz'), variants = join(root, 'variants.json');
    const bundle = await writeValidSdkBundle(root);
    const manifestBytes = bundle.manifestBytes;
    const variantsBytes = Buffer.from(JSON.stringify(variantMapFor(bundle.manifest)) + '\n');
    await writeFile(tarball, 'frozen cli bytes'); await writeFile(variants, variantsBytes);
    const env = { ...valid, T17_HOST_CLI_TARBALL: tarball, T17_HOST_CLI_SHA256: sha('wrong frozen bytes'), T17_HOST_SDK_BUNDLE: bundle.sdk,
      T17_HOST_SDK_MANIFEST_SHA256: sha(manifestBytes), T17_HOST_VARIANTS_FILE: variants };
    await expect(loadT17HostInputs(env)).rejects.toThrow(/tarball.*SHA-256/i);
    env.T17_HOST_CLI_SHA256 = sha('frozen cli bytes'); env.T17_HOST_SDK_MANIFEST_SHA256 = 'c'.repeat(64);
    await expect(loadT17HostInputs(env)).rejects.toThrow(/manifest.*SHA-256/i);
    env.T17_HOST_SDK_MANIFEST_SHA256 = sha(manifestBytes);
    await expect(loadT17HostInputs(env)).rejects.toThrow(/variant.*SHA-256/i);
    env.T17_HOST_VARIANTS_SHA256 = sha(variantsBytes);
    const loaded = await loadT17HostInputs(env);
    expect(loaded.variants).toEqual(variantMapFor(bundle.manifest));
    expect(publicT17HostSummary(loaded)).not.toHaveProperty('apiToken');
    expect(publicT17HostSummary(loaded)).not.toHaveProperty('registryToken');
  });

  it('rejects duplicate variant identities', async () => {
    const root = await createTestRoot('t17-host-variants-');
    const bundle = await writeValidSdkBundle(root);
    const manifestBytes = bundle.manifestBytes;
    const variantsBytes = JSON.stringify({ schemaVersion: 1, variants: [
      { componentId: 'line', framework: 'vue', variantReleaseId: 'v1' },
      { componentId: 'line', framework: 'vue', variantReleaseId: 'v2' },
    ] });
    const variantsPath = join(root, 'variants.json'), tarballPath = join(root, 'cli.tgz');
    await writeFile(tarballPath, 'frozen cli bytes'); await writeFile(variantsPath, variantsBytes);
    const env = { ...valid, T17_HOST_CLI_TARBALL: tarballPath, T17_HOST_CLI_SHA256: sha('frozen cli bytes'), T17_HOST_SDK_BUNDLE: bundle.sdk,
      T17_HOST_SDK_MANIFEST_SHA256: sha(manifestBytes), T17_HOST_VARIANTS_FILE: variantsPath, T17_HOST_VARIANTS_SHA256: sha(await readFile(variantsPath, 'utf8')) };
    await expect(loadT17HostInputs(env)).rejects.toThrow(/duplicate/i);
  });

  it('rejects SDK files reached through a directory junction outside the frozen bundle', async () => {
    const root = await createTestRoot('t17-host-junction-');
    try {
      const outside = join(root, 'outside');
      await mkdir(outside);
      await writeFile(join(outside, 'escaped.js'), 'outside bundle bytes');
      const bundle = await writeValidSdkBundle(root, true);
      await symlink(outside, join(bundle.sdk, 'linked'), 'junction');
      const variantsBytes = JSON.stringify({ schemaVersion: 1, variants: [] }) + String.fromCharCode(10);
      const tarballPath = join(root, 'cli.tgz'), variantsPath = join(root, 'variants.json');
      await writeFile(tarballPath, 'frozen cli bytes'); await writeFile(variantsPath, variantsBytes);
      const env = { ...valid, T17_HOST_CLI_TARBALL: tarballPath, T17_HOST_CLI_SHA256: sha('frozen cli bytes'), T17_HOST_SDK_BUNDLE: bundle.sdk,
        T17_HOST_SDK_MANIFEST_SHA256: sha(bundle.manifestBytes), T17_HOST_VARIANTS_FILE: variantsPath, T17_HOST_VARIANTS_SHA256: sha(variantsBytes) };

      await expect(loadT17HostInputs(env)).rejects.toThrow(/escape|bundle|link/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
