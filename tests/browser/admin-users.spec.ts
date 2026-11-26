import { expect, test } from '@playwright/test';

const api = 'http://127.0.0.1:3000';
const devToken = `header.${Buffer.from(JSON.stringify({ sub: 'admin', roles: ['reader', 'publisher', 'maintainer'], azp: 'zhinexus-web' })).toString('base64url')}.sig`;

const memberSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  username: 'alice.chen',
  displayName: '陈爱丽',
  roles: ['reader', 'publisher'],
  enabled: true,
  credentialState: 'set',
  syncState: 'synced',
  administrator: false,
  accountVersion: '2',
  desiredRevision: '2',
  accessEpoch: '1',
  createdAt: '2026-11-20T08:00:00.000Z',
  updatedAt: '2026-11-26T09:15:00.000Z',
};

const memberDetail = {
  ...memberSummary,
  componentGrants: [{ componentId: 'line', canPublish: true, canMaintain: false }],
  packageGrants: ['@company/charts-vue'],
};

test.describe('成员与权限管理体验回归 (/users)', () => {
  test('支持点击成员行查看详情、可视化编辑角色与授权并单次提交保存，以及弹窗新建成员', async ({ page }) => {
    await page.route('**/v1/auth/oidc/session', (r) => r.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } }));
    await page.route(`${api}/healthz`, (r) => r.fulfill({ status: 200, json: { status: 'ok' } }));

    let currentDetail = { ...memberDetail };
    let lastUpdatePayload: Record<string, unknown> | null = null;
    let createdPayload: Record<string, unknown> | null = null;

    await page.route(`${api}/v1/managed-accounts**`, (r) => {
      if (r.request().method() === 'POST') {
        createdPayload = r.request().postDataJSON();
        return r.fulfill({
          status: 201,
          json: {
            ...memberDetail,
            id: '22222222-2222-4222-8222-222222222222',
            username: createdPayload?.username,
            displayName: createdPayload?.displayName,
            roles: createdPayload?.roles,
            credentialState: 'unset',
            componentGrants: createdPayload?.componentGrants ?? [],
            packageGrants: createdPayload?.packageGrants ?? [],
          },
        });
      }
      const { componentGrants: _c, packageGrants: _p, ...summary } = currentDetail;
      return r.fulfill({ status: 200, json: { items: [summary], page: 1, pageSize: 20, total: 1 } });
    });

    await page.route(`${api}/v1/managed-accounts/audit`, (r) =>
      r.fulfill({
        status: 200,
        json: {
          items: [
            {
              at: '2026-11-26T09:15:00.000Z',
              actor: 'admin',
              action: 'update',
              accountId: memberSummary.id,
              username: 'alice.chen',
              result: 'passed',
            },
          ],
        },
      }),
    );

    await page.route(`${api}/v1/managed-accounts/${memberSummary.id}`, (r) =>
      r.fulfill({ status: 200, json: currentDetail }),
    );

    await page.route(`${api}/v1/managed-accounts/${memberSummary.id}/update`, (r) => {
      lastUpdatePayload = r.request().postDataJSON();
      currentDetail = {
        ...currentDetail,
        displayName: String(lastUpdatePayload?.displayName ?? currentDetail.displayName),
        roles: (lastUpdatePayload?.roles as typeof currentDetail.roles) ?? currentDetail.roles,
        componentGrants: (lastUpdatePayload?.componentGrants as typeof currentDetail.componentGrants) ?? currentDetail.componentGrants,
        packageGrants: (lastUpdatePayload?.packageGrants as typeof currentDetail.packageGrants) ?? currentDetail.packageGrants,
        desiredRevision: '3',
      };
      return r.fulfill({ status: 200, json: currentDetail });
    });

    await page.addInitScript(
      (token) => localStorage.setItem('zhinexus_console_auth', JSON.stringify({ token, subject: 'admin', roles: ['reader'], channel: 'web' })),
      devToken,
    );

    await page.goto('/users');
    await expect(page.getByRole('heading', { name: '成员与权限' })).toBeVisible();

    // 1. 直接点击成员行打开详情
    await page.getByRole('listitem').filter({ hasText: '陈爱丽' }).click();
    await expect(page.locator('section[aria-label="成员详情"]')).toContainText('@alice.chen');
    await expect(page.locator('section[aria-label="成员详情"]')).toContainText('@company/charts-vue');

    // 2. 勾选维护者角色并新增组件授权与包授权，点击保存更改（一次请求提交）
    await page.locator('section[aria-label="成员详情"]').getByRole('button', { name: /资产维护者/ }).click();
    await page.locator('section[aria-label="成员详情"]').getByLabel('新增组件授权 ID').fill('bar');
    await page.locator('section[aria-label="成员详情"]').getByRole('button', { name: '添加', exact: true }).click();
    await page.locator('section[aria-label="成员详情"]').getByLabel('新增包授权名称').fill('@company/charts-react');
    await page.locator('section[aria-label="成员详情"]').getByRole('button', { name: '添加包' }).click();
    await page.getByRole('button', { name: '保存更改' }).click();

    await expect(page.locator('main [role="status"]')).toContainText('成员资料与权限已保存');
    expect(lastUpdatePayload).toMatchObject({
      expectedRevision: '2',
      roles: ['reader', 'publisher', 'maintainer'],
      packageGrants: ['@company/charts-vue', '@company/charts-react'],
    });

    // 3. 切换至操作审计自动加载记录
    await page.getByRole('tab', { name: '操作审计' }).click();
    await expect(page.locator('section[aria-label="身份操作记录"]')).toContainText('@alice.chen');

    // 4. 通过原生 <dialog> 新建成员
    await page.getByRole('button', { name: '新建成员' }).click();
    const dialog = page.locator('dialog.zn-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('用户名').fill('bob.wu');
    await dialog.getByLabel('显示名').fill('吴博');
    await dialog.getByRole('button', { name: '创建账号' }).click();
    await expect(page.locator('main [role="status"]')).toContainText('成员 bob.wu 已创建');
    expect(createdPayload).toMatchObject({ username: 'bob.wu', displayName: '吴博' });
  });
});
