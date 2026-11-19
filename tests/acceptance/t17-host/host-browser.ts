/**
 * T17 owned-host 真实浏览器宿主、构建图取证与显式独立视觉基线辅助。
 *
 * 边界：
 * - 视觉基线必须由调用方显式提供已批准的独立 PNG 文件与 `EnvironmentV1`，绝不自动接受候选截图为基线；
 * - 浏览器仅访问本次 owned loopback 宿主 origin，拦截任何非 loopback 外发与下载；
 * - 构建图与 dist 产物经 `verifyBuiltImportEvidence` 复核后才构成真实生成模块导入证据。
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { chromium } from '@playwright/test';
import type { ArtifactRef, EnvironmentV1, IntegrationVerificationSpecV1 } from '@company/contracts';
import type { BuiltHost, Framework } from './host.js';
import { createBrowserAssetRecorder, type BrowserAsset } from './runtime.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export type ApprovedVisualBaseline = {
  imagePath: string;
  sha256: string;
  bytes: number;
  environment: EnvironmentV1;
};

export type StagedVisualBaseline = {
  relativePath: string;
  artifact: ArtifactRef;
  environment: EnvironmentV1;
};

export type BuiltGraphEvidence = {
  emittedEntry: string;
  sourceMapPath: string;
  viteModules: string[];
  emittedAssetSha256: string;
};

function assertInside(root: string, target: string, label: string): void {
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error(`${label} escapes its allowed root.`);
  }
}

function assertExactLoopbackHttpUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Browser host URL must be a valid loopback HTTP URL.');
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /[?#\\]/.test(value)
  ) {
    throw new Error('Browser host URL must be an exact loopback HTTP URL without credentials, query, or fragment.');
  }
  return value;
}

/**
 * 核验并落盘显式批准的独立视觉基线 PNG，绝不修改原基线字节或自动接受候选截图。
 */
export async function stageApprovedVisualBaseline(
  baseline: ApprovedVisualBaseline,
  verifyOutArea: string,
  framework: Framework,
): Promise<StagedVisualBaseline> {
  if (!isAbsolute(baseline.imagePath)) {
    throw new Error('Approved visual baseline imagePath must be an absolute path.');
  }
  if (!/^[0-9a-f]{64}$/.test(baseline.sha256) || !Number.isSafeInteger(baseline.bytes) || baseline.bytes <= 0) {
    throw new Error('Approved visual baseline digest or byte count is invalid.');
  }
  const sourcePath = resolve(baseline.imagePath);
  const stat = await lstat(sourcePath).catch(() => undefined);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.nlink > 1) {
    throw new Error('Approved visual baseline must be an ordinary unlinked file.');
  }
  const realSource = await realpath(sourcePath);
  const normalize = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
  if (normalize(realSource) !== normalize(sourcePath)) {
    throw new Error('Approved visual baseline path must not traverse a symlink or junction.');
  }
  const bytes = await readFile(sourcePath);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Approved visual baseline must be a valid PNG image.');
  }
  if (bytes.length !== baseline.bytes || sha(bytes) !== baseline.sha256) {
    throw new Error('Approved visual baseline SHA-256 digest or byte length mismatch.');
  }

  const outRoot = await realpath(resolve(verifyOutArea));
  const relativePath = `baselines/${framework}-baseline.png`;
  const destPath = resolve(outRoot, 'baselines', `${framework}-baseline.png`);
  assertInside(outRoot, destPath, 'Staged visual baseline');
  await mkdir(resolve(outRoot, 'baselines'), { recursive: true });
  await writeFile(destPath, bytes, { flag: 'wx' });

  return {
    relativePath,
    artifact: {
      path: relativePath,
      sha256: baseline.sha256,
      bytes: baseline.bytes,
    },
    environment: baseline.environment,
  };
}

/**
 * 读取 Vite 构建图（T17_BUILD_GRAPH_OUT）并核验入口产物与 sourcemap 位于项目 dist/ 内。
 */
export async function readBuiltGraphEvidence(
  projectRoot: string,
  buildGraphPath: string,
): Promise<BuiltGraphEvidence> {
  const root = await realpath(resolve(projectRoot));
  const graphStat = await lstat(buildGraphPath).catch(() => undefined);
  if (!graphStat?.isFile() || graphStat.isSymbolicLink() || graphStat.nlink > 1) {
    throw new Error('Build graph evidence must be an ordinary unlinked file.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(buildGraphPath, 'utf8'));
  } catch {
    throw new Error('Build graph evidence is not valid JSON.');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Build graph evidence must be an array of emitted chunks.');
  }
  const entryChunk = parsed.find(
    chunk => isRecord(chunk) && chunk.entry === true && typeof chunk.file === 'string' && Array.isArray(chunk.modules),
  ) as { file: string; entry: true; modules: unknown[] } | undefined;
  if (!entryChunk) {
    throw new Error('Build graph evidence does not contain an entry chunk.');
  }
  const normalizedFile = entryChunk.file.replaceAll('\\', '/').replace(/^\/+/, '');
  const emittedEntry = `dist/${normalizedFile}`;
  const sourceMapPath = `${emittedEntry}.map`;
  const emittedAbs = resolve(root, ...emittedEntry.split('/'));
  const mapAbs = resolve(root, ...sourceMapPath.split('/'));
  assertInside(root, emittedAbs, 'Emitted entry bundle');
  assertInside(root, mapAbs, 'Emitted source map');

  const emittedStat = await lstat(emittedAbs).catch(() => undefined);
  if (!emittedStat?.isFile() || emittedStat.isSymbolicLink() || emittedStat.nlink > 1) {
    throw new Error(`Emitted entry bundle is missing or unsafe: ${emittedEntry}`);
  }
  const emittedBytes = await readFile(emittedAbs);
  // Rollup/Rolldown virtual modules have no filesystem identity. Keep all real
  // module IDs (including Vue query suffixes) for the strict import verifier.
  const viteModules = entryChunk.modules.filter((m): m is string => typeof m === 'string' && !m.startsWith('\u0000'));

  return {
    emittedEntry,
    sourceMapPath,
    viteModules,
    emittedAssetSha256: sha(emittedBytes),
  };
}

export function buildHostBrowserSpec(params: {
  url: string;
  stagedBaseline?: StagedVisualBaseline;
  readySelector?: string;
  timeoutMs?: number;
  actions?: NonNullable<IntegrationVerificationSpecV1['browser']>['actions'];
  assertions?: NonNullable<IntegrationVerificationSpecV1['browser']>['assertions'];
  pixelThreshold?: number;
  maxDiffPixelRatio?: number;
}): NonNullable<IntegrationVerificationSpecV1['browser']> {
  const url = assertExactLoopbackHttpUrl(params.url);
  const env = params.stagedBaseline?.environment;
  const viewport = env ? { width: env.width, height: env.height } : { width: 800, height: 400 };
  const renderer = env ? env.renderer : 'canvas';
  const theme = env ? env.theme : 'light';

  return {
    url,
    readySelector: params.readySelector ?? '[data-testid="ready"]',
    timeoutMs: params.timeoutMs ?? 30_000,
    viewport,
    renderer,
    theme,
    actions: params.actions ?? [{ kind: 'click', selector: 'canvas' }],
    assertions: params.assertions ?? [
      { kind: 'visible', selector: '[data-testid="ready"]' },
      { kind: 'visible', selector: 'canvas' },
      { kind: 'text', selector: '[data-testid="event-count"]', value: '1' },
      {
        kind: 'text', selector: '[data-testid="event-payload"]',
        value: '{"seriesId":"revenue","dataIndex":1,"value":["Tuesday",75],"nativeType":"click"}',
      },
    ],
    ...(params.stagedBaseline
      ? {
          visual: {
            baseline: {
              image: params.stagedBaseline.artifact,
              environment: params.stagedBaseline.environment,
            },
            pixelThreshold: params.pixelThreshold ?? 0.1,
            maxDiffPixelRatio: params.maxDiffPixelRatio ?? 0.001,
          },
        }
      : {}),
  };
}

async function launchLocalChromium() {
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const msPlaywright = join(localAppData, 'ms-playwright');
      if (fs.existsSync(msPlaywright)) {
        const dirs = fs
          .readdirSync(msPlaywright, { withFileTypes: true })
          .filter(d => d.isDirectory() && d.name.startsWith('chromium_headless_shell-'))
          .map(d => d.name)
          .sort()
          .reverse();
        for (const dir of dirs) {
          const exe = join(msPlaywright, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
          if (fs.existsSync(exe)) {
            return await chromium.launch({ headless: true, executablePath: exe });
          }
        }
      }
    }
    throw err;
  }
}

/**
 * 通过真实无头 Chromium 访问 owned loopback 宿主，记录同源加载资源并返回快照。
 */
export async function collectBrowserLoadedAssets(
  host: BuiltHost,
  options?: { readySelector?: string; timeoutMs?: number },
): Promise<BrowserAsset[]> {
  const url = assertExactLoopbackHttpUrl(host.url);
  const origin = new URL(url).origin;
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const readySelector = options?.readySelector ?? '[data-testid="ready"]';
  const recorder = createBrowserAssetRecorder(origin);

  const browser = await launchLocalChromium();
  try {
    const context = await browser.newContext({
      viewport: { width: 800, height: 400 },
      deviceScaleFactor: 1,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      acceptDownloads: false,
    });
    const page = await context.newPage();
    const pending: Promise<void>[] = [];
    page.on('response', response => {
      pending.push(recorder.record(response).catch(() => undefined));
    });
    await context.route('**/*', async route => {
      const reqUrl = route.request().url();
      try {
        if (new URL(reqUrl).origin !== origin) {
          await route.abort();
          return;
        }
      } catch {
        await route.abort();
        return;
      }
      await route.continue();
    });

    await page.goto(url, { timeout: timeoutMs, waitUntil: 'networkidle' });
    await page.locator(readySelector).first().waitFor({ state: 'visible', timeout: timeoutMs });
    await Promise.all(pending);
    return recorder.snapshot();
  } finally {
    await browser.close().catch(() => {});
  }
}
