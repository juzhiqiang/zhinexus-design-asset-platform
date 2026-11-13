// C-owned supplemental acceptance harness; product files and frozen artifacts stay untouched.
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

if (!process.argv[2]) throw new Error('Pass an independent B source archive inside .tools/operations');
const operations = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '../../.tools/operations'));
const target = await realpath(resolve(process.argv[2]));
const owned = relative(operations, target);
if (!owned || owned.startsWith('..') || isAbsolute(owned)) throw new Error('Target must remain inside this workspace .tools/operations');
let source = await readFile(join(target, 'tests/browser/web-upload-real-e2e.spec.ts'), 'utf8');
const replaceOnce = (before, after) => {
  if (source.split(before).length !== 2) throw new Error(`Expected unique anchor: ${before}`);
  source = source.replace(before, after);
};
for (const [before, after] of [
  ['69443f97-8b73-4ecb-91aa-d8835a0b58dc', 'dcc49e73-37c6-4579-a814-713e780ae583'],
  ['0.0.6', '0.0.10'], ['127.0.0.1:5173', '127.0.0.1:5183'],
  ['7af91861c7ddb4786d1f98669a819625504ce5ad2a00bfee2b311a6f47e4e4eb', '2d9d4208bf070f2478116e500b87ab0748fe5af2793dfa3d13a7c7954212e752'],
  ['aa20d821f9a6369c5ec0968049a2eb056f4ea2fd78c62bc1c5b046f55759955f', 'b01aeec7604b2c399a6cb1efa7b4ba1ac3092f12ea92322c682a188045e8c01b'],
  ['91a2f9de25927e062f0f6205d16d4ab881981f9365af41a321ffb04f2f5ffdc4', 'cd625741f37a95f81b395b45bce6a34d439135dcaa1df3ea5989c73159ab8e5c'],
]) {
  if (!source.includes(before)) throw new Error(`Missing fixture token: ${before}`);
  source = source.replaceAll(before, after);
}
replaceOnce("    let capturedJobId = '';", `    let releasePostCount = 0;
    page.on('request', req => {
      if (req.method() === 'POST' && new URL(req.url()).pathname === '/v1/releases') releasePostCount++;
    });
    const initialUploadResponse = page.waitForResponse(res =>
      res.request().method() === 'POST' && new URL(res.url()).pathname === '/v1/uploads');
    let capturedJobId = '';`);
const anchor = '    // 5. 触发 ReleaseWorker 推进该真实发布作业';
replaceOnce(anchor, `    // C independent real-HTTP lifecycle gate after a genuine accepted release.
    const initialUploadRes = await initialUploadResponse;
    expect(initialUploadRes.status()).toBe(201);
    const originalSessionId = (await initialUploadRes.json()).uploadSessionId;
    expect(originalSessionId).toBeTruthy();
    expect(releaseRes.request().postDataJSON().uploadSessionId).toBe(originalSessionId);
    expect(releasePostCount).toBe(1);
    await expect.poll(() => page.evaluate(() =>
      ['zhinexus_pending_release', 'zhinexus_active_session_id', 'zhinexus_active_session_plan', 'zhinexus_upload_draft']
        .map(key => localStorage.getItem(key) === null)
    )).toEqual([true, true, true, true]);
    await page.reload();
    await expect(page.getByRole('button', { name: '恢复提交', exact: true })).toHaveCount(0);
    // Observe several 600ms polling periods; count attempted POSTs, not GET polling.
    await page.waitForTimeout(2100);
    await expect(page.getByRole('button', { name: '恢复提交', exact: true })).toHaveCount(0);
    expect(releasePostCount).toBe(1);
    expect(Number((await mainEnv!.db.query('SELECT count(*) AS total FROM release_jobs')).rows[0]!.total)).toBe(1);

${anchor}`);
const nextTest = source.indexOf("  test('缺图阻断：");
if (nextTest < 0) throw new Error('Missing second test');
const endFirst = source.lastIndexOf('  });', nextTest);
if (endFirst < 0) throw new Error('Missing first test boundary');
source = source.slice(0, endFirst) + `    // A later publication must allocate a different real upload session.
    await importCompleteRealMaterials(page, webManifestPath);
    let abortedPuts = 0;
    await page.route(url => url.hostname === '127.0.0.1' && Number(url.port) === mainEnv!.stack.ports.minio, async route => {
      if (route.request().method() === 'PUT') { abortedPuts++; await route.abort('connectionreset'); }
      else await route.continue();
    });
    const newSessionResponse = page.waitForResponse(res =>
      res.request().method() === 'POST' && new URL(res.url()).pathname === '/v1/uploads');
    await page.getByRole('button', { name: '确认并提交发布', exact: true }).click();
    const newSessionRes = await newSessionResponse;
    expect(newSessionRes.status()).toBe(201);
    const nextSessionId = (await newSessionRes.json()).uploadSessionId;
    expect(nextSessionId).toBeTruthy();
    expect(nextSessionId).not.toBe(originalSessionId);
    await expect(page.locator('#upload-status-message')).toContainText('发布失败:');
    expect(abortedPuts).toBeGreaterThan(0);
    expect(releasePostCount).toBe(1);
    expect(Number((await mainEnv!.db.query('SELECT count(*) AS total FROM release_jobs')).rows[0]!.total)).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem('zhinexus_active_session_id'))).toBe(nextSessionId);
    expect(await page.evaluate(() => localStorage.getItem('zhinexus_pending_release'))).toBeNull();
` + source.slice(endFirst);
// Reuse the existing real lost-202 fixture, but exercise the ordinary submit
// handler without a reload or the separate recovery-card handler.
const replayStart = source.indexOf("  test('真实丢失响应恢复与唯一作业断言：");
const replayEnd = source.indexOf("  test('清单期望摘要不可篡改：", replayStart);
if (replayStart < 0 || replayEnd <= replayStart) throw new Error('Missing real lost-response test boundaries');
let replay = source.slice(replayStart, replayEnd);
const replayReplace = (before, after) => {
  if (replay.split(before).length !== 2) throw new Error(`Expected unique normal-retry anchor: ${before}`);
  replay = replay.replace(before, after);
};
replayReplace('真实丢失响应恢复与唯一作业断言：网络掉线后刷新页面点击恢复，复用原幂等键且数据库仅一作业',
  'C独立普通提交重试：真实丢失202后计划过期，零重复上传并复用原请求与唯一作业');
replayReplace('      const capturedKeys: string[] = [];', `      const capturedKeys: string[] = [];
      const capturedBodies: string[] = [];
      let uploadCreates = 0;
      let uploadPuts = 0;
      let uploadCompletes = 0;
      page.on('request', req => {
        const url = new URL(req.url());
        if (req.method() === 'POST' && url.pathname === '/v1/uploads') uploadCreates++;
        if (req.method() === 'POST' && /^\\/v1\\/uploads\\/[^/]+\\/complete$/.test(url.pathname)) uploadCompletes++;
        if (req.method() === 'PUT' && Number(url.port) === recoveryEnv.stack.ports.minio) uploadPuts++;
      });`);
replayReplace('        capturedKeys.push(idempKey);', `        capturedKeys.push(idempKey);
        capturedBodies.push(req.postData()!);`);
const reloadStart = replay.indexOf('      // 刷新页面模拟用户重新打开控制台');
const reloadEnd = replay.indexOf('      // 监听第二次恢复请求的 response', reloadStart);
if (reloadStart < 0 || reloadEnd <= reloadStart) throw new Error('Missing reload/recovery block');
replay = replay.slice(0, reloadStart) + `      const firstPuts = uploadPuts;
      expect(firstPuts).toBeGreaterThan(0);
      expect(uploadCreates).toBe(1);
      expect(uploadCompletes).toBe(1);
      const savedPending = await page.evaluate(() => localStorage.getItem('zhinexus_pending_release'));
      expect(savedPending).toBeTruthy();
      const pendingSessionId = JSON.parse(savedPending!).uploadSessionId;
      expect(pendingSessionId).toBeTruthy();
      expect(JSON.parse(capturedBodies[0]!).uploadSessionId).toBe(pendingSessionId);
      // Expire only persisted plan metadata; the required behavior is no further
      // upload attempts at all. This does not pretend to wait for real URL expiry.
      await page.evaluate(() => {
        const plan = JSON.parse(localStorage.getItem('zhinexus_active_session_plan')!);
        plan.files.forEach((file: any) => { file.expiresAt = new Date(Date.now() - 60000).toISOString(); });
        localStorage.setItem('zhinexus_active_session_plan', JSON.stringify(plan));
      });
      await page.route(url => Number(url.port) === recoveryEnv.stack.ports.minio, async route => {
        if (route.request().method() === 'PUT') await route.abort('connectionreset');
        else await route.continue();
      });
      await expect(submitBtn).toBeEnabled();

` + replay.slice(reloadEnd);
replayReplace('      await resumeBtn.click();', '      await submitBtn.click();');
replayReplace("        (res) => res.url().includes('/v1/releases') && res.request().method() === 'POST',\n      );",
  "        (res) => res.url().includes('/v1/releases') && res.request().method() === 'POST',\n        { timeout: 10000 },\n      );");
replayReplace('      const secondReleaseRes = await secondReleasePromise;', `      const secondReleaseRes = await secondReleasePromise.catch(() => null);
      expect(uploadPuts, 'ordinary retry must not attempt another MinIO PUT').toBe(firstPuts);
      expect(uploadCompletes).toBe(1);
      expect(uploadCreates).toBe(1);
      expect(secondReleaseRes, 'ordinary retry must obtain the original accepted job').not.toBeNull();
      if (!secondReleaseRes) throw new Error('Missing accepted release replay');`);
replayReplace('      expect(capturedKeys[1]).toBe(capturedIdempotencyKey);', `      expect(capturedKeys[1]).toBe(capturedIdempotencyKey);
      expect(releasePostCalls).toBe(2);
      expect(capturedBodies[1]).toBe(capturedBodies[0]);
      expect(uploadCreates).toBe(1);
      expect(uploadPuts).toBe(firstPuts);
      expect(uploadCompletes).toBe(1);
      await expect.poll(() => page.evaluate(() =>
        ['zhinexus_pending_release', 'zhinexus_active_session_id', 'zhinexus_active_session_plan', 'zhinexus_upload_draft']
          .map(key => localStorage.getItem(key) === null)
      )).toEqual([true, true, true, true]);
      expect(Number((await recoveryEnv.db.query('SELECT count(*) AS total FROM release_jobs')).rows[0]!.total)).toBe(1);`);
source = source.slice(0, replayEnd) + replay + source.slice(replayEnd);
const spec = join(target, 'tests/acceptance/c-web-real-sdk0010.spec.ts');
await mkdir(dirname(spec), { recursive: true });
await writeFile(spec, source);
await writeFile(join(target, 'tests/acceptance/playwright.c-web-real.config.ts'), `import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: 'c-web-real-sdk0010.spec.ts', workers: 1,
  use: { browserName: 'chromium', headless: true },
  webServer: { command: 'pnpm --filter @company/gallery exec next start --hostname 127.0.0.1 --port 5183', url: 'http://127.0.0.1:5183', reuseExistingServer: false }
});\n`);
console.log(JSON.stringify({ target, spec, sha256: createHash('sha256').update(source).digest('hex') }));
