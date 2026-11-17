import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  async function walk(directory: string, prefix = ''): Promise<void> {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix + item.name;
      if (item.isSymbolicLink()) throw new Error('Unexpected link in acceptance target');
      if (item.isDirectory()) { result[relative + '/'] = 'directory'; await walk(join(directory, item.name), relative + '/'); }
      else result[relative] = createHash('sha256').update(await readFile(join(directory, item.name))).digest('hex');
    }
  }
  await walk(root); return result;
}
