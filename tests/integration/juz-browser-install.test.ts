import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const execute = promisify(execFile);

it.runIf(process.platform === 'win32')('npm installation prepares Chromium and reports failed downloads while allowing an explicit skip', async () => {
  const root = await mkdtemp(join(tmpdir(), 'juz-browser-install-'));
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const packed = JSON.parse((await execute(process.execPath, [resolve('packages/component-cli/scripts/pack-juz.mjs'), '--out', root], { timeout: 60_000, windowsHide: true })).stdout);
    const prefix = join(root, 'global');
    const npmCli = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    const options = { timeout: 240_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', PLAYWRIGHT_BROWSERS_PATH: join(root, 'browser-cache'), PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '0', npm_config_ignore_scripts: 'false' } };
    const installed = await execute(process.execPath, [npmCli, 'install', '--global', '--prefix', prefix, '--foreground-scripts', '--no-audit', '--no-fund', packed.tarballPath], options);
    expect(installed.stdout + installed.stderr).toContain('juz:');
    const packageRoot = join(prefix, 'node_modules/juz-cli');
    const metadata = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    expect(metadata.scripts.postinstall).toBeTruthy();
    const probe = "const { createRequire } = require('node:module'); const { chromium } = createRequire(process.argv[1])('@playwright/test'); (async () => { const browser = await chromium.launch({ headless: true }); try { const page = await browser.newPage(); await page.setContent('<button>Installed browser</button>'); console.log(await page.locator('button').textContent()); } finally { await browser.close(); } })().catch(e => { console.error(e); process.exitCode = 1; });";
    const launched = await execute(process.execPath, ['-e', probe, join(packageRoot, 'package.json')], options);
    expect(launched.stdout).toContain('Installed browser');

    // Use a real local HTTP failure and an empty cache; never depend on a CDN outage.
    let requests = 0;
    server = createServer((_request, response) => { requests++; response.writeHead(503).end('test download unavailable'); });
    await new Promise<void>(accept => server!.listen(0, '127.0.0.1', accept));
    const downloadHost = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    const browserCache = join(root, 'empty-browser-cache');
    const isolated = { ...options, env: { ...options.env, PLAYWRIGHT_BROWSERS_PATH: browserCache,
      PLAYWRIGHT_DOWNLOAD_HOST: downloadHost, PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST: downloadHost, PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: '1000' } };
    const rebuild = [npmCli, 'rebuild', '--global', '--prefix', prefix, '--foreground-scripts', 'juz-cli'];
    await expect(execute(process.execPath, rebuild, isolated)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('npm rebuild -g juz-cli') });
    expect(requests).toBeGreaterThan(0);
    // Package-local browser caches must be repaired through this installation, not an npx copy.
    await expect(execute(process.execPath, rebuild, { ...isolated, env: { ...isolated.env, PLAYWRIGHT_BROWSERS_PATH: '0' } }))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('npm rebuild -g juz-cli') });
    requests = 0;
    const skipped = await execute(process.execPath, rebuild, { ...isolated, env: { ...isolated.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' } });
    expect(skipped.stdout + skipped.stderr).toContain('PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD');
    expect(requests).toBe(0);
    expect((await readdir(browserCache).catch(() => [])).filter(name => name.startsWith('chromium'))).toEqual([]);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise<void>(accept => server!.close(() => accept())); }
    await rm(root, { recursive: true, force: true });
  }
}, 300_000);
