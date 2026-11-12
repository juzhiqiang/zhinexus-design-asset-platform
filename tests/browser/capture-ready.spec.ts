import { test, expect } from '@playwright/test';
import * as http from 'node:http';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { captureExample } from '../../packages/component-cli/src/local/capture.js';

test.describe('T04: Deterministic capture driven by ready -> runState -> getChecks', () => {
  let server: http.Server;
  let serverUrl: string;
  let tmpDir: string;

  test.beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-spec-'));
    server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (req.url === '/ok') {
        res.end(`<!DOCTYPE html>
<html>
<head>
  <style>
    #chart { width: 400px; height: 300px; background: #fafafa; }
  </style>
</head>
<body>
  <div id="chart"><canvas width="400" height="300"></canvas></div>
  <script>
    let state = 'default';
    window.__COMPONENT_EXAMPLE__ = {
      ready: Promise.resolve(),
      states: ['default', 'updated'],
      runState(nextState) {
        state = nextState;
        return Promise.resolve();
      },
      getChecks() {
        return [
          { name: 'single-instance', status: 'passed' },
          { name: 'no-page-error', status: 'passed' },
          { name: 'valid-dimensions', status: 'passed' },
          { name: 'fonts-ready', status: 'passed' }
        ];
      }
    };
  </script>
</body>
</html>`);
      } else if (req.url === '/page-error') {
        res.end(`<!DOCTYPE html>
<html>
<body>
  <div id="chart" style="width: 400px; height: 300px;"><canvas width="400" height="300"></canvas></div>
  <script>
    window.__COMPONENT_EXAMPLE__ = {
      ready: Promise.resolve(),
      states: ['default'],
      runState() { return Promise.resolve(); },
      getChecks() {
        return [{ name: 'single-instance', status: 'passed' }];
      }
    };
    throw new Error('Uncaught render failure in chart component');
  </script>
</body>
</html>`);
      } else if (req.url === '/ready-timeout') {
        res.end(`<!DOCTYPE html>
<html>
<body>
  <div id="chart" style="width: 400px; height: 300px;"></div>
  <script>
    window.__COMPONENT_EXAMPLE__ = {
      ready: new Promise(() => {}), // never resolves
      states: ['default'],
      runState() { return Promise.resolve(); },
      getChecks() { return []; }
    };
  </script>
</body>
</html>`);
      } else {
        res.statusCode = 404;
        res.end('Not Found');
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as { port: number };
    serverUrl = `http://127.0.0.1:${addr.port}`;
  });

  test.afterAll(async () => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('drives ready -> runState -> getChecks and produces valid screenshot and environment', async () => {
    const outputDir = path.join(tmpDir, 'ok-output');
    fs.mkdirSync(outputDir, { recursive: true });

    const result = await captureExample({
      url: `${serverUrl}/ok`,
      states: ['default'],
      outputDir,
      framework: 'vue',
      frameworkVersion: '3.5.45',
      echartsVersion: '6.1.0',
      exampleId: 'line-default',
      variantId: 'line-vue',
      packageSha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      packageVersion: '0.0.1',
    });

    expect(result.environment).toBeDefined();
    expect(result.environment.renderer).toBe('canvas');
    expect(result.environment.width).toBe(800);
    expect(result.environment.height).toBe(400);
    expect(result.environmentKey).toMatch(/^[a-f0-9]{64}$/);
    expect(result.screenshots.length).toBe(1);
    expect(result.screenshots[0]!.state).toBe('default');
    expect(result.screenshots[0]!.source).toBe('local-automatic');
    expect(fs.existsSync(path.join(outputDir, result.screenshots[0]!.image.path))).toBe(true);
    expect(result.checks.every((c) => c.status === 'passed')).toBe(true);
  });

  test('page_error_fails_even_with_screenshot: throws when page error occurs', async () => {
    const outputDir = path.join(tmpDir, 'error-output');
    fs.mkdirSync(outputDir, { recursive: true });

    await expect(
      captureExample({
        url: `${serverUrl}/page-error`,
        states: ['default'],
        outputDir,
        framework: 'vue',
        frameworkVersion: '3.5.45',
        echartsVersion: '6.1.0',
        exampleId: 'line-default',
        variantId: 'line-vue',
        packageSha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
        packageVersion: '0.0.1',
      }),
    ).rejects.toThrow(/Uncaught render failure in chart component|PAGE_ERROR/);
  });

  test('ready_timeout: throws when ready promise exceeds timeout', async () => {
    const outputDir = path.join(tmpDir, 'timeout-output');
    fs.mkdirSync(outputDir, { recursive: true });

    await expect(
      captureExample({
        url: `${serverUrl}/ready-timeout`,
        states: ['default'],
        outputDir,
        timeoutMs: 1500, // Short timeout for test
        framework: 'vue',
        frameworkVersion: '3.5.45',
        echartsVersion: '6.1.0',
        exampleId: 'line-default',
        variantId: 'line-vue',
        packageSha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
        packageVersion: '0.0.1',
      }),
    ).rejects.toThrow(/READY_TIMEOUT|未在超时内就绪/);
  });
});
