import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { manifestDigest } from '@company/contracts';
import { sanitizeWebManifest } from '../../apps/admin/app/lib/uploads/manifest-form.js';
import { createValidBundle, pngBytes } from '../fixtures/t05-artifacts.js';

let CURRENT_SDK_DIR: string;
let screenshotCount: number;
test.beforeAll(async () => {
  CURRENT_SDK_DIR = await mkdtemp(join(tmpdir(), 'zh-manual-browser-'));
  const fixture = await createValidBundle('web');
  screenshotCount = fixture.manifest.variants.length;
  for (const [path, bytes] of fixture.files) {
    const target = join(CURRENT_SDK_DIR, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, bytes);
  }
  await writeFile(join(CURRENT_SDK_DIR, 'manifest.json'), JSON.stringify(fixture.manifest));
});
test.afterAll(async () => { if (CURRENT_SDK_DIR) await rm(CURRENT_SDK_DIR, { recursive: true, force: true }); });
test.beforeEach(async ({ page }) => {
  await page.route('**/v1/auth/oidc/session', route => route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } }));
});

const MOCK_AUTH_TOKEN =
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ3ZWItZGV2ZWxvcGVyLWFsaWNlIiwicm9sZXMiOlsicHVibGlzaGVyIiwibWFpbnRhaW5lciJdLCJhenAiOiJ3ZWIiLCJleHAiOjE5OTk5OTk5OTl9.test_sig';

async function devLogin(page: Page) {
  const summary = page.locator('details.zn-token-login summary');
  await summary.click();
  await page.locator('#token-input').fill(MOCK_AUTH_TOKEN);
  await page.getByRole('button', { name: '凭证登录' }).click();
}

test.describe('T08: 网页手动发布与逐实现截图必检', () => {
  test('未登录用户访问发布工作区自动跳转至登录页且带有 noindex 保护', async ({ page }) => {
    const response = await page.goto('http://127.0.0.1:5177/upload');
    expect(response).not.toBeNull();
    expect(response!.status()).toBe(200);

    // 1. 未登录自动跳转至 /login，隐藏侧栏并展示登录入口
    await expect(page).toHaveURL(/\/login\?next=%2Fupload$/);
    await expect(page.locator('aside.zn-sidebar')).toHaveCount(0);
    await expect(page.locator('h1')).toContainText('管理员登录');
    await expect(page.locator('h2')).toContainText('登录后开放');
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute('content', /noindex/);
    await expect(page.getByRole('link', { name: '账号登录' })).toBeVisible();
  });

  test('模拟登录后展示发布工作区与逐实现必检清单', async ({ page }) => {
    await page.goto('http://127.0.0.1:5177/upload');

    // 输入开发者凭据登录
    await devLogin(page);

    // 确认进入工作区（默认为空态，可一键加载 7 组件演示草稿）
    await expect(page.getByRole('heading', { name: '资产发布工作区 (Manual Release)' })).toBeVisible();
    await expect(page.locator('body')).toContainText('当前登录身份：web-developer-alice');
    await expect(page.locator('body')).toContainText('逐实现截图关联与必检清单');

    await page.getByRole('button', { name: '加载 7 组件演示草稿' }).click();

    // 动态覆盖 7 组件 14 个实现变体
    const cards = page.locator('.variant-shot-card');
    await expect(cards).toHaveCount(14);
  });

  test('缺图阻断：任意变体缺图时禁止提交并展示明确错误提示 (blocks_submit_when_any_variant_has_no_image)', async ({ page }) => {
    await page.goto('http://127.0.0.1:5177/upload');
    await devLogin(page);
    await page.getByRole('button', { name: '加载 7 组件演示草稿' }).click();

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
      buffer: pngBytes(),
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
    await page.goto('http://127.0.0.1:5177/upload');
    await devLogin(page);

    const submitBtn = page.getByRole('button', { name: '确认并提交发布' });
    await expect(submitBtn).toBeDisabled();

    // 从完整合法 web manifest 出发，只将 line-vue 变体的截图框架错误标记为 react
    const realManifest = JSON.parse(readFileSync(join(CURRENT_SDK_DIR, 'manifest.json'), 'utf8'));
    const mismatchManifest = {
      ...realManifest,
      variants: realManifest.variants.map((v: any) => {
        if (v.variantId === 'line-vue') {
          return {
            ...v,
            screenshots: v.screenshots.map((s: any) => ({ ...s, framework: 'react' })),
          };
        }
        return v;
      }),
    };

    // 通过导入清单功能导入
    await page.locator('#import-manifest-input').setInputFiles({
      name: 'manifest.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(mismatchManifest, null, 2)),
    });

    // 验证阻断提示明确指示导入失败并包含错配原因
    const statusMsg = page.locator('#upload-status-message');
    await expect(statusMsg).toBeVisible();
    await expect(statusMsg).toContainText('导入 Manifest 失败');
    await expect(statusMsg).toContainText('Screenshot must belong to this variant/framework');
    await expect(submitBtn).toBeDisabled();
  });

  test('独立作业状态机页面支持 7 阶段步骤器展示与状态轮询', async ({ page }) => {
    await page.addInitScript(token => localStorage.setItem('zhinexus_console_auth', JSON.stringify({ token, subject: 'web-developer-alice', roles: ['publisher'], channel: 'web' })), MOCK_AUTH_TOKEN);
    await page.route('**/v1/releases/job-web-manual-001', route => route.fulfill({ json: { jobId: 'job-web-manual-001', state: 'READY', stage: 'READY' } }));
    await page.goto('http://127.0.0.1:5177/jobs/job-web-manual-001');

    await expect(page.getByRole('heading', { name: '发布作业流水线状态跟踪' })).toBeVisible();
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
    const realManifest = JSON.parse(readFileSync(join(CURRENT_SDK_DIR, 'manifest.json'), 'utf8'));
    const clean = sanitizeWebManifest(realManifest);
    const digest = await manifestDigest(clean);

    // 预置符合当前 fail-closed 契约的完整三元组与合法摘要
    await page.goto('http://127.0.0.1:5177/upload');
    await page.evaluate(
      ({ digestVal, manifestVal }) => {
        localStorage.setItem(
          'zhinexus_pending_release',
          JSON.stringify({
            idempotencyKey: 'web-resume-test-key-999',
            uploadSessionId: 'sess-resume-001',
            apiUrl: 'http://127.0.0.1:3000',
            subject: 'web-developer-alice',
            manifest: manifestVal,
            manifestDigest: digestVal,
            timestamp: Date.now(),
          }),
        );
      },
      { digestVal: digest, manifestVal: clean },
    );

    // 重新进入并模拟登录
    await page.goto('http://127.0.0.1:5177/upload');
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
    await page.goto('http://127.0.0.1:5177/upload');
    await devLogin(page);
    await page.getByRole('button', { name: '加载 7 组件演示草稿' }).click();

    // 针对 line-vue 变体，触发文件选择
    const fileInput = page.locator('tr.variant-shot-card').first().locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'custom-line-shot.png',
      mimeType: 'image/png',
      buffer: pngBytes(),
    });

    // 校验实际 PNG 的字节数及 manual-upload 来源
    const firstRow = page.locator('tr.variant-shot-card').first();
    await expect(firstRow).toContainText(`${pngBytes().byteLength} 字节`);
    await expect(firstRow).toContainText('已关联 (manual-upload)');
  });

  test('上传接口失败时阻断提交流程并展示清晰错误提示', async ({ page }) => {
    await page.goto('http://127.0.0.1:5177/upload');
    await devLogin(page);

    // 1. 导入完整合法外部清单
    await page.locator('#import-manifest-input').setInputFiles(join(CURRENT_SDK_DIR, 'manifest.json'));
    await expect(page.locator('#upload-status-message')).toContainText('成功导入外部 Manifest 清单');

    // 2. 真实目录导入全部预构建产物
    await page.locator('#import-files-input').setInputFiles(CURRENT_SDK_DIR);
    await expect(page.locator('#upload-status-message')).toContainText(/成功导入 \d+ 个本地预构建产物文件并完成路径映射/);

    // 3. 从本测试拥有的目录导入全部有效展示截图
    await page.locator('#import-screenshots-input').setInputFiles(join(CURRENT_SDK_DIR, 'screenshots'));
    await expect(page.locator('#upload-status-message')).toContainText(`成功批量关联 ${screenshotCount} 张有效展示截图`);

    const submitBtn = page.getByRole('button', { name: '确认并提交发布' });
    await expect(submitBtn).toBeEnabled();

    // 拦截 /v1/uploads 模拟 500 异常
    await page.route('**/v1/uploads', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'text/plain',
        body: 'STORAGE_UNAVAILABLE: 模拟对象存储网络故障',
      });
    });

    await submitBtn.click();

    // 验证页面明确展示错误并停止推进
    await expect(page.locator('#upload-status-message')).toContainText('发布失败:');
    await expect(page.locator('#upload-status-message')).toContainText('创建上传会话失败 (500)');
    // 提交按钮恢复可用状态
    await expect(submitBtn).toBeEnabled();
  });

  test('提交前最终快照校验触发 WebCrypto 异常时必须恢复提交按钮可用状态并提示错误', async ({ page }) => {
    await page.goto('http://127.0.0.1:5177/upload');
    await devLogin(page);

    // 1. 导入完整合法外部清单与目录文件直至可提交状态
    await page.locator('#import-manifest-input').setInputFiles(join(CURRENT_SDK_DIR, 'manifest.json'));
    await expect(page.locator('#upload-status-message')).toContainText('成功导入外部 Manifest 清单');

    await page.locator('#import-files-input').setInputFiles(CURRENT_SDK_DIR);
    await expect(page.locator('#upload-status-message')).toContainText(/成功导入 \d+ 个本地预构建产物文件并完成路径映射/);

    await page.locator('#import-screenshots-input').setInputFiles(join(CURRENT_SDK_DIR, 'screenshots'));
    await expect(page.locator('#upload-status-message')).toContainText(`成功批量关联 ${screenshotCount} 张有效展示截图`);

    const submitBtn = page.getByRole('button', { name: '确认并提交发布' });
    await expect(submitBtn).toBeEnabled();

    // 2. 注入 WebCrypto digest reject 故障（模拟并发/硬件忙碌异常）
    await page.evaluate(() => {
      Object.defineProperty(window.crypto.subtle, 'digest', {
        configurable: true,
        value: async () => {
          throw new DOMException('Simulated WebCrypto busy/reject', 'OperationError');
        },
      });
    });

    await submitBtn.click();

    // 3. 断言错误信息展示且提交按钮从 busy 状态恢复为可点击
    await expect(page.locator('#upload-status-message')).toContainText('Simulated WebCrypto busy/reject');
    await expect(submitBtn).toBeEnabled();
  });

  test('产物导入与截图读取重叠时保留全部文件及最新截图摘要', async ({ page }) => {
    await page.goto('http://127.0.0.1:5177/upload');
    await devLogin(page);
    await page.locator('#import-manifest-input').setInputFiles(join(CURRENT_SDK_DIR, 'manifest.json'));
    await expect(page.locator('#upload-status-message')).toContainText('成功导入外部 Manifest 清单');

    // 暂停截图读取，让另一项产物导入先完成，确定性覆盖异步操作交错。
    await page.evaluate(() => {
      const original = File.prototype.arrayBuffer;
      const state = window as typeof window & { releaseScreenshot?: () => void; screenshotReadStarted?: boolean };
      File.prototype.arrayBuffer = async function () {
        if (this.name === 'replacement.png') {
          state.screenshotReadStarted = true;
          await new Promise<void>(resolve => { state.releaseScreenshot = resolve; });
        }
        return original.call(this);
      };
    });
    await page.locator('input[data-upload-shot="line-vue"]').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: pngBytes(3, 3) });
    await expect.poll(() => page.evaluate(() => (window as typeof window & { screenshotReadStarted?: boolean }).screenshotReadStarted)).toBe(true);
    await page.locator('#import-files-input').setInputFiles(CURRENT_SDK_DIR);
    await expect(page.locator('#upload-status-message')).toContainText(/成功导入 \d+ 个本地预构建产物文件并完成路径映射/);
    await page.evaluate(() => (window as typeof window & { releaseScreenshot?: () => void }).releaseScreenshot?.());
    await expect(page.locator('#upload-status-message')).toContainText('已为实现 line-vue 上传有效展示截图');
    await expect(page.getByRole('button', { name: '确认并提交发布' })).toBeEnabled();
    await expect(page.locator('main')).not.toContainText('FILE_MISSING');
    await expect(page.locator('main')).not.toContainText('DIGEST_MISMATCH');
  });

  test('较早开始的目录读取不能覆盖后来替换的截图', async ({ page }, testInfo) => {
    const fixture = await createValidBundle('web');
    const image = fixture.files.get('screenshots/line-vue.png')!;
    fixture.files.delete('screenshots/line-vue.png');
    fixture.files.set('screenshots/line-vue-default.png', image);
    fixture.manifest = JSON.parse(JSON.stringify(fixture.manifest).replaceAll('screenshots/line-vue.png', 'screenshots/line-vue-default.png'));
    const directory = testInfo.outputPath('bundle');
    for (const [path, bytes] of fixture.files) {
      await mkdir(join(directory, path, '..'), { recursive: true });
      await writeFile(join(directory, path), bytes);
    }
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(fixture.manifest));
    await page.goto('/upload');
    await devLogin(page);
    await page.locator('#import-manifest-input').setInputFiles(join(directory, 'manifest.json'));
    await expect(page.locator('#upload-status-message')).toContainText('成功导入外部 Manifest 清单');
    await page.evaluate(() => {
      const original = File.prototype.arrayBuffer;
      const state = window as typeof window & { releaseImport?: () => void; importStarted?: boolean };
      File.prototype.arrayBuffer = async function () {
        if (this.name.endsWith('.tgz') && !state.importStarted) {
          state.importStarted = true;
          await new Promise<void>(resolve => { state.releaseImport = resolve; });
        }
        return original.call(this);
      };
    });
    await page.locator('#import-files-input').setInputFiles(directory);
    await expect.poll(() => page.evaluate(() => (window as typeof window & { importStarted?: boolean }).importStarted)).toBe(true);
    await page.locator('input[data-upload-shot="line-vue"]').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: pngBytes(3, 3) });
    await expect(page.locator('#upload-status-message')).toContainText('已为实现 line-vue 上传有效展示截图');
    await page.evaluate(() => (window as typeof window & { releaseImport?: () => void }).releaseImport?.());
    await expect(page.locator('#upload-status-message')).toContainText(/成功导入 \d+ 个本地预构建产物文件并完成路径映射/);
    await expect(page.getByRole('button', { name: '确认并提交发布' })).toBeEnabled();
  });

  for (const mode of ['single', 'batch'] as const) test(mode + '：删除截图使此前尚未完成的读取失效', async ({ page }, testInfo) => {
    await page.goto('/upload');
    await devLogin(page);
    await page.locator('#import-manifest-input').setInputFiles(join(CURRENT_SDK_DIR, 'manifest.json'));
    await expect(page.locator('#upload-status-message')).toContainText('成功导入外部 Manifest 清单');
    await page.locator('#import-files-input').setInputFiles(CURRENT_SDK_DIR);
    await expect(page.locator('#upload-status-message')).toContainText(/成功导入 \d+ 个本地预构建产物文件并完成路径映射/);
    await expect(page.getByRole('button', { name: '确认并提交发布' })).toBeEnabled();
    await page.evaluate(() => {
      const original = File.prototype.arrayBuffer;
      const state = window as typeof window & { releaseScreenshot?: () => void; screenshotReadStarted?: boolean };
      File.prototype.arrayBuffer = async function () {
        if (this.name === 'line-vue-replacement.png') {
          state.screenshotReadStarted = true;
          await new Promise<void>(resolve => { state.releaseScreenshot = resolve; });
        }
        return original.call(this);
      };
    });
    if (mode === 'single') {
      await page.locator('input[data-upload-shot="line-vue"]').setInputFiles({ name: 'line-vue-replacement.png', mimeType: 'image/png', buffer: pngBytes(3, 3) });
    } else {
      const directory = testInfo.outputPath('replacement');
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'line-vue-replacement.png'), pngBytes(3, 3));
      await page.locator('#import-screenshots-input').setInputFiles(directory);
    }
    await expect.poll(() => page.evaluate(() => (window as typeof window & { screenshotReadStarted?: boolean }).screenshotReadStarted)).toBe(true);
    await page.locator('button[data-remove-shot="line-vue"]').click();
    // 记录读取放行后每一次 DOM 变化，防止短暂缺图掩盖随后恢复的错误截图。
    await page.evaluate(() => {
      const state = window as typeof window & { releaseScreenshot?: () => void; screenshotRestored?: boolean };
      new MutationObserver(() => {
        if (document.querySelector('tr.variant-shot-card:has(input[data-upload-shot="line-vue"])')?.textContent?.includes('已关联')) state.screenshotRestored = true;
      }).observe(document.querySelector('main')!, { childList: true, subtree: true, characterData: true });
      state.releaseScreenshot?.();
    });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => (window as typeof window & { screenshotRestored?: boolean }).screenshotRestored)).not.toBe(true);
    await expect(page.locator('tr.variant-shot-card').filter({ has: page.locator('input[data-upload-shot="line-vue"]') })).toContainText('缺少有效展示截图');
    await expect(page.getByRole('button', { name: '确认并提交发布' })).toBeDisabled();
  });
});
