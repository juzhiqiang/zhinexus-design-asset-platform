import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { expect, it } from 'vitest';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { SearchIndexer } from '../../apps/api/dist/index/search-indexer.js';
import { workerHarness, realRegistry } from './t06-support.js';

// Local developer-browser acceptance against a separately built B gallery.
// The loopback proxy only transports requests to the isolated real API; it never fabricates responses.
it.skipIf(!process.env.PHASE2_GALLERY_ORIGIN)('真实画廊显式查询已发布索引并处理服务器撤权', async () => {
  const galleryOrigin = process.env.PHASE2_GALLERY_ORIGIN!;
  const h = await workerHarness(undefined, { galleryOrigin });
  let requests = 0;
  const proxy = createServer(async (request, response) => {
    if (request.url !== '/v1/search/candidates') { response.writeHead(404).end(); return; }
    try {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      if (request.method === 'POST') requests += 1;
      const headers: Record<string,string> = {};
      for (const key of ['authorization','content-type','origin','access-control-request-method','access-control-request-headers']) {
        const value = request.headers[key]; if (typeof value === 'string') headers[key] = value;
      }
      const result = await fetch(`${h.origin()}${request.url}`, { method: request.method, headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}), signal: AbortSignal.timeout(15000) });
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch { response.writeHead(502).end(); }
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await new ReleaseWorker(h.db, h.store, await realRegistry()).runOnce(h.jobId);
    await new SearchIndexer(h.db).runOnce(h.jobId);
    await new Promise<void>((resolve, reject) => { proxy.once('error', reject); proxy.listen(3000, '127.0.0.1', resolve); });
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await page.addInitScript(token => localStorage.setItem('zhinexus_console_auth', JSON.stringify({ token,subject:'alice',roles:['publisher'],channel:'web' })), h.auth);
    expect((await page.goto(`${galleryOrigin}/match`))?.status()).toBe(200);
    await page.locator('#framework-select').selectOption('vue');
    await page.locator('#framework-version-input').fill('3.5.45');
    await page.locator('#echarts-version-input').fill('6.1.0');
    await page.locator('#package-manager-select').selectOption('pnpm');
    await page.locator('#search-query-input').fill('line');
    expect(requests).toBe(0);
    await page.locator('#search-submit').click();
    await page.locator('.candidate-card').waitFor();
    expect(await page.locator('.candidate-card').count()).toBe(1);
    const pkg = h.fixture.manifest.packages.find(p => p.peerDependencies.vue)!;
    expect(await page.locator('.candidate-card').innerText()).toContain(pkg.name);
    expect(await page.locator('#candidate-results').innerText()).toContain('元数据');
    expect(requests).toBe(1);
    await page.screenshot({ path:'test-results/c3-live-gallery.png',fullPage:true });
    await h.db.query("INSERT INTO disabled_subjects(subject) VALUES ('alice')");
    await page.locator('#search-submit').click();
    await page.locator('#search-error').waitFor();
    expect(await page.locator('#search-error').innerText()).toContain('登录状态');
    expect(await page.locator('.candidate-card').count()).toBe(0);
  } finally {
    await browser?.close();
    if (proxy.listening) await new Promise<void>(resolve => proxy.close(() => resolve()));
    await h.close();
  }
}, 60000);
