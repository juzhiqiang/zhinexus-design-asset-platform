import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { makeFixture } from '../fixtures/releases/g1/factory.js';
import { validateReleaseBundle } from '../../packages/component-cli/src/contracts/bundle.js';
import { validateManifest } from '../../packages/component-cli/src/contracts/validation.js';
import {
  loadReleaseBundle,
  verifyReleaseBundle,
} from '../../packages/component-cli/src/local/manifest.js';

describe('T04: release bundle verification and contract enforcement', () => {
  it('accepts a valid frozen bundle with reports and complete file inventory', async () => {
    const f = makeFixture('cli');
    const result = await validateReleaseBundle(f.manifest, f.files);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.schemaVersion).toBe(1);
      expect(result.value.channel).toBe('cli');
    }
  });

  it('rejects unlisted bundle files with UNEXPECTED_FILE', async () => {
    const f = makeFixture('cli');
    f.files.set('unexpected/sneaky.bin', new Uint8Array([1, 2, 3]));
    const result = await validateReleaseBundle(f.manifest, f.files);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === 'UNEXPECTED_FILE')).toBe(true);
    }
  });

  it('rejects missing declared files with FILE_REQUIRED', async () => {
    const f = makeFixture('cli');
    const targetPath = f.manifest.files[0]!.path;
    f.files.delete(targetPath);
    const result = await validateReleaseBundle(f.manifest, f.files);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === 'FILE_REQUIRED')).toBe(true);
    }
  });

  it('rejects tampered files or tarballs with DIGEST_MISMATCH', async () => {
    const f = makeFixture('cli');
    const targetPath = f.manifest.files[0]!.path;
    const bytes = f.files.get(targetPath)!;
    const tampered = new Uint8Array(bytes);
    tampered[0] = tampered[0]! ^ 0xff;
    f.files.set(targetPath, tampered);

    const result = await validateReleaseBundle(f.manifest, f.files);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === 'DIGEST_MISMATCH')).toBe(true);
    }
  });

  it('rejects missing screenshots for variant with SCREENSHOT_REQUIRED', async () => {
    const f = makeFixture('cli');
    f.manifest.variants[0]!.screenshots = [];
    const result = await validateReleaseBundle(f.manifest, f.files);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === 'SCREENSHOT_REQUIRED')).toBe(true);
    }
  });

  it('rejects framework mismatch (e.g. React variant using Vue screenshot) with SCREENSHOT_VARIANT_MISMATCH', async () => {
    const f = makeFixture('cli');
    // f.manifest.variants[0] is vue, f.manifest.variants[2] is react
    const vueShot = f.manifest.variants[0]!.screenshots[0]!;
    const reactVariant = f.manifest.variants.find((v) => v.framework === 'react');
    if (!reactVariant) throw new Error('Missing react variant in fixture');
    reactVariant.screenshots = [vueShot];

    const result = await validateReleaseBundle(f.manifest, f.files);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === 'SCREENSHOT_VARIANT_MISMATCH')).toBe(true);
    }
  });

  it('loadReleaseBundle and verifyReleaseBundle inspect bundle on disk', async () => {
    const f = makeFixture('cli');
    const tempBundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-bundle-dir-'));
    try {
      // 写入 manifest.json 与所有文件
      fs.writeFileSync(
        path.join(tempBundleDir, 'manifest.json'),
        JSON.stringify(f.manifest, null, 2),
        'utf8',
      );
      for (const [relPath, bytes] of f.files) {
        const fullPath = path.join(tempBundleDir, relPath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, bytes);
      }

      const { manifest, filesMap } = await loadReleaseBundle(tempBundleDir);
      expect(manifest.schemaVersion).toBe(1);
      expect(filesMap.size).toBe(f.files.size);

      const verification = await verifyReleaseBundle(tempBundleDir);
      expect(verification.ok).toBe(true);
    } finally {
      fs.rmSync(tempBundleDir, { recursive: true, force: true });
    }
  });
});

