import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { validateManifest } from '@company/contracts';
import { sanitizeWebManifest } from '../../apps/gallery/app/lib/uploads/manifest-form.js';

const origin = process.env.WEB_UPLOAD_ORIGIN ?? `http://127.0.0.1:${process.env.WEB_UPLOAD_PORT ?? 5173}`;

test('older valid digest result cannot enable submission of newer corrupt files', async ({ page }) => {
  test.setTimeout(60_000);
  const bundle = process.env.WEB_UPLOAD_FROZEN_BUNDLE;
  if (!bundle) throw new Error('WEB_UPLOAD_FROZEN_BUNDLE must identify an already frozen SDK bundle');
  const manifest = sanitizeWebManifest(JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8')));
  expect(validateManifest(manifest).ok).toBe(true);
  const owned = await mkdtemp(join(tmpdir(), 'c-web-digest-'));
  try {
    const corrupt = join(owned, 'corrupt');
    await cp(bundle, corrupt, { recursive: true });
    const tarball = join(corrupt, manifest.packages[0]!.tarball.path);
    const bytes = await readFile(tarball);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    await writeFile(tarball, bytes);
    const manifestPath = join(owned, 'web-manifest.json');
    await writeFile(manifestPath, JSON.stringify(manifest));
    const countFiles = async (directory: string): Promise<number> => {
      let total = 0;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        total += entry.isDirectory() ? await countFiles(join(directory, entry.name)) : 1;
      }
      return total;
    };
    const importedFiles = await countFiles(bundle);
    await page.addInitScript(() => {
      localStorage.setItem('zhinexus_console_auth', JSON.stringify({ token: 'local-ui-test', subject: 'digest-user', roles: ['publisher'], channel: 'web' }));
    });
    await page.goto(`${origin}/upload`);
    await page.locator('#import-manifest-input').setInputFiles(manifestPath);
    await expect(page.locator('#upload-status-message')).toContainText('成功导入外部 Manifest 清单');
    await page.locator('#import-files-input').setInputFiles(bundle);
    const submit = page.getByRole('button', { name: '确认并提交发布', exact: true });
    await expect(submit).toBeEnabled();
    await page.waitForLoadState('networkidle');

    // Delay delivery of one real Web Crypto result from validation A, after
    // the directory importer has hashed its files. All digest bytes stay real.
    await page.evaluate(skip => {
      const native = crypto.subtle.digest.bind(crypto.subtle);
      const probe = { calls: 0, settled: 0, held: false, release: () => {} };
      (window as unknown as { cDigestProbe: typeof probe }).cDigestProbe = probe;
      Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: (algorithm: AlgorithmIdentifier, data: BufferSource) => {
        const result = native(algorithm, data);
        if (++probe.calls === skip + 1) {
          probe.held = true;
          return new Promise<ArrayBuffer>(resolveResult => { probe.release = () => { void result.then(resolveResult); }; })
            .then(value => { probe.settled++; return value; });
        }
        return result.then(value => { probe.settled++; return value; });
      } });
    }, importedFiles);
    await page.locator('#import-files-input').setInputFiles(bundle);
    await page.waitForFunction(() => (window as unknown as { cDigestProbe: { held: boolean } }).cDigestProbe.held);
    await page.locator('#import-files-input').setInputFiles(corrupt);
    await expect(page.locator('#missing-screenshots-alert')).toContainText('DIGEST_MISMATCH');
    await expect(submit).toBeDisabled();
    await page.evaluate(() => (window as unknown as { cDigestProbe: { release(): void } }).cDigestProbe.release());
    await page.waitForFunction(expected => (window as unknown as { cDigestProbe: { settled: number } }).cDigestProbe.settled >= expected,
      2 * (importedFiles + manifest.files.length));
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    await expect(submit).toBeDisabled();
    const enabledDuringFlush = await submit.evaluate(element => new Promise<boolean>(done => {
      let frames = 12;
      const sample = () => {
        if (!element.hasAttribute('disabled')) { done(true); return; }
        if (--frames === 0) { done(false); return; }
        requestAnimationFrame(sample);
      };
      sample();
    }));
    expect(enabledDuringFlush).toBe(false);
  } finally {
    const child = relative(resolve(tmpdir()), resolve(owned));
    if (!/^c-web-digest-[^/\\]+$/.test(child)) throw new Error('Refusing cleanup outside owned test directory');
    await rm(owned, { recursive: true, force: true });
  }
});
