/**
 * T17 A1 本地项目验证编排：`verifyIntegration`。
 *
 * 边界：
 * - 消费 T15 `IntegrationPlanV1`、T16 `IntegrationApplyResultV1`、独立 `IntegrationVerificationSpecV1`
 *   与显式 `IntegrationExecutionAuthorizationV1`；
 * - 公开入口守卫恒从 `applyResult.afterHashes` 出发，不接受外部替代哈希；
 * - 原生命令仅使用 `.tools` 固定工具链与 `shell: false`，禁用未授权 `pre`/`post` 钩子；
 * - 浏览器仅访问本次显式可信的 loopback URL，拦截外发、下载、弹窗与 `pageerror`；
 * - 报告 `passed` 要求五类检查 + `dependency-guard` 全通过、真实安装树核验、视觉 `PASS` 与匹配环境。
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium, errors } from '@playwright/test';
import {
  validateIntegrationApplyResult,
  type IntegrationApplyResultV1,
} from '../contracts/integration-apply.js';
import {
  validateIntegrationPlan,
  type IntegrationFileSnapshot,
  type IntegrationPlanV1,
} from '../contracts/integration-plan.js';
import {
  validateIntegrationExecutionAuthorization,
  validateIntegrationVerificationSpec,
  type IntegrationExecutionAuthorizationV1,
  type IntegrationVerificationCheck,
  type IntegrationVerificationIssue,
  type IntegrationVerificationReportV1,
  type IntegrationVerificationSpecV1,
} from '../contracts/integration-verification.js';
import type { ArtifactRef } from '../contracts/release-manifest.js';
import type { EnvironmentV1 } from '../contracts/reports.js';
import { compareBaseline } from '../local/compare.js';
import { captureBrowserEnvironment, VERIFICATION_BROWSER_CONTEXT } from './browser-environment.js';
import { canonicalProjectRoot } from './apply.js';
import { resolveToolchain, type ResolvedToolchain } from './install.js';
import { readNpmLock, readPnpmLock, resolveNpmDependency, resolvePnpmDependency } from './locks.js';
import {
  assertArtifactRootOutsideProject,
  buildVerificationReport,
  canonicalDigest,
  createRunArtifactSession,
  sanitizeDiagnosticText,
  sha256Hex,
  verificationIssue,
  type RunArtifactSession,
} from './report.js';
import { isInsideDirectory, isPlainObject, realpathOrSelf, toPosix } from './workspace.js';

export type VerifyIntegrationOptions = {
  applyResult: IntegrationApplyResultV1;
  spec: IntegrationVerificationSpecV1;
  authorization: IntegrationExecutionAuthorizationV1;
  artifactRoot: string;
  signal?: AbortSignal;
};

const FIXED_NODE_VERSION = '26.13.0';
const FIXED_NPM_VERSION = '11.20.0';
const FIXED_PNPM_VERSION = '12.18.0';

function resolveFixedToolchain(): ResolvedToolchain {
  try {
    return resolveToolchain(process.env as Record<string, string>);
  } catch {
    // 在 git worktree 或仓外安装运行中，.tools 位于当前固定 node.exe 所在目录的上一级
    const candidateToolRoot = path.resolve(path.dirname(process.execPath), '..');
    const nodeExe = path.join(candidateToolRoot, `node-v${FIXED_NODE_VERSION}-win-x64`, 'node.exe');
    const npmCli = path.join(candidateToolRoot, `node-v${FIXED_NODE_VERSION}-win-x64`, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const pnpmExe = path.join(candidateToolRoot, `pnpm-native-${FIXED_PNPM_VERSION}`, 'package', 'pnpm.exe');
    if (!fs.existsSync(nodeExe) || !fs.existsSync(npmCli) || !fs.existsSync(pnpmExe)) {
      throw new Error('TOOLCHAIN_UNAVAILABLE: 未找到固定 .tools 工具链');
    }
    const nodeVer = spawnSync(nodeExe, ['--version'], { shell: false, encoding: 'utf8' });
    if (nodeVer.status !== 0 || nodeVer.stdout.trim() !== `v${FIXED_NODE_VERSION}`) {
      throw new Error('TOOLCHAIN_UNAVAILABLE: Node 版本不匹配');
    }
    const npmVer = spawnSync(nodeExe, [npmCli, '--version'], { shell: false, encoding: 'utf8' });
    if (npmVer.status !== 0 || npmVer.stdout.trim() !== FIXED_NPM_VERSION) {
      throw new Error('TOOLCHAIN_UNAVAILABLE: npm 版本不匹配');
    }
    const pnpmVer = spawnSync(pnpmExe, ['--version'], { shell: false, encoding: 'utf8' });
    if (pnpmVer.status !== 0 || pnpmVer.stdout.trim() !== FIXED_PNPM_VERSION) {
      throw new Error('TOOLCHAIN_UNAVAILABLE: pnpm 版本不匹配');
    }
    return {
      toolRoot: candidateToolRoot,
      nodeExe,
      npmCli,
      pnpmExe,
      npmVersion: FIXED_NPM_VERSION,
      pnpmVersion: FIXED_PNPM_VERSION,
    };
  }
}

const MAX_SNAPSHOT_FILES = 10_000;
const MAX_SNAPSHOT_FILE_BYTES = 4 * 1024 * 1024;
const MAX_SNAPSHOT_TOTAL_BYTES = 256 * 1024 * 1024;
const ALLOWED_OUTPUT_LEAVES = new Set(['dist', 'build', '.next', 'out']);

function sanitizeBrowserDiagnostic(value: string): string {
  return sanitizeDiagnosticText(value)
    .replace(/(?:https?|wss?):\/\/[^\s"']+/gi, '[URL_REDACTED]')
    .replace(/\b(?:data|blob):[^\s"']*/gi, '[URL_REDACTED]')
    .replace(/((?:token|secret|password|authorization)=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/\b(?:token|secret|password|authorization):\s*[^\s"']+/gi, '$&'.replace(/^.*$/, '[REDACTED]'));
}

function isolatedScriptEnv(toolchain: ResolvedToolchain, isPnpm: boolean): Record<string, string> {
  const env: Record<string, string> = {};
  const keepKeys = ['SYSTEMROOT', 'SystemRoot', 'COMSPEC', 'ComSpec', 'WINDIR', 'windir', 'TEMP', 'TMP', 'PATHEXT'];
  for (const key of keepKeys) {
    const v = process.env[key];
    if (v !== undefined) env[key] = v;
  }
  const nodeDir = path.dirname(toolchain.nodeExe);
  const pnpmDir = path.dirname(toolchain.pnpmExe);
  env.PATH = `${nodeDir}${path.delimiter}${pnpmDir}${path.delimiter}${process.env.SystemRoot ?? 'C:\\Windows'}\\System32`;
  env.CI = 'true';
  env.NO_COLOR = '1';
  if (isPnpm) {
    env.PNPM_CONFIG_ENABLE_PRE_POST_SCRIPTS = 'false';
    env.PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS = 'false';
  }
  return env;
}

type NativeCommandResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: Error;
  timedOut: boolean;
  cancelled: boolean;
};

async function runNativeCommand(
  executable: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; signal?: AbortSignal },
): Promise<NativeCommandResult> {
  // 固定工具链和快照检查是同步操作；先处理已到期的取消，避免先启动脚本再终止。
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  if (options.signal?.aborted) {
    return { status: null, signal: null, stdout: '', stderr: '', timedOut: false, cancelled: true };
  }
  return new Promise(resolve => {
    const child = spawn(executable, [...args], {
      cwd: options.cwd, env: options.env, shell: false, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const outputLimit = 1024 * 1024;
    let stdout = '';
    let stderr = '';
    let error: Error | undefined;
    let timedOut = false;
    let cancelled = false;
    let termination: Promise<void> | undefined;
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(done => {
      child.once('close', (code, signal) => done({ code, signal }));
    });
    const append = (current: string, chunk: Buffer): string => {
      if (Buffer.byteLength(current) >= outputLimit) return current;
      const remaining = outputLimit - Buffer.byteLength(current);
      return current + chunk.subarray(0, remaining).toString('utf8');
    };
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.once('error', value => { error = value; });

    const terminateTree = (): Promise<void> => {
      if (termination) return termination;
      termination = (async () => {
        if (child.pid === undefined) {
          child.kill();
          await closed;
          return;
        }
        if (process.platform === 'win32') {
          const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows';
          const killer = spawn(path.join(systemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], {
            stdio: 'ignore', windowsHide: true, shell: false,
          });
          await new Promise<void>(done => {
            killer.once('error', () => {
              child.kill();
              done();
            });
            killer.once('close', code => {
              if (code !== 0 && child.exitCode === null) child.kill();
              done();
            });
          });
        } else {
          try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
          await Promise.race([closed.then(() => undefined), new Promise<void>(done => setTimeout(done, 500))]);
          try { process.kill(-child.pid, 'SIGKILL'); } catch { /* process group already exited */ }
        }
        await closed;
      })();
      return termination;
    };
    const onAbort = () => {
      cancelled = true;
      void terminateTree();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      void terminateTree();
    }, options.timeoutMs);
    if (options.signal?.aborted) onAbort();

    void closed.then(async result => {
      if (termination) await termination;
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ status: result.code, signal: result.signal, stdout, stderr, ...(error ? { error } : {}), timedOut, cancelled });
    });
  });
}

export function validateOutputDirectories(
  realProjectRoot: string,
  commands: IntegrationVerificationSpecV1['commands'],
): { ok: true; excludedRelPaths: Set<string> } | { ok: false; issue: IntegrationVerificationIssue } {
  const excludedRelPaths = new Set<string>();
  for (const cmd of commands) {
    const prefix = cmd.manifestPath.slice(0, -'package.json'.length);
    for (const dir of cmd.outputDirectories) {
      const leaf = dir.startsWith(prefix) ? dir.slice(prefix.length) : '';
      if (!ALLOWED_OUTPUT_LEAVES.has(leaf)) {
        return { ok: false, issue: verificationIssue('PATH_UNSAFE', dir) };
      }
      const abs = path.resolve(realProjectRoot, dir);
      if (fs.existsSync(abs)) {
        const stat = fs.lstatSync(abs);
        if (stat.isSymbolicLink()) {
          return { ok: false, issue: verificationIssue('PATH_UNSAFE', dir) };
        }
        const realDir = realpathOrSelf(abs);
        if (!isInsideDirectory(realProjectRoot, realDir)) {
          return { ok: false, issue: verificationIssue('PATH_UNSAFE', dir) };
        }
        const srcDir = path.resolve(realProjectRoot, `${prefix}src`);
        if (isInsideDirectory(srcDir, realDir) || isInsideDirectory(realDir, srcDir)) {
          return { ok: false, issue: verificationIssue('PATH_UNSAFE', dir) };
        }
      }
      excludedRelPaths.add(dir);
    }
  }
  return { ok: true, excludedRelPaths };
}

export function collectSourceSnapshots(
  realProjectRoot: string,
  excludedOutputDirs: ReadonlySet<string>,
): { ok: true; snapshots: IntegrationFileSnapshot[] } | { ok: false; issue: IntegrationVerificationIssue } {
  const snapshots: IntegrationFileSnapshot[] = [];
  let totalBytes = 0;

  const walk = (currentAbs: string, relPrefix: string): IntegrationVerificationIssue | undefined => {
    const entries = fs.readdirSync(currentAbs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.name === '.git' || entry.name === 'node_modules' || excludedOutputDirs.has(rel)) {
        continue;
      }
      const abs = path.join(currentAbs, entry.name);
      const lstat = fs.lstatSync(abs);
      if (lstat.isSymbolicLink()) {
        return verificationIssue('PATH_UNSAFE', rel);
      }
      if (lstat.isDirectory()) {
        const nested = walk(abs, rel);
        if (nested) return nested;
      } else if (lstat.isFile()) {
        if (lstat.nlink !== 1) {
          return verificationIssue('PATH_UNSAFE', rel);
        }
        if (snapshots.length >= MAX_SNAPSHOT_FILES) {
          return verificationIssue('EXECUTION_FAILED', rel);
        }
        if (lstat.size > MAX_SNAPSHOT_FILE_BYTES) {
          return verificationIssue('EXECUTION_FAILED', rel);
        }
        totalBytes += lstat.size;
        if (totalBytes > MAX_SNAPSHOT_TOTAL_BYTES) {
          return verificationIssue('EXECUTION_FAILED', rel);
        }
        const bytes = fs.readFileSync(abs);
        snapshots.push({ path: rel, exists: true, sha256: sha256Hex(bytes) });
      }
    }
    return undefined;
  };

  const err = walk(realProjectRoot, '');
  if (err) return { ok: false, issue: err };
  return { ok: true, snapshots };
}

function diffSnapshots(
  beforeList: readonly IntegrationFileSnapshot[],
  afterList: readonly IntegrationFileSnapshot[],
): {
  changedFiles: string[];
  normalizedBefore: IntegrationFileSnapshot[];
  normalizedAfter: IntegrationFileSnapshot[];
} {
  const beforeMap = new Map(beforeList.map(s => [s.path, s]));
  const afterMap = new Map(afterList.map(s => [s.path, s]));
  const allPaths = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort();
  const changedFiles: string[] = [];
  const normalizedBefore: IntegrationFileSnapshot[] = [];
  const normalizedAfter: IntegrationFileSnapshot[] = [];

  for (const filePath of allPaths) {
    const b = beforeMap.get(filePath) ?? { path: filePath, exists: false as const };
    const a = afterMap.get(filePath) ?? { path: filePath, exists: false as const };
    normalizedBefore.push(b);
    normalizedAfter.push(a);
    if (b.exists !== a.exists || b.sha256 !== a.sha256) {
      changedFiles.push(filePath);
    }
  }
  return { changedFiles, normalizedBefore, normalizedAfter };
}

function readInstalledPackageVersions(
  realProjectRoot: string,
  workspace: string,
  exactDependencies: IntegrationPlanV1['exactDependencies'],
): {
  ok: boolean;
  installedVersions: { name: string; version: string; manifestSha256: string }[];
  issues: IntegrationVerificationIssue[];
} {
  const installedVersions: { name: string; version: string; manifestSha256: string }[] = [];
  const issues: IntegrationVerificationIssue[] = [];

  const searchRoots: string[] = [];
  if (workspace !== '.') {
    searchRoots.push(path.resolve(realProjectRoot, workspace, 'node_modules'));
  }
  searchRoots.push(path.resolve(realProjectRoot, 'node_modules'));

  for (const dep of exactDependencies) {
    let foundPath: string | undefined;
    for (const nmRoot of searchRoots) {
      const candidate = path.join(nmRoot, ...dep.name.split('/'), 'package.json');
      const packageDir = path.dirname(candidate);
      const realPackageDir = realpathOrSelf(packageDir);
      const realNodeModules = realpathOrSelf(nmRoot);
      if (
        !isInsideDirectory(realProjectRoot, realNodeModules) ||
        !isInsideDirectory(realNodeModules, realPackageDir)
      ) {
        issues.push(verificationIssue('DEPENDENCY_MISMATCH'));
        break;
      }
      if (fs.existsSync(candidate) && fs.lstatSync(candidate).isFile() && !fs.lstatSync(candidate).isSymbolicLink()) {
        foundPath = candidate;
        break;
      }
    }
    if (!foundPath) {
      issues.push(verificationIssue('DEPENDENCY_MISMATCH'));
      continue;
    }
    try {
      const bytes = fs.readFileSync(foundPath);
      const parsed = JSON.parse(bytes.toString('utf8')) as { name?: unknown; version?: unknown };
      if (parsed.name !== dep.name || typeof parsed.version !== 'string' || parsed.version !== dep.version) {
        issues.push(verificationIssue('DEPENDENCY_MISMATCH'));
      }
      if (typeof parsed.version === 'string' && /^\d+\.\d+\.\d+/.test(parsed.version)) {
        installedVersions.push({
          name: dep.name,
          version: parsed.version,
          manifestSha256: sha256Hex(bytes),
        });
      }
    } catch {
      issues.push(verificationIssue('DEPENDENCY_MISMATCH'));
    }
  }

  return { ok: issues.length === 0, installedVersions, issues };
}

function blockedReport(params: {
  id: string;
  projectRoot: string;
  planDigest: string;
  applyResultDigest: string;
  specDigest: string;
  issue: IntegrationVerificationIssue;
  snapshots?: { before: IntegrationFileSnapshot[]; after: IntegrationFileSnapshot[] };
  session?: RunArtifactSession;
}): IntegrationVerificationReportV1 {
  return buildVerificationReport({
    id: params.id,
    projectRoot: params.projectRoot,
    planDigest: params.planDigest,
    applyResultDigest: params.applyResultDigest,
    specDigest: params.specDigest,
    status: 'blocked',
    checks: [
      {
        id: 'precondition-guard',
        category: 'behavior',
        status: 'blocked',
        issues: [params.issue],
        evidence: [],
      },
    ],
    changedFiles: [],
    snapshots: params.snapshots ?? { before: [], after: [] },
    installedVersions: [],
    visualResult: 'not-run',
    artifacts: params.session?.artifacts ?? [],
    pendingItems: [params.issue],
  });
}

function isAllowedLoopbackRequest(reqUrl: string, allowedOrigin: string): boolean {
  try {
    const parsed = new URL(reqUrl);
    const requestOrigin = parsed.protocol === 'ws:'
      ? 'http://' + parsed.host
      : parsed.protocol === 'wss:'
        ? 'https://' + parsed.host
        : parsed.protocol === 'http:' || parsed.protocol === 'https:'
          ? parsed.origin
          : undefined;
    return requestOrigin === allowedOrigin;
  } catch {
    return false;
  }
}

async function launchLocalChromium() {
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const msPlaywright = path.join(localAppData, 'ms-playwright');
      if (fs.existsSync(msPlaywright)) {
        const dirs = fs
          .readdirSync(msPlaywright, { withFileTypes: true })
          .filter(d => d.isDirectory() && d.name.startsWith('chromium_headless_shell-'))
          .map(d => d.name)
          .sort()
          .reverse();
        for (const dir of dirs) {
          const exe = path.join(msPlaywright, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
          if (fs.existsSync(exe)) {
            return await chromium.launch({ headless: true, executablePath: exe });
          }
        }
      }
    }
    throw err;
  }
}

async function runBrowserVerification(params: {
  browserSpec: NonNullable<IntegrationVerificationSpecV1['browser']>;
  plan: IntegrationPlanV1;
  installedVersions: IntegrationVerificationReportV1['installedVersions'];
  session: RunArtifactSession;
  signal?: AbortSignal;
}): Promise<{
  behaviorCheck: IntegrationVerificationCheck;
  visualCheck: IntegrationVerificationCheck;
  visualResult: 'PASS' | 'DIFF' | 'NEW' | 'INCOMPATIBLE' | 'not-run';
  environment?: EnvironmentV1;
}> {
  const b = params.browserSpec;
  const targetOrigin = new URL(b.url).origin;
  const framework = params.plan.localProject.framework;
  const frameworkVersion =
    params.installedVersions.find(d => d.name === framework)?.version;
  const echartsVersion =
    params.installedVersions.find(d => d.name === 'echarts')?.version;

  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    if (!frameworkVersion || !echartsVersion) throw new Error('BROWSER_ENVIRONMENT: verified installed versions are unavailable');
    browser = await launchLocalChromium();
    onAbort = () => {
      void browser?.close().catch(() => {});
    };
    params.signal?.addEventListener('abort', onAbort, { once: true });
    if (params.signal?.aborted) onAbort();
    const context = await browser.newContext({
      viewport: b.viewport,
      ...VERIFICATION_BROWSER_CONTEXT,
      colorScheme: b.theme === 'dark' ? 'dark' : 'light',
      acceptDownloads: false,
    });
    const runtimeErrors: string[] = [];
    const page = await context.newPage();
    await page.addInitScript(({ allowedOrigin }) => {
      const diagnostics: string[] = [];
      (window as unknown as { __zhinexusDiagnostics: string[] }).__zhinexusDiagnostics = diagnostics;
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const rawUrl = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
        try {
          const target = new URL(rawUrl, window.location.href);
          if ((target.protocol !== 'http:' && target.protocol !== 'https:') || target.origin !== allowedOrigin) {
            diagnostics.push('outbound_blocked: ' + rawUrl);
            return Promise.reject(new TypeError('Blocked request'));
          }
        } catch {
          diagnostics.push('outbound_blocked: ' + rawUrl);
          return Promise.reject(new TypeError('Blocked request'));
        }
        return originalFetch(input, init);
      };
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = class extends NativeWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          const target = new URL(url.toString(), window.location.href);
          const mappedOrigin = target.protocol === 'ws:' ? 'http://' + target.host : target.protocol === 'wss:' ? 'https://' + target.host : '';
          if (mappedOrigin !== allowedOrigin) {
            diagnostics.push('websocket_blocked: ' + target.toString());
            throw new DOMException('Blocked WebSocket', 'SecurityError');
          }
          super(url, protocols);
        }
      };
    }, { allowedOrigin: targetOrigin });

    page.on('pageerror', err => {
      runtimeErrors.push('pageerror: ' + sanitizeBrowserDiagnostic(err.message));
    });
    page.on('popup', popup => {
      runtimeErrors.push('popup_blocked');
      void popup.close().catch(() => {});
    });
    page.on('dialog', dialog => {
      runtimeErrors.push('dialog_blocked');
      void dialog.dismiss().catch(() => {});
    });
    page.on('download', download => {
      runtimeErrors.push('download_blocked');
      void download.cancel().catch(() => {});
    });

    await context.route('**/*', async route => {
      const reqUrl = route.request().url();
      if (!isAllowedLoopbackRequest(reqUrl, targetOrigin)) {
        runtimeErrors.push('outbound_blocked: ' + sanitizeBrowserDiagnostic(reqUrl));
        await route.abort();
        return;
      }
      await route.continue();
    });
    context.routeWebSocket('**/*', async wsRoute => {
      const reqUrl = wsRoute.url();
      if (!isAllowedLoopbackRequest(reqUrl, targetOrigin)) {
        runtimeErrors.push('websocket_blocked: ' + sanitizeBrowserDiagnostic(reqUrl));
        await wsRoute.close();
        return;
      }
      wsRoute.connectToServer();
    });

    if (params.signal?.aborted) {
      const issue = verificationIssue('CANCELLED');
      return {
        behaviorCheck: { id: 'browser', category: 'behavior', status: 'failed', issues: [issue], evidence: [] },
        visualCheck: { id: 'visual', category: 'visual', status: 'not-run', issues: [], evidence: [] },
        visualResult: 'not-run',
      };
    }

    await page.goto(b.url, { timeout: b.timeoutMs, waitUntil: 'load' });
    const readyLoc = page.locator(b.readySelector).first();
    await readyLoc.waitFor({ state: 'visible', timeout: b.timeoutMs });

    for (const action of b.actions) {
      if (action.kind === 'fill') {
        await page.locator(action.selector).first().fill(action.value ?? '', { timeout: b.timeoutMs });
      } else {
        await page.locator(action.selector).first().click({ timeout: b.timeoutMs });
      }
    }

    const behaviorFailures: string[] = [];
    // All assertion waits share one budget; navigation/readiness/actions keep their existing timeouts.
    const assertionDeadline = Date.now() + b.timeoutMs;
    for (const assertion of b.assertions) {
      const loc = page.locator(assertion.selector);
      let failure: string | undefined;
      while (true) {
        params.signal?.throwIfAborted();
        failure = undefined;
        const remainingMs = Math.max(1, assertionDeadline - Date.now());
        if (assertion.kind === 'visible') {
          const count = await loc.count();
          if (count === 0) {
            failure = `visible_missing:${assertion.selector}`;
          } else {
            failure = `zero_size_or_hidden:${assertion.selector}`;
            try {
              const isVisible = await loc.first().isVisible();
              const box = await loc.first().boundingBox({ timeout: remainingMs });
              if (isVisible && box && box.width > 0 && box.height > 0) failure = undefined;
            } catch (error) {
              // An element may detach between count and first(); only a bounded lookup timeout is a mismatch.
              if (!(error instanceof errors.TimeoutError)) throw error;
            }
          }
        } else if (assertion.kind === 'text') {
          failure = `text_mismatch:${assertion.selector}`;
          const count = await loc.count();
          if (count > 0) {
            try {
              const actual = (await loc.first().textContent({ timeout: remainingMs }))?.trim() ?? '';
              if (actual === (assertion.value ?? '').trim()) failure = undefined;
            } catch (error) {
              if (!(error instanceof errors.TimeoutError)) throw error;
            }
          }
        } else if (assertion.kind === 'count') {
          const actualCount = await loc.count();
          if (actualCount !== assertion.count) {
            failure = `count_mismatch:${assertion.selector}:${actualCount}!=${assertion.count}`;
          }
        }
        const remainingWaitMs = assertionDeadline - Date.now();
        if (!failure || remainingWaitMs <= 0) break;
        // Poll the declared condition rather than assuming a UI update duration. Abort is checked every sample.
        await new Promise<void>(resolve => setTimeout(resolve, Math.min(25, remainingWaitMs)));
      }
      if (failure) behaviorFailures.push(failure);
    }

    const pageDiagnostics = await page.evaluate(() => (window as unknown as { __zhinexusDiagnostics?: string[] }).__zhinexusDiagnostics ?? []);
    runtimeErrors.push(...pageDiagnostics.map(sanitizeBrowserDiagnostic));

    const environmentAudit = await captureBrowserEnvironment({
      browser, page, readySelector: b.readySelector, timeoutMs: b.timeoutMs, viewport: b.viewport,
      renderer: b.renderer, theme: b.theme, frameworkVersion, echartsVersion,
    });
    const env = environmentAudit.environment;
    params.session.writeText('browser-environment.json', JSON.stringify(environmentAudit, null, 2));
    const screenshotBuf = await page.screenshot({ fullPage: false });
    const shotRef = params.session.writeBytes('screenshot.png', screenshotBuf);
    const behaviorLogRef = params.session.writeText(
      'behavior.json',
      JSON.stringify({ runtimeErrors, behaviorFailures }, null, 2),
    );

    if (runtimeErrors.length > 0 || behaviorFailures.length > 0) {
      const issueCode = runtimeErrors.length > 0 ? 'BROWSER_FAILED' : 'BEHAVIOR_FAILED';
      const issue = verificationIssue(issueCode);
      return {
        behaviorCheck: {
          id: 'browser',
          category: 'behavior',
          status: 'failed',
          issues: [issue],
          evidence: [behaviorLogRef, shotRef],
        },
        visualCheck: {
          id: 'visual',
          category: 'visual',
          status: 'not-run',
          issues: [],
          evidence: [],
        },
        visualResult: 'not-run',
        environment: env,
      };
    }

    // 视觉基线比对
    if (!b.visual) {
      const issue = verificationIssue('VISUAL_BASELINE_MISSING');
      return {
        behaviorCheck: {
          id: 'browser',
          category: 'behavior',
          status: 'passed',
          issues: [],
          evidence: [behaviorLogRef],
        },
        visualCheck: {
          id: 'visual',
          category: 'visual',
          status: 'failed',
          issues: [issue],
          evidence: [shotRef],
        },
        visualResult: 'NEW',
        environment: env,
      };
    }

    const baselineRel = b.visual.baseline.image.path;
    const baselineAbs = path.resolve(params.session.realArtifactRoot, baselineRel);
    const realBaseline = realpathOrSelf(baselineAbs);
    if (
      !isInsideDirectory(params.session.realArtifactRoot, realBaseline) ||
      !fs.existsSync(realBaseline) ||
      !fs.lstatSync(realBaseline).isFile()
    ) {
      const issue = verificationIssue('VISUAL_BASELINE_MISSING');
      return {
        behaviorCheck: { id: 'browser', category: 'behavior', status: 'passed', issues: [], evidence: [behaviorLogRef] },
        visualCheck: { id: 'visual', category: 'visual', status: 'failed', issues: [issue], evidence: [shotRef] },
        visualResult: 'NEW',
        environment: env,
      };
    }

    const baselineBytes = fs.readFileSync(realBaseline);
    if (
      baselineBytes.byteLength !== b.visual.baseline.image.bytes ||
      sha256Hex(baselineBytes) !== b.visual.baseline.image.sha256
    ) {
      const issue = verificationIssue('EVIDENCE_INVALID');
      return {
        behaviorCheck: { id: 'browser', category: 'behavior', status: 'passed', issues: [], evidence: [behaviorLogRef] },
        visualCheck: { id: 'visual', category: 'visual', status: 'failed', issues: [issue], evidence: [shotRef] },
        visualResult: 'INCOMPATIBLE',
        environment: env,
      };
    }

    const cmp = compareBaseline(
      { environment: b.visual.baseline.environment, imageBuffer: baselineBytes },
      { environment: env, imageBuffer: screenshotBuf },
      {
        pixelThreshold: b.visual.pixelThreshold,
        maxDiffPixelRatio: b.visual.maxDiffPixelRatio,
        generateDiffImage: true,
      },
    );

    const visualEvidence: ArtifactRef[] = [shotRef];
    if (cmp.diffImage) {
      visualEvidence.push(params.session.writeBytes('diff.png', cmp.diffImage));
    }

    if (cmp.result === 'PASS') {
      return {
        behaviorCheck: { id: 'browser', category: 'behavior', status: 'passed', issues: [], evidence: [behaviorLogRef] },
        visualCheck: { id: 'visual', category: 'visual', status: 'passed', issues: [], evidence: visualEvidence },
        visualResult: 'PASS',
        environment: env,
      };
    }

    const visualIssue =
      cmp.result === 'DIFF'
        ? verificationIssue('VISUAL_DIFF')
        : cmp.result === 'INCOMPATIBLE'
          ? verificationIssue('VISUAL_ENVIRONMENT_MISMATCH')
          : verificationIssue('VISUAL_BASELINE_MISSING');

    return {
      behaviorCheck: { id: 'browser', category: 'behavior', status: 'passed', issues: [], evidence: [behaviorLogRef] },
      visualCheck: { id: 'visual', category: 'visual', status: 'failed', issues: [visualIssue], evidence: visualEvidence },
      visualResult: cmp.result,
      environment: env,
    };
  } catch {
    const cancelled = params.signal?.aborted ?? false;
    const issue = verificationIssue(cancelled ? 'CANCELLED' : 'BROWSER_FAILED');
    return {
      behaviorCheck: { id: 'browser', category: 'behavior', status: 'failed', issues: [issue], evidence: [] },
      visualCheck: { id: 'visual', category: 'visual', status: 'not-run', issues: [], evidence: [] },
      visualResult: 'not-run',
    };
  } finally {
    if (onAbort) params.signal?.removeEventListener('abort', onAbort);
    await browser?.close().catch(() => {});
  }
}

export async function verifyIntegrationInternal(
  root: string,
  plan: IntegrationPlanV1,
  options: VerifyIntegrationOptions,
  privateBaselineSnapshots?: readonly IntegrationFileSnapshot[],
): Promise<IntegrationVerificationReportV1> {
  const reportId = `verify-${randomUUID().slice(0, 12)}`;
  const canonicalRoot = canonicalProjectRoot(root);
  const planDigest = canonicalDigest(plan);
  const applyResultDigest = canonicalDigest(options.applyResult);
  const specDigest = canonicalDigest(options.spec);

  const realProjectRoot = realpathOrSelf(path.resolve(root));
  const artCheck = assertArtifactRootOutsideProject(realProjectRoot, options.artifactRoot);
  if (!artCheck.ok) {
    return blockedReport({
      id: reportId,
      projectRoot: canonicalRoot,
      planDigest,
      applyResultDigest,
      specDigest,
      issue: artCheck.issue,
    });
  }

  // 1. 基础结构与上下文一致性守卫
  const planCheck = validateIntegrationPlan(plan);
  if (!planCheck.ok || plan.status !== 'planned') {
    return blockedReport({
      id: reportId, projectRoot: canonicalRoot, planDigest, applyResultDigest, specDigest,
      issue: verificationIssue('INVALID_INPUT'),
    });
  }
  const applyCheck = validateIntegrationApplyResult(options.applyResult);
  if (!applyCheck.ok || options.applyResult.status !== 'applied') {
    return blockedReport({
      id: reportId, projectRoot: canonicalRoot, planDigest, applyResultDigest, specDigest,
      issue: verificationIssue('INVALID_INPUT'),
    });
  }
  if (options.applyResult.projectRoot !== canonicalRoot || options.applyResult.planDigest !== planDigest) {
    return blockedReport({
      id: reportId, projectRoot: canonicalRoot, planDigest, applyResultDigest, specDigest,
      issue: verificationIssue('IDENTITY_MISMATCH'),
    });
  }

  const specCheck = validateIntegrationVerificationSpec(options.spec, {
    projectRoot: canonicalRoot,
    planDigest,
    applyResultDigest,
    plan,
    applyResult: options.applyResult,
  });
  if (!specCheck.ok) {
    return blockedReport({
      id: reportId, projectRoot: canonicalRoot, planDigest, applyResultDigest, specDigest,
      issue: verificationIssue('IDENTITY_MISMATCH'),
    });
  }

  const authCheck = validateIntegrationExecutionAuthorization(options.authorization, {
    projectRoot: canonicalRoot,
    planDigest,
    applyResultDigest,
    specDigest,
    plan,
    applyResult: options.applyResult,
    spec: options.spec,
  });
  if (!authCheck.ok || options.authorization.operation !== 'verify') {
    return blockedReport({
      id: reportId, projectRoot: canonicalRoot, planDigest, applyResultDigest, specDigest,
      issue: verificationIssue('AUTHORIZATION_MISMATCH'),
    });
  }

  // 只有项目身份、摘要、验证规格和显式授权全部有效后才创建证据目录。
  let session: RunArtifactSession;
  try {
    session = createRunArtifactSession(options.artifactRoot, 'verify');
  } catch (error) {
    const unsafePath = error instanceof Error && error.message.startsWith('PATH_UNSAFE:');
    return blockedReport({
      id: reportId, projectRoot: canonicalRoot, planDigest, applyResultDigest, specDigest,
      issue: verificationIssue(unsafePath ? 'PATH_UNSAFE' : 'EVIDENCE_INVALID'),
    });
  }

  // 2. 校验输出目录白名单
  const outDirCheck = validateOutputDirectories(realProjectRoot, options.spec.commands);
  if (!outDirCheck.ok) {
    return blockedReport({
      id: reportId, projectRoot: canonicalRoot, planDigest, applyResultDigest, specDigest,
      issue: outDirCheck.issue, session,
    });
  }

  // 3. 采集验证前全量源文件快照，并比对可信基线（applyResult.afterHashes 或修复私有基线）
  const beforeSnapRes = collectSourceSnapshots(realProjectRoot, outDirCheck.excludedRelPaths);
  if (!beforeSnapRes.ok) {
    return blockedReport({
      id: reportId, projectRoot: canonicalRoot, planDigest, applyResultDigest, specDigest,
      issue: beforeSnapRes.issue, session,
    });
  }
  const beforeMap = new Map(beforeSnapRes.snapshots.map(s => [s.path, s]));
  if (privateBaselineSnapshots) {
    const sourceDiff = diffSnapshots(privateBaselineSnapshots, beforeSnapRes.snapshots);
    if (sourceDiff.changedFiles.length) {
      return blockedReport({
        id: reportId, projectRoot: canonicalRoot, planDigest, applyResultDigest, specDigest,
        issue: verificationIssue('PROJECT_CHANGED', sourceDiff.changedFiles[0]),
        snapshots: { before: beforeSnapRes.snapshots, after: beforeSnapRes.snapshots },
        session,
      });
    }
  }
  const guards = new Map(plan.baseFileHashes.map(guard => [guard.path, guard]));
  for (const guard of options.applyResult.afterHashes) guards.set(guard.path, guard);
  if (privateBaselineSnapshots) {
    const generatedPaths = new Set(plan.changes.filter(change => change.kind === 'generated-component').map(change => change.path));
    for (const guard of privateBaselineSnapshots) {
      if (generatedPaths.has(guard.path)) guards.set(guard.path, guard);
    }
  }
  for (const guard of guards.values()) {
    const actual = beforeMap.get(guard.path);
    const actualExists = actual?.exists ?? false;
    if (guard.exists !== actualExists || guard.sha256 !== actual?.sha256) {
      return blockedReport({
        id: reportId, projectRoot: canonicalRoot, planDigest, applyResultDigest, specDigest,
        issue: verificationIssue('PROJECT_CHANGED', guard.path),
        snapshots: { before: beforeSnapRes.snapshots, after: beforeSnapRes.snapshots },
        session,
      });
    }
  }

  // 4. 逐命令核验 package.json 字节并准备执行
  const checks: IntegrationVerificationCheck[] = [];
  const pendingItems: IntegrationVerificationIssue[] = [];
  let commandFailed = false;

  const toolchain = resolveFixedToolchain();
  const pm = plan.packageManager ?? plan.localProject.packageManager ?? 'npm';
  const scriptEnv = isolatedScriptEnv(toolchain, pm === 'pnpm');

  for (const cmd of options.spec.commands) {
    if (commandFailed || options.signal?.aborted) {
      if (options.signal?.aborted && !pendingItems.some(issue => issue.code === 'CANCELLED')) {
        const issue = verificationIssue('CANCELLED');
        pendingItems.push(issue);
        checks.push({ id: `${cmd.kind}-${cmd.script}`, category: cmd.kind, status: 'failed', issues: [issue], evidence: [] });
        commandFailed = true;
        continue;
      }
      checks.push({
        id: `${cmd.kind}-${cmd.script}`,
        category: cmd.kind,
        status: 'not-run',
        issues: [],
        evidence: [],
      });
      continue;
    }

    const manifestAbs = path.resolve(realProjectRoot, cmd.manifestPath);
    if (!fs.existsSync(manifestAbs) || fs.lstatSync(manifestAbs).isSymbolicLink()) {
      const issue = verificationIssue('PROJECT_CHANGED', cmd.manifestPath);
      pendingItems.push(issue);
      checks.push({ id: `${cmd.kind}-${cmd.script}`, category: cmd.kind, status: 'failed', issues: [issue], evidence: [] });
      commandFailed = true;
      continue;
    }
    const manifestBytes = fs.readFileSync(manifestAbs);
    if (sha256Hex(manifestBytes) !== cmd.manifestSha256) {
      const issue = verificationIssue('PROJECT_CHANGED', cmd.manifestPath);
      pendingItems.push(issue);
      checks.push({ id: `${cmd.kind}-${cmd.script}`, category: cmd.kind, status: 'failed', issues: [issue], evidence: [] });
      commandFailed = true;
      continue;
    }

    let hasScript = false;
    try {
      const parsed = JSON.parse(manifestBytes.toString('utf8')) as unknown;
      if (isPlainObject(parsed) && isPlainObject(parsed.scripts) && typeof parsed.scripts[cmd.script] === 'string') {
        hasScript = true;
      }
    } catch {
      hasScript = false;
    }
    if (!hasScript) {
      const issue = verificationIssue('SCRIPT_NOT_ALLOWED', cmd.manifestPath);
      pendingItems.push(issue);
      checks.push({ id: `${cmd.kind}-${cmd.script}`, category: cmd.kind, status: 'failed', issues: [issue], evidence: [] });
      commandFailed = true;
      continue;
    }

    const cwd = path.dirname(manifestAbs);
    const res = pm === 'npm'
      ? await runNativeCommand(toolchain.nodeExe, [toolchain.npmCli, '--ignore-scripts', 'run', cmd.script], {
          cwd, env: scriptEnv, timeoutMs: cmd.timeoutMs, signal: options.signal,
        })
      // 固定工具链已独立校验身份；禁止 pnpm 按 packageManager 再引导管理器或
      // 在脚本前隐式安装，避免验证执行本身改写已冻结的锁文件与安装树。
      : await runNativeCommand(toolchain.pnpmExe, ['--pm-on-fail=ignore', '--config.verifyDepsBeforeRun=false', 'run', cmd.script], {
          cwd, env: scriptEnv, timeoutMs: cmd.timeoutMs, signal: options.signal,
        });

    const logText = sanitizeDiagnosticText(
      `exitCode=${res.status ?? 'null'}\nsignal=${res.signal ?? 'none'}\n--- stdout ---\n${res.stdout ?? ''}\n--- stderr ---\n${res.stderr ?? ''}\n`,
    );
    const logRef = session.writeText(`${cmd.kind}-${cmd.script}.log`, logText);

    if (res.cancelled) {
      const issue = verificationIssue('CANCELLED');
      pendingItems.push(issue);
      checks.push({ id: `${cmd.kind}-${cmd.script}`, category: cmd.kind, status: 'failed', issues: [issue], evidence: [logRef] });
      commandFailed = true;
    } else if (res.timedOut) {
      const issue = verificationIssue('TIMEOUT');
      pendingItems.push(issue);
      checks.push({ id: `${cmd.kind}-${cmd.script}`, category: cmd.kind, status: 'failed', issues: [issue], evidence: [logRef] });
      commandFailed = true;
    } else if (res.status !== 0 || res.error) {
      const issue = verificationIssue(cmd.kind === 'type' ? 'TYPE_FAILED' : 'BUILD_FAILED');
      pendingItems.push(issue);
      checks.push({ id: `${cmd.kind}-${cmd.script}`, category: cmd.kind, status: 'failed', issues: [issue], evidence: [logRef] });
      commandFailed = true;
    } else {
      checks.push({ id: `${cmd.kind}-${cmd.script}`, category: cmd.kind, status: 'passed', issues: [], evidence: [logRef] });
    }
  }

  // 确保 type 与 build 两类至少有记录（若 spec 省略某类）
  if (!checks.some(c => c.category === 'type')) {
    checks.push({ id: 'type-skipped', category: 'type', status: 'not-run', issues: [], evidence: [] });
  }
  if (!checks.some(c => c.category === 'build')) {
    checks.push({ id: 'build-skipped', category: 'build', status: 'not-run', issues: [], evidence: [] });
  }

  // 5. 真实安装树 dependency-guard 检查
  const depCheck = readInstalledPackageVersions(
    realProjectRoot,
    plan.localProject.workspace,
    plan.exactDependencies,
  );
  const lockPath = plan.localProject.lockfile?.path;
  if (lockPath) {
    const lockResult = plan.packageManager === 'pnpm' ? readPnpmLock(realProjectRoot) : readNpmLock(realProjectRoot);
    const importer = plan.localProject.workspace === '.' ? '' : plan.localProject.workspace;
    if (!lockResult.ok) depCheck.issues.push(verificationIssue('DEPENDENCY_MISMATCH'));
    else for (const dep of plan.exactDependencies) {
      const resolved = lockResult.format === 'npm-v3'
        ? resolveNpmDependency(lockResult.data.packages, importer, dep.name)
        : resolvePnpmDependency(lockResult.data.importers, importer || '.', dep.name);
      if (resolved?.unresolved || resolved?.version !== dep.version || resolved?.specifier !== dep.version) {
        depCheck.issues.push(verificationIssue('DEPENDENCY_MISMATCH'));
        break;
      }
    }
    if (depCheck.issues.length) depCheck.ok = false;
  }
  const depEvidence = session.writeText('dependency-guard.json', JSON.stringify(depCheck.installedVersions, null, 2));
  if (!depCheck.ok) {
    const issue = depCheck.issues[0]!;
    pendingItems.push(issue);
    checks.push({
      id: 'dependency-guard',
      category: 'behavior',
      status: 'failed',
      issues: [issue],
      evidence: [depEvidence],
    });
  } else {
    checks.push({
      id: 'dependency-guard',
      category: 'behavior',
      status: 'passed',
      issues: [],
      evidence: [depEvidence],
    });
  }

  // 6. 业务缺口检查
  if (options.spec.businessGaps.length > 0) {
    const gapIssue = verificationIssue('MISSING_BUSINESS_INFO');
    pendingItems.push(gapIssue);
    checks.push({
      id: 'business-gaps',
      category: 'missing-business-info',
      status: 'failed',
      issues: [gapIssue],
      evidence: [],
    });
  } else {
    checks.push({
      id: 'business-gaps',
      category: 'missing-business-info',
      status: 'passed',
      issues: [],
      evidence: [],
    });
  }

  // 7. 浏览器与视觉验证
  let visualResult: 'PASS' | 'DIFF' | 'NEW' | 'INCOMPATIBLE' | 'not-run' = 'not-run';
  let environment: EnvironmentV1 | undefined;
  if (options.spec.browser && !commandFailed && !options.signal?.aborted) {
    const browserRes = await runBrowserVerification({
      browserSpec: options.spec.browser,
      plan,
      installedVersions: depCheck.installedVersions,
      session,
      signal: options.signal,
    });
    checks.push(browserRes.behaviorCheck, browserRes.visualCheck);
    visualResult = browserRes.visualResult;
    environment = browserRes.environment;
    pendingItems.push(...browserRes.behaviorCheck.issues, ...browserRes.visualCheck.issues);
  } else {
    checks.push({ id: 'browser', category: 'behavior', status: 'not-run', issues: [], evidence: [] });
    checks.push({ id: 'visual', category: 'visual', status: 'not-run', issues: [], evidence: [] });
  }

  // 8. 结束复读源文件快照
  const afterSnapRes = collectSourceSnapshots(realProjectRoot, outDirCheck.excludedRelPaths);
  const afterList = afterSnapRes.ok ? afterSnapRes.snapshots : [];
  const { changedFiles, normalizedBefore, normalizedAfter } = diffSnapshots(beforeSnapRes.snapshots, afterList);
  if (!afterSnapRes.ok || changedFiles.length > 0) {
    const sourceIssues = [
      ...(!afterSnapRes.ok ? [afterSnapRes.issue] : []),
      ...(changedFiles.length > 0 ? [verificationIssue('PROJECT_CHANGED', changedFiles[0])] : []),
    ];
    pendingItems.push(...sourceIssues);
    checks.push({
      id: 'source-guard',
      category: 'behavior',
      status: 'failed',
      issues: sourceIssues,
      evidence: [],
    });
  }

  const hasFailedCheck = checks.some(c => c.status === 'failed');
  let finalStatus: 'passed' | 'failed' | 'blocked';
  if (
    !hasFailedCheck &&
    changedFiles.length === 0 &&
    pendingItems.length === 0 &&
    visualResult === 'PASS' &&
    Boolean(environment) &&
    checks.every(c => c.status === 'passed')
  ) {
    finalStatus = 'passed';
  } else if (hasFailedCheck) {
    finalStatus = 'failed';
  } else {
    if (pendingItems.length === 0) {
      pendingItems.push(verificationIssue('VISUAL_BASELINE_MISSING'));
    }
    finalStatus = 'blocked';
  }

  return buildVerificationReport({
    id: reportId,
    projectRoot: canonicalRoot,
    planDigest,
    applyResultDigest,
    specDigest,
    status: finalStatus,
    checks,
    changedFiles,
    snapshots: { before: normalizedBefore, after: normalizedAfter },
    installedVersions: depCheck.installedVersions,
    visualResult,
    environment,
    artifacts: session.artifacts,
    pendingItems,
  });
}

export async function verifyIntegration(
  root: string,
  plan: IntegrationPlanV1,
  options: VerifyIntegrationOptions,
): Promise<IntegrationVerificationReportV1> {
  return verifyIntegrationInternal(root, plan, options);
}
