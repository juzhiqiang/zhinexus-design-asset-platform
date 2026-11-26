import { expect, test } from '@playwright/test';

const api = 'http://127.0.0.1:3000';
const devToken = `header.${Buffer.from(JSON.stringify({ sub: 'admin', roles: ['reader', 'publisher', 'maintainer'], azp: 'zhinexus-web' })).toString('base64url')}.sig`;

test.describe('后台管理重构核心流程（资产管理 / 发布作业 / 全局外壳）', () => {
  test('密码登录后默认进入资产管理，可查看详情、废弃版本、查看发布作业并退出登录', async ({ page }) => {
    await page.route('**/v1/auth/oidc/session', (route) => route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } }));
    await page.route('**/v1/auth/oidc/logout', (route) => route.fulfill({ status: 204 }));
    await page.route(`${api}/healthz`, (route) => route.fulfill({ status: 200, json: { status: 'ok' } }));
    await page.route(`${api}/identity/login`, (route) =>
      route.fulfill({ status: 200, json: { access_token: devToken, token_type: 'Bearer', expires_in: 300, scope: 'openid' } }),
    );

    let deprecated = false;
    let isPublic = false;
    let lastBaselinePayload: Record<string, unknown> | null = null;
    await page.route(`${api}/v1/me/components**`, (route) =>
      route.fulfill({
        status: 200,
        json: {
          page: 1,
          pageSize: 20,
          total: 1,
          items: [
            {
              componentId: 'line',
              variants: [
                {
                  variantReleaseId: '11111111-1111-4111-8111-111111111111',
                  variantId: 'line-vue',
                  framework: 'vue',
                  packageName: '@company/charts-vue',
                  packageVersion: '0.1.0',
                },
              ],
            },
          ],
        },
      }),
    );

    await page.route(`${api}/v1/me/variant-releases/11111111-1111-4111-8111-111111111111`, (route) =>
      route.fulfill({
        status: 200,
        json: {
          variantReleaseId: '11111111-1111-4111-8111-111111111111',
          availability: deprecated ? 'DEPRECATED' : 'Ready',
          reportSource: 'local-automatic',
          baselineStatus: 'accepted',
          indexStatus: 'indexed',
          isPublic,
          baselineHeads: [
            {
              exampleId: 'default',
              environmentKey: 'e'.repeat(64),
              revisionId: '99999999-9999-4999-8999-999999999999',
              screenshotId: 'shot-1',
            },
          ],
          package: {
            name: '@company/charts-vue',
            version: '0.1.0',
            dependencies: {},
            peerDependencies: { vue: '3.5.45', echarts: '6.1.0' },
            sourceDigest: 'c'.repeat(64),
            tarball: { path: 'packages/charts-vue-0.1.0.tgz', sha256: 'a'.repeat(64), bytes: 1024 },
          },
          variant: {
            componentId: 'line',
            variantId: 'line-vue',
            framework: 'vue',
            packageName: '@company/charts-vue',
            packageVersion: '0.1.0',
            exportPath: './line',
            exportName: 'LineChart',
            category: 'charts',
            api: { path: 'api/line-vue.json', sha256: 'd'.repeat(64), bytes: 100 },
            docs: { path: 'docs/line-vue.md', sha256: 'f'.repeat(64), bytes: 80 },
            examples: [],
            compatibility: [],
            screenshots: [
              {
                id: 'shot-1',
                variantId: 'line-vue',
                framework: 'vue',
                packageVersion: '0.1.0',
                packageSha256: 'a'.repeat(64),
                exampleId: 'default',
                state: 'default',
                environmentKey: 'e'.repeat(64),
                source: 'local-automatic',
                image: { path: 'screenshots/line-vue.png', sha256: 'b'.repeat(64), bytes: 512 },
              },
            ],
          },
        },
      }),
    );

    await page.route(`${api}/v1/publishing/components/line/visibility`, (route) => {
      const body = route.request().postDataJSON() as { isPublic: boolean };
      isPublic = body.isPublic;
      return route.fulfill({ status: 200, json: { componentId: 'line', category: 'charts', isPublic } });
    });

    await page.route(`${api}/v1/publishing/components/line/releases`, (route) =>
      route.fulfill({
        status: 200,
        json: {
          componentId: 'line',
          category: 'charts',
          isPublic,
          items: [
            {
              variantReleaseId: '11111111-1111-4111-8111-111111111111',
              variantId: 'line-vue',
              framework: 'vue',
              packageName: '@company/charts-vue',
              packageVersion: '0.1.0',
              exportName: 'LineChart',
              availability: deprecated ? 'DEPRECATED' : 'Ready',
            },
          ],
        },
      }),
    );

    await page.route(`${api}/v1/baselines`, (route) => {
      lastBaselinePayload = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { revisionId: '88888888-8888-4888-8888-888888888888' } });
    });

    await page.route(`${api}/v1/preview-grants`, (route) =>
      route.fulfill({
        status: 200,
        json: {
          bootstrapUrl: `https://r-11111111-1111-4111-8111-111111111111.preview.example.com/bootstrap?grant=${'g'.repeat(43)}`,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          mode: 'domain',
        },
      }),
    );

    await page.route('https://r-11111111-1111-4111-8111-111111111111.preview.example.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>preview</title><p>ok</p>' }),
    );

    await page.route(`${api}/v1/me/variant-releases/11111111-1111-4111-8111-111111111111/compatibility`, (route) =>
      route.fulfill({ status: 200, json: { variantReleaseId: '11111111-1111-4111-8111-111111111111', items: [] } }),
    );

    await page.route(`${api}/v1/variant-releases/11111111-1111-4111-8111-111111111111/deprecate`, (route) => {
      deprecated = true;
      return route.fulfill({ status: 200, json: { variantReleaseId: '11111111-1111-4111-8111-111111111111', status: 'DEPRECATED' } });
    });

    await page.route(`${api}/v1/releases**`, (route) =>
      route.fulfill({
        status: 200,
        json: {
          items: [
            {
              jobId: '22222222-2222-4222-8222-222222222222',
              channel: 'cli',
              subject: 'admin',
              state: 'READY',
              stage: 'READY',
              attempt: 1,
              createdAt: '2026-11-26T00:00:00.000Z',
              updatedAt: '2026-11-26T00:01:00.000Z',
              packages: [{ name: '@company/charts-vue', version: '0.1.0' }],
              variantCount: 1,
            },
          ],
        },
      }),
    );

    // 1. 访问根路径未登录跳至 /login
    await page.goto('/login');
    await page.getByLabel('用户名').fill('admin');
    await page.getByLabel('密码', { exact: true }).fill('ZhinexusAdmin!2026');
    await page.getByRole('button', { name: '密码登录' }).click();

    // 2. 默认进入 /assets，顶栏展示用户名与退出登录，侧栏展示真实 API ONLINE
    await expect(page).toHaveURL(/\/assets$/);
    await expect(page.locator('.zn-topbar-username')).toHaveText('admin');
    await expect(page.locator('.zn-link-pulse')).toContainText('API ONLINE');
    await expect(page.getByRole('heading', { name: '资产管理' })).toBeVisible();

    // 3. 打开详情并验证状态分栏、组件可见性切换、基线 expectedRevision 更新、沙箱预览与废弃操作
    await page.getByRole('button', { name: '管理' }).click();
    await expect(page.locator('main')).toContainText('本地自动校验 (local-automatic)');
    await expect(page.locator('main')).toContainText('已索引');

    // 切换组件公开可见性
    await page.getByPlaceholder('例如：已完成合规与视觉验收，对外公开').fill('验收通过公开');
    await page.getByRole('button', { name: '设为公开画廊可见' }).click();
    await expect(page.locator('main [role="status"]')).toContainText('组件已设为公开');

    // 二次更新视觉基线自动携带 expectedRevision
    await page.getByPlaceholder('例如：首版基线确认通过 / 样式调整更新基线').fill('更新基线修订');
    await page.getByRole('button', { name: '更新视觉基线' }).click();
    await expect(page.locator('main [role="status"]')).toContainText('视觉基线已更新至新修订');
    expect(lastBaselinePayload).toMatchObject({
      variantId: 'line-vue',
      expectedRevision: '99999999-9999-4999-8999-999999999999',
    });

    // 切换预览标签并启动隔离沙箱预览
    await page.getByRole('tab', { name: '预览与截图' }).click();
    await page.getByRole('button', { name: '启动沙箱预览' }).click();
    await expect(page.locator('iframe.zn-preview-frame')).toHaveAttribute('sandbox', 'allow-scripts');

    // 切回概览并执行版本废弃
    await page.getByRole('tab', { name: '概览与运维' }).click();
    await page.getByPlaceholder('例如：已被新版本替代').fill('升级至 0.2.0');
    await page.getByRole('button', { name: '废弃此版本' }).click();
    await expect(page.locator('main [role="status"]')).toContainText('DEPRECATED');

    // 4. 切换到发布作业列表页
    await page.getByRole('link', { name: /发布作业/ }).click();
    await expect(page).toHaveURL(/\/jobs$/);
    await expect(page.locator('main')).toContainText('@company/charts-vue@0.1.0');

    // 5. 全局退出登录返回 /login
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('无数据库时（503 INFRA_UNAVAILABLE）展示统一基础设施未连接引导卡', async ({ page }) => {
    await page.route('**/v1/auth/oidc/session', (route) => route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } }));
    await page.route(`${api}/healthz`, (route) => route.fulfill({ status: 200, json: { status: 'ok' } }));
    await page.route(`${api}/v1/me/components**`, (route) => route.fulfill({ status: 503, json: { code: 'INFRA_UNAVAILABLE' } }));
    await page.addInitScript(
      (token) => localStorage.setItem('zhinexus_console_auth', JSON.stringify({ token, subject: 'admin', roles: ['reader'], channel: 'web' })),
      devToken,
    );

    await page.goto('/assets');
    await expect(page.locator('main [role="alert"]')).toContainText('本地基础设施未连接');
    await expect(page.locator('main [role="alert"]')).toContainText('pnpm infra:up');
  });

  test('接口返回 401 时，自动清理会话并跳回登录页', async ({ page }) => {
    await page.route('**/v1/auth/oidc/session', (route) => route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } }));
    await page.route('**/v1/auth/oidc/logout', (route) => route.fulfill({ status: 204 }));
    await page.route(`${api}/healthz`, (route) => route.fulfill({ status: 200, json: { status: 'ok' } }));
    await page.route(`${api}/v1/me/components**`, (route) => route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } }));

    await page.addInitScript(
      (token) => localStorage.setItem('zhinexus_console_auth', JSON.stringify({ token, subject: 'admin', roles: ['reader'], channel: 'web' })),
      devToken,
    );
    await page.goto('/assets');
    await expect(page).toHaveURL(/\/login\?next=%2Fassets$/);
    expect(await page.evaluate(() => localStorage.getItem('zhinexus_console_auth'))).toBeNull();
  });

  test('本地 JWT 已过期时，直接清理会话并跳回登录页', async ({ page }) => {
    await page.route('**/v1/auth/oidc/session', (route) => route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } }));
    await page.route(`${api}/healthz`, (route) => route.fulfill({ status: 200, json: { status: 'ok' } }));

    const expiredToken = `header.${Buffer.from(JSON.stringify({ sub: 'admin', roles: ['reader'], exp: 1000 })).toString('base64url')}.sig`;
    await page.addInitScript(
      (token) => localStorage.setItem('zhinexus_console_auth', JSON.stringify({ token, subject: 'admin', roles: ['reader'], channel: 'web' })),
      expiredToken,
    );
    await page.goto('/jobs');
    await expect(page).toHaveURL(/\/login\?next=%2Fjobs$/);
    expect(await page.evaluate(() => localStorage.getItem('zhinexus_console_auth'))).toBeNull();
  });
});
