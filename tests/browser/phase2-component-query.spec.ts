import { expect, test, type Page } from '@playwright/test';
import { validateComponentMatchResponse } from '@company/contracts';

/**
 * 二期 P1：`/match` 组件精确查询表单的浏览器测试。
 *
 * 范围与约束（与 `docs/specs/2026-11-16-phase2-query-completion-design.md` 一致）：
 * - 表单**只显式 GET** `/v1/matching/components`，无 body，Bearer 取当前 session；
 * - 字段：componentId / framework / packageVersion / 可选 packageName / frameworkVersion /
 *   echartsVersion；React 必须精确 reactDomVersion，Vue 禁止；
 * - 输入或身份（退出登录/切换身份）变化一律中止在途请求并清空结果；
 * - 与原项目上下文本地校验、文本检索、设计 ID 规则匹配表单并存，不自动回写设计规则；
 * - 375px 窄屏不横向溢出；不回显服务端原始错误或 token；不持久化查询或响应。
 *
 * 选择器约定（实现时须一致）：
 * - 登录门：`#token-input`；
 * - 组件查询区：`#component-query`、`#cq-component-id`、`#cq-framework`、`#cq-package-version`、
 *   `#cq-package-name`、`#cq-framework-version`、`#cq-echarts-version`、`#cq-react-dom-version`、
 *   `#cq-submit`、`#cq-loading`、`#cq-error`、`#cq-input-errors`、`#cq-gap`、`#cq-result`；
 * - 结果态：`#cq-result-status`、`#cq-result-target`、`#cq-result-dependencies`、`#cq-result-gaps`、
 *   `#cq-result-api`。
 *
 * TDD 记录：宿主 RED 时组件查询区尚未实现，相关用例因缺元素失败；表单入口用例同时断言
 * HTTP 200，避免被 404 页面自带内容误判为通过。实现完成后已转 GREEN。
 */

const MATCH_URL = 'http://127.0.0.1:5173/match';
const COMPONENT_MATCH_PATH = '/v1/matching/components';
const AUTH_KEY = 'zhinexus_console_auth';

const TARGET = {
  variantReleaseId: '00000000-0000-4000-8000-000000000001',
  variantId: 'line-vue',
  componentId: 'line',
  framework: 'vue' as const,
  packageName: '@company/charts-vue',
  packageVersion: '0.0.12',
  packageSha256: 'b'.repeat(64),
  exportName: 'LineChart',
  exportPath: './line',
  evidence: [
    { kind: 'api' as const, path: 'api/line.json', sha256: 'c'.repeat(64) },
    { kind: 'docs' as const, path: 'docs/line.md', sha256: 'd'.repeat(64) },
  ],
  compatibility: { status: 'unverified' as const, recordIds: [] as string[] },
  examples: [{ id: 'example', previewEntry: 'preview/index.html' }],
  styleExport: './style.css',
  readyMethod: 'whenRendered',
  notes: [] as string[],
};

/**
 * 表单填充后应发出的查询字段。
 * 用**必填字段的具体类型**而不是 `Record<string, string>`：后者在
 * `noUncheckedIndexedAccess` 下会把每个已知字段读成 `string | undefined`，
 * 于是 `.fill(params.componentId)` 与 `packageVersion: params.packageVersion` 全部报错。
 */
type QueryFields = {
  componentId: string;
  framework: string;
  packageVersion: string;
  packageName: string;
  frameworkVersion: string;
  echartsVersion: string;
};

/** 页面在填充表单后应发出的完整查询串（用于核对 URL 与键集合）。 */
function expectedParams(overrides: Partial<QueryFields> = {}): QueryFields {
  return {
    componentId: 'line',
    framework: 'vue',
    packageVersion: '0.0.12',
    packageName: '@company/charts-vue',
    frameworkVersion: '3.5.45',
    echartsVersion: '6.1.0',
    ...overrides,
  };
}

function matchedBody(overrides: Partial<QueryFields> = {}) {
  const params = expectedParams(overrides);
  return {
    schemaVersion: 1,
    query: params,
    status: 'matched' as const,
    target: { ...TARGET, packageVersion: params.packageVersion },
    api: {
      schemaVersion: 1, componentId: 'line', framework: 'vue' as const, exportName: 'LineChart', exportPath: './line',
      props: [{ name: 'data', type: 'ChartData', required: true }],
      events: [{ name: 'point-click', payload: 'ChartEvent' }],
      styleExport: './style.css', readyMethod: 'whenRendered', notes: [],
    },
    exactDependencies: [
      { name: '@company/charts-vue', version: params.packageVersion },
      { name: 'vue', version: params.frameworkVersion },
      { name: 'echarts', version: params.echartsVersion },
    ],
    gaps: [{ code: 'COMPATIBILITY_UNVERIFIED', message: '缺少该精确版本组合的已接受兼容记录' }],
  };
}

function gapBody(overrides: Partial<QueryFields> = {}) {
  const params = expectedParams(overrides);
  return {
    schemaVersion: 1, query: params, status: 'gap' as const, exactDependencies: [],
    gaps: [{ code: 'TARGET_UNAVAILABLE', message: '目标当前不可用，请核对配置及访问条件' }],
  };
}

async function seedConsoleSession(page: Page, subject = 'phase2-query'): Promise<void> {
  await page.addInitScript(({ key, subject: sub }: { key: string; subject: string }) => {
    window.localStorage.setItem(
      key,
      JSON.stringify({ token: 'phase2-query-token', subject: sub, roles: [], channel: 'web' }),
    );
  }, { key: AUTH_KEY, subject });
}

/** 记录页面实际发出的组件查询请求（URL + method + 是否有 body）。 */
function trackComponentMatchRequests(page: Page): { urls: string[]; methods: string[]; bodies: string[] } {
  const hits = { urls: [] as string[], methods: [] as string[], bodies: [] as string[] };
  page.on('request', (request) => {
    if (request.url().includes(COMPONENT_MATCH_PATH)) {
      hits.urls.push(request.url());
      hits.methods.push(request.method());
      hits.bodies.push(request.postData() ?? '');
    }
  });
  return hits;
}

async function fillQuery(page: Page, overrides: Partial<QueryFields> = {}): Promise<void> {
  const params = expectedParams(overrides);
  await page.locator('#cq-component-id').fill(params.componentId);
  await page.locator('#cq-framework').selectOption(params.framework);
  await page.locator('#cq-package-version').fill(params.packageVersion);
  await page.locator('#cq-package-name').fill(params.packageName);
  await page.locator('#cq-framework-version').fill(params.frameworkVersion);
  await page.locator('#cq-echarts-version').fill(params.echartsVersion);
}

test.describe('二期组件精确查询表单', () => {
  test('表单与既有项目上下文/文本检索/设计 ID 匹配并存，页面 200', async ({ page }) => {
    await seedConsoleSession(page);
    const response = await page.goto(MATCH_URL);
    expect(response?.status()).toBe(200);
    await expect(page.locator('#component-query')).toBeVisible();
    for (const id of ['#cq-component-id', '#cq-framework', '#cq-package-version', '#cq-package-name',
      '#cq-framework-version', '#cq-echarts-version', '#cq-submit']) {
      await expect(page.locator(id)).toBeVisible();
    }
    // 既有能力不回退
    await expect(page.locator('#framework-select')).toBeVisible();
    await expect(page.locator('#search-query-input')).toBeVisible();
    await expect(page.locator('#design-match')).toBeVisible();
    await expect(page.locator('#design-mapping-input')).toBeVisible();
  });

  test('React 框架才显示 reactDomVersion 输入，Vue 隐藏且不发送', async ({ page }) => {
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await expect(page.locator('#cq-react-dom-version')).toHaveCount(0);
    await page.locator('#cq-framework').selectOption('react');
    await expect(page.locator('#cq-react-dom-version')).toBeVisible();
    await page.locator('#cq-framework').selectOption('vue');
    await expect(page.locator('#cq-react-dom-version')).toHaveCount(0);
  });

  test('只有显式点击才 GET，且 URL 用单次百分号编码携带 scoped packageName', async ({ page }) => {
    const hits = trackComponentMatchRequests(page);
    await page.route(`**${COMPONENT_MATCH_PATH}**`, async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(matchedBody()),
      });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillQuery(page);
    expect(hits.urls).toEqual([]); // 编辑字段不触发请求
    await page.locator('#cq-submit').click();

    await expect(page.locator('#cq-result')).toBeVisible();
    expect(hits.methods).toEqual(['GET']);
    expect(hits.bodies.every(body => body === '')).toBe(true);
    expect(hits.urls).toHaveLength(1);
    const url = new URL(hits.urls[0]!);
    expect(url.searchParams.get('packageName')).toBe('@company/charts-vue');
    expect(hits.urls[0]).toContain('packageName=%40company%2Fcharts-vue');
    expect(url.searchParams.get('componentId')).toBe('line');
    expect(url.searchParams.get('echartsVersion')).toBe('6.1.0');
  });

  test('matched 响应通过公开校验并展示 target/api/依赖与 COMPATIBILITY_UNVERIFIED', async ({ page }) => {
    await page.route(`**${COMPONENT_MATCH_PATH}**`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(matchedBody()) });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillQuery(page);
    await page.locator('#cq-submit').click();

    await expect(page.locator('#cq-result-status')).toHaveText('matched');
    await expect(page.locator('#cq-result-target')).toContainText('@company/charts-vue@0.0.12');
    await expect(page.locator('#cq-result-target')).toContainText('LineChart');
    await expect(page.locator('#cq-result-api')).toContainText('LineChart');
    await expect(page.locator('#cq-result-dependencies')).toContainText('echarts@6.1.0');
    await expect(page.locator('#cq-result-gaps')).toContainText('COMPATIBILITY_UNVERIFIED');
    await expect(page.locator('#cq-gap')).toHaveCount(0);
  });

  test('gap 响应同形展示，不显示 target/api/依赖', async ({ page }) => {
    await page.route(`**${COMPONENT_MATCH_PATH}**`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(gapBody()) });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillQuery(page);
    await page.locator('#cq-submit').click();

    await expect(page.locator('#cq-gap')).toBeVisible();
    await expect(page.locator('#cq-gap')).toContainText('TARGET_UNAVAILABLE');
    await expect(page.locator('#cq-result')).toHaveCount(0);
  });

  test('未认证 401 提示重新登录，不回显服务端原文', async ({ page }) => {
    const serverText = ' Bearer token missing: principal=unknown-subject';
    await page.route(`**${COMPONENT_MATCH_PATH}**`, async (route) => {
      await route.fulfill({ status: 401, contentType: 'text/plain', body: serverText });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillQuery(page);
    await page.locator('#cq-submit').click();

    await expect(page.locator('#cq-error')).toBeVisible();
    await expect(page.locator('#cq-error')).toContainText('重新登录');
    expect(await page.locator('#component-query').textContent()).not.toContain(serverText);
    expect(await page.locator('#component-query').textContent()).not.toContain('unknown-subject');
  });

  test('输入变化取消在途请求并清空旧结果', async ({ page }) => {
    let release!: (body: unknown) => void;
    const pending = new Promise<unknown>(resolve => { release = resolve; });
    await page.route(`**${COMPONENT_MATCH_PATH}**`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await pending) });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillQuery(page);
    await page.locator('#cq-submit').click();
    await expect(page.locator('#cq-loading')).toBeVisible();

    // 编辑任意字段：在途请求必须被取消，旧结果不得回显
    await page.locator('#cq-package-version').fill('0.0.13');
    release(matchedBody({ packageVersion: '0.0.13' }));
    await expect(page.locator('#cq-result')).toHaveCount(0);
    await expect(page.locator('#cq-loading')).toHaveCount(0);
  });

  test('退出登录取消在途请求、清空结果并回退登录门', async ({ page }) => {
    let release!: (body: unknown) => void;
    const pending = new Promise<unknown>(resolve => { release = resolve; });
    await page.route(`**${COMPONENT_MATCH_PATH}**`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await pending) });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillQuery(page);
    await page.locator('#cq-submit').click();
    await expect(page.locator('#cq-loading')).toBeVisible();

    await page.locator('button', { hasText: '退出登录' }).first().click();
    release(matchedBody());
    await expect(page.locator('#token-input')).toBeVisible();
    await expect(page.locator('#component-query')).toHaveCount(0);
  });

  test('切换身份（同页改写会话 + focus 复核）使在途结果失效，不泄露旧身份数据', async ({ page }) => {
    let release!: (body: unknown) => void;
    const pending = new Promise<unknown>(resolve => { release = resolve; });
    await page.route(`**${COMPONENT_MATCH_PATH}**`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await pending) });
    });
    await seedConsoleSession(page, 'phase2-query-a');
    await page.goto(MATCH_URL);
    await fillQuery(page);
    await page.locator('#cq-submit').click();
    await expect(page.locator('#cq-loading')).toBeVisible();

    await page.evaluate((key: string) => {
      window.localStorage.setItem(key, JSON.stringify({ token: 'phase2-query-token', subject: 'phase2-query-b', roles: [], channel: 'web' }));
      window.dispatchEvent(new Event('focus'));
    }, AUTH_KEY);
    release(matchedBody());
    await expect(page.locator('#cq-result')).toHaveCount(0);
    await expect(page.locator('#component-query')).toHaveCount(0);
  });

  test('切换身份且未触发 focus：响应落地前复核身份，旧身份不回显', async ({ page }) => {
    let release!: (body: unknown) => void;
    const pending = new Promise<unknown>(resolve => { release = resolve; });
    await page.route(`**${COMPONENT_MATCH_PATH}**`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await pending) });
    });
    await seedConsoleSession(page, 'phase2-query-a');
    await page.goto(MATCH_URL);
    await fillQuery(page);
    await page.locator('#cq-submit').click();
    await expect(page.locator('#cq-loading')).toBeVisible();

    // 同页改写会话，不派发 focus / storage：只能靠落地前的 token/subject 复核拦截
    await page.evaluate((key: string) => {
      window.localStorage.setItem(key, JSON.stringify({ token: 'phase2-query-token', subject: 'phase2-query-b', roles: [], channel: 'web' }));
    }, AUTH_KEY);
    release(matchedBody());
    await expect(page.locator('#cq-result')).toHaveCount(0);
    await expect(page.locator('#component-query')).toHaveCount(0);
  });

  test('非法输入本地拒绝，不发起任何请求', async ({ page }) => {
    const hits = trackComponentMatchRequests(page);
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillQuery(page, { packageVersion: 'latest' });
    await page.locator('#cq-submit').click();
    await expect(page.locator('#cq-input-errors')).toBeVisible();
    expect(hits.urls).toEqual([]);
  });

  test('React 缺 reactDomVersion 本地拒绝，不发起请求', async ({ page }) => {
    const hits = trackComponentMatchRequests(page);
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillQuery(page, { framework: 'react', frameworkVersion: '19.3.1' });
    await page.locator('#cq-submit').click();
    await expect(page.locator('#cq-input-errors')).toBeVisible();
    expect(hits.urls).toEqual([]);
  });

  test('输入空白不被静默 trim：带空格的 packageName 本地拒绝且不发请求', async ({ page }) => {
    const hits = trackComponentMatchRequests(page);
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillQuery(page);
    // 前后各加一个空格：若实现先 trim 再发送，这里就会发出请求
    await page.locator('#cq-package-name').fill('  @company/charts-vue  ');
    await page.locator('#cq-submit').click();
    await expect(page.locator('#cq-input-errors')).toBeVisible();
    expect(hits.urls).toEqual([]);
  });

  test('输入空白不被静默 trim：带空格的 reactDomVersion 本地拒绝且不发请求', async ({ page }) => {
    const hits = trackComponentMatchRequests(page);
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillQuery(page, { framework: 'react', frameworkVersion: '19.3.1' });
    await page.locator('#cq-react-dom-version').fill(' 19.3.1 ');
    await page.locator('#cq-submit').click();
    await expect(page.locator('#cq-input-errors')).toBeVisible();
    expect(hits.urls).toEqual([]);
  });

  test('窄屏 375px 不横向溢出', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await seedConsoleSession(page);
    const response = await page.goto(MATCH_URL);
    expect(response?.status()).toBe(200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('不回显服务端原文，不持久化查询或响应，不自动回写设计规则', async ({ page }) => {
    await page.route(`**${COMPONENT_MATCH_PATH}**`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(matchedBody()) });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillQuery(page);
    await page.locator('#cq-submit').click();
    await expect(page.locator('#cq-result')).toBeVisible();

    expect(validateComponentMatchResponse(matchedBody()).ok).toBe(true);
    const keys = await page.evaluate(() => Object.keys(window.localStorage));
    expect(keys.filter((key) => /component|query|match|target|api/i.test(key))).toEqual([]);
    // 设计 ID 表单不被查询结果回写
    await expect(page.locator('#design-mapping-input')).toHaveValue('');
  });

  test('界面不宣称自动接入或兼容性通过，也不使用模型/OCR 表述', async ({ page }) => {
    await page.route(`**${COMPONENT_MATCH_PATH}**`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(matchedBody()) });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillQuery(page);
    await page.locator('#cq-submit').click();
    await expect(page.locator('#cq-result')).toBeVisible();

    const text = (await page.locator('#component-query').textContent()) ?? '';
    // 禁词只收「自动接入 / 能力冒充」类表述。**不按裸子串禁「兼容性已确认」**：
    // 产品文案里有否定句「Ready 不代表兼容性已确认」，裸子串会把这句必要的免责提示
    // 误判成成功承诺。否定语义改用下面的正向断言验证。
    for (const forbidden of ['模型', 'OCR', '视觉匹配', '智能推荐', '训练', '已通过兼容']) {
      expect(text).not.toContain(forbidden);
    }

    // 正向验证「未确认」语义，而不是靠禁词碰运气：
    // 兼容状态必须是 unverified，缺口码必须是 COMPATIBILITY_UNVERIFIED，
    // 并且界面必须给出否定式提示（matched ≠ 兼容性已通过）。
    await expect(page.locator('#cq-result-status')).toHaveText('matched');
    await expect(page.locator('#cq-result-gaps')).toContainText('COMPATIBILITY_UNVERIFIED');
    await expect(page.locator('#cq-result-target')).toContainText('unverified');
    expect(text).toContain('不代表兼容性已确认');
    // 不得出现任何肯定式的兼容结论
    for (const claim of ['兼容性已通过', '兼容已通过', '兼容性已确认通过', '已验证兼容']) {
      expect(text).not.toContain(claim);
    }
  });
});
