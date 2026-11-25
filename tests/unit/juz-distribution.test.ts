import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const execute = promisify(execFile);
it('returns the current juz distribution on repeated builds when older versions coexist', async () => {
  const root = await mkdtemp(join(tmpdir(), 'juz-repeat-pack-'));
  try {
    const script = resolve('packages/component-cli/scripts/pack-juz.mjs');
    const metadata = JSON.parse(await readFile('packages/component-cli/package.json', 'utf8'));
    const old = join(root, 'juz-cli-0.0.1.tgz'); await writeFile(old, 'keep-old-artifact');
    for (let i = 0; i < 2; i++) {
      const result = JSON.parse((await execute(process.execPath, [script, '--out', root], { windowsHide: true, timeout: 60_000 })).stdout);
      expect(result.tarballName).toBe(`juz-cli-${metadata.version}.tgz`);
      expect(result.tarballPath).toBe(join(root, result.tarballName));
      expect(createHash('sha256').update(await readFile(result.tarballPath)).digest('hex')).toBe(result.sha256);
    }
    expect(await readFile(old, 'utf8')).toBe('keep-old-artifact');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120_000);
