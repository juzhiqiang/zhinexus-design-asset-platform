import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { makeFixture } from '../fixtures/releases/g1/factory.js';
import { createBundleZip } from '../../packages/component-cli/src/project/archive.js';
import { runCli } from '../../packages/component-cli/src/cli.js';

const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function bundle() {
  const root = await mkdtemp(join(tmpdir(), 'juz-archive-')); roots.push(root);
  const dir = join(root, 'bundle'); await mkdir(dir);
  const fixture = makeFixture('cli');
  for (const variant of fixture.manifest.variants) {
    const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, componentId: variant.componentId, framework: variant.framework, exportName: variant.exportName, exportPath: variant.exportPath, props: [], events: [], notes: [] }));
    fixture.files.set(variant.api.path, bytes);
    Object.assign(variant.api, { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const docs = fixture.manifest.variants[0]!.docs;
  const docBytes = fixture.files.get(docs.path)!; fixture.files.delete(docs.path);
  docs.path = 'docs/中文说明.md'; fixture.files.set(docs.path, docBytes);
  fixture.manifest.files = [...fixture.files].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }));
  fixture.files.set('manifest.json', Buffer.from(JSON.stringify(fixture.manifest, null, 2) + '\n'));
  for (const [name, bytes] of fixture.files) { await mkdir(join(dir, name, '..'), { recursive: true }); await writeFile(join(dir, name), bytes); }
  return { root, dir, fixture };
}

describe('frozen bundle ZIP', () => {
  it('still resumes an existing frozen bundle inside a root package without rebuilding it', async () => {
    const { root, dir, fixture } = await bundle();
    const pkg = fixture.manifest.packages[0]!; const variant = fixture.manifest.variants[0]!;
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version }));
    await writeFile(join(root, 'component.config.json'), JSON.stringify({ schemaVersion: 1, packageDir: '.', build: { program: process.execPath, args: ['-e', "require('fs').writeFileSync('rebuilt','yes')"] }, dev: {}, variants: [{ componentId: variant.componentId, framework: variant.framework, category: 'general', exportName: variant.exportName, exportPath: variant.exportPath, api: 'unused-api.json', docs: 'unused-docs.md', consumer: { templateDir: 'unused-consumer', adapter: 'vite', previewDir: 'dist', previewEntry: 'index.html' }, readiness: { selector: '#app', states: ['default'], width: 800, height: 400, renderer: 'canvas', theme: 'light' } }] }));
    const requests: string[] = [];
    const server = createServer((request, response) => { requests.push(request.url!); response.writeHead(401).end('{}'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
      const original = await readFile(join(dir, 'manifest.json'));
      const result = await runCli(['publish', '--bundle-dir', 'bundle', '--api-url', origin, '--token', 'synthetic-resume-token'], '1.0.0', { cwd: root });
      expect(result.exitCode).toBe(1); expect(requests, result.stderr).toEqual(['/v1/uploads']);
      expect(await readFile(join(dir, 'manifest.json'))).toEqual(original);
      await expect(readFile(join(root, 'rebuilt'))).rejects.toThrow();
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it.runIf(process.platform === 'win32')('can be extracted by Windows and preserves every declared byte while excluding session files', async () => {
    const { root, dir, fixture } = await bundle();
    await writeFile(join(dir, '.release-session.json'), '{"token":"do-not-export"}');
    await writeFile(join(dir, '.env'), 'SECRET=do-not-export');
    const archive = await createBundleZip(dir);
    const target = join(root, 'extracted');
    await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:JUZ_TEST_ARCHIVE -DestinationPath $env:JUZ_TEST_TARGET'], { env: { ...process.env, JUZ_TEST_ARCHIVE: archive, JUZ_TEST_TARGET: target } });
    for (const [name, bytes] of fixture.files) expect(await readFile(join(target, name))).toEqual(Buffer.from(bytes));
    await expect(readFile(join(target, '.release-session.json'))).rejects.toThrow();
    await expect(readFile(join(target, '.env'))).rejects.toThrow();
    await expect(createBundleZip(dir)).rejects.toThrow(/EEXIST/);
  });

  it('rejects tampered material before producing an archive', async () => {
    const { dir, fixture } = await bundle();
    await writeFile(join(dir, fixture.manifest.packages[0]!.tarball.path), 'tampered');
    await expect(createBundleZip(dir)).rejects.toThrow(/BUNDLE_INVALID/);
    await expect(readFile(dir + '.zip')).rejects.toThrow();
  });

  it('rejects a declared path escaping through a symlink', async () => {
    const { dir, root, fixture } = await bundle();
    const { symlink } = await import('node:fs/promises');
    await cp(join(dir, 'packages'), join(root, 'external'), { recursive: true });
    await rm(join(dir, 'packages'), { recursive: true });
    await symlink(join(root, 'external'), join(dir, 'packages'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(fixture.manifest.packages.length).toBeGreaterThan(0);
    await expect(createBundleZip(dir)).rejects.toThrow(/PATH_OUTSIDE_PROJECT/);
  });
});
