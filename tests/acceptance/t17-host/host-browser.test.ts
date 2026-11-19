/**
 * T17 owned-host 真实浏览器宿主与独立视觉基线辅助测试（RED → GREEN）。
 *
 * 覆盖：
 * - 显式独立视觉基线（stageApprovedVisualBaseline）：拒绝缺失/相对路径/链接/非 PNG/摘要不符，绝不自动接受候选截图；
 * - 构建图证据（readBuiltGraphEvidence）：解析 Vite build graph、entry chunk、sourcemap 与 dist 字节摘要；
 * - 浏览器验证规范构造（buildHostBrowserSpec）：仅接受精确 loopback URL，绑定 viewport/renderer/theme 与独立基线；
 * - 真实 Chromium 加载 owned loopback 宿主并记录模块资源字节（collectBrowserLoadedAssets + verifyBuiltImportEvidence）。
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EnvironmentV1 } from '@company/contracts';
import { createOwnedRun, startBuiltHost, verifyBuiltImportEvidence } from './host.js';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
// 最小合法 1x1 PNG 字节（签名 + IHDR + IDAT + IEND）
const MINIMAL_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex',
);

const SAMPLE_ENV: EnvironmentV1 = {
  os: 'windows',
  arch: 'x64',
  browserVersion: '158.0.0.0',
  browserRevision: '1254',
  fontDigest: '3'.repeat(64),
  locale: 'zh-CN',
  timezone: 'Asia/Shanghai',
  deviceScaleFactor: 1,
  renderer: 'canvas',
  width: 800,
  height: 400,
  theme: 'light',
  frameworkVersion: '3.5.45',
  echartsVersion: '6.1.0',
};

async function loadHostBrowser(): Promise<Record<string, unknown>> {
  try {
    return (await import('./host-browser.js')) as unknown as Record<string, unknown>;
  } catch {
    return {};
  }
}

describe('T17 owned-host 浏览器宿主与独立视觉基线', () => {
  it('stageApprovedVisualBaseline 仅接受显式批准的普通 PNG 基线，拒绝非 PNG、篡改摘要或符号链接', async () => {
    const mod = await loadHostBrowser();
    expect(typeof mod.stageApprovedVisualBaseline).toBe('function');
    const stageBaseline = mod.stageApprovedVisualBaseline as (
      baseline: { imagePath: string; sha256: string; bytes: number; environment: EnvironmentV1 },
      verifyOutArea: string,
      framework: 'vue' | 'react',
    ) => Promise<{ relativePath: string; artifact: { path: string; sha256: string; bytes: number }; environment: EnvironmentV1 }>;

    const root = await mkdtemp(join(tmpdir(), 'zhinexus-t17-baseline-test-'));
    try {
      const baselineFile = join(root, 'approved-vue.png');
      const notPngFile = join(root, 'fake.png');
      const outDir = join(root, 'verify-out');
      await mkdir(outDir);
      await writeFile(baselineFile, MINIMAL_PNG);
      await writeFile(notPngFile, Buffer.from('not-a-png-file'));

      // 合法独立 PNG 基线成功落盘到 baselines/vue-baseline.png 且原基线不变
      const staged = await stageBaseline(
        { imagePath: baselineFile, sha256: sha(MINIMAL_PNG), bytes: MINIMAL_PNG.length, environment: SAMPLE_ENV },
        outDir,
        'vue',
      );
      expect(staged.relativePath).toBe('baselines/vue-baseline.png');
      expect(staged.artifact).toEqual({
        path: 'baselines/vue-baseline.png',
        sha256: sha(MINIMAL_PNG),
        bytes: MINIMAL_PNG.length,
      });
      expect(await readFile(join(outDir, 'baselines/vue-baseline.png'))).toEqual(MINIMAL_PNG);
      expect(await readFile(baselineFile)).toEqual(MINIMAL_PNG);

      // 非 PNG 字节拒绝
      await expect(
        stageBaseline(
          { imagePath: notPngFile, sha256: sha(Buffer.from('not-a-png-file')), bytes: 14, environment: SAMPLE_ENV },
          outDir,
          'react',
        ),
      ).rejects.toThrow(/PNG/i);

      // 摘要不符拒绝
      await expect(
        stageBaseline(
          { imagePath: baselineFile, sha256: '0'.repeat(64), bytes: MINIMAL_PNG.length, environment: SAMPLE_ENV },
          outDir,
          'react',
        ),
      ).rejects.toThrow(/sha|digest/i);

      // 相对路径拒绝
      await expect(
        stageBaseline(
          { imagePath: 'relative/vue.png', sha256: sha(MINIMAL_PNG), bytes: MINIMAL_PNG.length, environment: SAMPLE_ENV },
          outDir,
          'react',
        ),
      ).rejects.toThrow(/absolute/i);

      // 祖先目录 junction/符号链接拒绝（Windows 无需管理员权限）
      const realDir = join(root, 'real-baselines');
      await mkdir(realDir);
      await writeFile(join(realDir, 'approved.png'), MINIMAL_PNG);
      const linkDir = join(root, 'linked-baselines');
      await symlink(realDir, linkDir, process.platform === 'win32' ? 'junction' : 'dir');
      await expect(
        stageBaseline(
          { imagePath: join(linkDir, 'approved.png'), sha256: sha(MINIMAL_PNG), bytes: MINIMAL_PNG.length, environment: SAMPLE_ENV },
          outDir,
          'react',
        ),
      ).rejects.toThrow(/symlink|junction|link|ordinary/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('readBuiltGraphEvidence 解析 Vite 构建图与 dist 产物，缺失 entry 或越界路径立即拒绝', async () => {
    const mod = await loadHostBrowser();
    expect(typeof mod.readBuiltGraphEvidence).toBe('function');
    const readGraph = mod.readBuiltGraphEvidence as (
      projectRoot: string,
      buildGraphPath: string,
    ) => Promise<{ emittedEntry: string; sourceMapPath: string; viteModules: string[]; emittedAssetSha256: string }>;

    const root = await mkdtemp(join(tmpdir(), 'zhinexus-t17-graph-test-'));
    try {
      const assetsDir = join(root, 'dist', 'assets');
      await mkdir(assetsDir, { recursive: true });
      const jsBytes = Buffer.from('console.log("built");\n');
      const mapBytes = Buffer.from(JSON.stringify({ version: 3, sources: ['../../src/components/zhinexus/component-0001.vue'] }));
      await writeFile(join(assetsDir, 'index-abc.js'), jsBytes);
      await writeFile(join(assetsDir, 'index-abc.js.map'), mapBytes);

      const graphFile = join(root, 'graph.json');
      const genAbs = join(root, 'src', 'components', 'zhinexus', 'component-0001.vue');
      await writeFile(
        graphFile,
        JSON.stringify([{ file: 'assets/index-abc.js', entry: true, modules: [
          '\u0000rolldown/runtime.js', '\u0000vite/modulepreload-polyfill.js',
          genAbs + '?vue&type=script&setup=true&lang.ts', genAbs,
        ] }]),
      );

      const evidence = await readGraph(root, graphFile);
      expect(evidence.emittedEntry).toBe('dist/assets/index-abc.js');
      expect(evidence.sourceMapPath).toBe('dist/assets/index-abc.js.map');
      expect(evidence.emittedAssetSha256).toBe(sha(jsBytes));
      expect(evidence.viteModules).toEqual([genAbs + '?vue&type=script&setup=true&lang.ts', genAbs]);

      // 无 entry chunk 拒绝
      const emptyGraph = join(root, 'empty-graph.json');
      await writeFile(emptyGraph, JSON.stringify([{ file: 'assets/index-abc.js', entry: false, modules: [] }]));
      await expect(readGraph(root, emptyGraph)).rejects.toThrow(/entry/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('buildHostBrowserSpec 仅接受精确 loopback URL 并对齐独立视觉基线环境', async () => {
    const mod = await loadHostBrowser();
    expect(typeof mod.buildHostBrowserSpec).toBe('function');
    const buildSpec = mod.buildHostBrowserSpec as (params: {
      url: string;
      stagedBaseline?: { relativePath: string; artifact: { path: string; sha256: string; bytes: number }; environment: EnvironmentV1 };
      timeoutMs?: number;
    }) => Record<string, unknown>;

    const valid = buildSpec({
      url: 'http://127.0.0.1:4173/',
      stagedBaseline: {
        relativePath: 'baselines/vue-baseline.png',
        artifact: { path: 'baselines/vue-baseline.png', sha256: sha(MINIMAL_PNG), bytes: MINIMAL_PNG.length },
        environment: SAMPLE_ENV,
      },
    });
    expect(valid.url).toBe('http://127.0.0.1:4173/');
    expect(valid.viewport).toEqual({ width: 800, height: 400 });
    expect(valid.renderer).toBe('canvas');
    expect(valid.theme).toBe('light');
    expect(valid.assertions).toContainEqual({ kind: 'text', selector: '[data-testid="event-count"]', value: '1' });
    expect(valid.assertions).toContainEqual({
      kind: 'text', selector: '[data-testid="event-payload"]',
      value: '{"seriesId":"revenue","dataIndex":1,"value":["Tuesday",75],"nativeType":"click"}',
    });
    expect((valid.visual as Record<string, unknown>)?.pixelThreshold).toBe(0.1);

    // 非 loopback URL 拒绝
    expect(() => buildSpec({ url: 'https://example.com/' })).toThrow(/loopback/i);
    expect(() => buildSpec({ url: 'http://127.0.0.1:4173/?token=secret' })).toThrow(/loopback|query/i);
  });

  it('collectBrowserLoadedAssets 通过真实 Chromium 加载 owned loopback 宿主并对齐 verifyBuiltImportEvidence', async () => {
    const mod = await loadHostBrowser();
    expect(typeof mod.collectBrowserLoadedAssets).toBe('function');
    const collectAssets = mod.collectBrowserLoadedAssets as (
      host: Awaited<ReturnType<typeof startBuiltHost>>,
      options?: { readySelector?: string; timeoutMs?: number },
    ) => Promise<{ url: string; path: string; sha256: string; bytes: number; status: number }[]>;

    const run = await createOwnedRun({ baseDirectory: tmpdir() });
    try {
      const projectRoot = run.projectRoots.vue;
      const genRel = 'src/components/zhinexus/component-0001.vue';
      const genAbs = join(projectRoot, genRel);
      await mkdir(join(projectRoot, 'src/components/zhinexus'), { recursive: true });
      await writeFile(genAbs, '<template><div>ok</div></template>\n');

      const assetsDir = join(projectRoot, 'dist/assets');
      await mkdir(assetsDir, { recursive: true });
      const bundleJs = Buffer.from('document.querySelector("[data-testid=ready]").dataset.loaded="1";\n');
      const bundleMap = Buffer.from(
        JSON.stringify({ version: 3, sources: ['../../src/components/zhinexus/component-0001.vue'] }),
      );
      await writeFile(join(assetsDir, 'entry.js'), bundleJs);
      await writeFile(join(assetsDir, 'entry.js.map'), bundleMap);
      const graphPath = join(projectRoot, 'dist/build-graph.json');
      await writeFile(graphPath, JSON.stringify([{
        file: 'assets/entry.js', entry: true,
        modules: ['\u0000rolldown/runtime.js', '\u0000vite/modulepreload-polyfill.js', genAbs],
      }]));
      await writeFile(
        join(projectRoot, 'dist/index.html'),
        '<!doctype html><html><body><h1 data-testid="ready">T17 host</h1><script type="module" src="/assets/entry.js"></script></body></html>\n',
      );
      await run.registerOwnedPath(projectRoot, ['src', 'dist']);

      const host = await startBuiltHost({ projectRoot, run });
      try {
        const loaded = await collectAssets(host, { readySelector: '[data-testid="ready"]', timeoutMs: 20_000 });
        const { readBuiltGraphEvidence } = await import('./host-browser.js');
        const graph = await readBuiltGraphEvidence(projectRoot, graphPath);
        const verified = await verifyBuiltImportEvidence({
          projectRoot,
          generatedPath: genRel,
          emittedEntry: 'dist/assets/entry.js',
          sourceMapPath: 'dist/assets/entry.js.map',
          viteModules: graph.viteModules,
          host,
          loadedAssets: loaded,
          emittedAssetSha256: sha(bundleJs),
        });
        expect(verified.generatedModuleIncluded).toBe(true);
        expect(verified.browserLoadedBuiltAsset).toBe(true);
        // Only NUL-prefixed virtual IDs are removed; ordinary relative IDs
        // remain invalid input to the unchanged strict verifier.
        await expect(verifyBuiltImportEvidence({
          projectRoot, generatedPath: genRel, emittedEntry: graph.emittedEntry, sourceMapPath: graph.sourceMapPath,
          viteModules: ['./relative-module.ts', genAbs], host, loadedAssets: loaded, emittedAssetSha256: sha(bundleJs),
        })).rejects.toThrow(/absolute/i);
      } finally {
        await host.close();
      }
    } finally {
      await run.abortForTest();
    }
  });
});
