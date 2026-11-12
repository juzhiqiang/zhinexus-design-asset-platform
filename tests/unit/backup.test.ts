import { expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateBackupManifest, verifyBackup } from '../../infra/scripts/backup.js';

const manifest = { version: 1, sourceId: '7b7b1be8-41d4-4eb2-91a7-9ae3aa4fb254', createdAt: '2026-11-12T00:00:00.000Z',
  files: Object.fromEntries(['postgres.dump','verdaccio.tar','minio.tar'].map(file => [file, { bytes: 1, sha256: 'a'.repeat(64) }])) };
it('rejects unknown backup versions, missing stores, injected filenames and invalid hashes', () => {
  expect(validateBackupManifest(manifest)).toEqual(manifest);
  for (const invalid of [{...manifest,version:2}, {...manifest,files:{}}, {...manifest,files:{...manifest.files,'../secret':manifest.files['minio.tar']}},
    {...manifest,sourceId:'shared-g2'}, {...manifest,files:{...manifest.files,'minio.tar':{bytes:1,sha256:'secret'}}}]) {
    expect(() => validateBackupManifest(invalid)).toThrow();
  }
});
it('refuses corrupted or incomplete archive content before any restore mutation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zhinexus-backup-test-'));
  try {
    await writeFile(join(dir,'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(dir,'postgres.dump'), 'b');
    await expect(verifyBackup(dir)).rejects.toThrow();
  } finally { await rm(dir, { recursive:true }); }
});
