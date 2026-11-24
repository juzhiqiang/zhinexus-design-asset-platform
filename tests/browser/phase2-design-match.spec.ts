import { expect, test, type Page } from '@playwright/test';
import { manifestDigest } from '@company/contracts';

/**
 * 二期 ID 规则匹配：`/match` 设计 ID 配置与装配方案展示的 RED 基线浏览器测试
 * （设计 ID 输入区与 `match-plan-client.ts` 尚未实现）。
 *
 * 范围与约束（与 `2026-11-15-phase2-match-plan-http.md` B 范围一致）：
 * - 输入为**显式规则 JSON**（DesignIdMappingV1）+ 逐行元素清单（instanceId/designId）
 *   + 可选绑定 JSON（ElementBindings[]）；只用冻结 contracts 校验，不自定义 HTTP 形状；
 * - **只有显式点击「生成装配方案」才 POST** `/v1/matching/plans`，Bearer 取当前 session；
 * - 会话/上下文/规则/元素/绑定任意改动都取消在途请求并清理旧结果；提交前复核 token/subject，
 *   响应落地复核身份与 `inputDigest`（必须等于对完整请求的 `manifestDigest`）；
 * - 未知字段与重复映射/实例在本地拒绝（只渲染安全字段路径），未知 designId 交服务端报缺口；
 * - 不使用图片识别或大模型；不做三期代码安装；不回显服务端原始错误或 token；
 * - 保留既有项目上下文本地校验与人工文本检索（B1/B2/B3 行为不回退）。
 *
 * 选择器约定（实现时须一致，沿用既有 `#` 约定并新增）：
 * - 登录门：`#token-input`；上下文字段：`#framework-select` / `#framework-version-input` /
 *   `#echarts-version-input` / `#package-manager-select` / `#requirement-input` / `#context-submit`；
 * - 文本检索（保留）：`#search-query-input` / `#react-dom-version-input` / `#search-submit`；
 * - 设计 ID 配置：`#design-match`、`#design-mapping-input`、`#design-instance-input`、
 *   `#design-design-id-input`、「添加元素」、`#design-elements-list`、`.design-element-row`、
 *   `.design-element-instance`、`.design-element-id`、「删除」、`#design-bindings-input`、
 *   `#design-submit`、`#design-unconfigured`、`#design-input-errors`；
 * - 方案态：`#design-loading`、`#design-error`、`#design-empty`、`#design-plan`、
 *   `#design-plan-digest`、`#design-dependencies`、`.plan-element`、`.plan-element-instance`、
 *   `.plan-element-design-id`、`.plan-element-status`、`.plan-target`、`.plan-gap`。
 *
 * 说明：宿主 RED 时设计 ID 输入区尚未实现，相关用例因缺元素失败；表单入口用例同时断言
 * HTTP 200，避免被 404 页面自带内容误判为通过。
 */

const MATCH_URL = 'http://127.0.0.1:5177/match';
const PLAN_PATH = '/v1/matching/plans';
const AUTH_KEY = 'zhinexus_console_auth';

const DESIGN_ID = '设计/Line';
const MAPPING_JSON = JSON.stringify({
  schemaVersion: 1,
  ruleSetId: 'library',
  revision: 'draft-1',
  entries: [{ designId: DESIGN_ID, framework: 'react', variantReleaseId: '00000000-0000-4000-8000-000000000001' }],
});

/** 依据元素清单构造页面应发出的完整请求（用于核对载荷与 inputDigest）。 */
const requestFor = (elements: { instanceId: string; designId: string }[]) => ({
  design: {
    schemaVersion: 1 as const,
    mapping: JSON.parse(MAPPING_JSON) as unknown,
    elements,
  },
  context: {
    framework: 'react' as const,
    frameworkVersion: '19.3.1',
    packageManager: 'pnpm' as const,
    requirements: [] as string[],
  },
});

/** 页面在填充上述表单后应发出的完整请求（用于核对载荷与 inputDigest）。 */
const expectedRequest = requestFor([{ instanceId: 'node-1', designId: DESIGN_ID }]);

const target = (framework: 'react' | 'vue' = 'react') => ({
  variantReleaseId: '00000000-0000-4000-8000-000000000001',
  variantId: 'line-react',
  componentId: 'line',
  framework,
  packageName: '@company/charts-react',
  packageVersion: '0.0.10',
  packageSha256: 'b'.repeat(64),
  exportName: 'LineChart',
  exportPath: './line',
  evidence: [
    { kind: 'api', path: 'api/line.json', sha256: 'c'.repeat(64) },
    { kind: 'docs', path: 'docs/line.md', sha256: 'd'.repeat(64) },
  ],
  compatibility: { status: 'unverified', recordIds: [] },
  examples: [{ id: 'example', previewEntry: 'preview/index.html' }],
  styleExport: './style.css',
  readyMethod: 'whenRendered',
  notes: [] as string[],
});

/** 依据当前输入签发 inputDigest 的合法方案（React 框架，与上下文一致）。 */
async function planFor(
  digest: string,
  elements: unknown[],
  gaps: unknown[] = [],
  dependencies: { name: string; version: string }[] = [{ name: '@company/charts-react', version: '0.0.10' }],
): Promise<Record<string, unknown>> {
  return {
    schemaVersion: 1,
    source: 'design-id',
    inputDigest: digest,
    ruleSetId: 'library',
    revision: 'draft-1',
    context: expectedRequest.context,
    elements,
    exactDependencies: dependencies,
    gaps,
  };
}

const mappedElement = (instanceId: string, designId = DESIGN_ID) => ({
  instanceId,
  designId,
  status: 'mapped',
  target: target(),
  props: [{ name: 'data', type: 'ChartData', required: true }],
  events: [{ name: 'onPointClick', payload: 'ChartEvent' }],
  gaps: [{ code: 'COMPATIBILITY_UNVERIFIED', message: '缺少实测兼容记录' }, {code:'MISSING_PROP',message:'缺数据'}, {code:'MISSING_EVENT',message:'缺事件'}, {code:'LAYOUT_UNKNOWN',message:'缺布局'}],
});

const gapElement = (instanceId: string, designId: string) => ({
  instanceId,
  designId,
  status: 'gap',
  props: [],
  events: [],
  gaps: [{ code: 'UNMAPPED_ID', message: '没有为该设计 ID 配置当前框架的发布' }],
});

async function seedConsoleSession(page: Page, subject = 'phase2-design'): Promise<void> {
  await page.addInitScript(({ key, subject: sub }: { key: string; subject: string }) => {
    window.localStorage.setItem(
      key,
      JSON.stringify({ token: 'phase2-design-token', subject: sub, roles: [], channel: 'web' }),
    );
  }, { key: AUTH_KEY, subject });
}

function trackPlanRequests(page: Page): string[] {
  const hits: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes(PLAN_PATH)) hits.push(request.url());
  });
  return hits;
}

async function fillContext(page: Page): Promise<void> {
  await page.locator('#framework-select').selectOption('react');
  await page.locator('#framework-version-input').fill('19.3.1');
  await page.locator('#package-manager-select').selectOption('pnpm');
}

async function fillMapping(page: Page, raw: string = MAPPING_JSON): Promise<void> {
  await page.locator('#design-mapping-input').fill(raw);
}

async function addElement(page: Page, instanceId: string, designId: string = DESIGN_ID): Promise<void> {
  await page.locator('#design-instance-input').fill(instanceId);
  await page.locator('#design-design-id-input').fill(designId);
  await page.getByRole('button', { name: '添加元素' }).click();
}

/** 挂载一个可延迟释放的匹配端点，便于构造在途请求。 */
async function deferPlanRoute(page: Page, body: unknown): Promise<() => void> {
  let release: () => void = () => {};
  await page.route(`**${PLAN_PATH}`, async (route) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return () => release();
}

test.describe('二期 /match 设计 ID 配置与装配方案', () => {
  test('登录门展示设计 ID 配置与元素清单，并保留人工文本检索', async ({ page }) => {
    await seedConsoleSession(page);
    const response = await page.goto(MATCH_URL);
    expect(response?.status()).toBe(200);

    await expect(page.locator('#design-match')).toBeVisible();
    await expect(page.locator('#design-mapping-input')).toBeVisible();
    await expect(page.locator('#design-instance-input')).toBeVisible();
    await expect(page.locator('#design-design-id-input')).toBeVisible();
    await expect(page.locator('#design-bindings-input')).toBeVisible();
    await expect(page.locator('#design-submit')).toBeVisible();

    // 既有能力不回退：本地上下文校验与人工文本检索仍在
    await expect(page.locator('#context-submit')).toBeVisible();
    await expect(page.locator('#search-query-input')).toBeVisible();
    await expect(page.locator('#search-submit')).toBeVisible();
  });

  test('未登录时不暴露设计 ID 配置', async ({ page }) => {
    await page.goto(MATCH_URL);
    await expect(page.getByRole('heading', { name: /登录后开放/ })).toBeVisible();
    await expect(page.locator('#design-match')).toHaveCount(0);
    await expect(page.locator('#design-mapping-input')).toHaveCount(0);
  });

  test('空配置与空元素显示尚未配置，不得称为匹配成功', async ({ page }) => {
    await seedConsoleSession(page);
    const response = await page.goto(MATCH_URL);
    expect(response?.status()).toBe(200);

    await expect(page.locator('#design-unconfigured')).toBeVisible();
    await expect(page.locator('#design-plan')).toHaveCount(0);
    const text = (await page.locator('#design-match').textContent()) ?? '';
    expect(text).not.toContain('匹配成功');
    expect(text).not.toContain('已就绪');
    expect(text).not.toContain('可安装');
  });

  test('规则 JSON 语法错误：本地拒绝、不发请求、保留用户输入', async ({ page }) => {
    await seedConsoleSession(page);
    const hits = trackPlanRequests(page);
    await page.goto(MATCH_URL);
    await fillContext(page);

    await fillMapping(page, '{"schemaVersion":1,');
    await addElement(page, 'node-1');
    await page.locator('#design-submit').click();

    await expect(page.locator('#design-input-errors')).toBeVisible();
    expect(hits).toEqual([]);
    await expect(page.locator('#design-mapping-input')).toHaveValue('{"schemaVersion":1,');
    await expect(page.locator('#design-input-errors')).toContainText('规则 JSON');
  });

  test('规则 JSON 未知字段：本地拒绝并给出安全字段路径', async ({ page }) => {
    await seedConsoleSession(page);
    const hits = trackPlanRequests(page);
    await page.goto(MATCH_URL);
    await fillContext(page);

    const withUnknown = JSON.stringify({ ...JSON.parse(MAPPING_JSON), ocrText: 'screenshot' });
    await fillMapping(page, withUnknown);
    await addElement(page, 'node-1');
    await page.locator('#design-submit').click();

    await expect(page.locator('#design-input-errors')).toContainText('/ocrText');
    expect(hits).toEqual([]);
  });

  test('重复映射（即使目标相同）本地拒绝，指向具体条目路径', async ({ page }) => {
    await seedConsoleSession(page);
    const hits = trackPlanRequests(page);
    await page.goto(MATCH_URL);
    await fillContext(page);

    const parsed = JSON.parse(MAPPING_JSON) as { entries: unknown[] };
    parsed.entries.push({ ...(parsed.entries[0] as object) });
    await fillMapping(page, JSON.stringify(parsed));
    await addElement(page, 'node-1');
    await page.locator('#design-submit').click();

    await expect(page.locator('#design-input-errors')).toContainText('/mapping/entries/1/designId');
    expect(hits).toEqual([]);
    // 用户输入不被静默丢弃
    await expect(page.locator('#design-mapping-input')).not.toHaveValue('');
  });

  test('重复 instanceId 本地拒绝，指向具体元素路径', async ({ page }) => {
    await seedConsoleSession(page);
    const hits = trackPlanRequests(page);
    await page.goto(MATCH_URL);
    await fillContext(page);
    await fillMapping(page);

    await addElement(page, 'node-1');
    await addElement(page, 'node-1', 'other');
    await page.locator('#design-submit').click();

    await expect(page.locator('#design-input-errors')).toContainText('/elements/1/instanceId');
    expect(hits).toEqual([]);
  });

  test('未知 designId 不被本地拒绝：允许提交并交给服务端报告缺口', async ({ page }) => {
    const unknownRequest = requestFor([{ instanceId: 'node-1', designId: 'unconfigured' }]);
    await page.route(`**${PLAN_PATH}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(await planFor(await manifestDigest(unknownRequest), [gapElement('node-1', 'unconfigured')])),
      });
    });
    await seedConsoleSession(page);
    const hits = trackPlanRequests(page);
    await page.goto(MATCH_URL);
    await fillContext(page);
    await fillMapping(page);

    await addElement(page, 'node-1', 'unconfigured');
    await page.locator('#design-submit').click();

    await expect(page.locator('#design-plan')).toBeVisible();
    expect(hits).toHaveLength(1);
    await expect(page.locator('.plan-element-status')).toContainText('gap');
    await expect(page.locator('.plan-gap')).toContainText('UNMAPPED_ID');
    await expect(page.locator('.plan-target')).toHaveCount(0);
  });

  test('只有显式点击才 POST；编辑规则/元素/上下文/绑定均不触发请求', async ({ page }) => {
    await page.route(`**${PLAN_PATH}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(await planFor(await manifestDigest(expectedRequest), [mappedElement('node-1')])),
      });
    });
    await seedConsoleSession(page);
    const hits = trackPlanRequests(page);
    await page.goto(MATCH_URL);
    await fillContext(page);
    await fillMapping(page);
    await addElement(page, 'node-1');

    // 本地校验与各类编辑都不得触发匹配请求
    await page.locator('#context-submit').click();
    await expect(page.locator('#context-success')).toBeVisible();
    await page.locator('#design-mapping-input').fill(`${MAPPING_JSON} `);
    await page.locator('#framework-version-input').fill('19.3.1');
    await page.locator('#design-bindings-input').fill('[]');
    expect(hits).toEqual([]);

    await page.locator('#design-submit').click();
    await expect(page.locator('#design-plan')).toBeVisible();
    expect(hits).toHaveLength(1);
  });

  test('请求体只含冻结契约字段，Bearer 取当前会话，不夹带模型/OCR 数据', async ({ page }) => {
    await page.route(`**${PLAN_PATH}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(await planFor(await manifestDigest(expectedRequest), [mappedElement('node-1')])),
      });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillContext(page);
    await fillMapping(page);
    await addElement(page, 'node-1');

    const request = page.waitForRequest((item) => item.url().includes(PLAN_PATH) && item.method() === 'POST');
    await page.locator('#design-submit').click();
    const captured = await request;

    const headers = await captured.allHeaders();
    expect(headers.authorization).toBe('Bearer phase2-design-token');
    const body = (await captured.postDataJSON()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['context', 'design']);
    for (const forbidden of ['model', 'ocr', 'ocrText', 'screenshot', 'prompt', 'image', 'query']) {
      expect(Object.prototype.hasOwnProperty.call(body, forbidden)).toBe(false);
    }
  });

  test('可选绑定 JSON 合法时随请求发送', async ({ page }) => {
    await page.route(`**${PLAN_PATH}`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await planFor('0'.repeat(64), [])) });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillContext(page);
    await fillMapping(page);
    await addElement(page, 'node-1');

    const bindings = [{ instanceId: 'node-1', props: [{ name: 'data', source: 'sales' }], events: [{ name: 'onPointClick', handler: 'showDetail' }], layout: 'grid cell 1' }];
    await page.locator('#design-bindings-input').fill(JSON.stringify(bindings));

    const request = page.waitForRequest((item) => item.url().includes(PLAN_PATH) && item.method() === 'POST');
    await page.locator('#design-submit').click();
    const captured = await request;
    const body = (await captured.postDataJSON()) as Record<string, unknown>;
    expect(body.bindings).toEqual(bindings);
  });

  test('绑定 JSON 非法时本地拒绝且不发请求', async ({ page }) => {
    await seedConsoleSession(page);
    const hits = trackPlanRequests(page);
    await page.goto(MATCH_URL);
    await fillContext(page);
    await fillMapping(page);
    await addElement(page, 'node-1');

    await page.locator('#design-bindings-input').fill('{not json');
    await page.locator('#design-submit').click();

    await expect(page.locator('#design-input-errors')).toBeVisible();
    expect(hits).toEqual([]);
  });

  test('绑定引用不存在实例时本地拒绝，给出 /bindings 路径', async ({ page }) => {
    await seedConsoleSession(page);
    const hits = trackPlanRequests(page);
    await page.goto(MATCH_URL);
    await fillContext(page);
    await fillMapping(page);
    await addElement(page, 'node-1');

    await page.locator('#design-bindings-input').fill(JSON.stringify([{ instanceId: 'ghost', props: [], events: [] }]));
    await page.locator('#design-submit').click();

    await expect(page.locator('#design-input-errors')).toContainText('/bindings/0/instanceId');
    expect(hits).toEqual([]);
  });

  test('同一 designId 多实例复用：每个实例独立成行，不按 designId 合并', async ({ page }) => {
    const multiRequest = requestFor([
      { instanceId: 'node-1', designId: DESIGN_ID },
      { instanceId: 'node-2', designId: DESIGN_ID },
      { instanceId: 'node-3', designId: DESIGN_ID },
    ]);
    const digest = await manifestDigest(multiRequest);
    await page.route(`**${PLAN_PATH}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(await planFor(digest, [mappedElement('node-1'), mappedElement('node-2'), mappedElement('node-3')])),
      });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillContext(page);
    await fillMapping(page);
    await addElement(page, 'node-1');
    await addElement(page, 'node-2');
    await addElement(page, 'node-3');
    await expect(page.locator('#design-elements-list .design-element-row')).toHaveCount(3);

    await page.locator('#design-submit').click();

    await expect(page.locator('.plan-element')).toHaveCount(3);
    await expect(page.locator('.plan-element-instance')).toHaveText(['node-1', 'node-2', 'node-3']);
    await expect(page.locator('.plan-target')).toHaveCount(3);
  });

  test('mapped 元素展示真实目标与证据，不编造链接', async ({ page }) => {
    const digest = await manifestDigest(expectedRequest);
    await page.route(`**${PLAN_PATH}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(await planFor(digest, [mappedElement('node-1')])),
      });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillContext(page);
    await fillMapping(page);
    await addElement(page, 'node-1');
    await page.locator('#design-submit').click();

    const element = page.locator('.plan-element').first();
    await expect(element.locator('.plan-element-status')).toContainText('mapped');
    await expect(element.locator('.plan-target')).toContainText('@company/charts-react@0.0.10');
    await expect(element.locator('.plan-target')).toContainText('LineChart');
    await expect(element.locator('.plan-target')).toContainText('./line');
    await expect(element.locator('.plan-target')).toContainText('api/line.json');
    await expect(element.locator('.plan-target')).toContainText('docs/line.md');
    await expect(element.locator('.plan-target')).toContainText('unverified');
    await expect(page.locator('#design-dependencies')).toContainText('@company/charts-react@0.0.10');
    // 证据只以文本呈现，不生成可点击的伪造证据链接
    await expect(page.locator('#design-plan a')).toHaveCount(0);
  });

  test('inputDigest 与当前输入一致时展示方案并显示摘要', async ({ page }) => {
    const digest = await manifestDigest(expectedRequest);
    await page.route(`**${PLAN_PATH}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(await planFor(digest, [mappedElement('node-1')])),
      });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillContext(page);
    await fillMapping(page);
    await addElement(page, 'node-1');
    await page.locator('#design-submit').click();

    await expect(page.locator('#design-plan')).toBeVisible();
    await expect(page.locator('#design-plan-digest')).toContainText(digest.slice(0, 12));
  });

  test('inputDigest 与当前输入不一致：旧响应被忽略，不挂载方案', async ({ page }) => {
    await page.route(`**${PLAN_PATH}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(await planFor('a'.repeat(64), [mappedElement('node-1')])),
      });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillContext(page);
    await fillMapping(page);
    await addElement(page, 'node-1');
    await page.locator('#design-submit').click();

    await expect(page.locator('#design-plan')).toHaveCount(0);
    await expect(page.locator('#design-error')).toBeVisible();
    await expect(page.locator('.plan-element')).toHaveCount(0);
  });

  test('空设计响应带 EMPTY_DESIGN 缺口时展示诚实空态', async ({ page }) => {
    const emptyRequest = { design: { ...expectedRequest.design, elements: [] }, context: expectedRequest.context };
    const digest = await manifestDigest(emptyRequest);
    await page.route(`**${PLAN_PATH}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(await planFor(digest, [], [{ code: 'EMPTY_DESIGN', message: '尚未配置任何设计元素' }], [])),
      });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillContext(page);
    await fillMapping(page);
    await page.locator('#design-submit').click();

    await expect(page.locator('#design-empty')).toBeVisible();
    await expect(page.locator('#design-empty')).toContainText('EMPTY_DESIGN');
    await expect(page.locator('#design-plan')).toHaveCount(0);
  });

  test('401/403 提示重新登录，不回显 token 或服务端原文', async ({ page }) => {
    for (const status of [401, 403]) {
      await page.route(`**${PLAN_PATH}`, async (route) => {
        await route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'FORBIDDEN', message: 'denied for phase2-design-token', details: [], requestId: 'req-1' }),
        });
      });
      await seedConsoleSession(page);
      await page.goto(MATCH_URL);
      await fillContext(page);
      await fillMapping(page);
      await addElement(page, 'node-1');
      await page.locator('#design-submit').click();

      await expect(page.locator('#design-error')).toBeVisible();
      const text = (await page.locator('#design-error').textContent()) ?? '';
      expect(text).not.toContain('phase2-design-token');
      expect(text).not.toContain('Bearer');
      expect(text).not.toContain('denied');
      expect(text).not.toContain('FORBIDDEN');
    }
  });

  test('服务端 5xx 与非法响应都只显示固定文案，不回显原文或输入键名', async ({ page }) => {
    await page.route(`**${PLAN_PATH}`, async (route) => {
      await route.fulfill({ status: 500, contentType: 'text/plain', body: 'upstream boom: secret' });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillContext(page);
    await fillMapping(page);
    await addElement(page, 'node-1');
    await page.locator('#design-submit').click();

    let text = (await page.locator('#design-error').textContent()) ?? '';
    expect(text).not.toContain('upstream boom');
    expect(text).not.toContain('secret');

    const broken = await planFor(await manifestDigest(expectedRequest), [mappedElement('node-1')]);
    delete broken.exactDependencies;
    await page.route(`**${PLAN_PATH}`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(broken) });
    });
    await page.locator('#design-submit').click();

    await expect(page.locator('#design-error')).toBeVisible();
    text = (await page.locator('#design-error').textContent()) ?? '';
    expect(text).not.toContain('exactDependencies');
    expect(text).not.toContain('Required field is missing');
    await expect(page.locator('#design-plan')).toHaveCount(0);
  });

  test('编辑规则 JSON 取消在途请求并清理结果，迟到响应不回显', async ({ page }) => {
    const release = await deferPlanRoute(page, await planFor(await manifestDigest(expectedRequest), [mappedElement('node-1')]));
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillContext(page);
    await fillMapping(page);
    await addElement(page, 'node-1');
    await page.locator('#design-submit').click();
    await expect(page.locator('#design-loading')).toBeVisible();

    await fillMapping(page, `${MAPPING_JSON} `);
    await expect(page.locator('#design-loading')).toHaveCount(0);

    release();
    await page.waitForTimeout(300);
    await expect(page.locator('#design-plan')).toHaveCount(0);
    await expect(page.locator('.plan-element')).toHaveCount(0);
  });

  test('增删元素取消在途请求并清理结果', async ({ page }) => {
    const release = await deferPlanRoute(page, await planFor(await manifestDigest(expectedRequest), [mappedElement('node-1')]));
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillContext(page);
    await fillMapping(page);
    await addElement(page, 'node-1');
    await page.locator('#design-submit').click();
    await expect(page.locator('#design-loading')).toBeVisible();

    await addElement(page, 'node-2');
    await expect(page.locator('#design-loading')).toHaveCount(0);
    await page.locator('#design-elements-list').getByRole('button', { name: '删除' }).first().click();
    await expect(page.locator('#design-elements-list .design-element-row')).toHaveCount(1);
    await expect(page.locator('#design-elements-list .design-element-instance')).toHaveText('node-2');

    release();
    await page.waitForTimeout(300);
    await expect(page.locator('#design-plan')).toHaveCount(0);
  });

  test('编辑上下文字段取消在途请求并清理结果', async ({ page }) => {
    const release = await deferPlanRoute(page, await planFor(await manifestDigest(expectedRequest), [mappedElement('node-1')]));
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillContext(page);
    await fillMapping(page);
    await addElement(page, 'node-1');
    await page.locator('#design-submit').click();
    await expect(page.locator('#design-loading')).toBeVisible();

    await page.locator('#framework-version-input').fill('19.3.2');
    await expect(page.locator('#design-loading')).toHaveCount(0);

    release();
    await page.waitForTimeout(300);
    await expect(page.locator('#design-plan')).toHaveCount(0);
  });
  test('React DOM精确版本随装配请求发送，编辑后清除旧结果', async ({ page }) => {
    let received: Record<string, unknown> | undefined;
    await page.route(`**${PLAN_PATH}`, async route => {
      received = route.request().postDataJSON();
      await route.fulfill({json:await planFor(await manifestDigest(received),[mappedElement('node-1')])});
    });
    await seedConsoleSession(page); await page.goto(MATCH_URL); await fillContext(page); await fillMapping(page); await addElement(page,'node-1');
    await page.locator('#react-dom-version-input').fill('19.3.1'); await page.locator('#design-submit').click();
    await expect(page.locator('#design-plan')).toBeVisible(); expect(received?.reactDomVersion).toBe('19.3.1');
    await page.locator('#react-dom-version-input').fill('19.3.0'); await expect(page.locator('#design-plan')).toHaveCount(0);
  });
  test('未添加的元素或需求草稿不允许静默忽略提交', async ({ page }) => {
    let requests=0; await page.route(`**${PLAN_PATH}`,async route=>{requests++;await route.fulfill({json:{}});});
    await seedConsoleSession(page);await page.goto(MATCH_URL);await fillContext(page);await fillMapping(page);await addElement(page,'node-1');
    await page.locator('#design-instance-input').fill('unfinished');await page.locator('#design-submit').click();
    await expect(page.locator('#design-error')).toBeVisible();expect(requests).toBe(0);
    await page.locator('#design-instance-input').fill('');await page.locator('#requirement-input').fill('待添加需求');await page.locator('#design-submit').click();
    await expect(page.locator('#design-error')).toBeVisible();expect(requests).toBe(0);
  });
  test('展示API参数事件绑定与布局、样式、就绪约定和限制', async ({ page }) => {
    const element=mappedElement('node-1'); element.target.notes=['仅允许单系列'];
    await page.route(`**${PLAN_PATH}`,async route=>route.fulfill({json:await planFor(await manifestDigest(route.request().postDataJSON()),[element])}));
    await seedConsoleSession(page);await page.goto(MATCH_URL);await fillContext(page);await fillMapping(page);await addElement(page,'node-1');await page.locator('#design-submit').click();
    await expect(page.locator('#design-plan')).toContainText('ChartData');await expect(page.locator('#design-plan')).toContainText('onPointClick');
    await expect(page.locator('#design-plan')).toContainText('whenRendered');await expect(page.locator('#design-plan')).toContainText('./style.css');
    await expect(page.locator('#design-plan')).toContainText('仅允许单系列');
  });

  test('编辑绑定 JSON 取消在途请求并清理结果', async ({ page }) => {
    const release = await deferPlanRoute(page, await planFor(await manifestDigest(expectedRequest), [mappedElement('node-1')]));
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillContext(page);
    await fillMapping(page);
    await addElement(page, 'node-1');
    await page.locator('#design-bindings-input').fill('[]');
    await page.locator('#design-submit').click();
    await expect(page.locator('#design-loading')).toBeVisible();

    await page.locator('#design-bindings-input').fill(
      JSON.stringify([{ instanceId: 'node-1', props: [{ name: 'data', source: 'other' }], events: [] }]),
    );
    await expect(page.locator('#design-loading')).toHaveCount(0);

    release();
    await page.waitForTimeout(300);
    await expect(page.locator('#design-plan')).toHaveCount(0);
  });

  test('退出登录回退登录门，且不残留方案或加载态', async ({ page }) => {
    const release = await deferPlanRoute(page, await planFor(await manifestDigest(expectedRequest), [mappedElement('node-1')]));
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillContext(page);
    await fillMapping(page);
    await addElement(page, 'node-1');
    await page.locator('#design-submit').click();
    await expect(page.locator('#design-loading')).toBeVisible();

    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.getByRole('heading', { name: /登录后开放/ })).toBeVisible();

    release();
    await page.waitForTimeout(300);
    await expect(page.locator('#design-plan')).toHaveCount(0);
    await expect(page.locator('#design-loading')).toHaveCount(0);
  });

  test('同页改写 token 后再点击：提交前复核会话，不发请求并清理', async ({ page }) => {
    const hits = trackPlanRequests(page);
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillContext(page);
    await fillMapping(page);
    await addElement(page, 'node-1');

    await page.evaluate((key: string) => {
      const raw = window.localStorage.getItem(key);
      const session = raw ? JSON.parse(raw) : {};
      window.localStorage.setItem(key, JSON.stringify({ ...session, token: 'rotated-token' }));
    }, AUTH_KEY);

    await page.locator('#design-submit').click();

    expect(hits).toEqual([]);
    await expect(page.getByRole('heading', { name: /登录后开放/ })).toBeVisible();
    await expect(page.locator('#design-loading')).toHaveCount(0);
  });

  test('同 subject 换 token：响应落地前复核身份，旧身份结果被清理', async ({ page }) => {
    await page.route(`**${PLAN_PATH}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(await planFor(await manifestDigest(expectedRequest), [mappedElement('node-1')])),
      });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillContext(page);
    await fillMapping(page);
    await addElement(page, 'node-1');
    await page.locator('#design-submit').click();
    await expect(page.locator('#design-plan')).toBeVisible();

    await page.evaluate((key: string) => {
      window.localStorage.setItem(key, JSON.stringify({ token: 'rotated-token', subject: 'phase2-design', roles: [], channel: 'web' }));
      window.dispatchEvent(new Event('focus'));
    }, AUTH_KEY);

    await expect(page.getByRole('heading', { name: /登录后开放/ })).toBeVisible();
    await expect(page.locator('#design-plan')).toHaveCount(0);
    await expect(page.locator('#design-loading')).toHaveCount(0);
  });

  test('另一标签页改写会话（storage 事件）后取消并清理，旧身份不回显', async ({ page, context }) => {
    const release = await deferPlanRoute(page, await planFor(await manifestDigest(expectedRequest), [mappedElement('node-1')]));
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillContext(page);
    await fillMapping(page);
    await addElement(page, 'node-1');
    await page.locator('#design-submit').click();
    await expect(page.locator('#design-loading')).toBeVisible();

    const other = await context.newPage();
    await other.goto(MATCH_URL);
    await other.evaluate((key: string) => {
      window.localStorage.setItem(key, JSON.stringify({ token: 'other-token', subject: 'identity-b', roles: [], channel: 'web' }));
    }, AUTH_KEY);
    await other.close();

    await expect(page.getByRole('heading', { name: /登录后开放/ })).toBeVisible();
    await expect(page.locator('#design-loading')).toHaveCount(0);

    release();
    await page.waitForTimeout(300);
    await expect(page.locator('#design-plan')).toHaveCount(0);
  });

  test('designId 仅按文本转义呈现，不生成可执行标签', async ({ page }) => {
    const escaped = '<img src=x onerror=alert(1)>';
    const escapedRequest = requestFor([{ instanceId: 'node-1', designId: escaped }]);
    const digest = await manifestDigest(escapedRequest);
    await page.route(`**${PLAN_PATH}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(await planFor(digest, [gapElement('node-1', escaped)])),
      });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillContext(page);
    await fillMapping(page);
    await addElement(page, 'node-1', escaped);
    await page.locator('#design-submit').click();

    await expect(page.locator('.plan-element-design-id').first()).toContainText('<img src=x onerror=alert(1)>');
    await expect(page.locator('#design-match img')).toHaveCount(0);
  });

  test('窄屏 375px 不横向溢出', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await seedConsoleSession(page);
    const response = await page.goto(MATCH_URL);
    expect(response?.status()).toBe(200);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('界面不使用模型/OCR/视觉匹配表述，也不持久化设计配置', async ({ page }) => {
    await page.route(`**${PLAN_PATH}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(await planFor(await manifestDigest(expectedRequest), [mappedElement('node-1')])),
      });
    });
    await seedConsoleSession(page);
    await page.goto(MATCH_URL);
    await fillContext(page);
    await fillMapping(page);
    await addElement(page, 'node-1');
    await page.locator('#design-submit').click();
    await expect(page.locator('#design-plan')).toBeVisible();

    const text = (await page.locator('#design-match').textContent()) ?? '';
    for (const forbidden of ['模型', 'OCR', '视觉匹配', '智能推荐', '训练']) {
      expect(text).not.toContain(forbidden);
    }

    const keys = await page.evaluate(() => Object.keys(window.localStorage));
    expect(keys.filter((key) => /design|mapping|binding|plan/i.test(key))).toEqual([]);
  });
});
