import { test, expect } from '@playwright/test';
import * as http from 'node:http';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { captureExample } from '../../packages/component-cli/src/local/capture.js';
import { buildCheckReport } from '../../packages/component-cli/src/local/report.js';
import { validateCheckReport } from '../../packages/component-cli/src/contracts/validation.js';

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
      } else if (req.url?.startsWith('/protocol/')) {
        const kind = req.url.split('/')[2];
        res.end('<!doctype html><div id="chart" style="width:400px;height:300px"></div><script>' +
          'const kind = ' + JSON.stringify(kind) + ';' +
          String.raw`
          let state = 'default';
          let settled = true;
          const example = {
            ready: Promise.resolve(), states: ['default', 'updated'],
            runState(next) {
              state = next;
              if (kind === 'state-ready') {
                settled = false;
                this.ready = new Promise(resolve => setTimeout(() => { settled = true; resolve(); }, 200));
              }
              return Promise.resolve();
            },
            getChecks() {
              if (kind === 'empty-checks') return [];
              if (kind === 'bad-checks') return [{ name: 'render', status: 'unknown' }];
              if (kind === 'shared-checks') {
                const checks = [{ name: 'render', status: 'passed' }, { name: 'x'.repeat(2048), status: 'passed' }];
                if (state === 'final') checks.push({ name: 'render [updated]', status: 'passed' });
                return checks;
              }
              if (kind === 'duplicate-checks') return Array.from({ length: 2 }, () => ({ name: 'render', status: 'passed' }));
              return [{ name: state + '-render', status: (kind === 'masked-failure' && state === 'default') || !settled ? 'failed' : 'passed' }];
            }
          };
          if (kind === 'missing-runState') delete example.runState;
          if (kind === 'missing-getChecks') delete example.getChecks;
          if (kind === 'bad-ready') example.ready = true;
          if (kind === 'unsupported-state') example.states = ['default'];
          if (kind === 'shared-checks') example.states.push('final');
          if (kind === 'no-discovery') delete example.states;
          window.__COMPONENT_EXAMPLE__ = example;
          ` + '</script>');
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
    expect(result.checks.map(check => check.name)).toEqual(['single-instance', 'no-page-error', 'valid-dimensions', 'fonts-ready']);
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

  function captureProtocol(kind: string, states = ['default']) {
    return captureExample({ url: serverUrl + '/protocol/' + kind, states,
      outputDir: path.join(tmpDir, kind), framework: 'react', frameworkVersion: '19.3.1',
      echartsVersion: '6.1.0', exampleId: 'line-default', variantId: 'line-react',
      packageSha256: 'a'.repeat(64), packageVersion: '0.0.1', timeoutMs: 1500 });
  }

  for (const kind of ['missing-runState', 'missing-getChecks', 'bad-ready', 'empty-checks', 'bad-checks']) {
    test('rejects invalid example protocol: ' + kind, async () => {
      await expect(captureProtocol(kind)).rejects.toThrow(/INVALID_EXAMPLE_PROTOCOL/);
    });
  }

  test('does not hide a failed earlier required state behind a later passing state', async () => {
    await expect(captureProtocol('masked-failure', ['default', 'updated'])).rejects.toThrow(/CHECKS_FAILED.*default/);
  });

  test('rejects required states omitted from the optional discovery list', async () => {
    await expect(captureProtocol('unsupported-state', ['updated'])).rejects.toThrow(/INVALID_EXAMPLE_PROTOCOL.*updated/);
  });

  test('waits for the updated ready signal and records checks for every required state', async () => {
    const result = await captureProtocol('state-ready', ['default', 'updated']);
    expect(result.screenshots.map(shot => shot.state)).toEqual(['default', 'updated']);
    expect(result.checks.map(check => check.name)).toEqual(['default-render', 'updated-render']);
    expect(result.checks.every(check => check.status === 'passed')).toBe(true);
  });

  test('allows discovery to be omitted while still executing required states', async () => {
    const result = await captureProtocol('no-discovery', ['default', 'updated']);
    expect(result.checks.map(check => check.name)).toEqual(['default-render', 'updated-render']);
  });

  test('builds a valid report when multiple states return the same check names', async () => {
    const result = await captureProtocol('shared-checks', ['updated', 'default', 'final']);
    const report = buildCheckReport({
      ...result, variantId: 'line-react', exampleId: 'line-default', packageSha256: 'a'.repeat(64),
    });

    const validation = validateCheckReport(report);
    expect(validation.ok, validation.ok ? undefined : JSON.stringify(validation.issues)).toBe(true);
    expect(report.screenshots.map(shot => shot.state)).toEqual(['updated', 'default', 'final']);
    const names = report.checks.map(check => check.name);
    expect(names).toHaveLength(7);
    expect(names[0]).toContain('[updated]');
    expect(names[2]).toBe('render');
    expect(names[3]).toBe('x'.repeat(2048));
    expect(names[4]).toContain('[final]');
    expect(names[6]).toBe('render [updated]');
  });

  test('preserves the first check name when no default state is captured', async () => {
    const result = await captureProtocol('shared-checks', ['updated', 'final']);
    expect(result.checks[0]!.name).toBe('render');
    expect(result.checks[2]!.name).toContain('[final]');
  });

  test('rejects duplicate check names within a single state', async () => {
    await expect(captureProtocol('duplicate-checks')).rejects.toThrow(/INVALID_EXAMPLE_PROTOCOL.*Duplicate check name.*render.*default/);
  });
});
