// 本机工作区示例 QA；不生成 release manifest、environmentKey 或视觉基线。
// Run: .\scripts\pnpm.ps1 exec node tests/acceptance/chart-visual/run.mjs
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const rawDir = path.join(root, '.tools/qa/component-visual-acceptance');
const evidenceDir = path.join(root, 'docs/verification/evidence/component-visual-acceptance-2026-11-22');
const components = ['line', 'bar', 'pie', 'scatter', 'trend-card', 'ranking', 'proportion'];
const viewports = [
  { width: 390, height: 844 }, { width: 768, height: 1024 },
  { width: 1280, height: 720 }, { width: 1440, height: 900 },
];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const relative = (file) => path.relative(root, file).replaceAll('\\', '/');
const results = [];
const servers = [];
let browser;
let sheetPage;

async function portOccupied(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(true); });
  });
}

async function startPreview(framework, port) {
  if (await portOccupied(port)) throw new Error(`端口 ${port} 已被占用，不复用或终止已有服务`);
  const child = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'),
    'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { cwd: path.join(root, 'examples', framework), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const record = { framework, port, pid: child.pid, child, output: '' };
  servers.push(record);
  child.stdout.on('data', (data) => { record.output += data; });
  child.stderr.on('data', (data) => { record.output += data; });
  child.on('error', (error) => { record.output += error.message; });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`预览启动失败: ${record.output}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/index.html`)).ok) return; } catch { /* poll server readiness */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`预览启动超时: ${record.output}`);
}

async function inspect(context, framework, component, theme, renderer, viewport, state = 'default') {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  const errors = [];
  const consoleErrors = [];
  const networkErrors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 400) networkErrors.push(`${response.status()} ${response.url()}`); });
  page.on('requestfailed', (request) => networkErrors.push(`${request.failure()?.errorText} ${request.url()}`));
  const port = framework === 'vue' ? 5184 : 5185;
  const entry = component === 'line' ? 'index' : component;
  const url = `http://127.0.0.1:${port}/${entry}.html?theme=${theme}&renderer=${renderer}`;
  const id = `${framework}-${component}-${theme}-${renderer}-${viewport.width}-${state}`;
  const result = { id, framework, component, theme, renderer, viewport, state, url, errors, consoleErrors, networkErrors };
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 15000 });
    await page.waitForFunction(() => window.__COMPONENT_EXAMPLE__ !== undefined, null, { timeout: 12000 });
    await page.evaluate(() => window.__COMPONENT_EXAMPLE__.ready);
    // 每个状态使用新页面；不连续进入 empty 与 zero-total 等同快照状态。
    if (state !== 'default') await page.evaluate((name) => window.__COMPONENT_EXAMPLE__.runState(name), state);
    result.runtime = await page.evaluate(() => {
      const hook = window.__COMPONENT_EXAMPLE_TEST__;
      return { checks: window.__COMPONENT_EXAMPLE__.getChecks(), data: hook.seriesData(),
        summary: hook.summarySlots(), labels: hook.categoryLabels(), presentation: hook.appliedPresentation(),
        versions: JSON.parse(document.querySelector('[data-testid="runtime-info"]').textContent) };
    });
    result.layout = await page.evaluate((selector) => {
      const bounds = document.querySelector(selector).getBoundingClientRect();
      const scrollWidth = document.documentElement.scrollWidth;
      return { viewportWidth: innerWidth, scrollWidth, horizontalOverflow: scrollWidth > innerWidth + 1,
        host: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        hostClipped: bounds.left < 0 || bounds.right > innerWidth + 1,
        activeState: document.querySelector('.toolbar button.active')?.textContent.trim() };
    }, `.charts-${component}`);
    const expected = theme === 'light'
      ? { paletteFirst: '#3b82f6', textColor: '#263044' }
      : { paletteFirst: '#60a5fa', textColor: '#e2e8f0' };
    const presentation = result.runtime.presentation;
    if (result.runtime.checks.some((check) => check.status !== 'passed')) errors.push('示例自检未全部通过');
    if (!presentation || presentation.canvases !== (renderer === 'canvas' ? 1 : 0)
      || presentation.svgs !== (renderer === 'svg' ? 1 : 0)
      || presentation.paletteFirst !== expected.paletteFirst || presentation.textColor !== expected.textColor) errors.push('实际主题或渲染器不匹配');
    const screenshot = path.join(rawDir, `${id}.png`);
    const bytes = state === 'default'
      ? await page.screenshot({ path: screenshot, fullPage: false })
      : await page.locator(`.charts-${component}`).screenshot({ path: screenshot });
    result.screenshot = { path: relative(screenshot), sha256: sha256(bytes), bytes: bytes.length };
    if (state === 'default' && viewport.width === 1280 && theme === 'light' && renderer === 'canvas') {
      // 现有坐标钩子返回类目中心；分组柱状图的中心是两柱之间的空隙。
      // 单系列 fixture 让钩子的类目中心落在柱体内，与既有事件测试相同。
      result.clickState = component === 'bar' ? 'single' : 'default';
      if (component === 'bar') await page.evaluate(() => window.__COMPONENT_EXAMPLE__.runState('single'));
      await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__.clearClicks());
      const point = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__.pointClientPosition(0, 0));
      if (!point) throw new Error('未取到默认数据点坐标');
      await page.mouse.click(point.x + (['ranking', 'proportion'].includes(component) ? -8 : 0),
        point.y + (component === 'bar' ? 8 : 0));
      await page.waitForFunction(() => window.__COMPONENT_EXAMPLE_TEST__.getClicks().length > 0, null, { timeout: 3000 });
      result.clicks = await page.evaluate(() => window.__COMPONENT_EXAMPLE_TEST__.getClicks());
      if (result.clicks.length !== 1) errors.push(`点击产生 ${result.clicks.length} 次事件`);
      await page.getByTestId('state-updated').focus();
      await page.keyboard.press('Enter');
      await page.evaluate(() => window.__COMPONENT_EXAMPLE__.ready);
      result.keyboardUpdate = await page.evaluate(() => ({ activeState: document.querySelector('.toolbar button.active')?.textContent.trim(),
        checks: window.__COMPONENT_EXAMPLE__.getChecks() }));
      if (result.keyboardUpdate.activeState !== 'updated' || result.keyboardUpdate.checks.some((check) => check.status !== 'passed')) errors.push('键盘更新未通过');
    }
  } catch (error) { errors.push(error.message); }
  finally {
    result.functionalPassed = errors.length === 0 && consoleErrors.length === 0 && networkErrors.length === 0;
    results.push(result);
    await page.close();
  }
}

function croppedPng(bytes, maxWidth) {
  const source = PNG.sync.read(bytes);
  const cropped = new PNG({ width: Math.min(source.width, maxWidth), height: source.height });
  PNG.bitblt(source, cropped, 0, 0, cropped.width, cropped.height, 0, 0);
  return PNG.sync.write(cropped);
}

async function contactSheet(name, cells) {
  const tiles = await Promise.all(cells.map(async (cell) => {
    const bytes = croppedPng(await readFile(path.join(root, cell.screenshot.path)), cell.state === 'default' ? 840 : 720);
    return `<figure><figcaption>${cell.framework} / ${cell.component} / ${cell.state}</figcaption><img src="data:image/png;base64,${bytes.toString('base64')}"></figure>`;
  }));
  await sheetPage.setContent(`<html lang="zh-CN"><style>body{margin:16px;font:14px system-ui;background:#eef2f6}h1{font-size:20px}section{display:grid;grid-template-columns:repeat(4,420px);gap:12px}figure{margin:0;background:white;border:1px solid #94a3b8}figcaption{padding:8px;font-weight:600}img{width:100%;display:block}</style><h1>工作区 QA · ${name}</h1><section>${tiles.join('')}</section></html>`);
  await sheetPage.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images, (img) => img.decode())); });
  const file = path.join(evidenceDir, `${name}.png`);
  const bytes = await sheetPage.screenshot({ path: file, fullPage: true });
  return { path: relative(file), sha256: sha256(bytes), cases: cells.length };
}

try {
  await mkdir(rawDir, { recursive: true });
  await mkdir(evidenceDir, { recursive: true });
  await startPreview('vue', 5184);
  await startPreview('react', 5185);
  browser = await chromium.launch({ headless: true });
  const version = browser.version();
  // 只有两个完全独立的浏览器上下文并发，不共享应用状态。
  await Promise.all(['vue', 'react'].map(async (framework) => {
    const context = await browser.newContext({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai', deviceScaleFactor: 1 });
    context.setDefaultTimeout(12000);
    for (const component of components) {
      for (const theme of ['light', 'dark']) for (const renderer of ['canvas', 'svg']) for (const viewport of viewports) {
        await inspect(context, framework, component, theme, renderer, viewport);
      }
      const fixture = JSON.parse(await readFile(path.join(root, `examples/fixtures/${component}.json`), 'utf8'));
      for (const state of Object.keys(fixture.states).filter((name) => name !== 'default')) {
        await inspect(context, framework, component, 'light', 'canvas', viewports[2], state);
      }
      console.log(`${framework} ${component}: ${results.filter((cell) => cell.framework === framework && cell.component === component).length} 格完成`);
    }
    await context.close();
  }));
  results.sort((a, b) => a.id.localeCompare(b.id));
  const parityErrors = [];
  for (const cell of results.filter((cell) => cell.framework === 'vue')) {
    const other = results.find((candidate) => candidate.id === cell.id.replace(/^vue-/, 'react-'));
    for (const field of ['data', 'summary', 'labels', 'presentation']) {
      if (JSON.stringify(cell.runtime?.[field]) !== JSON.stringify(other?.runtime?.[field])) parityErrors.push(`${cell.id}: ${field}`);
    }
    if (JSON.stringify(cell.clicks) !== JSON.stringify(other?.clicks)) parityErrors.push(`${cell.id}: clicks`);
  }
  sheetPage = await browser.newPage({ viewport: { width: 1750, height: 900 } });
  const contactSheets = [];
  for (const viewport of viewports) for (const theme of ['light', 'dark']) for (const renderer of ['canvas', 'svg']) {
    contactSheets.push(await contactSheet(`default-${viewport.width}-${theme}-${renderer}`,
      results.filter((cell) => cell.state === 'default' && cell.viewport.width === viewport.width && cell.theme === theme && cell.renderer === renderer && cell.screenshot)));
  }
  for (const component of components) {
    contactSheets.push(await contactSheet(`states-${component}`, results.filter((cell) => cell.component === component && cell.theme === 'light'
      && cell.renderer === 'canvas' && cell.viewport.width === 1280 && cell.screenshot)));
  }
  const summary = { scope: 'workspace-example-qa-only', baseline: 'b665681997ba842de6ed039652bf4f358771db6a',
    environment: { os: process.platform, arch: process.arch, node: process.version, browserVersion: version, locale: 'zh-CN', timezone: 'Asia/Shanghai', deviceScaleFactor: 1 },
    counts: { total: results.length, defaultMatrix: results.filter((cell) => cell.state === 'default').length,
      additionalStates: results.filter((cell) => cell.state !== 'default').length,
      functionalPassed: results.filter((cell) => cell.functionalPassed).length,
      horizontalOverflow: results.filter((cell) => cell.layout?.horizontalOverflow).length,
      hostClipped: results.filter((cell) => cell.layout?.hostClipped).length,
      parityErrors: parityErrors.length }, parityErrors, contactSheets, results };
  await writeFile(path.join(evidenceDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({ counts: summary.counts, environment: summary.environment,
    failures: results.filter((cell) => !cell.functionalPassed).map(({ id, errors, consoleErrors, networkErrors }) => ({ id, errors, consoleErrors, networkErrors })), parityErrors }, null, 2));
  if (summary.counts.functionalPassed !== results.length || parityErrors.length) process.exitCode = 1;
  // overflow / 可读性是报告项；exit 0 仅代表功能检查通过，不等于视觉验收通过。
} finally {
  if (browser) await browser.close();
  for (const server of servers) {
    server.child.kill();
    await writeFile(path.join(rawDir, `server-${server.framework}.log`), `pid=${server.pid}\nport=${server.port}\n${server.output}`);
  }
}
