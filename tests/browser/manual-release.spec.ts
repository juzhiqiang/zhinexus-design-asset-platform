import { expect, test } from '@playwright/test';

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

    // 点击一键模拟登录
    const loginBtn = page.getByRole('button', { name: '一键模拟开发者登录' });
    await expect(loginBtn).toBeVisible();
    await loginBtn.click();

    // 确认进入工作区
    await expect(page.locator('h1')).toContainText('资产发布工作区 (Manual Release)');
    await expect(page.locator('body')).toContainText('当前登录身份：web-developer-alice');
    await expect(page.locator('body')).toContainText('逐实现截图关联与必检清单');

    // 初始包含 4 个实现变体 (line-vue, line-react, bar-vue, bar-react)
    const cards = page.locator('.variant-shot-card');
    await expect(cards).toHaveCount(4);
  });

  test('缺图阻断：任意变体缺图时禁止提交并展示明确错误提示 (blocks_submit_when_any_variant_has_no_image)', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/upload');
    await page.getByRole('button', { name: '一键模拟开发者登录' }).click();

    const submitBtn = page.getByRole('button', { name: '确认并提交发布' });
    // 初始时 4 个变体均有图，提交按钮可用
    await expect(submitBtn).toBeEnabled();

    // 删除 bar-react 变体的截图
    const removeBtn = page.locator('button[data-remove-shot="bar-react"]');
    await expect(removeBtn).toBeVisible();
    await removeBtn.click();

    // 此时 bar-react 变体缺图
    // 1. 提交按钮必须被禁用
    await expect(submitBtn).toBeDisabled();

    // 2. 页面醒目展示阻断警告与缺失变体列表
    const blockerAlert = page.locator('.blocker-alert');
    await expect(blockerAlert).toBeVisible();
    await expect(blockerAlert).toContainText('阻断发布：存在未关联有效截图的组件实现');
    await expect(blockerAlert).toContainText('bar-react');
    await expect(blockerAlert).toContainText('SCREENSHOT_REQUIRED');

    // 3. 点击“补齐默认截图”后恢复
    const restoreBtn = page.locator('button[data-restore-shot="bar-react"]');
    await expect(restoreBtn).toBeVisible();
    await restoreBtn.click();

    // 恢复后提交按钮重新可用，阻断警告消失
    await expect(submitBtn).toBeEnabled();
    await expect(blockerAlert).not.toBeVisible();
  });

  test('框架错配拦截：将 React 截图配给 Vue 变体时前置阻断 (SCREENSHOT_VARIANT_MISMATCH)', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/upload');
    await page.getByRole('button', { name: '一键模拟开发者登录' }).click();

    const submitBtn = page.getByRole('button', { name: '确认并提交发布' });
    await expect(submitBtn).toBeEnabled();

    // 点击模拟框架错配测试按钮（针对第一个 Vue 变体）
    const mismatchBtn = page.getByRole('button', { name: '模拟框架错配测试' }).first();
    await expect(mismatchBtn).toBeVisible();
    await mismatchBtn.click();

    // 验证阻断提示
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
});
