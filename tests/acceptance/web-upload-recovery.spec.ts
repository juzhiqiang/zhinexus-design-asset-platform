import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { manifestDigest, validateManifest, type ReleaseManifestV1 } from '@company/contracts';
import { sanitizeWebManifest } from '../../apps/gallery/app/lib/uploads/manifest-form.js';

// Browser storage/recovery checks with an explicitly mocked API. These do not
// replace the separate real PostgreSQL/MinIO/Verdaccio end-to-end suite.
const origin = process.env.WEB_UPLOAD_ORIGIN ?? `http://127.0.0.1:${process.env.WEB_UPLOAD_PORT ?? 5173}`;
const apiUrl = 'https://web-recovery.test';
const subject = 'acceptance-alice';
const storageKeys = ['zhinexus_pending_release', 'zhinexus_active_session_id',
  'zhinexus_active_session_plan', 'zhinexus_upload_draft'];
let manifest: ReleaseManifestV1;
let digest: string;

type Pending = {
  uploadSessionId: string;
  idempotencyKey: string;
  apiUrl?: string;
  subject?: string;
  manifestDigest?: string;
  manifest: ReleaseManifestV1;
};

test.beforeAll(async () => {
  const bundle = process.env.WEB_UPLOAD_FROZEN_BUNDLE;
  if (!bundle) throw new Error('WEB_UPLOAD_FROZEN_BUNDLE must identify an already frozen SDK bundle');
  const raw = JSON.parse(await readFile(resolve(bundle, 'manifest.json'), 'utf8'));
  manifest = sanitizeWebManifest(raw);
  const checked = validateManifest(manifest);
  expect(checked.ok, checked.ok ? '' : JSON.stringify(checked.issues)).toBe(true);
  digest = await manifestDigest(manifest);
});

const token = (sub: string) => `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub,
  roles: ['publisher', 'maintainer'], azp: 'web' })).toString('base64url')}.local-ui-test`;

function validPending(): Pending {
  return { uploadSessionId: 'acceptance-upload', idempotencyKey: 'acceptance-fixed-key',
    apiUrl, subject, manifestDigest: digest, manifest: structuredClone(manifest) };
}

async function seed(page: Page, pending: Pending) {
  // Seed only once. A reload must inspect the application's persisted result,
  // rather than reinstalling the pending request and hiding a cleanup defect.
  await page.addInitScript(({ pendingValue, auth, targetApi }) => {
    if (localStorage.getItem('c_acceptance_seeded')) return;
    localStorage.setItem('c_acceptance_seeded', 'yes');
    localStorage.setItem('zhinexus_console_auth', JSON.stringify(auth));
    localStorage.setItem('zhinexus_api_url', targetApi);
    localStorage.setItem('zhinexus_pending_release', JSON.stringify(pendingValue));
    localStorage.setItem('zhinexus_active_session_id', pendingValue.uploadSessionId);
    localStorage.setItem('zhinexus_active_session_plan', JSON.stringify({ ...pendingValue, files: [] }));
    localStorage.setItem('zhinexus_upload_draft', JSON.stringify({ manifestDigest: pendingValue.manifestDigest }));
  }, { pendingValue: pending, auth: { token: token(subject), subject, roles: ['publisher', 'maintainer'], channel: 'web' }, targetApi: apiUrl });
  const posts: Array<{ key: string | undefined; body: unknown }> = [];
  await page.route(`${apiUrl}/**`, async route => {
    const request = route.request();
    const headers = { 'access-control-allow-origin': origin, 'access-control-allow-headers': '*', 'content-type': 'application/json' };
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    if (request.method() === 'POST') {
      posts.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() });
      await route.fulfill({ status: 202, headers, body: JSON.stringify({ jobId: 'acceptance-job', state: 'PENDING' }) });
      return;
    }
    await route.fulfill({ status: 200, headers, body: JSON.stringify({ jobId: 'acceptance-job', state: 'READY' }) });
  });
  await page.goto(`${origin}/upload`);
  await expect(page.locator('body')).toContainText(`当前登录身份：${subject}`);
  await page.waitForLoadState('networkidle');
  return posts;
}

for (const missing of ['apiUrl', 'subject', 'manifestDigest'] as const) {
  test(`legacy pending missing ${missing} cannot display or replay`, async ({ page }) => {
    const pending = validPending();
    delete pending[missing];
    const posts = await seed(page, pending);
    await expect(page.getByRole('button', { name: '恢复提交', exact: true })).toHaveCount(0);
    expect(posts).toHaveLength(0);
  });
}

for (const changed of ['api', 'subject', 'manifest'] as const) {
  test(`pending with changed ${changed} cannot display or replay`, async ({ page }) => {
    const pending = validPending();
    if (changed === 'api') pending.apiUrl = 'https://other-recovery.test';
    if (changed === 'subject') pending.subject = 'acceptance-bob';
    if (changed === 'manifest') {
      const example = pending.manifest.variants[0]!.examples[0]!;
      example.theme = example.theme === 'light' ? 'dark' : 'light';
    }
    const posts = await seed(page, pending);
    await expect(page.getByRole('button', { name: '恢复提交', exact: true })).toHaveCount(0);
    expect(posts).toHaveLength(0);
  });
}

test('matching pending replays original request once and stays clean after reload', async ({ page }) => {
  const pending = validPending();
  const posts = await seed(page, pending);
  await page.getByRole('button', { name: '恢复提交', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复提交', exact: true })).toHaveCount(0);
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]!.key).toBe(pending.idempotencyKey);
  expect(posts[0]!.body).toEqual({ uploadSessionId: pending.uploadSessionId, manifest: pending.manifest });
  const cleared = await page.evaluate(keys => keys.map(key => ({ key, empty: localStorage.getItem(key) === null })), storageKeys);
  expect(cleared).toEqual(storageKeys.map(key => ({ key, empty: true })));
  await page.reload();
  await expect(page.locator('body')).toContainText(`当前登录身份：${subject}`);
  await expect(page.getByRole('button', { name: '恢复提交', exact: true })).toHaveCount(0);
  expect(posts).toHaveLength(1);
});

for (const changed of ['api', 'subject', 'manifest'] as const) {
  test(`resume handler rechecks ${changed} after the card became eligible`, async ({ page }) => {
    const pending = validPending();
    const posts = await seed(page, pending);
    await expect(page.getByRole('button', { name: '恢复提交', exact: true })).toBeVisible();
    if (changed === 'api') pending.apiUrl = 'https://other-recovery.test';
    if (changed === 'subject') pending.subject = 'acceptance-bob';
    if (changed === 'manifest') pending.manifest.variants[0]!.examples[0]!.theme = 'dark';
    await page.evaluate(value => localStorage.setItem('zhinexus_pending_release', JSON.stringify(value)), pending);
    await page.getByRole('button', { name: '恢复提交', exact: true }).click();
    await expect(page.locator('#upload-status-message')).toContainText(/不一致|拒绝|禁止|损坏|不完整/);
    await page.waitForLoadState('networkidle');
    expect(posts).toHaveLength(0);
  });
}

test('logging out and changing subject removes eligibility immediately', async ({ page }) => {
  const posts = await seed(page, validPending());
  await expect(page.getByRole('button', { name: '恢复提交', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.locator('#token-input').fill(token('acceptance-bob'));
  await page.getByRole('button', { name: '凭证登录', exact: true }).click();
  await expect(page.locator('body')).toContainText('当前登录身份：acceptance-bob');
  await expect(page.getByRole('button', { name: '恢复提交', exact: true })).toHaveCount(0);
  expect(posts).toHaveLength(0);
});
