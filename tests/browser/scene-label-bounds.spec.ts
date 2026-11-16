import { expect, test, type Locator } from '@playwright/test';

/** 捕获条末标签仍有完整文本、却被图表画布裁切的回归；不依赖 grid 配置值。 */
async function expectVisibleLabels(host: Locator, expected: readonly string[]): Promise<void> {
  const labels = await host.evaluate((element, wanted) => {
    const frame = element.getBoundingClientRect();
    return [...element.querySelectorAll('svg text')].flatMap((text) => {
      const rect = text.getBoundingClientRect();
      const content = text.textContent ?? '';
      // 坐标轴也会显示数值；只检查绘图区内的条末标签。
      if (!wanted.includes(content) || rect.top - frame.top < 56 || rect.bottom > frame.bottom - 24) return [];
      return [{ text: content, left: rect.left - frame.left, right: rect.right - frame.left, width: frame.width }];
    });
  }, [...expected]);
  expect(labels.map((label) => label.text).sort()).toEqual([...expected].sort());
  for (const label of labels) {
    expect(label.left, `${label.text} 左边界`).toBeGreaterThanOrEqual(0);
    expect(label.right, `${label.text} 右边界`).toBeLessThanOrEqual(label.width);
  }
}

for (const framework of ['vue', 'react'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    for (const component of ['ranking', 'proportion'] as const) {
      test(`${component} 完整数值在默认及窄容器内可见: ${framework}/${theme}`, async ({ page }) => {
        const origin = framework === 'vue' ? 5174 : 5175;
        await page.goto(`http://127.0.0.1:${origin}/${component}.html?theme=${theme}&renderer=svg`);
        await page.waitForFunction(() => window.__COMPONENT_EXAMPLE__ !== undefined);
        await page.evaluate(() => window.__COMPONENT_EXAMPLE__!.ready);
        const host = page.locator(`.charts-${component}`);
        const labels = component === 'ranking'
          ? ['180次', '180次', '120次', '90次', '60次']
          : ['120次（40.0%）', '80次（26.7%）', '100次（33.3%）'];
        await expectVisibleLabels(host, labels);
        await host.evaluate((element) => { element.style.width = '360px'; });
        await expect(host.locator('svg')).toHaveAttribute('width', '360');
        // SVG 的尺寸属性先于下一帧文字布局更新；等待真实边界收敛。
        await expect(async () => expectVisibleLabels(host, labels)).toPass({ timeout: 1500 });
        await page.evaluate(() => window.__COMPONENT_EXAMPLE__!.runState('single'));
        await expectVisibleLabels(host, [component === 'ranking' ? '200次' : '300次（100.0%）']);
      });
    }
  }
}

for (const component of ['ranking', 'proportion'] as const) {
  test(`${component} 长单位和小数标签按实际文字宽度保留空间`, async ({ page }) => {
    await page.goto('http://127.0.0.1:5174/harness.html');
    await page.waitForFunction(() => window.__CORE_HARNESS__ !== undefined);
    await page.evaluate((chart) => {
      const host = document.getElementById('host')!;
      host.style.width = '360px';
      window.__CORE_HARNESS__!.create(host, { chart, renderer: 'svg', animation: false, unit: { suffix: '万元', decimals: 2 } });
      window.__CORE_HARNESS__!.update({ series: [{ id: 'amount', name: '金额', points: [{ x: '甲', y: 1234567.25 }] }] });
    }, component);
    await page.evaluate(() => window.__CORE_HARNESS__!.whenRendered());
    await expectVisibleLabels(page.locator('#host'), [component === 'ranking' ? '1,234,567.25万元' : '1,234,567.25万元（100.0%）']);
  });
}
