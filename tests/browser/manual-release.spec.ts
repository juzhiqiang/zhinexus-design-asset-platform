import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const MOCK_AUTH_TOKEN =
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ3ZWItZGV2ZWxvcGVyLWFsaWNlIiwicm9sZXMiOlsicHVibGlzaGVyIiwibWFpbnRhaW5lciJdLCJhenAiOiJ3ZWIiLCJleHAiOjE5OTk5OTk5OTl9.test_sig';

async function devLogin(page: Page) {
  await page.locator('#token-input').fill(MOCK_AUTH_TOKEN);
  await page.getByRole('button', { name: '凭证登录' }).click();
}

test.describe('T08: 网页手动发布与逐实现截图必检', () => {
  test('未登录用户访问发布工作区渲染登录后开放且带有 noindex 保护', async ({ page }) => {
    const response = await page.goto('http://127.0.0.1:5173/upload');
    expect(response).not.toBeNull();
    expect(response!.status()).toBe(200);

    // 1. 未登录渲染提示
    await expect(page.locator('h1')).toContainText('登录后开放');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('body')).toContainText('此处提供组件发布功能');
  });

  test('模拟登录后展示发布工作区与逐实现必检清单', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/upload');

    // 输入开发者凭据登录
    await devLogin(page);

    // 确认进入工作区
    await expect(page.locator('h1')).toContainText('资产发布工作区 (Manual Release)');
    await expect(page.locator('body')).toContainText('当前登录身份：web-developer-alice');
    await expect(page.locator('body')).toContainText('逐实现截图关联与必检清单');

    // 动态覆盖 7 组件 14 个实现变体
    const cards = page.locator('.variant-shot-card');
    await expect(cards).toHaveCount(14);
  });

  test('缺图阻断：任意变体缺图时禁止提交并展示明确错误提示 (blocks_submit_when_any_variant_has_no_image)', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/upload');
    await devLogin(page);

    const submitBtn = page.getByRole('button', { name: '确认并提交发布' });
    // 初始时从干净草稿启动，14 项实现全部无截图，提交按钮初始被禁用
    await expect(submitBtn).toBeDisabled();

    // 页面醒目展示阻断警告与全部 14 项缺失
    const blockerAlert = page.locator('.blocker-alert');
    await expect(blockerAlert).toBeVisible();
    await expect(blockerAlert).toContainText('阻断发布：存在未关联有效截图的组件实现');
    await expect(blockerAlert).toContainText('SCREENSHOT_REQUIRED');
    await expect(page.locator('.tag:has-text("未就绪")')).toContainText('缺图 14 项');

    // 为 bar-react 变体上传有效截图
    const barReactInput = page.locator('input[data-upload-shot="bar-react"]');
    await barReactInput.setInputFiles({
      name: 'bar-react-default.png',
      mimeType: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]),
    });

    // 变体状态更新为已关联，缺图数减少为 13 项，但仍未全部就绪，提交按钮仍然被禁用
    const barReactRow = page.locator('tr.variant-shot-card:has-text("bar-react")');
    await expect(barReactRow).toContainText('已关联 (manual-upload)');
    await expect(page.locator('.tag:has-text("未就绪")')).toContainText('缺图 13 项');
    await expect(submitBtn).toBeDisabled();

    // 点击删除截图按钮
    const removeBtn = page.locator('button[data-remove-shot="bar-react"]');
    await expect(removeBtn).toBeVisible();
    await removeBtn.click();

    // 恢复为 14 项缺失，提交按钮保持禁用
    await expect(barReactRow).toContainText('缺少有效展示截图');
    await expect(page.locator('.tag:has-text("未就绪")')).toContainText('缺图 14 项');
    await expect(submitBtn).toBeDisabled();
  });

  test('框架错配拦截：导入错配框架截图时前置阻断 (SCREENSHOT_VARIANT_MISMATCH)', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/upload');
    await devLogin(page);

    const submitBtn = page.getByRole('button', { name: '确认并提交发布' });
    await expect(submitBtn).toBeDisabled();

    // 构造将 React 截图错误赋给 Vue 变体的 manifest 清单
    const mismatchManifest = {
      schemaVersion: 1,
      channel: 'web',
      packages: [],
      variants: [
        {
          componentId: 'line',
          variantId: 'line-vue',
          framework: 'vue',
          packageName: '@company/charts-vue',
          packageVersion: '0.0.6',
          exportPath: './line',
          exportName: 'LineChart',
          api: { path: 'api/line-vue.json', sha256: '00', bytes: 10 },
          docs: { path: 'docs/line-vue.md', sha256: '00', bytes: 10 },
          examples: [
            {
              id: 'example-line-vue-default',
              previewEntry: 'preview/line-vue/index.html',
              previewFiles: [{ path: 'preview/line-vue/index.html', sha256: '00', bytes: 10 }],
              fixtureDigest: '0000000000000000000000000000000000000000000000000000000000000000',
              renderer: 'canvas',
              theme: 'light',
              width: 800,
              height: 400,
              requiredStates: ['default'],
            },
          ],
          screenshots: [
            {
              id: 'shot-line-vue-default',
              variantId: 'line-vue',
              framework: 'react', // 故意错误标记为 react 框架
              packageVersion: '0.0.6',
              packageSha256: '00',
              exampleId: 'example-line-vue-default',
              state: 'default',
              source: 'manual-upload',
              image: { path: 'screenshots/line-vue-default.png', sha256: '00', bytes: 10 },
              environmentKey: 'unknown-manual',
            },
          ],
          compatibility: [],
        },
      ],
      reports: [],
      files: [],
    };

    // 通过导入清单功能导入
    await page.locator('#import-manifest-input').setInputFiles({
      name: 'manifest.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(mismatchManifest)),
    });

    // 验证阻断提示明确指示 SCREENSHOT_VARIANT_MISMATCH
    const blockerAlert = page.locator('.blocker-alert');
    await expect(blockerAlert).toBeVisible();
    await expect(blockerAlert).toContainText('SCREENSHOT_VARIANT_MISMATCH');
    await expect(blockerAlert).toContainText('框架错配');
    await expect(submitBtn).toBeDisabled();
  });

  test('独立作业状态机页面支持 7 阶段步骤器展示与状态轮询', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/jobs/job-web-manual-001');

    await expect(page.locator('h1')).toContainText('发布作业流水线状态跟踪');
    await expect(page.locator('body')).toContainText('作业编号：job-web-manual-001');

    // 验证包含 7 阶段 steps
    const steps = page.locator('.pipeline-step');
    await expect(steps).toHaveCount(7);
    await expect(page.locator('body')).toContainText('FINALIZE_OBJECTS');
    await expect(page.locator('body')).toContainText('ENSURE_PACKAGES');
    await expect(page.locator('body')).toContainText('REGISTER_ASSETS');
    await expect(page.locator('body')).toContainText('CHECK_AVAILABILITY');
    await expect(page.locator('body')).toContainText('READY_TX');
    await expect(page.locator('body')).toContainText('READY');
  });

  test('断点恢复机制：当存在未完成的发布会话时展示恢复卡片并允许一键恢复', async ({ page }) => {
    // 预置 localStorage 断点数据
    await page.goto('http://127.0.0.1:5173/upload');
    await page.evaluate(() => {
      localStorage.setItem(
        'zhinexus_pending_release',
        JSON.stringify({
          idempotencyKey: 'web-resume-test-key-999',
          uploadSessionId: 'sess-resume-001',
          manifest: { channel: 'web', packages: [], variants: [], files: [], reports: [] },
          timestamp: Date.now(),
        }),
      );
    });

    // 重新进入并模拟登录
    await page.goto('http://127.0.0.1:5173/upload');
    await devLogin(page);

    // 验证出现恢复卡片
    await expect(page.locator('body')).toContainText('检测到未完成的发布请求');
    await expect(page.locator('body')).toContainText('web-resume-test-key-999');

    const resumeBtn = page.getByRole('button', { name: '恢复提交' });
    await expect(resumeBtn).toBeVisible();

    const abandonBtn = page.getByRole('button', { name: '放弃草稿' });
    await expect(abandonBtn).toBeVisible();
    await abandonBtn.click();

    // 放弃后卡片消失
    await expect(page.locator('body')).not.toContainText('web-resume-test-key-999');
  });

  test('支持界面选择本地图片替换截图并动态更新大小与摘要', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/upload');
    await devLogin(page);

    // 针对 line-vue 变体，触发文件选择
    const fileInput = page.locator('tr.variant-shot-card').first().locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'custom-line-shot.png',
      mimeType: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]),
    });

    // 验证更新为 10 字节
    const firstRow = page.locator('tr.variant-shot-card').first();
    await expect(firstRow).toContainText('10 字节');
    await expect(firstRow).toContainText('已关联 (manual-upload)');
  });

  test('上传接口失败时阻断提交流程并展示清晰错误提示', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/upload');
    await devLogin(page);

    const testBuf = Buffer.from('0123456789');
    const testSha = createHash('sha256').update(testBuf).digest('hex');

    // 构造包含单个有效变体的合规 manifest
    const validSingleManifest = {
      schemaVersion: 1,
      channel: 'web',
      packages: [],
      variants: [
        {
          componentId: 'line',
          variantId: 'line-vue',
          framework: 'vue',
          packageName: '@company/charts-vue',
          packageVersion: '0.0.6',
          exportPath: './line',
          exportName: 'LineChart',
          api: { path: 'api/line-vue.json', sha256: testSha, bytes: testBuf.byteLength },
          docs: { path: 'docs/line-vue.md', sha256: testSha, bytes: testBuf.byteLength },
          examples: [
            {
              id: 'example-line-vue-default',
              previewEntry: 'preview/line-vue/index.html',
              previewFiles: [{ path: 'preview/line-vue/index.html', sha256: testSha, bytes: testBuf.byteLength }],
              fixtureDigest: '0000000000000000000000000000000000000000000000000000000000000000',
              renderer: 'canvas',
              theme: 'light',
              width: 800,
              height: 400,
              requiredStates: ['default'],
            },
          ],
          screenshots: [
            {
              id: 'shot-line-vue-default',
              variantId: 'line-vue',
              framework: 'vue',
              packageVersion: '0.0.6',
              packageSha256: '00',
              exampleId: 'example-line-vue-default',
              state: 'default',
              source: 'manual-upload',
              image: { path: 'screenshots/line-vue-default.png', sha256: testSha, bytes: testBuf.byteLength },
              environmentKey: 'unknown-manual',
            },
          ],
          compatibility: [],
        },
      ],
      reports: [],
      files: [
        { path: 'screenshots/line-vue-default.png', sha256: testSha, bytes: testBuf.byteLength },
        { path: 'preview/line-vue/index.html', sha256: testSha, bytes: testBuf.byteLength },
        { path: 'docs/line-vue.md', sha256: testSha, bytes: testBuf.byteLength },
        { path: 'api/line-vue.json', sha256: testSha, bytes: testBuf.byteLength },
      ],
    };

    // 导入清单
    await page.locator('#import-manifest-input').setInputFiles({
      name: 'manifest.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(validSingleManifest)),
    });

    // 真实目录导入对应产物文件
    const tempDir = await mkdtemp(join(tmpdir(), 'manual-test-files-'));
    try {
      await mkdir(join(tempDir, 'screenshots'), { recursive: true });
      await mkdir(join(tempDir, 'preview/line-vue'), { recursive: true });
      await mkdir(join(tempDir, 'docs'), { recursive: true });
      await mkdir(join(tempDir, 'api'), { recursive: true });
      await writeFile(join(tempDir, 'screenshots/line-vue-default.png'), testBuf);
      await writeFile(join(tempDir, 'preview/line-vue/index.html'), testBuf);
      await writeFile(join(tempDir, 'docs/line-vue.md'), testBuf);
      await writeFile(join(tempDir, 'api/line-vue.json'), testBuf);

      await page.locator('#import-files-input').setInputFiles(tempDir);

      // 拦截 /v1/uploads 模拟 500 异常
      await page.route('**/v1/uploads', async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'text/plain',
          body: 'STORAGE_UNAVAILABLE: 模拟对象存储网络故障',
        });
      });

      const submitBtn = page.getByRole('button', { name: '确认并提交发布' });
      await expect(submitBtn).toBeEnabled();
      await submitBtn.click();

      // 验证页面明确展示错误并停止推进
      await expect(page.locator('body')).toContainText('发布失败: 创建上传会话失败 (500)');
      // 提交按钮恢复可用状态
      await expect(submitBtn).toBeEnabled();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
