/**
 * T17 A1 真实 Chromium 浏览器验收测试：generated-page.spec.ts
 *
 * 覆盖：
 * - 真实 loopback 宿主导入本轮生成模块，执行 fill/click 与 visible/text/count DOM 断言；
 * - 类型与构建通过但点击交互失败时报告 failed (behavior)；
 * - 零尺寸容器、pageerror、非 loopback 外发请求与弹窗均失败；
 * - 视觉 NEW / DIFF / INCOMPATIBLE 均不通过，PASS 需真实匹配环境与基线 PNG，且基线 bytes 不变。
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, test } from '@playwright/test';
import { canonicalJson } from '../../packages/component-cli/src/contracts/schema.js';
import type { IntegrationPlanV1 } from '../../packages/component-cli/src/contracts/integration-plan.js';
import type { IntegrationApplyResultV1 } from '../../packages/component-cli/src/contracts/integration-apply.js';
import type {
  IntegrationExecutionAuthorizationV1,
  IntegrationVerificationSpecV1,
} from '../../packages/component-cli/src/contracts/integration-verification.js';
import { canonicalProjectRoot } from '../../packages/component-cli/src/integration/apply.js';
import { callVerify, loadT17CliExports } from '../integration/t17-support/verify-namespace.js';
import { validIntegrationPlanFixture } from '../fixtures/integration-plan.js';
import { applyResultFixture } from '../fixtures/integration-apply.js';

function sha256Hex(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

function canonicalDigest(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function setupFakeProjectForBrowser(tempRoot: string): {
  root: string;
  canonicalRoot: string;
  artifactRoot: string;
  plan: IntegrationPlanV1;
  applyResult: IntegrationApplyResultV1;
} {
  const root = path.join(tempRoot, 'proj');
  const artifactRoot = path.join(tempRoot, 'artifacts');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(artifactRoot, { recursive: true });

  const plan: IntegrationPlanV1 = structuredClone(validIntegrationPlanFixture()) as unknown as IntegrationPlanV1;
  const applyResult: IntegrationApplyResultV1 = structuredClone(applyResultFixture()) as unknown as IntegrationApplyResultV1;

  // 写入最小 package.json 与 node_modules 满足 dependency-guard
  const pkgJsonContent = JSON.stringify({
    name: 'browser-host-test',
    version: '1.0.0',
    scripts: {
      typecheck: 'node -e "process.exit(0)"',
      build: 'node -e "process.exit(0)"',
    },
  });
  fs.writeFileSync(path.join(root, 'package.json'), pkgJsonContent, 'utf8');
  const pkgHash = sha256Hex(pkgJsonContent);

  const lockContent = "lockfileVersion: '9.0'\n";
  fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), lockContent, 'utf8');
  const lockHash = sha256Hex(lockContent);

  for (const dep of plan.exactDependencies) {
    const depPkg = path.join(root, 'node_modules', ...dep.name.split('/'), 'package.json');
    fs.mkdirSync(path.dirname(depPkg), { recursive: true });
    fs.writeFileSync(depPkg, JSON.stringify({ name: dep.name, version: dep.version }), 'utf8');
  }

  // 写入 plan 中声明的生成文件
  const afterHashes: IntegrationApplyResultV1['afterHashes'] = [
    { path: 'package.json', exists: true, sha256: pkgHash },
    { path: 'pnpm-lock.yaml', exists: true, sha256: lockHash },
  ];
  for (const ch of plan.changes) {
    if (ch.kind === 'generated-component') {
      const target = path.join(root, ch.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const content = `<template><div class="zhinexus-chart-host">ok</div></template>\n`;
      fs.writeFileSync(target, content, 'utf8');
      afterHashes.push({ path: ch.path, exists: true, sha256: sha256Hex(content) });
    }
  }

  const canonicalRoot = canonicalProjectRoot(root);
  plan.localProject.workspace = '.';
  plan.localProject.fileSnapshots = [
    { path: 'package.json', exists: true, sha256: pkgHash },
    { path: 'pnpm-lock.yaml', exists: true, sha256: lockHash },
  ];
  plan.baseFileHashes = [
    { path: 'package.json', exists: true, sha256: pkgHash },
    { path: 'pnpm-lock.yaml', exists: true, sha256: lockHash },
    { path: 'src/components/zhinexus/component-0001.vue', exists: false },
  ];
  applyResult.projectRoot = canonicalRoot;
  applyResult.planDigest = canonicalDigest(plan);
  applyResult.afterHashes = afterHashes;
  applyResult.installedVersions = [];

  return { root, canonicalRoot, artifactRoot, plan, applyResult };
}

async function startHostServer(mode: 'ok' | 'click-broken' | 'zero-size' | 'pageerror' | 'outbound' | 'popup' | 'alt-visual'): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const reqPath = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (reqPath === '/generated-module.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(`
        export function mountChart(el, mode) {
          const box = document.createElement('div');
          box.className = 'chart-box';
          box.style.width = mode === 'zero-size' ? '0px' : '400px';
          box.style.height = mode === 'zero-size' ? '0px' : '240px';
          box.style.background = mode === 'alt-visual' ? '#ff3366' : '#1677ff';
          box.textContent = mode === 'alt-visual' ? 'ALT' : 'READY';
          el.appendChild(box);
        }
      `);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>Generated Host</title></head>
<body style="margin:0;padding:16px;background:#fff;font-family:sans-serif;">
  <div id="app"></div>
  <input id="filter" value="" />
  <button id="refresh" type="button">Refresh</button>
  <div id="status">idle</div>
  <ul id="items"><li class="item">1</li></ul>
  <script type="module">
    import { mountChart } from '/generated-module.js';
    const mode = ${JSON.stringify(mode)};
    mountChart(document.getElementById('app'), mode);
    if (mode === 'pageerror') {
      throw new Error('Synthetic runtime pageerror');
    }
    if (mode === 'outbound') {
      fetch('https://example.com/leak').catch(() => {});
    }
    if (mode === 'popup') {
      window.open('http://127.0.0.1/popup', '_blank');
    }
    document.getElementById('refresh').addEventListener('click', () => {
      if (mode !== 'click-broken') {
        const inputVal = document.getElementById('filter').value;
        document.getElementById('status').textContent = 'clicked:' + inputVal;
        const li = document.createElement('li');
        li.className = 'item';
        li.textContent = '2';
        document.getElementById('items').appendChild(li);
      }
    });
    document.body.setAttribute('data-ready', 'true');
  </script>
</body>
</html>`);
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

test('verifyIntegration 真实 Chromium 交互、安全隔离与视觉三态验收', async () => {
  const cliExports = await loadT17CliExports();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zhinexus-t17-browser-'));

  try {
    const { root, canonicalRoot, artifactRoot, plan, applyResult } = setupFakeProjectForBrowser(tempRoot);
    const planDigest = canonicalDigest(plan);
    const applyResultDigest = canonicalDigest(applyResult);
    const pkgHash = applyResult.afterHashes.find(h => h.path === 'package.json')!.sha256!;

    const makeBrowserSpecAndAuth = (
      url: string,
      visual?: NonNullable<IntegrationVerificationSpecV1['browser']>['visual'],
    ): { spec: IntegrationVerificationSpecV1; authorization: IntegrationExecutionAuthorizationV1 } => {
      const spec: IntegrationVerificationSpecV1 = {
        schemaVersion: 1,
        projectRoot: canonicalRoot,
        planDigest,
        applyResultDigest,
        commands: [
          { kind: 'type', script: 'typecheck', manifestPath: 'package.json', manifestSha256: pkgHash, timeoutMs: 20_000, outputDirectories: [] },
          { kind: 'build', script: 'build', manifestPath: 'package.json', manifestSha256: pkgHash, timeoutMs: 20_000, outputDirectories: [] },
        ],
        browser: {
          url,
          readySelector: '[data-ready="true"]',
          timeoutMs: 15_000,
          viewport: { width: 800, height: 400 },
          renderer: 'canvas',
          theme: 'light',
          actions: [
            { kind: 'fill', selector: '#filter', value: 'q4' },
            { kind: 'click', selector: '#refresh' },
          ],
          assertions: [
            { kind: 'visible', selector: '.chart-box' },
            { kind: 'text', selector: '#status', value: 'clicked:q4' },
            { kind: 'count', selector: '#items .item', count: 2 },
          ],
          ...(visual ? { visual } : {}),
        },
        businessGaps: [],
      };
      const specDigest = canonicalDigest(spec);
      const authorization: IntegrationExecutionAuthorizationV1 = {
        schemaVersion: 1,
        projectRoot: canonicalRoot,
        planDigest,
        applyResultDigest,
        specDigest,
        operation: 'verify',
        allowProjectScripts: true,
        allowBrowser: true,
        scriptNames: ['typecheck', 'build'],
        allowedRepairPaths: [],
        maxAttempts: 0,
      };
      return { spec, authorization };
    };

    // 1. NEW (无基线): 浏览器交互通过，但 visualResult 为 NEW，总状态不能为 passed
    const okHost = await startHostServer('ok');
    try {
      const { spec: newSpec, authorization: newAuth } = makeBrowserSpecAndAuth(okHost.url);
      const newReport = await callVerify(cliExports, root, plan, { applyResult, spec: newSpec, authorization: newAuth, artifactRoot });
      expect(newReport).toBeDefined();
      expect(newReport!.status).toBe('failed');
      expect(newReport!.visualResult).toBe('NEW');
      expect(newReport!.checks.find(c => c.category === 'behavior' && c.id !== 'dependency-guard')?.status).toBe('passed');
      expect(newReport!.environment).toBeDefined();

      // 找到产出的真实截图并作为基线保存
      const shotRef = newReport!.artifacts.find(a => a.path.endsWith('.png'));
      expect(shotRef).toBeDefined();
      expect(shotRef!.bytes).toBeGreaterThan(0);
      const baselineRel = 'baselines/generated-ok.png';
      const baselineAbs = path.join(artifactRoot, baselineRel);
      fs.mkdirSync(path.dirname(baselineAbs), { recursive: true });
      fs.copyFileSync(path.join(artifactRoot, shotRef!.path), baselineAbs);
      const baselineBytesBefore = fs.readFileSync(baselineAbs);
      const baselineSha = sha256Hex(baselineBytesBefore);

      // 2. PASS (匹配基线与环境)
      const { spec: passSpec, authorization: passAuth } = makeBrowserSpecAndAuth(okHost.url, {
        baseline: {
          image: { path: baselineRel, sha256: baselineSha, bytes: baselineBytesBefore.length },
          environment: newReport!.environment!,
        },
        pixelThreshold: 0.1,
        maxDiffPixelRatio: 0.001,
      });
      const passReport = await callVerify(cliExports, root, plan, { applyResult, spec: passSpec, authorization: passAuth, artifactRoot });
      expect(passReport).toBeDefined();
      expect(passReport!.status).toBe('passed');
      expect(passReport!.visualResult).toBe('PASS');
      expect(fs.readFileSync(baselineAbs).equals(baselineBytesBefore)).toBe(true);

      // 3. INCOMPATIBLE (基线环境不匹配)
      const { spec: incompSpec, authorization: incompAuth } = makeBrowserSpecAndAuth(okHost.url, {
        baseline: {
          image: { path: baselineRel, sha256: baselineSha, bytes: baselineBytesBefore.length },
          environment: { ...newReport!.environment!, locale: 'en-US' },
        },
        pixelThreshold: 0.1,
        maxDiffPixelRatio: 0.001,
      });
      const incompReport = await callVerify(cliExports, root, plan, { applyResult, spec: incompSpec, authorization: incompAuth, artifactRoot });
      expect(incompReport).toBeDefined();
      expect(incompReport!.status).toBe('failed');
      expect(incompReport!.visualResult).toBe('INCOMPATIBLE');
      expect(fs.readFileSync(baselineAbs).equals(baselineBytesBefore)).toBe(true);

      // 4. DIFF (不同视觉画面 vs 已有基线)
      const altHost = await startHostServer('alt-visual');
      try {
        const { spec: diffSpec, authorization: diffAuth } = makeBrowserSpecAndAuth(altHost.url, {
          baseline: {
            image: { path: baselineRel, sha256: baselineSha, bytes: baselineBytesBefore.length },
            environment: newReport!.environment!,
          },
          pixelThreshold: 0.1,
          maxDiffPixelRatio: 0.001,
        });
        const diffReport = await callVerify(cliExports, root, plan, { applyResult, spec: diffSpec, authorization: diffAuth, artifactRoot });
        expect(diffReport).toBeDefined();
        expect(diffReport!.status).toBe('failed');
        expect(diffReport!.visualResult).toBe('DIFF');
        expect(fs.readFileSync(baselineAbs).equals(baselineBytesBefore)).toBe(true);
      } finally {
        await altHost.close();
      }
    } finally {
      await okHost.close();
    }

    // 5. 类型通过但点击失败 / 零尺寸 / pageerror / 外发 / 弹窗均失败
    for (const badMode of ['click-broken', 'zero-size', 'pageerror', 'outbound', 'popup'] as const) {
      const badHost = await startHostServer(badMode);
      try {
        const { spec, authorization } = makeBrowserSpecAndAuth(badHost.url);
        const badReport = await callVerify(cliExports, root, plan, { applyResult, spec, authorization, artifactRoot });
        expect(badReport).toBeDefined();
        expect(badReport!.status).toBe('failed');
      } finally {
        await badHost.close();
      }
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
