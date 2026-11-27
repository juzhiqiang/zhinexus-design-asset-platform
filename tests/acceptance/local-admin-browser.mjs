import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

// Run against the actual pnpm dev stack. No request interception or synthetic session.
const api = 'http://127.0.0.1:3000';
const admin = 'http://127.0.0.1:5177';
const username = process.env.PLATFORM_DEV_ADMIN_USERNAME || 'admin';
const password = process.env.PLATFORM_DEV_ADMIN_PASSWORD || 'ZhinexusAdmin!2026';
const browser = await chromium.launch();
const errors = [];
await mkdir('test-results/local-admin-runtime', { recursive: true });
try {
  for (const target of ['password', 'admin', 'gallery']) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      page.on('response', response => {
        if (response.url().startsWith(api + '/') && response.status() >= 500) errors.push({ path: new URL(response.url()).pathname, status: response.status() });
      });
      await page.goto(target === 'password' ? admin + '/login' : api + '/v1/auth/oidc/start?target=' + target);
      await page.getByLabel('用户名', { exact: true }).fill(username);
      await page.getByLabel('密码', { exact: true }).fill(password);
      await page.getByRole('button', { name: target === 'password' ? '密码登录' : '登录', exact: true }).click();
      await page.waitForURL(target === 'gallery' ? '**/library' : target === 'admin' ? '**/upload' : '**/assets');
      if (target === 'gallery') {
        await expect(page.locator('main')).not.toContainText('服务暂时不可用');
      } else {
        const users = page.waitForResponse(response => response.url().startsWith(api + '/v1/managed-accounts?'));
        await page.goto(admin + '/users');
        expect((await users).status()).toBe(200);
        await expect(page.getByRole('button', { name: '新建成员', exact: true })).toBeVisible();
        await expect(page.locator('main')).toContainText('本地管理员');
        await page.screenshot({ path: `test-results/local-admin-runtime/${target}-users.png`, fullPage: true });
        const settings = page.waitForResponse(response => response.url() === api + '/v1/access-settings');
        await page.goto(admin + '/access-settings');
        expect((await settings).status()).toBe(200);
        await expect(page.getByRole('heading', { name: '接入与配置', exact: true })).toBeVisible();
        await expect(page.locator('main')).not.toContainText('服务暂时不可用');
        await page.screenshot({ path: `test-results/local-admin-runtime/${target}-settings.png`, fullPage: true });
      }
      console.log(JSON.stringify({ flow: target, passed: true }));
    } finally { await context.close(); }
  }
  expect(errors).toEqual([]);
} finally { await browser.close(); }
