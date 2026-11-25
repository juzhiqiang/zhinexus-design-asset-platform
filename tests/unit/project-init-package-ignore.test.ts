import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import tar from 'tar-stream';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../packages/component-cli/src/cli.js';
import { resolvePnpmExecutable } from '../../packages/component-cli/src/local/pack.js';
import { computeSourceDigest } from '../../packages/component-cli/src/local/digest.js';
import { freezePackageRelease } from '../../packages/component-cli/src/local/freeze.js';
import { installProjectConsumer } from '../../packages/component-cli/src/project/consumer.js';
import { readProject } from '../../packages/component-cli/src/project/config.js';

const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function tarEntries(archive: Buffer): Promise<Map<string, Buffer>> {
  const entries = new Map<string, Buffer>();
  const extract = tar.extract();
  await new Promise<void>((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on('data', chunk => {
        if (Buffer.isBuffer(chunk)) chunks.push(chunk);
        else reject(new Error('Unexpected tar stream chunk'));
      });
      stream.on('error', reject);
      stream.on('end', () => { entries.set(header.name, Buffer.concat(chunks)); next(); });
      stream.resume();
    });
    extract.on('error', reject);
    extract.on('finish', resolve);
    extract.end(gunzipSync(archive));
  });
  return entries;
}

describe('root component package release exclusions', () => {
  it('does not create configuration when the ignore path cannot be safely updated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'juz-invalid-ignore-')); roots.push(root);
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', scripts: { build: 'node build.mjs' } }));
    await mkdir(join(root, '.npmignore'));
    const result = await runCli(['init', '--component', 'badge', '--export', 'Badge', '--framework', 'react', '--category', 'general'], '1.0.0', { cwd: root });
    expect(result.exitCode).toBe(1); expect(result.stderr).toContain('PACKAGE_IGNORE_INVALID');
    await expect(readFile(join(root, 'component.config.json'))).rejects.toThrow();
    expect(await readdir(join(root, '.npmignore'))).toEqual([]);
  });

  it('keeps source fingerprints independent of previous release outputs while still tracking source edits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'juz-source-ignore-')); roots.push(root);
    await writeFile(join(root, 'index.js'), 'export const Badge = 1;');
    const before = await computeSourceDigest(root);
    await mkdir(join(root, '.component-releases', 'old'), { recursive: true });
    await writeFile(join(root, '.component-releases', 'old', 'manifest.json'), '{}');
    await writeFile(join(root, '.component-releases', 'old.zip'), 'old archive');
    for (const name of ['.component-release.json', '.component-release.json.tmp', '.release-session.json']) await writeFile(join(root, name), 'old bookkeeping');
    expect(await computeSourceDigest(root)).toBe(before);
    await writeFile(join(root, 'index.js'), 'export const Badge = 2;');
    expect(await computeSourceDigest(root)).not.toBe(before);
  });
  it.each(['.npmignore', '.gitignore'])('keeps %s exclusions and excludes old platform artifacts from a real packed package', async ignoreFile => {
    const root = await mkdtemp(join(tmpdir(), 'juz-init-ignore-')); roots.push(root);
    const packageRoot = join(root, 'component'); const output = join(root, 'packed');
    await mkdir(packageRoot); await mkdir(output);
    await mkdir(join(packageRoot, 'dist')); await mkdir(join(packageRoot, '.component-releases', 'old'), { recursive: true });
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: '@fixture/root-ignore', version: '1.0.0', scripts: { build: 'node build.mjs' } }));
    const previous = '# existing exclusions\r\nprivate-notes.txt\r\n';
    await writeFile(join(packageRoot, ignoreFile), previous);
    if (ignoreFile === '.npmignore') await writeFile(join(packageRoot, '.gitignore'), 'dist/\n');
    await writeFile(join(packageRoot, 'private-notes.txt'), 'existing private file');
    await writeFile(join(packageRoot, 'dist', 'index.js'), 'export const Badge = 1;');
    await writeFile(join(packageRoot, '.component-releases', 'old', '.release-session.json'), '{"uploadUrl":"https://invalid.example/synthetic-upload-secret"}');
    await writeFile(join(packageRoot, '.component-releases', 'old.zip'), 'synthetic old archive');
    await writeFile(join(packageRoot, '.component-release.json'), '{"bundleDir":".component-releases/old"}');
    await writeFile(join(packageRoot, '.component-release.json.tmp'), 'synthetic pending pointer');
    await writeFile(join(packageRoot, '.release-session.json'), '{"uploadUrl":"synthetic-root-session"}');

    const initialized = await runCli(['init', '--component', 'badge', '--export', 'Badge', '--framework', 'react', '--category', 'general'], '1.0.0', { cwd: packageRoot });
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    await execute(resolvePnpmExecutable(packageRoot), ['pack', '--pack-destination', output], { cwd: packageRoot, windowsHide: true, timeout: 30_000 });
    const archive = (await readdir(output)).find(name => name.endsWith('.tgz'));
    expect(archive).toBeDefined();
    const entries = await tarEntries(await readFile(join(output, archive!)));
    expect(entries.get('package/dist/index.js')?.toString()).toBe('export const Badge = 1;');
    expect(entries.has('package/private-notes.txt')).toBe(false);
    expect([...entries.keys()].filter(name => name.includes('.component-release') || name.endsWith('/.release-session.json'))).toEqual([]);
    expect([...entries.values()].some(bytes => bytes.includes('synthetic-upload-secret') || bytes.includes('synthetic-root-session'))).toBe(false);
    expect((await readFile(join(packageRoot, '.npmignore'), 'utf8')).startsWith(previous)).toBe(true);
    if (ignoreFile === '.gitignore') expect(await readFile(join(packageRoot, '.gitignore'), 'utf8')).toBe(previous);
    const savedIgnore = await readFile(join(packageRoot, '.npmignore'));
    const repeated = await runCli(['init', '--component', 'badge', '--export', 'Badge', '--framework', 'react', '--category', 'general'], '1.0.0', { cwd: packageRoot });
    expect(repeated.stderr).toContain('CONFIG_EXISTS');
    expect(await readFile(join(packageRoot, '.npmignore'))).toEqual(savedIgnore);
  }, 40_000);

  it.each(['.component-releases/old/.release-session.json', 'dist/.release-session.json', '.component-release.json', '.component-release.json.tmp'])('rejects a genuinely packed and installed %s before importing component code', async artifact => {
    const root = await mkdtemp(join(tmpdir(), 'juz-packed-state-')); roots.push(root);
    const packageRoot = join(root, 'component'); const consumer = join(root, 'external-consumer');
    await mkdir(packageRoot); await mkdir(consumer); await mkdir(join(packageRoot, 'dist'));
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: '@fixture/root-ignore', version: '1.0.0', type: 'module', exports: './dist/index.js', files: ['dist', '.component-releases', '.component-release.json', '.component-release.json.tmp'], scripts: { build: 'node build.mjs' } }));
    await writeFile(join(packageRoot, 'dist/index.js'), "import { writeFileSync } from 'node:fs'; writeFileSync('component-imported', 'yes'); export const Badge = 1;");
    await mkdir(join(packageRoot, artifact, '..'), { recursive: true });
    await writeFile(join(packageRoot, artifact), '{"uploadUrl":"synthetic-sensitive-state"}');
    const initialized = await runCli(['init', '--component', 'badge', '--export', 'Badge', '--framework', 'react', '--category', 'general'], '1.0.0', { cwd: packageRoot });
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    await mkdir(join(packageRoot, 'consumers/react'), { recursive: true });
    await writeFile(join(packageRoot, 'consumers/react/package.json'), JSON.stringify({ name: 'isolated-consumer', private: true, type: 'module' }));
    const project = await readProject(packageRoot);
    const frozen = await freezePackageRelease({ packageDir: packageRoot, stagingDir: join(root, 'frozen') });
    const archiveBefore = await readFile(frozen.tarballPath);
    expect((await tarEntries(archiveBefore)).get('package/' + artifact)?.toString()).toContain('synthetic-sensitive-state');
    await expect(installProjectConsumer(project, project.config.variants[0]!, frozen, consumer, () => {}, 30_000, project.config.variants)).rejects.toThrow(/PACKAGE_RELEASE_ARTIFACT.*files.*dist/s);
    expect(await readFile(frozen.tarballPath)).toEqual(archiveBefore);
    expect(createHash('sha256').update(archiveBefore).digest('hex')).toBe(frozen.sha256);
    await expect(readFile(join(consumer, 'component-imported'))).rejects.toThrow();
    await expect(readFile(join(consumer, '.verify-export.mjs'))).rejects.toThrow();
  }, 40_000);
});
