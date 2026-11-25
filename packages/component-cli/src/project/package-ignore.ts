import { appendFile, lstat, readFile, writeFile } from 'node:fs/promises';
import { projectPath } from './config.js';

/** Preserve npm's existing ignore source before excluding generated release state. */
export async function excludeRootReleaseArtifacts(root: string): Promise<void> {
  const readIgnore = async (name: string): Promise<string | undefined> => {
    const file = await projectPath(root, name, true);
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('PACKAGE_IGNORE_INVALID: ' + name);
      return await readFile(file, 'utf8');
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    }
  };
  const existing = await readIgnore('.npmignore');
  const previous = existing ?? await readIgnore('.gitignore') ?? '';
  const exclusions = '\n# juz local release artifacts\n/.component-releases/\n/.component-release.json\n/.component-release.json.tmp\n/.release-session.json\n';
  const target = await projectPath(root, '.npmignore', true);
  if (existing === undefined) await writeFile(target, previous + exclusions, { flag: 'wx' });
  else await appendFile(target, exclusions);
}
