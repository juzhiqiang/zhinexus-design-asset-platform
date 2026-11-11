import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  computeBufferSha256,
  computeFileSha256,
  computeSourceDigest,
  createArtifactRef,
} from '../../packages/component-cli/src/local/digest.js';
import {
  freezePackageRelease,
  verifyFrozenTarball,
} from '../../packages/component-cli/src/local/freeze.js';

describe('T04: digest computation and release fingerprint', () => {
  it('computes 64-char lowercase SHA-256 for buffers', () => {
    const hash = computeBufferSha256(Buffer.from('hello'));
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('computes accurate SHA-256 for files on disk', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-test-'));
    try {
      const filePath = path.join(tempDir, 'sample.txt');
      fs.writeFileSync(filePath, 'hello\n');
      const hash = await computeFileSha256(filePath);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);

      const ref = await createArtifactRef(filePath, 'relative/sample.txt');
      expect(ref).toEqual({
        path: 'relative/sample.txt',
        sha256: hash,
        bytes: fs.statSync(filePath).size,
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('computes deterministic normalized sourceDigest and ignores transient files', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-digest-test-'));
    try {
      fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'dist'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'node_modules'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.turbo'), { recursive: true });

      fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name":"test"}\n');
      fs.writeFileSync(path.join(tempDir, 'src', 'index.ts'), 'export const a = 1;\n');
      // Transient files that must be ignored
      fs.writeFileSync(path.join(tempDir, 'dist', 'index.js'), 'ignored\n');
      fs.writeFileSync(path.join(tempDir, 'node_modules', 'dep.js'), 'ignored\n');
      fs.writeFileSync(path.join(tempDir, '.turbo', 'cache.log'), 'ignored\n');
      fs.writeFileSync(path.join(tempDir, 'test.tgz'), 'ignored\n');

      const digest1 = await computeSourceDigest(tempDir);
      expect(digest1).toMatch(/^[a-f0-9]{64}$/);

      // Mutating transient file does not change sourceDigest
      fs.writeFileSync(path.join(tempDir, 'dist', 'index.js'), 'mutated dist\n');
      const digest2 = await computeSourceDigest(tempDir);
      expect(digest2).toBe(digest1);

      // Mutating included source file changes sourceDigest
      fs.writeFileSync(path.join(tempDir, 'src', 'index.ts'), 'export const a = 2;\n');
      const digest3 = await computeSourceDigest(tempDir);
      expect(digest3).not.toBe(digest1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('freezePackageRelease freezes tarball and detects byte mutations', async () => {
    const repoRoot = path.resolve(__dirname, '../../');
    const corePkgDir = path.join(repoRoot, 'packages', 'charts-core');
    const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freeze-test-'));

    try {
      const frozen = await freezePackageRelease({
        packageDir: corePkgDir,
        stagingDir,
      });

      expect(frozen.packageName).toBe('@company/charts-core');
      expect(frozen.version).toBe('0.0.1');
      expect(frozen.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(frozen.bytes).toBeGreaterThan(0);
      expect(fs.existsSync(frozen.tarballPath)).toBe(true);
      expect(fs.existsSync(path.join(stagingDir, 'fingerprint.json'))).toBe(true);

      // Intact tarball verifies successfully
      const checkValid = await verifyFrozenTarball(frozen);
      expect(checkValid.ok).toBe(true);

      // Mutating even 1 byte of the frozen tarball triggers failure
      const buffer = fs.readFileSync(frozen.tarballPath);
      buffer[buffer.length - 1] = (buffer[buffer.length - 1]! ^ 0xff);
      fs.writeFileSync(frozen.tarballPath, buffer);

      const checkTampered = await verifyFrozenTarball(frozen);
      expect(checkTampered.ok).toBe(false);
      if (!checkTampered.ok) {
        expect(checkTampered.error).toBe('TARBALL_MUTATION_DETECTED');
      }
    } finally {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  });
});
