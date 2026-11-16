import { createServer, request as proxyRequest, type Server } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { validateComponentMatchResponse, type ComponentMatchResponseV1 } from '@company/contracts';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { workerHarness, realRegistry } from '../platform/t06-support.js';
import { componentApiFixture } from '../fixtures/match-plan.js';
import { replaceBundleArtifact } from '../fixtures/t05-artifacts.js';

const galleryOrigin = process.env.PHASE2_GALLERY_ORIGIN;
if (!galleryOrigin) throw new Error('P4 requires PHASE2_GALLERY_ORIGIN for a built Gallery instance');
if (new URL(galleryOrigin).origin !== galleryOrigin || !['127.0.0.1', 'localhost'].includes(new URL(galleryOrigin).hostname)) {
  throw new Error('P4 Gallery must use an explicit local origin');
}
const artifacts = join(process.cwd(), 'test-results', 'phase2-query-acceptance');
let h: Awaited<ReturnType<typeof workerHarness>> | undefined;
let proxy: Server | undefined;
let browser: Browser | undefined;
let page: Page;

beforeAll(async () => {
  h = await workerHarness(f => {
    for (const variant of f.manifest.variants) replaceBundleArtifact(f, variant.api.path, Buffer.from(JSON.stringify({
      ...componentApiFixture(variant.framework), componentId: variant.componentId,
      exportName: variant.exportName, exportPath: variant.exportPath,
    })));
    f.manifest.packages.find(pkg => pkg.peerDependencies.react)!.peerDependencies['react-dom'] = '19.3.1';
  }, { galleryOrigin });
  await new ReleaseWorker(h.db, h.store, await realRegistry()).runOnce(h.jobId);
  expect((await h.db.query('SELECT state FROM release_jobs WHERE id=$1', [h.jobId])).rows[0]!.state).toBe('READY');

  // Plain local HTTP forwarding preserves the genuine Nest status, headers and bytes, including CORS.
  // No route.fulfill, synthetic API response or service replacement is involved.
  proxy = createServer((req, res) => {
    const upstream = proxyRequest(new URL(req.url!, h!.origin()), { method: req.method,
      headers: { ...req.headers, host: new URL(h!.origin()).host } }, reply => {
      res.writeHead(reply.statusCode!, reply.headers); reply.pipe(res);
    });
    upstream.on('error', () => { res.statusCode = 502; res.end(); });
    req.pipe(upstream);
  });
  await new Promise<void>((resolve, reject) => { proxy!.once('error', reject); proxy!.listen(3000, '127.0.0.1', resolve); });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await mkdir(artifacts, { recursive: true });
});

afterAll(async () => {
  try { await browser?.close(); }
  finally {
    try {
      if (proxy?.listening) await new Promise<void>((resolve, reject) => {
        proxy!.close(error => error ? reject(error) : resolve()); proxy!.closeAllConnections();
      });
    } finally { await h?.close(); }
  }
});

async function query(): Promise<ComponentMatchResponseV1> {
  const result = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/v1/matching/components');
  await page.locator('#cq-submit').click();
  const response = await result;
  expect(response.status()).toBe(200);
  expect(response.request().postData()).toBeNull();
  const checked = validateComponentMatchResponse(await response.json());
  if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
  return checked.value;
}

it('真实登录与 GET 展示：输入更改和撤权清空材料，375px 可用', async () => {
  expect((await page.goto(galleryOrigin + '/match'))?.status()).toBe(200);
  await page.locator('#token-input').fill(h!.auth);
  await page.getByRole('button', { name: '凭证登录', exact: true }).click();
  const variant = h!.fixture.manifest.variants.find(v => v.componentId === 'line' && v.framework === 'vue')!;
  await page.locator('#cq-component-id').fill('line');
  await page.locator('#cq-framework').selectOption('vue');
  await page.locator('#cq-package-version').fill(variant.packageVersion);
  await page.locator('#cq-package-name').fill(variant.packageName);
  await page.locator('#cq-framework-version').fill('3.5.45');
  await page.locator('#cq-echarts-version').fill('6.1.0');
  const matched = await query();
  expect(matched.status).toBe('matched');
  await browserExpect(page.locator('#cq-result-target')).toContainText(matched.target!.variantReleaseId);
  await browserExpect(page.locator('#cq-result-api')).toContainText('point-click');
  await page.locator('#component-query').screenshot({ path: join(artifacts, 'gallery-query-desktop.png') });

  const react = h!.fixture.manifest.variants.find(v => v.componentId === 'line' && v.framework === 'react')!;
  await page.locator('#cq-framework').selectOption('react');
  await browserExpect(page.locator('#cq-result')).toHaveCount(0);
  await page.locator('#cq-package-name').fill(react.packageName);
  await page.locator('#cq-package-version').fill(react.packageVersion);
  await page.locator('#cq-framework-version').fill('19.3.1');
  await page.locator('#cq-react-dom-version').fill('19.3.1');
  const reactMatch = await query();
  expect(reactMatch.target?.framework).toBe('react');
  expect(reactMatch.exactDependencies).toContainEqual({ name: 'react-dom', version: '19.3.1' });
  await browserExpect(page.locator('#cq-result-api')).toContainText('onPointClick');
  await page.locator('#component-query').screenshot({ path: join(artifacts, 'gallery-query-react.png') });
  await page.locator('#cq-framework').selectOption('vue');
  await page.locator('#cq-package-name').fill(variant.packageName);
  await page.locator('#cq-package-version').fill(variant.packageVersion);
  await page.locator('#cq-framework-version').fill('3.5.45');

  await page.locator('#cq-component-id').fill('bar');
  await browserExpect(page.locator('#cq-result')).toHaveCount(0);
  await page.locator('#cq-component-id').fill('line');
  expect((await query()).status).toBe('matched');
  await h!.db.query("UPDATE component_permissions SET can_read=false,can_publish=false,can_maintain=false WHERE subject='alice' AND component_id='line'");
  const revoked = await query();
  expect(revoked.status).toBe('gap');
  expect(revoked.target).toBeUndefined();
  expect(revoked.api).toBeUndefined();
  expect(revoked.exactDependencies).toEqual([]);
  await browserExpect(page.locator('#cq-result')).toHaveCount(0);
  await browserExpect(page.locator('#cq-gap')).toContainText('TARGET_UNAVAILABLE');
  await page.locator('#component-query').screenshot({ path: join(artifacts, 'gallery-query-revoked.png') });

  await h!.db.query("UPDATE component_permissions SET can_read=true WHERE subject='alice' AND component_id='line'");
  await page.setViewportSize({ width: 375, height: 900 });
  expect((await query()).status).toBe('matched');
  await browserExpect(page.locator('#cq-result')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('#component-query').screenshot({ path: join(artifacts, 'gallery-query-mobile.png') });
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await browserExpect(page.locator('#token-input')).toBeVisible();
  await browserExpect(page.locator('#cq-result')).toHaveCount(0);
  console.log(JSON.stringify({ event: 'PHASE2_GALLERY_REAL_HTTP', matched: true, inputCleared: true,
    revokedCleared: true, logoutCleared: true, mobileWidth: 375, productionAcceptance: false }));
});
