import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { command, withLocalLock } from '../../infra/scripts/local.js';

describe('local infrastructure operations', () => {
  it('keeps a useful npm conflict code without exposing child output', () => {
    const run = () => command(process.execPath, ['-e', 'console.log(JSON.stringify({error:{code:"EPUBLISHCONFLICT",summary:"private-token"}})); process.exit(1)']);
    expect(run).toThrow('EPUBLISHCONFLICT');
    try { run(); } catch (error) { expect(String(error)).not.toContain('private-token'); }
  });
  it('excludes concurrent operations and releases the lock after failure', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'g2-lock-test-'));
    try {
      await expect(withLocalLock(async () => {
        await expect(withLocalLock(async () => {}, directory)).rejects.toThrow();
        throw new Error('operation failed');
      }, directory)).rejects.toThrow('operation failed');
      expect(existsSync(join(directory, 'operation.lock'))).toBe(false);
      await expect(withLocalLock(async () => 'retry', directory)).resolves.toBe('retry');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
