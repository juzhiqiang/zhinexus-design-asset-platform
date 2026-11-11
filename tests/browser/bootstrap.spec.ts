import { expect, test } from '@playwright/test';

test('gallery explains its bootstrap stage', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173');
  await expect(page.getByRole('heading', { name: 'Zhinexus 组件资产平台' })).toBeVisible();
  await expect(page.getByText('工程骨架已连接，目录与发布功能待开发。')).toBeVisible();
});
for (const [framework, port] of [['vue', 5174], ['react', 5175]] as const) {
  test(`${framework} built example loads framework and core through package exports`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}`);
    await expect(page.getByTestId('runtime-info')).toContainText(`"framework": "${framework}"`);
    const runtime = JSON.parse((await page.getByTestId('runtime-info').textContent())!);
    expect(runtime).toMatchObject({ stage: 'bootstrap', echartsVersion: '6.1.0', framework });
    expect(runtime.frameworkVersion).toBe(framework === 'vue' ? '3.5.45' : '19.3.1');
    expect(errors).toEqual([]);
  });
}
