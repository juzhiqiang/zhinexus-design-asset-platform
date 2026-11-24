import { expect, test, type Page } from '@playwright/test';

/**
 * 二期 B1：`/match` 项目上下文本地表单浏览器回归测试。
 *
 * 范围与约束（与 kickoff 计划 B1 一致）：
 * - `/match` 为现有 `(console)` 边界内的本地表单，仅做 `ProjectContext` 采集与本地校验；
 * - 不依赖尚未交付的 Candidate/MatchPlan 或 search API；不得发起任何检索/匹配网络请求；
 * - 复用控制台既有会话门（localStorage `zhinexus_console_auth`）与画廊选择器/样式约定；
 * - 不改根配置、锁、版本或 auth。
 *
 * 选择器约定（实现页面时须一致）：
 * - 登录门（未登录）：`#token-input` + 标题「登录后开放」；
 * - 表单（已登录）：`#framework-select`(vue/react)、`#framework-version-input`、`#echarts-version-input`、
 *   `#package-manager-select`(npm/pnpm)、`#requirement-input` + 按钮「添加需求」、
 *   `#requirements-list .requirement-row`（每行含「删除」按钮）、`#context-submit`、
 *   结果区 `#context-success` / `#context-errors`。
 *
 * 说明（宿主 RED 实况，2026-11-15）：`/match` 未实现时返回 404；宿主实跑为 1 失败 / 1 中断 / 4 未跑，
 * 「未登录提示」等用例因缺元素失败；「noindex」用例曾被 404 页面自带的 noindex 误判通过。
 * 因此每个用例均断言 `response.status() === 200` 以消除误绿；页面实现后转 GREEN。
 */

const MATCH_URL = 'http://127.0.0.1:5177/match';
const AUTH_KEY = 'zhinexus_console_auth';

/** 复用控制台既有会话门：addInitScript 注入 localStorage 会话，避免 URL 传 JWT。 */
async function seedConsoleSession(page: Page): Promise<void> {
  await page.addInitScript((key: string) => {
    window.localStorage.setItem(
      key,
      JSON.stringify({ token: 'phase2-test-token', subject: 'phase2-browser', roles: [], channel: 'web' }),
    );
  }, AUTH_KEY);
}

/** 收集疑似命中未交付检索/匹配服务的请求（本批为纯本地表单，不得发起；排除 /match 页面自身）。 */
function trackForbiddenRequests(page: Page): string[] {
  const hits: string[] = [];
  const pattern = /match-plan|matchplan|searchcandidates|parsedesign|creatematchplan|\/v1\/search|\/api\/search|candidate/i;
  page.on('request', (request) => {
    if (pattern.test(request.url())) hits.push(request.url());
  });
  return hits;
}

test.describe('二期 /match 项目上下文本地表单', () => {
  test('控制台 /match 标记 noindex', async ({ page }) => {
    await seedConsoleSession(page);
    const response = await page.goto(MATCH_URL);
    expect(response).not.toBeNull();
    expect(response!.status()).toBe(200);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });

  test('未登录显示登录提示，不暴露上下文表单', async ({ page }) => {
    const response = await page.goto(MATCH_URL);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: /登录后开放/ })).toBeVisible();
    await expect(page.locator('#token-input')).toBeVisible();
    await expect(page.locator('#framework-select')).toHaveCount(0);
  });

  test('会话门内：合法输入通过本地校验并显示成功状态', async ({ page }) => {
    await seedConsoleSession(page);
    const response = await page.goto(MATCH_URL);
    expect(response?.status()).toBe(200);

    await expect(page.locator('#framework-select')).toBeVisible();
    await page.locator('#framework-select').selectOption('react');
    await page.locator('#framework-version-input').fill('19.3.1');
    await page.locator('#package-manager-select').selectOption('pnpm');
    await page.locator('#echarts-version-input').fill(''); // 空白可选 ECharts 省略

    await page.locator('#context-submit').click();
    await expect(page.locator('#context-success')).toBeVisible();
    await expect(page.locator('#context-errors')).toBeHidden();
  });

  test('会话门内：非法输入显示字段错误且无成功状态', async ({ page }) => {
    await seedConsoleSession(page);
    const response = await page.goto(MATCH_URL);
    expect(response?.status()).toBe(200);

    await page.locator('#framework-select').selectOption('vue');
    await page.locator('#framework-version-input').fill('^3.0.0'); // 版本范围应被拒绝
    await page.locator('#package-manager-select').selectOption('npm');

    await page.locator('#context-submit').click();
    await expect(page.locator('#context-errors')).toBeVisible();
    await expect(page.locator('#context-success')).toHaveCount(0);
  });

  test('需求可增删', async ({ page }) => {
    await seedConsoleSession(page);
    const response = await page.goto(MATCH_URL);
    expect(response?.status()).toBe(200);

    await expect(page.locator('#requirements-list .requirement-row')).toHaveCount(0);
    await page.locator('#requirement-input').fill('销售数据看板');
    await page.getByRole('button', { name: '添加需求' }).click();
    await page.locator('#requirement-input').fill('移动端适配');
    await page.getByRole('button', { name: '添加需求' }).click();
    await expect(page.locator('#requirements-list .requirement-row')).toHaveCount(2);

    await page.locator('#requirements-list .requirement-row').first().getByRole('button', { name: '删除' }).click();
    await expect(page.locator('#requirements-list .requirement-row')).toHaveCount(1);
  });

  test('编辑输入撤销过期成功状态', async ({ page }) => {
    await seedConsoleSession(page);
    const response = await page.goto(MATCH_URL);
    expect(response?.status()).toBe(200);

    await page.locator('#framework-select').selectOption('vue');
    await page.locator('#framework-version-input').fill('3.5.45');
    await page.locator('#package-manager-select').selectOption('pnpm');
    await page.locator('#context-submit').click();
    await expect(page.locator('#context-success')).toBeVisible();

    // 修改任一字段应立即撤销上一次成功状态，过期结果不得残留
    await page.locator('#framework-version-input').fill('3.5.46');
    await expect(page.locator('#context-success')).toHaveCount(0);
  });

  test('需求草稿编辑清除全部过期成功提示，校验不得遗漏未添加草稿', async ({ page }) => {
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await page.locator('#framework-select').selectOption('react');
    await page.locator('#framework-version-input').fill('19.3.1');
    await page.locator('#package-manager-select').selectOption('pnpm');
    await page.locator('#context-submit').click();
    await expect(page.locator('#context-success')).toBeVisible();
    await page.locator('#requirement-input').fill('尚未添加的业务需求');
    await expect(page.getByText('本地校验通过', { exact: true })).toHaveCount(0);
    await page.locator('#context-submit').click();
    await expect(page.locator('#context-success')).toHaveCount(0);
    await expect(page.locator('#requirement-input')).toHaveValue('尚未添加的业务需求');
    await expect(page.getByText(/请先添加.*需求/)).toBeVisible();
  });

  test('退出并切换身份清空项目输入', async ({ page }) => {
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await page.locator('#requirement-input').fill('上一身份的私有需求');
    await page.getByRole('button', { name: '添加需求' }).click();
    await page.getByRole('button', { name: '退出登录' }).click();
    const token = await page.evaluate(() => `test.${btoa(JSON.stringify({ sub: 'another-user' }))}.test`);
    await page.locator('#token-input').fill(token);
    await page.getByRole('button', { name: '凭证登录' }).click();
    await expect(page.locator('#requirements-list .requirement-row')).toHaveCount(0);
    await expect(page.locator('#requirement-input')).toHaveValue('');
  });

  test('本地表单不发起检索/匹配网络请求', async ({ page }) => {
    await seedConsoleSession(page);
    const forbidden = trackForbiddenRequests(page);
    const response = await page.goto(MATCH_URL);
    expect(response?.status()).toBe(200);

    await expect(page.locator('#framework-select')).toBeVisible();
    const storageBefore = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
    const leaked: string[] = [];
    const privateNeed = 'phase2-private-requirement-7613';
    page.on('request', request => {
      if (`${request.url()} ${request.postData() ?? ''}`.includes(privateNeed)) leaked.push(request.url());
    });

    await page.locator('#framework-select').selectOption('react');
    await page.locator('#framework-version-input').fill('19.3.1');
    await page.locator('#package-manager-select').selectOption('npm');
    await page.locator('#requirement-input').fill(privateNeed);
    await page.getByRole('button', { name: '添加需求' }).click();
    await page.locator('#context-submit').click();
    await expect(page.locator('#context-success')).toBeVisible();

    // 本地校验完成即应出现成功状态；此时不应有任何命中未交付检索/匹配端点的请求
    expect(forbidden).toEqual([]);
    expect(leaked).toEqual([]);
    expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))).toEqual(storageBefore);
  });

  test('桌面与手机入口和字段错误可读，页面不横向溢出', async ({ page }, testInfo) => {
    await seedConsoleSession(page);
    for (const width of [1280, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(MATCH_URL);
      await expect(page.getByRole('navigation', { name: '控制台导航' }).getByRole('link', { name: '项目上下文匹配' })).toBeVisible();
      await expect(page.locator('#framework-select')).toHaveValue('');
      await expect(page.locator('#framework-version-input')).toHaveValue('');
      await page.locator('#context-submit').click();
      await expect(page.locator('#framework-version-input')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('#framework-version-input')).toHaveAttribute('aria-describedby', 'err-frameworkVersion');
      await expect(page.locator('#err-frameworkVersion')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath(`context-${width}.png`), fullPage: true });
    }
  });
});
