import { expect, test, type Page } from '@playwright/test';

/**
 * 二期 B3：文本检索接入的 RED 基线浏览器测试（`/match` 检索交互尚未实现）。
 *
 * 范围与约束（与 `2026-11-15-phase2-text-search.md` B3 一致）：
 * - 保留 B1 本地校验按钮及行为，新增 query 与可选 React DOM 精确版本输入及独立搜索按钮；
 * - **只有用户明确点击搜索才 POST**；Bearer 取当前 session；
 * - 表单任何编辑、退出、身份切换、卸载均取消并忽略旧响应，重试也不能恢复旧身份数据；
 * - requirements 未添加草稿拒绝提交；不回显服务端原始错误或 token；
 * - 复用现有 Playwright 配置与既有会话门 / 选择器约定，不改根配置、锁、版本或 auth。
 *
 * 选择器约定（实现时须一致，均沿用 B1 既有约定并新增）：
 * - 登录门（未登录）：`#token-input` + 标题「登录后开放」；
 * - 表单（已登录）：B1 既有 `#framework-select` / `#framework-version-input` / `#echarts-version-input` /
 *   `#package-manager-select` / `#requirement-input` + 「添加需求」/ `#requirements-list .requirement-row` /
 *   「删除」/ `#context-submit` / `#context-success` / `#context-errors`；
 * - 新增检索：`#search-query-input`、`#react-dom-version-input`、`#search-submit`；
 * - 检索结果态：`#search-loading`、`#search-empty`、`#search-error`、`#candidate-results`（复用 B2 组件）。
 *
 * 说明：宿主 RED 时 `/match` 尚无检索交互，相关用例因缺元素失败；表单入口用例
 * 同时断言 HTTP 200，其余用例验证具体页面元素和交互。
 */

const MATCH_URL = 'http://127.0.0.1:5173/match';
const SEARCH_PATH = '/v1/search/candidates';
const AUTH_KEY = 'zhinexus_console_auth';

/** 复用控制台既有会话门：addInitScript 注入 localStorage 会话，避免 URL 传 JWT。 */
async function seedConsoleSession(page: Page, subject = 'phase2-search'): Promise<void> {
  await page.addInitScript(({ key, subject: sub }: { key: string; subject: string }) => {
    window.localStorage.setItem(
      key,
      JSON.stringify({ token: 'phase2-search-token', subject: sub, roles: [], channel: 'web' }),
    );
  }, { key: AUTH_KEY, subject });
}

/** 收集命中检索端点的请求（用于断言「只有显式点击才 POST」与「取消后不再发起」）。 */
function trackSearchRequests(page: Page): string[] {
  const hits: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes(SEARCH_PATH)) hits.push(request.url());
  });
  return hits;
}

/** 填充合法本地上下文，使本地校验可通过（检索前不强制要求，但保证表单可用）。 */
async function fillValidContext(page: Page): Promise<void> {
  await page.locator('#framework-select').selectOption('react');
  await page.locator('#framework-version-input').fill('19.3.1');
  await page.locator('#package-manager-select').selectOption('pnpm');
}

test.describe('二期 /match 文本检索接入', () => {
  test('登录门内展示检索表单：query、可选 React DOM 版本与独立搜索按钮', async ({ page }) => {
    await seedConsoleSession(page);
    const response = await page.goto(MATCH_URL);
    expect(response?.status()).toBe(200);

    await expect(page.locator('#search-query-input')).toBeVisible();
    await expect(page.locator('#react-dom-version-input')).toBeVisible();
    await expect(page.locator('#search-submit')).toBeVisible();

    // 保留 B1 本地校验按钮及行为
    await expect(page.locator('#context-submit')).toBeVisible();
  });

  test('只有显式点击搜索才 POST，编辑字段不发起请求', async ({ page }) => {
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => { release = resolve; });
    await page.route(`**${SEARCH_PATH}`, async (route) => {
      await pending;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [], gaps: [] }) });
    });
    await seedConsoleSession(page);
    const hits = trackSearchRequests(page);
    const response = await page.goto(MATCH_URL);
    expect(response?.status()).toBe(200);

    await fillValidContext(page);
    await page.locator('#search-query-input').fill('折线图');
    await page.locator('#react-dom-version-input').fill('19.3.1');

    // 仅编辑与本地校验均不得触发检索请求
    await page.locator('#context-submit').click();
    await expect(page.locator('#context-success')).toBeVisible();
    expect(hits).toEqual([]);

    // 显式点击搜索后才 POST
    const request = page.waitForRequest((item) => item.url().includes(SEARCH_PATH) && item.method() === 'POST');
    await page.locator('#search-submit').click();
    await request;
    await expect(page.locator('#search-loading')).toBeVisible();
    expect(hits).toHaveLength(1);
    release();
    await expect(page.locator('#search-empty')).toBeVisible();
  });

  test('requirements 未添加草稿时拒绝检索提交，保留草稿', async ({ page }) => {
    await seedConsoleSession(page);
    const hits = trackSearchRequests(page);
    await page.goto(MATCH_URL);

    await fillValidContext(page);
    await page.locator('#search-query-input').fill('折线图');
    await page.locator('#requirement-input').fill('销售数据看板'); // 未点「添加需求」

    await page.locator('#search-submit').click();

    await expect(page.locator('#search-error')).toBeVisible();
    await expect(page.locator('#search-error')).toContainText('请先添加当前需求');
    expect(hits).toEqual([]);
    // 草稿保留，不静默丢失
    await expect(page.locator('#requirement-input')).toHaveValue('销售数据看板');
  });

  test('空候选输出诚实空态', async ({ page }) => {
    await page.route(`**${SEARCH_PATH}`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [], gaps: [] }) });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);

    await fillValidContext(page);
    await page.locator('#search-query-input').fill('不存在的组件');
    await page.locator('#search-submit').click();

    await expect(page.locator('#search-empty')).toBeVisible();
    await expect(page.locator('#search-empty')).toContainText('暂无候选');
    await expect(page.locator('#candidate-results')).toHaveCount(0);
  });

  test('鉴权失败显示错误且不回显 token', async ({ page }) => {
    await page.route(`**${SEARCH_PATH}`, async (route) => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'unauthorized' }) });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);

    await fillValidContext(page);
    await page.locator('#search-query-input').fill('折线图');
    await page.locator('#search-submit').click();

    await expect(page.locator('#search-error')).toBeVisible();
    const errorText = (await page.locator('#search-error').textContent()) ?? '';
    expect(errorText).not.toContain('phase2-search-token');
    expect(errorText).not.toContain('Bearer');
  });

  test('网络/格式失败显示错误且不回显服务端原始内容', async ({ page }) => {
    await page.route(`**${SEARCH_PATH}`, async (route) => {
      await route.fulfill({ status: 500, contentType: 'text/plain', body: 'upstream boom: secret' });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);

    await fillValidContext(page);
    await page.locator('#search-query-input').fill('折线图');
    await page.locator('#search-submit').click();

    await expect(page.locator('#search-error')).toBeVisible();
    const errorText = (await page.locator('#search-error').textContent()) ?? '';
    expect(errorText).not.toContain('upstream boom');
    expect(errorText).not.toContain('secret');
  });

  test('编辑字段取消并忽略旧响应：迟到响应不得覆盖当前状态', async ({ page }) => {
    let release: () => void = () => {};
    await page.route(`**${SEARCH_PATH}`, async (route) => {
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [], gaps: [] }) });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);

    await fillValidContext(page);
    await page.locator('#search-query-input').fill('折线图');
    await page.locator('#search-submit').click();
    await expect(page.locator('#search-loading')).toBeVisible();

    // 请求在途时编辑字段：必须取消并忽略该旧响应
    await page.locator('#search-query-input').fill('柱状图');
    await expect(page.locator('#search-loading')).toHaveCount(0);

    // 迟到的旧响应不得把结果挂载为当前状态
    release();
    await page.waitForTimeout(300);
    await expect(page.locator('#candidate-results')).toHaveCount(0);
  });

  test('退出登录取消并忽略旧响应，且不残留检索结果', async ({ page }) => {
    let release: () => void = () => {};
    await page.route(`**${SEARCH_PATH}`, async (route) => {
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [], gaps: [] }) });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);

    await fillValidContext(page);
    await page.locator('#search-query-input').fill('折线图');
    await page.locator('#search-submit').click();
    await expect(page.locator('#search-loading')).toBeVisible();

    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.getByRole('heading', { name: /登录后开放/ })).toBeVisible();

    release();
    await page.waitForTimeout(300);
    // 回到登录门：无检索结果、无加载态残留
    await expect(page.locator('#candidate-results')).toHaveCount(0);
    await expect(page.locator('#search-loading')).toHaveCount(0);
  });

  test('切换身份后旧身份响应被忽略，不恢复旧身份数据', async ({ page }) => {
    let release: () => void = () => {};
    await page.route(`**${SEARCH_PATH}`, async (route) => {
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [], gaps: [] }) });
    });
    await seedConsoleSession(page, 'identity-a');
    await page.goto(MATCH_URL);

    await fillValidContext(page);
    await page.locator('#search-query-input').fill('折线图');
    await page.locator('#search-submit').click();
    await expect(page.locator('#search-loading')).toBeVisible();

    // 退出并切换为另一身份
    await page.getByRole('button', { name: '退出登录' }).click();
    await seedConsoleSession(page, 'identity-b');
    await page.reload();
    await expect(page.locator('#search-query-input')).toBeVisible();

    // 旧身份的迟到响应不得挂载
    release();
    await page.waitForTimeout(300);
    await expect(page.locator('#candidate-results')).toHaveCount(0);
    await expect(page.locator('#search-loading')).toHaveCount(0);
  });

  test('成功检索后挂载 CandidateResults 展示真实候选', async ({ page }) => {
    const sha = 'a'.repeat(64);
    const body = {
      candidates: [{
        variantReleaseId: 'release-react-line', variantId: 'react-line', componentId: 'line', framework: 'react',
        packageName: '@company/charts-react', packageVersion: '0.1.0', packageSha256: sha, exportName: 'LineChart',
        evidence: [
          { kind: 'api', path: 'api/line.json', sha256: 'b'.repeat(64) },
          { kind: 'docs', path: 'docs/line.md', sha256: 'c'.repeat(64) },
        ],
        compatibility: { status: 'unverified', recordIds: [] }, ranking: { text: 0.8 }, gaps: [],
      }],
      gaps: [],
    };
    await page.route(`**${SEARCH_PATH}`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);

    await fillValidContext(page);
    await page.locator('#search-query-input').fill('折线图');
    await page.locator('#search-submit').click();

    await expect(page.locator('#candidate-results')).toBeVisible();
    await expect(page.locator('.candidate-card')).toHaveCount(1);
    await expect(page.locator('.candidate-card')).toContainText('@company/charts-react@0.1.0');
  });

  test('已返回结果后编辑上下文字段清理检索结果', async ({ page }) => {
    await page.route(`**${SEARCH_PATH}`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [], gaps: [] }) });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);

    await fillValidContext(page);
    await page.locator('#search-query-input').fill('折线图');
    await page.locator('#search-submit').click();
    await expect(page.locator('#search-empty')).toBeVisible();

    // 编辑上文字段必须取消在途请求并清理既有结果
    await page.locator('#framework-version-input').fill('19.3.2');
    await expect(page.locator('#search-empty')).toHaveCount(0);
    await expect(page.locator('#candidate-results')).toHaveCount(0);
  });

  test('检索在途时增删需求取消并清理，迟到响应不回显', async ({ page }) => {
    let release: () => void = () => {};
    await page.route(`**${SEARCH_PATH}`, async (route) => {
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [], gaps: [] }) });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);

    await fillValidContext(page);
    await page.locator('#requirement-input').fill('数据看板');
    await page.getByRole('button', { name: '添加需求' }).click();
    await page.locator('#search-query-input').fill('折线图');
    await page.locator('#search-submit').click();
    await expect(page.locator('#search-loading')).toBeVisible();

    // 在途时再增删需求：取消并清理
    await page.locator('#requirement-input').fill('移动端适配');
    await page.getByRole('button', { name: '添加需求' }).click();
    await expect(page.locator('#search-loading')).toHaveCount(0);

    release();
    await page.waitForTimeout(300);
    await expect(page.locator('#candidate-results')).toHaveCount(0);
    await expect(page.locator('#search-empty')).toHaveCount(0);
  });

  test('另一标签页改写会话（storage 事件）后取消并清理，旧身份不可回显', async ({ page, context }) => {
    let release: () => void = () => {};
    await page.route(`**${SEARCH_PATH}`, async (route) => {
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [], gaps: [] }) });
    });
    await seedConsoleSession(page, 'identity-a');
    await page.goto(MATCH_URL);

    await fillValidContext(page);
    await page.locator('#search-query-input').fill('折线图');
    await page.locator('#search-submit').click();
    await expect(page.locator('#search-loading')).toBeVisible();

    // 另一标签页改写会话：先导航到同源页面（避免 about:blank 下 localStorage SecurityError），
    // 且不用 addInitScript 注入，以免覆盖期望写入的身份
    const other = await context.newPage();
    await other.goto(MATCH_URL);
    await other.evaluate((key: string) => {
      window.localStorage.setItem(key, JSON.stringify({ token: 'other-token', subject: 'identity-b', roles: [], channel: 'web' }));
    }, AUTH_KEY);
    await other.close();

    await expect(page.getByRole('heading', { name: /登录后开放/ })).toBeVisible();
    await expect(page.locator('#search-loading')).toHaveCount(0);

    release();
    await page.waitForTimeout(300);
    await expect(page.locator('#candidate-results')).toHaveCount(0);
  });

  test('重新聚焦时复核会话：会话被改写则取消并回退登录门', async ({ page }) => {
    let release: () => void = () => {};
    await page.route(`**${SEARCH_PATH}`, async (route) => {
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [], gaps: [] }) });
    });
    await seedConsoleSession(page, 'identity-a');
    await page.goto(MATCH_URL);

    await fillValidContext(page);
    await page.locator('#search-query-input').fill('折线图');
    await page.locator('#search-submit').click();
    await expect(page.locator('#search-loading')).toBeVisible();

    // 同页改写会话（不触发 storage 事件），再派发 focus 复核当前会话
    await page.evaluate((key: string) => {
      window.localStorage.setItem(key, JSON.stringify({ token: 'other-token', subject: 'identity-b', roles: [], channel: 'web' }));
      window.dispatchEvent(new Event('focus'));
    }, AUTH_KEY);

    await expect(page.getByRole('heading', { name: /登录后开放/ })).toBeVisible();
    await expect(page.locator('#search-loading')).toHaveCount(0);

    release();
    await page.waitForTimeout(300);
    await expect(page.locator('#candidate-results')).toHaveCount(0);
  });

  test('同页改写会话且未触发 focus：响应落地前复核身份，旧身份不回显', async ({ page }) => {
    let release: () => void = () => {};
    await page.route(`**${SEARCH_PATH}`, async (route) => {
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [], gaps: [] }) });
    });
    await seedConsoleSession(page, 'identity-a');
    await page.goto(MATCH_URL);

    await fillValidContext(page);
    await page.locator('#search-query-input').fill('折线图');
    await page.locator('#search-submit').click();
    await expect(page.locator('#search-loading')).toBeVisible();

    // 同页改写会话，且不派发 focus / storage：只能靠响应落地前的身份复核拦截
    await page.evaluate((key: string) => {
      window.localStorage.setItem(key, JSON.stringify({ token: 'other-token', subject: 'identity-b', roles: [], channel: 'web' }));
    }, AUTH_KEY);

    release();
    await page.waitForTimeout(300);

    // 旧身份的迟到响应不得挂载为结果
    await expect(page.locator('#candidate-results')).toHaveCount(0);
    await expect(page.locator('#search-empty')).toHaveCount(0);
    await expect(page.locator('#search-loading')).toHaveCount(0);
  });

  test('同页改写 token 后再点击搜索：提交前复核会话，不发请求并清理回退登录门', async ({ page }) => {
    const hits = trackSearchRequests(page);
    await seedConsoleSession(page, 'identity-a');
    await page.goto(MATCH_URL);

    await fillValidContext(page);
    await page.locator('#search-query-input').fill('折线图');

    // 同页只改 token（subject 不变）：提交前复核必须发现失效
    await page.evaluate((key: string) => {
      const raw = window.localStorage.getItem(key);
      const session = raw ? JSON.parse(raw) : {};
      window.localStorage.setItem(key, JSON.stringify({ ...session, token: 'rotated-token' }));
    }, AUTH_KEY);

    await page.locator('#search-submit').click();

    // 不发请求，且清理回退登录门（不留 loading / 错误态）
    expect(hits).toEqual([]);
    await expect(page.getByRole('heading', { name: /登录后开放/ })).toBeVisible();
    await expect(page.locator('#search-loading')).toHaveCount(0);
    await expect(page.locator('#search-error')).toHaveCount(0);
  });

  test('同 subject 换 token：会话失效，检索结果与字段被清理', async ({ page }) => {
    await page.route(`**${SEARCH_PATH}`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [], gaps: [] }) });
    });
    await seedConsoleSession(page, 'identity-a');
    await page.goto(MATCH_URL);

    await fillValidContext(page);
    await page.locator('#search-query-input').fill('折线图');
    await page.locator('#search-submit').click();
    await expect(page.locator('#search-empty')).toBeVisible();

    // 同 subject 但换 token：仍属失效会话，focus 复核必须清理
    await page.evaluate((key: string) => {
      window.localStorage.setItem(key, JSON.stringify({ token: 'rotated-token', subject: 'identity-a', roles: [], channel: 'web' }));
      window.dispatchEvent(new Event('focus'));
    }, AUTH_KEY);

    await expect(page.getByRole('heading', { name: /登录后开放/ })).toBeVisible();
    await expect(page.locator('#search-empty')).toHaveCount(0);
    await expect(page.locator('#candidate-results')).toHaveCount(0);
  });

  test('未登录时不暴露检索表单', async ({ page }) => {
    await page.goto(MATCH_URL);
    await expect(page.getByRole('heading', { name: /登录后开放/ })).toBeVisible();
    await expect(page.locator('#search-query-input')).toHaveCount(0);
    await expect(page.locator('#search-submit')).toHaveCount(0);
  });
});
