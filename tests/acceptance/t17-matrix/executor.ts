/**
 * T17 矩阵 CLI 参数构造器（冻结命令表对应 C0）。
 *
 * 只做参数组装与最小形态检查，不做执行。命令形态（docs/plans/2026-11-19-phase3-t17-completion.md）：
 *   component integrate verify --project <p> --plan <f> --apply-result <f> --spec <f> --out <dir>
 *                             --allow-project-scripts <true|false> --allow-browser <true|false>
 *   component integrate repair ... --report <f> [--max-attempts <0|1|2>]
 *   component mcp serve（由 McpStdioSession 启动）
 *
 * 约束：所有路径必须是既定的绝对路径；workspace 只接受 '. ' 或项目内相对路径，越界即抛错。
 */
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import tar from 'tar-stream';

export type VerifyArgsInput = {
  projectRoot: string;
  workspace: string;
  planPath: string;
  applyResultPath: string;
  specPath: string;
  artifactRoot: string;
  allowProjectScripts: boolean;
  allowBrowser: boolean;
};

const ABSOLUTE = /^[A-Za-z]:[\\/]/;

function requireAbsolute(value: string, label: string): string {
  if (!value || !ABSOLUTE.test(value)) throw new Error(label + ' 必须是绝对路径');
  return path.resolve(value);
}

export function verifyArgsFor(input: VerifyArgsInput): string[] {
  const projectRoot = requireAbsolute(input.projectRoot, 'projectRoot');
  const planPath = requireAbsolute(input.planPath, 'planPath');
  const applyResultPath = requireAbsolute(input.applyResultPath, 'applyResultPath');
  const specPath = requireAbsolute(input.specPath, 'specPath');
  const artifactRoot = requireAbsolute(input.artifactRoot, 'artifactRoot');
  const workspace = validateWorkspace(projectRoot, input.workspace);
  void workspace;
  return [
    'integrate', 'verify',
    '--project', projectRoot,
    '--plan', planPath,
    '--apply-result', applyResultPath,
    '--spec', specPath,
    '--out', artifactRoot,
    '--allow-project-scripts', input.allowProjectScripts ? 'true' : 'false',
    '--allow-browser', input.allowBrowser ? 'true' : 'false',
  ];
}

export type RepairArgsInput = VerifyArgsInput & { reportPath: string; maxAttempts: 0 | 1 | 2 };

export function repairArgsFor(input: RepairArgsInput): string[] {
  if (input.maxAttempts !== 0 && input.maxAttempts !== 1 && input.maxAttempts !== 2) throw new Error('maxAttempts 只接受 0、1 或 2');
  const projectRoot = requireAbsolute(input.projectRoot, 'projectRoot');
  const planPath = requireAbsolute(input.planPath, 'planPath');
  const applyResultPath = requireAbsolute(input.applyResultPath, 'applyResultPath');
  const specPath = requireAbsolute(input.specPath, 'specPath');
  const artifactRoot = requireAbsolute(input.artifactRoot, 'artifactRoot');
  const reportPath = requireAbsolute(input.reportPath, 'reportPath');
  validateWorkspace(projectRoot, input.workspace);
  return [
    'integrate', 'repair',
    '--project', projectRoot,
    '--plan', planPath,
    '--apply-result', applyResultPath,
    '--spec', specPath,
    '--out', artifactRoot,
    '--allow-project-scripts', input.allowProjectScripts ? 'true' : 'false',
    '--allow-browser', input.allowBrowser ? 'true' : 'false',
    '--report', reportPath,
    '--max-attempts', String(input.maxAttempts),
  ];
}

/** workspace 只接受 '.' 或严格位于项目根之内的相对路径（不管是否为真实存在的目录）。 */
export function validateWorkspace(projectRoot: string, workspace: string): string {
  const normalized = workspace.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalized === '.' || normalized === '') return '.';
  if (normalized.startsWith('/') || ABSOLUTE.test(normalized)) throw new Error('workspace 必须是项目内相对路径');
  if (normalized.split('/').includes('..')) throw new Error('workspace 不得越出项目根');
  if (normalized.includes('./') || normalized.includes('../')) throw new Error('workspace 必须已规范化');
  for (const segment of normalized.split('/')) {
    if (!segment || /[%*#<>|"\u0000-\u001f]/.test(segment) || segment.endsWith('.') || segment.endsWith(' ')) {
      throw new Error('workspace 段名非法');
    }
  }
  const joined = path.resolve(projectRoot, normalized);
  const relative = path.relative(path.resolve(projectRoot), joined);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('workspace 必须位于项目根内');
  void joined;
  return normalized;
}

export type InspectArgsInput = { projectRoot: string; workspace?: string };

export function inspectArgsFor(input: InspectArgsInput): string[] {
  const projectRoot = requireAbsolute(input.projectRoot, 'projectRoot');
  const workspace = input.workspace === undefined ? '.' : validateWorkspace(projectRoot, input.workspace);
  return workspace === '.' ? ['integrate', 'inspect', '--project', projectRoot] : ['integrate', 'inspect', '--project', projectRoot, '--workspace', workspace];
}

export type PlanArgsInput = {
  projectRoot: string;
  workspace?: string;
  matchPath: string;
  apiUrl: string;
  registryUrl: string;
  outputDir?: string;
};

export function planArgsFor(input: PlanArgsInput): string[] {
  const projectRoot = requireAbsolute(input.projectRoot, 'projectRoot');
  const matchPath = requireAbsolute(input.matchPath, 'matchPath');
  const workspace = input.workspace === undefined ? '.' : validateWorkspace(projectRoot, input.workspace);
  const args = [
    'integrate', 'plan',
    '--project', projectRoot,
    '--match', matchPath,
    '--api-url', requireHttpOrigin(input.apiUrl, 'apiUrl'),
    '--registry', requireHttpOrigin(input.registryUrl, 'registryUrl'),
  ];
  if (workspace !== '.') args.push('--workspace', workspace);
  if (input.outputDir !== undefined) args.push('--output-dir', input.outputDir);
  return args;
}

export type ApplyArgsInput = {
  projectRoot: string;
  workspace?: string;
  planPath: string;
  apiUrl: string;
  registryUrl: string;
  backupRoot: string;
  allowInstall: boolean;
  outputDir?: string;
};

export function applyArgsFor(input: ApplyArgsInput): string[] {
  const projectRoot = requireAbsolute(input.projectRoot, 'projectRoot');
  const planPath = requireAbsolute(input.planPath, 'planPath');
  const backupRoot = requireAbsolute(input.backupRoot, 'backupRoot');
  const workspace = input.workspace === undefined ? '.' : validateWorkspace(projectRoot, input.workspace);
  const args = [
    'integrate', 'apply',
    '--project', projectRoot,
    '--plan', planPath,
    '--api-url', requireHttpOrigin(input.apiUrl, 'apiUrl'),
    '--registry', requireHttpOrigin(input.registryUrl, 'registryUrl'),
    '--backup-root', backupRoot,
    '--allow-install', input.allowInstall ? 'true' : 'false',
  ];
  if (workspace !== '.') args.push('--workspace', workspace);
  if (input.outputDir !== undefined) args.push('--output-dir', input.outputDir);
  return args;
}

export function requireHttpOrigin(value: string, label: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
    return value;
  } catch {
    throw new Error(label + ' 必须是 http(s) origin');
  }
}

/* ------------------------------------------------------------------ *
 * 场景清单与宿主一致性
 * ------------------------------------------------------------------ */

import { T17_POSITIVE_SCENARIOS, T17_REFUSAL_SCENARIOS } from '../../fixtures/t17-matrix/scenarios.js';
import type { T17PositiveScenario } from '../../fixtures/t17-matrix/scenarios.js';
import { canonicalJson, sha256Bytes, sha256Text } from './support.js';

/**
 * 固定分母：20 正例（10 Vue + 10 React）与 13 强制拒绝例。
 * 跑前校验一次；分母变化直接抛错（防止跑后调分母凑通过率）。
 */
export function validateScenarioManifest(
  positive: readonly T17PositiveScenario[] = T17_POSITIVE_SCENARIOS,
  refusals: readonly { caseId: string }[] = T17_REFUSAL_SCENARIOS,
): { positive: number; refusal: number } {
  if (positive.length !== 20) throw new Error('正向分母必须为 20，当前为 ' + positive.length);
  if (positive.filter((item) => item.framework === 'vue').length !== 10) throw new Error('Vue 正向分母必须为 10');
  if (positive.filter((item) => item.framework === 'react').length !== 10) throw new Error('React 正向分母必须为 10');
  if (refusals.length !== 13) throw new Error('强制拒绝分母必须为 13，当前为 ' + refusals.length);
  return { positive: positive.length, refusal: refusals.length };
}

/** 声明宿主必须与本次实际宿主一致；不一致即抛错（防止 next-app-router 案例冒充 vite 宿主）。 */
export function assertScenarioHost(scenario: T17PositiveScenario, actualHost: 'vite' | 'next-app-router'): 'vite' | 'next-app-router' {
  if (scenario.host !== actualHost) throw new Error('场景宿主不一致: ' + scenario.caseId);
  return actualHost;
}

export type FrozenCliIdentity = {
  version: string;
  tarballSha256: string;
  tarballPath: string;
  installRoot: string;
  packageRoot: string;
  binPath: string;
};

export type EvidenceHost = {
  writeEvidence(name: string, bytes: Uint8Array): Promise<{ path: string; sha256: string; bytes: number }>;
};

export type RunFrozenVerifyInput = {
  scenario: T17PositiveScenario;
  actualHost: 'vite' | 'next-app-router';
  cli: FrozenCliIdentity;
  expectedVersion: string;
  expectedTarballSha256: string;
  projectRoot: string;
  workspace: string;
  planPath: string;
  applyResultPath: string;
  specPath: string;
  artifactRoot: string;
  tokens: { apiToken?: string; registryToken?: string };
  timeoutMs?: number;
  host: EvidenceHost;
};

export type RunFrozenVerifyResult = {
  exitCode: number;
  args: string[];
  reportPath: string;
  reportSha256: string;
  reportBytes: number;
  stdout: string;
  stderr: string;
};

function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

async function frozenTarEntrySha256(tarballPath: string, entryName: string): Promise<string> {
  const { pipeline } = await import('node:stream/promises');
  const extract = tar.extract();
  const extraction = pipeline(createReadStream(tarballPath), createGunzip(), extract);
  let entrySha256: string | undefined;
  for await (const entry of extract) {
    const chunks: Buffer[] = [];
    let entryBytes = 0;
    for await (const chunk of entry as AsyncIterable<Uint8Array>) {
      const chunkBytes = Buffer.from(chunk);
      entryBytes += chunkBytes.length;
      if (entry.header.name === entryName) chunks.push(chunkBytes);
    }
    if (entry.header.name !== entryName) continue;
    if (entry.header.type !== 'file' || entrySha256 !== undefined || entry.header.size !== entryBytes) {
      throw new Error('冻结 CLI tarball 中 bin.js entry 结构无效');
    }
    entrySha256 = sha256Bytes(Buffer.concat(chunks, entryBytes));
  }
  await extraction;
  if (!entrySha256) throw new Error('冻结 CLI tarball 缺少 package/dist/bin.js');
  return entrySha256;
}

function isVerificationReport(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  const digest = (candidate: unknown) => typeof candidate === 'string' && /^[a-f0-9]{64}$/.test(candidate);
  const snapshots = report.snapshots;
  return report.schemaVersion === 1
    && report.operation === 'verify'
    && ['passed', 'failed', 'blocked'].includes(String(report.status))
    && typeof report.projectRoot === 'string'
    && digest(report.planDigest) && digest(report.applyResultDigest) && digest(report.specDigest)
    && typeof report.id === 'string' && typeof report.toolVersion === 'string' && typeof report.verifiedAt === 'string'
    && Array.isArray(report.checks) && Array.isArray(report.changedFiles) && Array.isArray(report.installedVersions)
    && !!snapshots && typeof snapshots === 'object' && !Array.isArray(snapshots)
    && Array.isArray((snapshots as Record<string, unknown>).before) && Array.isArray((snapshots as Record<string, unknown>).after)
    && ['PASS', 'DIFF', 'NEW', 'INCOMPATIBLE', 'not-run'].includes(String(report.visualResult))
    && Array.isArray(report.artifacts) && Array.isArray(report.pendingItems);
}

function safeDiagnostic(value: string, tokens: RunFrozenVerifyInput['tokens']): string {
  let output = value;
  for (const token of [tokens.apiToken, tokens.registryToken]) {
    if (token) output = output.split(token).join('[REDACTED]');
  }
  output = output
    .replace(/\b(?:api[-_]?token|registry[-_]?token|authorization|password|secret)(?:\s*[=:]\s*|\s+)[^\s,;]+/gi, '[REDACTED]')
    .replace(/(?:https?|wss?):\/\/[^\s"']+/gi, '[URL_REDACTED]');
  return output.slice(0, 4096);
}

/** 冻结 CLI 入口必须严格等于既定包名与版本、bin 必须是 dist/bin.js。 */
export async function assertFrozenCliEntry(cli: FrozenCliIdentity, expectedVersion: string, expectedTarballSha256: string): Promise<void> {
  const { lstat, readFile, realpath } = await import('node:fs/promises');
  const { sha256File } = await import('./support.js');
  if (!/^[a-f0-9]{64}$/.test(expectedTarballSha256) || !/^[a-f0-9]{64}$/.test(cli.tarballSha256) || cli.tarballSha256 !== expectedTarballSha256) throw new Error('冻结 CLI tarball 摘要与预期不一致');
  const tarballPath = path.resolve(cli.tarballPath);
  const tarballStat = await lstat(tarballPath);
  if (!tarballStat.isFile() || tarballStat.isSymbolicLink() || tarballStat.nlink > 1 || await realpath(tarballPath) !== tarballPath) throw new Error('冻结 CLI tarball 必须是未链接的普通文件');
  if (await sha256File(tarballPath) !== expectedTarballSha256) throw new Error('冻结 CLI tarball 字节摘要与预期不一致');
  const installRoot = path.resolve(cli.installRoot);
  const packageRoot = path.resolve(cli.packageRoot);
  const expectedPackageRoot = path.resolve(installRoot, 'node_modules', '@company', 'component-cli');
  const expectedBinPath = path.resolve(expectedPackageRoot, 'dist', 'bin.js');
  const binPath = path.resolve(cli.binPath);
  if (packageRoot !== expectedPackageRoot || binPath !== expectedBinPath || !isInside(installRoot, packageRoot) || !isInside(packageRoot, binPath)) throw new Error('冻结 CLI 安装入口路径与包结构不匹配');
  for (const [target, kind] of [[installRoot, 'directory'], [packageRoot, 'directory'], [binPath, 'file']] as const) {
    const stat = await lstat(target);
    if (stat.isSymbolicLink() || (kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) || await realpath(target) !== target) throw new Error('冻结 CLI 安装路径必须是无链接的包副本');
  }
  const manifest = JSON.parse(await readFile(`${cli.packageRoot}/package.json`, 'utf8')) as { name?: string; version?: string; bin?: string | Record<string, string> };
  if (manifest.name !== '@company/component-cli') throw new Error('冻结 CLI package name 不匹配: ' + String(manifest.name));
  if (manifest.version !== expectedVersion || cli.version !== expectedVersion) throw new Error('冻结 CLI 版本与预期不一致');
  const declaredBin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.component;
  if (declaredBin !== './dist/bin.js') throw new Error('冻结 CLI 未声明 ./dist/bin.js 入口');
  const tarEntrySha256 = await frozenTarEntrySha256(tarballPath, 'package/dist/bin.js');
  if (await sha256File(binPath) !== tarEntrySha256) throw new Error('冻结 CLI 安装入口与 tarball 中 package/dist/bin.js 摘要不一致');
}

/** 稳定的场景身份摘要（与运行顺序无关，供 run-seal payload 与 evidence 绑定）。 */
export function stableScenarioIdentity(input: {
  scenario: T17PositiveScenario;
  cliVersion: string;
  cliTarballSha256: string;
  frozenBundleSha256: string;
}): { caseId: string; sha256: string; canonical: string } {
  const canonical = canonicalJson({
    caseId: input.scenario.caseId,
    framework: input.scenario.framework,
    packageManager: input.scenario.packageManager,
    topology: input.scenario.topology,
    workspace: input.scenario.workspace,
    host: input.scenario.host,
    hostMode: input.scenario.hostMode,
    components: input.scenario.components,
    readySelector: input.scenario.browser.readySelector,
    actions: input.scenario.browser.actions,
    assertions: input.scenario.browser.assertions,
    interaction: input.scenario.browser.interaction ?? null,
    visual: input.scenario.visual,
    cliVersion: input.cliVersion,
    cliTarballSha256: input.cliTarballSha256,
    frozenBundleSha256: input.frozenBundleSha256,
  });
  return { caseId: input.scenario.caseId, sha256: sha256Text(canonical), canonical };
}

/**
 * 以受控子进程调用冻结 CLI 的 verify，并把 stdout 的单个 JSON 作为报告证据封存。
 *
 * 边界：
 * - 先校验冻结包身份（包名/版本/bin/摘要），再拼参数；
 * - 只写报告证据字节；令牌不进入任何证据文件（调用方负责不把令牌拼进 stdout 捕获文本）；
 * - stdout 必须是结构完整的单个 verify 报告 JSON，否则拒绝封存且不回显原文；stderr 诊断先脱敏且限长。
 */
export async function runFrozenVerify(input: RunFrozenVerifyInput): Promise<RunFrozenVerifyResult> {
  await assertFrozenCliEntry(input.cli, input.expectedVersion, input.expectedTarballSha256);
  assertScenarioHost(input.scenario, input.actualHost);
  const requestedWorkspace = validateWorkspace(input.projectRoot, input.workspace);
  const scenarioWorkspace = validateWorkspace(input.projectRoot, input.scenario.workspace);
  if (requestedWorkspace !== scenarioWorkspace) throw new Error('verify workspace 与矩阵场景不一致');
  let plan: unknown;
  try {
    const { readFile } = await import('node:fs/promises');
    plan = JSON.parse(await readFile(path.resolve(input.planPath), 'utf8'));
  } catch {
    throw new Error('verify plan JSON 不可读取');
  }
  const localProject = plan && typeof plan === 'object' && !Array.isArray(plan)
    ? (plan as Record<string, unknown>).localProject
    : undefined;
  const planWorkspace = localProject && typeof localProject === 'object' && !Array.isArray(localProject)
    ? (localProject as Record<string, unknown>).workspace
    : undefined;
  if (typeof planWorkspace !== 'string' || validateWorkspace(input.projectRoot, planWorkspace) !== requestedWorkspace) {
    throw new Error('verify plan workspace 与矩阵场景不一致');
  }
  const args = verifyArgsFor({
    projectRoot: input.projectRoot,
    workspace: input.workspace,
    planPath: input.planPath,
    applyResultPath: input.applyResultPath,
    specPath: input.specPath,
    artifactRoot: input.artifactRoot,
    allowProjectScripts: true,
    allowBrowser: true,
  });
  const { execFile } = await import('node:child_process');
  const env: Record<string, string> = {};
  const allowedEnvironment = new Set([
    'appdata', 'comspec', 'homedrive', 'homepath', 'localappdata', 'path', 'pathext', 'playwright_browsers_path',
    'systemroot', 'temp', 'tmp', 'userprofile', 'windir',
  ]);
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && allowedEnvironment.has(key.toLowerCase())) env[key] = value;
  }
  env.CI = 'true';
  env.NO_COLOR = '1';
  if (input.tokens.apiToken) env.ZHINEXUS_API_TOKEN = input.tokens.apiToken;
  if (input.tokens.registryToken) env.ZHINEXUS_REGISTRY_TOKEN = input.tokens.registryToken;
  const outcome = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = execFile(
      process.execPath,
      [input.cli.binPath, ...args],
      { cwd: input.projectRoot, timeout: input.timeoutMs ?? 900_000, maxBuffer: 8 * 1024 * 1024, env, windowsHide: true },
      (error, stdout, stderr) => {
        const code = error && 'code' in error && typeof error.code === 'number' ? error.code : error ? 1 : 0;
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      },
    );
    child.stdin?.end();
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(outcome.stdout);
  } catch {
    throw new Error('冻结 CLI stdout 不是单个 JSON 验证报告');
  }
  if (!isVerificationReport(parsed)) throw new Error('冻结 CLI stdout 不符合 verify 报告结构');
  const reportStatus = parsed.status;
  const expectedExitCode = reportStatus === 'passed' ? 0 : 2;
  if (outcome.code !== expectedExitCode) throw new Error('冻结 CLI verify 退出码与报告状态不一致');
  if ((input.tokens.apiToken && outcome.stdout.includes(input.tokens.apiToken)) || (input.tokens.registryToken && outcome.stdout.includes(input.tokens.registryToken))) {
    throw new Error('冻结 CLI 报告包含敏感令牌，拒绝封存');
  }
  const reportPath = input.scenario.caseId + '-verify-report.json';
  const reportBytes = Buffer.from(outcome.stdout, 'utf8');
  const stored = await input.host.writeEvidence(reportPath, reportBytes);
  if (stored.sha256 !== sha256Bytes(reportBytes) || stored.bytes !== reportBytes.byteLength || path.basename(stored.path) !== reportPath) {
    throw new Error('冻结 CLI 报告证据回执与实际字节不一致');
  }
  return {
    exitCode: outcome.code,
    args,
    reportPath,
    reportSha256: stored.sha256,
    reportBytes: reportBytes.byteLength,
    stdout: outcome.stdout,
    stderr: safeDiagnostic(outcome.stderr, input.tokens),
  };
}
