/**
 * T17 owned-host 独立参考视觉基线生成器测试（RED → GREEN）。
 *
 * 覆盖：
 * - 手写直接 SDK 宿主（scaffoldReferenceSdkProject）直接导入 @company/charts-{vue,react}，
 *   绝不引用或读取被测生成模块（components/zhinexus/component-0001）；
 * - captureReferenceBaselineFromHost 通过真实 Chromium 与可注入 EnvironmentMeasurer 采集真实参考 PNG 与 EnvironmentV1，
 *   不硬编码假 fontDigest/browserRevision，且在仓外 owner 根封存后清理临时宿主；
 * - verifyIndependentReferenceBaselineSeal 拒绝被篡改的 PNG 或 run-seal.json。
 */
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EnvironmentV1 } from '@company/contracts';
import { createOwnedRun, startBuiltHost } from './host.js';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

async function loadBaselineRef(): Promise<Record<string, unknown>> {
  try {
    return (await import('./baseline-reference.js')) as unknown as Record<string, unknown>;
  } catch {
    return {};
  }
}

describe('T17 owned-host 独立参考基线生成器', () => {
  it('scaffoldReferenceSdkProject 仅生成手写直接 SDK 导入宿主，不引用任何被测生成模块', async () => {
    const mod = await loadBaselineRef();
    expect(typeof mod.scaffoldReferenceSdkProject).toBe('function');
    const scaffoldRef = mod.scaffoldReferenceSdkProject as (
      run: Awaited<ReturnType<typeof createOwnedRun>>,
      framework: 'vue' | 'react',
      sdkVersion: string,
    ) => Promise<{ root: string; framework: 'vue' | 'react' }>;

    const run = await createOwnedRun({ baseDirectory: tmpdir() });
    try {
      const vueProj = await scaffoldRef(run, 'vue', '0.0.12');
      const vueApp = await readFile(join(vueProj.root, 'src/App.vue'), 'utf8');
      expect(vueApp).toContain('@company/charts-vue/line');
      expect(vueApp).toContain('@company/charts-vue/style.css');
      expect(vueApp).not.toContain('component-0001');
      expect(vueApp).not.toContain('components/zhinexus');
      expect(vueApp).not.toContain('ZhinexusComponent');

      const reactProj = await scaffoldRef(run, 'react', '0.0.12');
      const reactMain = await readFile(join(reactProj.root, 'src/main.tsx'), 'utf8');
      expect(reactMain).toContain('@company/charts-react/line');
      expect(reactMain).toContain('@company/charts-react/style.css');
      expect(reactMain).not.toContain('component-0001');
      expect(reactMain).not.toContain('components/zhinexus');
      expect(reactMain).not.toContain('ZhinexusComponent');
    } finally {
      await run.abortForTest();
    }
  });

  it('captureReferenceBaselineFromHost 采集真实参考 PNG、调用可注入 EnvironmentMeasurer 并封存校验', async () => {
    const mod = await loadBaselineRef();
    expect(typeof mod.captureReferenceBaselineFromHost).toBe('function');
    expect(typeof mod.verifyIndependentReferenceBaselineSeal).toBe('function');

    const captureRef = mod.captureReferenceBaselineFromHost as (params: {
      host: Awaited<ReturnType<typeof startBuiltHost>>;
      framework: 'vue' | 'react';
      frameworkVersion: string;
      echartsVersion: string;
      viewport?: { width: number; height: number };
      measureEnvironment?: (ctx: {
        browser: { version(): string };
        framework: 'vue' | 'react';
        frameworkVersion: string;
        echartsVersion: string;
        viewport: { width: number; height: number };
        renderer: 'canvas' | 'svg';
        theme: string;
        locale: string;
        timezone: string;
        deviceScaleFactor: number;
      }) => Promise<EnvironmentV1>;
    }) => Promise<{ pngBytes: Buffer; environment: EnvironmentV1; clickObserved: boolean }>;

    const verifySeal = mod.verifyIndependentReferenceBaselineSeal as (result: {
      runId: string;
      evidenceRoot: string;
      sealPath: string;
      sealSha256: string;
      baselines: {
        vue: { imagePath: string; sha256: string; bytes: number; environment: EnvironmentV1 };
        react: { imagePath: string; sha256: string; bytes: number; environment: EnvironmentV1 };
      };
    }) => Promise<void>;

    const run = await createOwnedRun({ baseDirectory: tmpdir() });
    let evidenceRootToClean: string | undefined;
    try {
      const projectRoot = run.projectRoots.vue;
      await mkdir(join(projectRoot, 'dist'), { recursive: true });
      await writeFile(
        join(projectRoot, 'dist/index.html'),
        `<!doctype html>
<html>
<body style="margin:0;background:#fff;">
  <main>
    <h1 data-testid="ready">T17 Vue host</h1>
    <div style="width:720px;height:360px"><canvas id="c" width="720" height="360"></canvas></div>
    <output data-testid="event-count">0</output>
    <output data-testid="event-payload">none</output>
  </main>
  <script>
    const c = document.getElementById('c');
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1677ff';
    ctx.fillRect(0, 0, 720, 360);
    c.addEventListener('click', () => {
      const out = document.querySelector('[data-testid="event-count"]');
      out.textContent = String(Number(out.textContent) + 1);
      document.querySelector('[data-testid="event-payload"]').textContent = JSON.stringify({seriesId:'revenue',dataIndex:1,value:['Tuesday',75],nativeType:'click'});
    });
  </script>
</body>
</html>`,
      );
      await run.registerOwnedPath(projectRoot, ['dist']);

      let measurerCalled = false;
      const customFontDigest = '9'.repeat(64);
      const host = await startBuiltHost({ projectRoot, run });
      let captured: { pngBytes: Buffer; environment: EnvironmentV1; clickObserved: boolean };
      try {
        captured = await captureRef({
          host,
          framework: 'vue',
          frameworkVersion: '3.5.45',
          echartsVersion: '6.1.0',
          viewport: { width: 800, height: 400 },
          measureEnvironment: async ctx => {
            measurerCalled = true;
            return {
              os: 'windows',
              arch: 'x64',
              browserVersion: ctx.browser.version(),
              browserRevision: 'measured-rev',
              fontDigest: customFontDigest,
              locale: ctx.locale,
              timezone: ctx.timezone,
              deviceScaleFactor: ctx.deviceScaleFactor,
              renderer: ctx.renderer,
              width: ctx.viewport.width,
              height: ctx.viewport.height,
              theme: ctx.theme,
              frameworkVersion: ctx.frameworkVersion,
              echartsVersion: ctx.echartsVersion,
            };
          },
        });
      } finally {
        await host.close();
      }

      expect(measurerCalled).toBe(true);
      expect(captured.clickObserved).toBe(true);
      expect(captured.pngBytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(captured.environment.fontDigest).toBe(customFontDigest);
      expect(captured.environment.browserRevision).toBe('measured-rev');

      // 封存双框架参考基线并验证 seal + 篡改拒绝
      const vueRef = await run.writeEvidence('vue-reference-baseline.png', captured.pngBytes);
      const reactRef = await run.writeEvidence('react-reference-baseline.png', captured.pngBytes);
      const baselines = {
        vue: { imagePath: vueRef.path, sha256: vueRef.sha256, bytes: vueRef.bytes, environment: captured.environment },
        react: { imagePath: reactRef.path, sha256: reactRef.sha256, bytes: reactRef.bytes, environment: { ...captured.environment, frameworkVersion: '19.3.1' } },
      };
      await run.stopOwnedProcesses();
      const sealPath = await run.sealEvidence({
        kind: 't17-independent-reference-baselines',
        productionAcceptance: false,
        baselines,
      });
      const sealSha256 = sha(await readFile(sealPath));
      await run.cleanup();
      evidenceRootToClean = run.evidenceRoot;

      // 临时参考工程已被清理，外部基线证据留存
      await expect(lstat(run.parentRoot)).rejects.toMatchObject({ code: 'ENOENT' });

      const sealedResult = {
        runId: run.runId,
        evidenceRoot: run.evidenceRoot,
        sealPath,
        sealSha256,
        baselines,
      };
      await expect(verifySeal(sealedResult)).resolves.toBeUndefined();

      // 篡改 PNG 字节必须被拒绝
      await writeFile(vueRef.path, Buffer.from('tampered'));
      await expect(verifySeal(sealedResult)).rejects.toThrow(/digest|seal|sha|PNG/i);
    } finally {
      await run.abortForTest().catch(() => undefined);
      if (evidenceRootToClean) {
        await rm(evidenceRootToClean, { recursive: true, force: true });
      }
    }
  });

  it('拒绝真实浏览器点击后事件断连或载荷与数据源不符的参考宿主', async () => {
    const { captureReferenceBaselineFromHost } = await import('./baseline-reference.js');
    for (const wrongPayload of [false, true]) {
      const run = await createOwnedRun({ baseDirectory: tmpdir() });
      let host: Awaited<ReturnType<typeof startBuiltHost>> | undefined;
      try {
        const root = run.projectRoots.vue;
        await mkdir(join(root, 'dist'));
        await writeFile(join(root, 'dist/index.html'), `<!doctype html>
          <h1 data-testid="ready">Disconnected SDK event</h1>
          <canvas width="720" height="360"></canvas>
          <output data-testid="event-count">0</output>
          <output data-testid="event-payload">none</output>
          ${wrongPayload ? `<script>document.querySelector('canvas').addEventListener('click',()=>{document.querySelector('[data-testid=event-count]').textContent='1';document.querySelector('[data-testid=event-payload]').textContent='wrong-series';});</script>` : ''}`);
        await run.registerOwnedPath(root, ['dist']);
        host = await startBuiltHost({ projectRoot: root, run });
        await expect(captureReferenceBaselineFromHost({
          host, framework: 'vue', frameworkVersion: '3.5.45', echartsVersion: '6.1.0', timeoutMs: 2_000,
        })).rejects.toThrow(/event|click|payload/i);
      } finally {
        await host?.close();
        await run.abortForTest();
      }
    }
  });
});
