import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run through scripts/pnpm.ps1 so Node, pnpm and PATH use the isolated toolchain.
const root = fileURLToPath(new URL('../', import.meta.url));
const { packageManager } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const pnpm = join(root, `.tools/pnpm-native-${packageManager.split('@')[1]}/package/pnpm.exe`);
const originalOrigin = process.env.NEXT_PUBLIC_SITE_URL;

// Reserve an available local port before starting our own Next process.
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));

for (const origin of ['https://gallery-cache-a.test', 'https://gallery-cache-b.test', 'https://gallery-cache-a.test', originalOrigin]) {
  const env = { ...process.env };
  if (origin) env.NEXT_PUBLIC_SITE_URL = origin;
  else delete env.NEXT_PUBLIC_SITE_URL;
  const build = spawnSync(pnpm, ['exec', 'turbo', 'run', 'build', '--filter=@company/gallery', '--cache=local:rw'], {
    cwd: root, env, encoding: 'utf8',
  });
  assert.equal(build.status, 0, build.error?.message ?? build.stdout + build.stderr);

  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: join(root, 'apps/gallery'), env, stdio: 'pipe',
  });
  let logs = '';
  server.stdout.on('data', chunk => { logs += chunk; });
  server.stderr.on('data', chunk => { logs += chunk; });
  const ended = once(server, 'exit');
  try {
    let response;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && server.exitCode === null) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/sitemap.xml`, { signal: AbortSignal.timeout(1000) });
        break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    assert.ok(response, `Next did not become ready: ${logs}`);
    assert.equal(response.status, 200);
    const xml = await response.text();
    const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
    assert.deepEqual(urls, origin ? [new URL('/', origin).href, new URL('/components', origin).href] : [], 'sitemap must match the selected build origin');
    console.log(`Gallery origin verified: ${origin ?? '(unset)'}`);
  } finally {
    server.kill();
    await ended;
  }
}
