import { expect, test } from '@playwright/test';

test('public gallery content and metadata are present in the initial HTML', async ({ page }) => {
  const response = await page.goto('http://127.0.0.1:5173/components');
  expect(response).not.toBeNull();
  const html = await response!.text();

  expect(html).toContain('Zhinexus 组件资产平台');
  expect(html).toContain('公开组件目录正在建设中');
  await expect(page).toHaveTitle(/组件目录.*Zhinexus/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Vue.*React/);
});

test('console placeholder is marked noindex and excluded from the sitemap', async ({ page, request }) => {
  const response = await page.goto('http://127.0.0.1:5173/upload');
  expect(response).not.toBeNull();
  const html = await response!.text();

  expect(html).toContain('登录后开放');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  const sitemap = await request.get('http://127.0.0.1:5173/sitemap.xml');
  const sitemapXml = await sitemap.text();
  expect(sitemap.status()).toBe(200);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (siteUrl) {
    expect(sitemapXml).toContain(new URL('/components', siteUrl).toString());
    expect(sitemapXml).toContain(new URL('/', siteUrl).toString());
  } else {
    expect(sitemapXml).not.toContain('<loc>');
  }
  expect(sitemapXml).not.toContain('/upload');
});

test('component detail paths stay unavailable until public catalog data exists', async ({ request }) => {
  const response = await request.get('http://127.0.0.1:5173/components/not-published');
  expect(response.status()).toBe(404);
});

test('component detail renders status, framework switch, code, and sandbox iframe for line chart', async ({ page }) => {
  const response = await page.goto('http://127.0.0.1:5173/components/line');
  expect(response).not.toBeNull();
  expect(response!.status()).toBe(200);

  // 1. 验证标题与元数据
  await expect(page).toHaveTitle(/折线图.*LineChart.*组件详情/);
  await expect(page.locator('h1')).toContainText('折线图 (LineChart)');

  // 2. 状态看板展示
  const statusGrid = page.locator('.status-grid');
  await expect(statusGrid).toContainText('Ready');
  await expect(statusGrid).toContainText('local-automatic');
  await expect(statusGrid).toContainText('accepted');
  await expect(statusGrid).toContainText('indexed');
  await expect(statusGrid).toContainText('@company/charts-vue@0.0.4');

  // 3. 隔离预览 iframe 校验
  const iframe = page.locator('iframe.preview-frame');
  await expect(iframe).toHaveCount(1);
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
  await expect(iframe).toHaveAttribute('src', 'http://127.0.0.1:5174/index.html');
  await expect(page.locator('.shield-badge')).toContainText('独立域沙箱安全隔离');

  // 4. 框架切换至 React 19
  const reactTab = page.getByRole('tab', { name: /React 19/ });
  await reactTab.click();

  // 切换后包名与状态同步变更
  await expect(statusGrid).toContainText('@company/charts-react@0.0.4');
  await expect(page.locator('.code-section')).toContainText("import { LineChart } from '@company/charts-react/line';");
  await expect(page.locator('.code-section')).toContainText('pnpm add @company/charts-react');
  await expect(page.locator('iframe.preview-frame')).toHaveAttribute('src', 'http://127.0.0.1:5175/index.html');

  // 5. API 规范表展示
  await expect(page.locator('.spec-table')).toHaveCount(2);
  await expect(page.locator('.spec-table').first()).toContainText('data');
  await expect(page.locator('.spec-table').first()).toContainText('ChartData');
  await expect(page.locator('.spec-table').first()).toContainText('LineChartConfig');
});

test('component detail covers bar, pie, and scatter charts', async ({ page }) => {
  // 柱状图
  await page.goto('http://127.0.0.1:5173/components/bar');
  await expect(page.locator('h1')).toContainText('柱状图 (BarChart)');
  await expect(page.locator('iframe.preview-frame')).toHaveAttribute('src', 'http://127.0.0.1:5174/bar.html');

  // 饼图
  await page.goto('http://127.0.0.1:5173/components/pie');
  await expect(page.locator('h1')).toContainText('饼图 / 环形图 (PieChart)');
  await expect(page.locator('iframe.preview-frame')).toHaveAttribute('src', 'http://127.0.0.1:5174/pie.html');

  // 散点图
  await page.goto('http://127.0.0.1:5173/components/scatter');
  await expect(page.locator('h1')).toContainText('散点图 (ScatterChart)');
  await expect(page.locator('iframe.preview-frame')).toHaveAttribute('src', 'http://127.0.0.1:5174/scatter.html');
});

test('catalog viewer allows viewing and filtering preset components', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/components');
  
  // 点击浏览官方预置资产规范
  const browseBtn = page.getByRole('button', { name: /浏览官方预置资产规范/ });
  await browseBtn.click();

  // 出现 4 个组件卡片
  await expect(page.locator('.component-card')).toHaveCount(4);
  await expect(page.locator('.component-card')).toContainText(['折线图', '柱状图', '饼图', '散点图']);

  // 按框架筛选 Vue 3
  await page.getByRole('button', { name: 'Vue 3' }).click();
  await expect(page.locator('.component-card')).toHaveCount(4);

  // 搜索框过滤
  const searchInput = page.getByPlaceholder('搜索图表或组件名称...');
  await searchInput.fill('散点');
  await expect(page.locator('.component-card')).toHaveCount(1);
  await expect(page.locator('.component-card')).toContainText('散点图');
  await expect(page.locator('.component-card')).toContainText('ScatterChart');

  // 清空搜索
  await searchInput.fill('不存在的图表');
  await expect(page.locator('.component-card')).toHaveCount(0);
  await expect(page.locator('.empty-state')).toBeVisible();
});
