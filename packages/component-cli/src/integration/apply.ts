/**
 * T16 P1 受控应用编排：`applyIntegration` / `rollbackIntegration`。
 *
 * 冻结接口（docs/plans/2026-11-18-t16-b-install-isolation-brief.md）：
 *
 * ```text
 * applyIntegration(root, plan, options): Promise<IntegrationApplyResultV1>
 * rollbackIntegration(root, {id, sha256}, {backupRoot}): Promise<IntegrationRollbackResultV1>
 * ```
 *
 * 边界：
 * - 授权只能来自本次显式调用的内存边界；磁盘计划本身永不构成执行授权；
 * - 写入路径与摘要由产品从**重新核验过**的计划重新派生，不接受离线 JSON 自报字段；
 * - `plan.commands` 只是展示数据，绝不传给 shell，也不执行项目 build/typecheck；
 * - 完整备份落盘后才按逐文件 hash 守卫写入目标；`installStarted=true` 在物化进程启动前
 *   原子持久化，持久化失败绝不启动进程；
 * - 结构化阻断以结果返回；参数/损坏输入/备份不可信抛固定脱敏执行错误（CLI 映射 exit 1）。
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  INTEGRATION_APPLY_ISSUE_MESSAGES,
  validateIntegrationApplyAuthorization,
  validateIntegrationApplyResult,
  validateIntegrationBackup,
  validateIntegrationRollbackResult,
  type IntegrationApplyAuthorizationV1,
  type IntegrationApplyIssue,
  type IntegrationApplyIssueCode,
  type IntegrationApplyResultV1,
  type IntegrationBackupV1,
  type IntegrationRollbackResultV1,
} from '../contracts/integration-apply.js';
import { validateIntegrationPlan } from '../contracts/integration-plan.js';
import type { IntegrationDependency, IntegrationPlanV1 } from '../contracts/integration-plan.js';
import { canonicalJson } from '../contracts/schema.js';
import type { ComponentMatchResponseV1 } from '../contracts/component-match.js';
import type { MatchElement } from '../contracts/match-plan.js';
import { isPlainObject, readNpmWorkspacePatterns, readPnpmWorkspacePatterns, realpathOrSelf } from './workspace.js';
import { planIntegration } from './plan.js';
import { BackupError, createOperationId, ensureBackupRoot, loadBackup, persistBackup, serializeBackup, type BackupReference } from './backup.js';
import { BindingError, resolveBindingModel, type GeneratedBindingModel } from './bindings.js';
import { generateReactComponent } from './generate-react.js';
import { generateVueComponent } from './generate-vue.js';
import {
  PatchError,
  assertBackupSource,
  readTargetBytes,
  removeCreatedDirectories,
  restoreBackupEntry,
  sha256Hex,
  writeTargetFile,
  type RestoreIssue,
} from './patch.js';
import {
  InstallError,
  buildReadyTree,
  cleanupInstall,
  cleanupInstallStrict,
  createInstallContext,
  deliverReadyTree,
  generateCandidateLock,
  materializeFrozenDependencies,
  planDelivery,
  readInstalledVersions,
  verifyWorkspaceMemberRoots,
  type InstallContext,
} from './install.js';

export type IntegrationApplyOptions = {
  authorization?: IntegrationApplyAuthorizationV1;
  apiUrl: string;
  registryUrl: string;
  apiToken?: string;
  registryToken?: string;
  backupRoot: string;
  workspace?: string;
  outputDir?: string;
  requestTimeoutMs?: number;
};

export type IntegrationRollbackOptions = { backupRoot: string };

/** 执行错误（参数/损坏输入/备份不可信）：`code` 稳定，消息固定脱敏，由 CLI 映射 exit 1。 */
export const INTEGRATION_APPLY_ERROR_CODES = ['INVALID_ARGUMENTS', 'INVALID_SCHEMA', 'BACKUP_INVALID', 'EXECUTION_FAILED'] as const;
export type IntegrationApplyErrorCode = typeof INTEGRATION_APPLY_ERROR_CODES[number];

export class IntegrationApplyError extends Error {
  readonly code: IntegrationApplyErrorCode;

  constructor(code: IntegrationApplyErrorCode, message: string) {
    super(message);
    this.name = 'IntegrationApplyError';
    this.code = code;
  }
}

/** 目标工程的规范化绝对根（POSIX 分隔符），与授权/备份中的 `projectRoot` 同口径。 */
export function canonicalProjectRoot(root: string): string {
  return path.resolve(realpathOrSelf(path.resolve(root))).split(path.sep).join('/');
}

/** issue 消息由契约固定：这里只按 code 取固定措辞，可附合法项目相对路径。 */
function issueOf(code: IntegrationApplyIssueCode, relativePath?: string): IntegrationApplyIssue {
  const message: string = INTEGRATION_APPLY_ISSUE_MESSAGES[code];
  return {
    code,
    message,
    ...(relativePath !== undefined ? { path: relativePath } : {}),
  } as IntegrationApplyIssue;
}

function blockedResult(
  projectRoot: string,
  planDigest: string,
  operationId: string,
  issues: IntegrationApplyIssue[],
): IntegrationApplyResultV1 {
  return {
    schemaVersion: 1, operation: 'apply', operationId, projectRoot, planDigest,
    status: 'blocked', changedFiles: [], beforeHashes: [], afterHashes: [], installedVersions: [], issues,
    installState: 'not-run',
  };
}

function toExecutionError(error: unknown): never {
  if (error instanceof IntegrationApplyError) throw error;
  if (error instanceof BackupError) throw new IntegrationApplyError('BACKUP_INVALID', error.message);
  if (error instanceof PatchError) throw new IntegrationApplyError('EXECUTION_FAILED', error.message);
  if (error instanceof InstallError) throw new IntegrationApplyError('EXECUTION_FAILED', error.message);
  if (error instanceof BindingError) throw new IntegrationApplyError('EXECUTION_FAILED', error.message);
  throw new IntegrationApplyError('EXECUTION_FAILED', '受控应用执行失败');
}

// ─── 重新核验 ───

const CONFLICT_TO_ISSUE: Record<string, IntegrationApplyIssueCode> = {
  PROJECT_CHANGED: 'PROJECT_CHANGED',
  TARGET_CHANGED: 'TARGET_CHANGED',
  API_MISMATCH: 'API_MISMATCH',
  PACKAGE_DIGEST_MISMATCH: 'TARGET_CHANGED',
  DEPENDENCY_CONFLICT: 'DEPENDENCY_CONFLICT',
  PATH_UNSAFE: 'PATH_UNSAFE',
  DIRTY_TARGET: 'DIRTY_TARGET',
  OUTPUT_EXISTS: 'PROJECT_CHANGED',
};

/** 归一化计划：只忽略 `checkedAt` 这类纯检查时间字段，其余逐字段比对。 */
function normalizedPlan(plan: IntegrationPlanV1): Record<string, unknown> {
  return {
    ...plan,
    publicationEvidence: plan.publicationEvidence.map(entry => ({ ...entry, checkedAt: '' })),
  } as unknown as Record<string, unknown>;
}

function firstDifference(left: unknown, right: unknown, location: string): string | undefined {
  if (canonicalJson(left) === canonicalJson(right)) return undefined;
  if (!isPlainObject(left) || !isPlainObject(right)) return location;
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const found = firstDifference(left[key], right[key], `${location}/${key}`);
    if (found !== undefined) return found;
  }
  return location;
}

function differenceIssue(location: string): IntegrationApplyIssue {
  if (location.startsWith('/localProject')) return issueOf('PROJECT_CHANGED');
  if (location.startsWith('/exactDependencies')) return issueOf('DEPENDENCY_CONFLICT');
  if (location.startsWith('/registryEvidence')) return issueOf('TARGET_CHANGED');
  if (location.startsWith('/publicationEvidence')) return issueOf('TARGET_CHANGED');
  if (location.startsWith('/sourceMatchPlan')) return issueOf('INVALID_PLAN');
  return issueOf('PROJECT_CHANGED');
}

type ReplanOutcome = { ok: true; plan: IntegrationPlanV1 } | { ok: false; issues: IntegrationApplyIssue[] };

/** 独立重跑 inspection + 远端计划核验，再与调用方给出的计划逐字段比对。 */
async function replanAndCompare(root: string, plan: IntegrationPlanV1, options: IntegrationApplyOptions): Promise<ReplanOutcome> {
  const replanned = await planIntegration(root, plan.sourceMatchPlan, {
    apiUrl: options.apiUrl,
    registryUrl: options.registryUrl,
    ...(options.apiToken !== undefined ? { apiToken: options.apiToken } : {}),
    ...(options.registryToken !== undefined ? { registryToken: options.registryToken } : {}),
    ...(options.requestTimeoutMs !== undefined ? { requestTimeoutMs: options.requestTimeoutMs } : {}),
    workspace: options.workspace ?? plan.localProject.workspace,
    ...(options.outputDir !== undefined ? { outputDir: options.outputDir } : {}),
  });
  if (replanned.conflicts.length > 0) {
    return {
      ok: false,
      issues: replanned.conflicts.map(conflict => issueOf(CONFLICT_TO_ISSUE[conflict.code] ?? 'PROJECT_CHANGED', conflict.path)),
    };
  }
  const difference = firstDifference(normalizedPlan(plan), normalizedPlan(replanned), '');
  if (difference !== undefined) return { ok: false, issues: [differenceIssue(difference)] };
  return { ok: true, plan: replanned };
}

// ─── 目标工程配置与 workspace ───

const UNSUPPORTED_SPECIFIER_PREFIXES = [
  'git:', 'git+', 'github:', 'bitbucket:', 'gitlab:', 'file:', 'link:', 'portal:', 'patch:', 'workspace:', 'catalog:',
];

function isUnsupportedSpecifier(specifier: string): boolean {
  const trimmed = specifier.trim();
  return UNSUPPORTED_SPECIFIER_PREFIXES.some(prefix => trimmed.startsWith(prefix));
}

function hasConfigurationLines(text: string): boolean {
  return text.split(/\r?\n/).some(line => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith('#') && !trimmed.startsWith(';');
  });
}

/**
 * 影响解析且尚未支持的工程配置必须显式阻断：项目 `.npmrc`、pnpmfile、
 * 清单的 overrides/resolutions/pnpm/config，以及非 registry 来源的依赖声明。
 */
function assertSupportedProjectConfiguration(root: string, plan: IntegrationPlanV1): void {
  for (const relative of ['.npmrc', 'pnpmfile.cjs', '.pnpmfile.cjs']) {
    const absolute = path.join(root, ...relative.split('/'));
    if (!fs.existsSync(absolute)) continue;
    if (relative === '.npmrc') {
      let text: string;
      try {
        text = fs.readFileSync(absolute, 'utf8');
      } catch {
        throw new InstallError('DEPENDENCY_CONFLICT', '目标工程存在不可读的 .npmrc');
      }
      if (hasConfigurationLines(text)) {
        throw new InstallError('DEPENDENCY_CONFLICT', '目标工程的 .npmrc 含有暂不支持的解析影响配置');
      }
      continue;
    }
    throw new InstallError('DEPENDENCY_CONFLICT', `目标工程含有暂不支持的包管理器钩子：${relative}`);
  }
  const manifestPaths = new Set([
    path.join(root, 'package.json'),
    path.join(root, ...plan.localProject.workspace.split('/'), 'package.json'),
  ]);
  for (const manifestPath of manifestPaths) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      continue;
    }
    if (!isPlainObject(parsed)) continue;
    for (const field of ['overrides', 'resolutions', 'pnpm', 'config']) {
      if (parsed[field] !== undefined) {
        throw new InstallError('DEPENDENCY_CONFLICT', `目标清单含有暂不支持的字段：${field}`);
      }
    }
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const value = parsed[field];
      if (value === undefined) continue;
      if (!isPlainObject(value)) {
        throw new InstallError('DEPENDENCY_CONFLICT', `目标清单的 ${field} 不是对象`);
      }
      for (const [name, specifier] of Object.entries(value)) {
        if (typeof specifier !== 'string') {
          throw new InstallError('DEPENDENCY_CONFLICT', `目标清单的 ${field}.${name} 不是字符串 specifier`);
        }
        if (isUnsupportedSpecifier(specifier)) {
          throw new InstallError('DEPENDENCY_CONFLICT', `依赖 ${name} 使用暂不支持的来源协议`);
        }
      }
    }
  }
  for (const dependency of plan.localProject.resolvedDependencies) {
    if (isUnsupportedSpecifier(dependency.specifier)) {
      throw new InstallError('DEPENDENCY_CONFLICT', `依赖 ${dependency.name} 使用暂不支持的来源协议`);
    }
  }
}

/** workspace 枚举的 I/O 失败：固定脱敏执行错误（不区分底层错误细节）。 */
function enumerationIoError(): IntegrationApplyError {
  return new IntegrationApplyError('EXECUTION_FAILED', 'workspace 成员枚举 I/O 失败');
}

/**
 * 逐目录枚举：真实目录与链接分开收集（逐条 lstat 判定，junction 归入链接），
 * I/O 失败一律失败关闭；ENOENT/ENOTDIR 视为该层无匹配（模式声明允许指向不存在的路径）。
 */
function listDirectoryEntries(root: string, relative: string): { directories: string[]; links: string[] } {
  const absolute = relative === '' ? root : path.join(root, ...relative.split('/'));
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absolute, { withFileTypes: true });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { directories: [], links: [] };
    throw enumerationIoError();
  }
  const directories: string[] = [];
  const links: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(path.join(absolute, entry.name));
    } catch {
      throw enumerationIoError();
    }
    if (stats.isSymbolicLink()) links.push(entry.name);
    else if (stats.isDirectory()) directories.push(entry.name);
  }
  return { directories, links };
}

export type WorkspaceMemberEnumeration = { members: string[]; linkHits: string[] };

/**
 * 展开 workspace 模式（仅完整段 `*` / `**`）：真实目录带 package.json 的收为成员；
 * 命中模式的链接（junction 等）只记入 linkHits，绝不穿行、绝不静默跳过——
 * 静态段命中链接同样记录并终止该分支。读取任何成员清单/启动候选锁之前必须
 * 先确认 linkHits 为空，否则按不安全成员 blocked 失败关闭。
 */
export function enumerateWorkspaceMembersDetailed(root: string, patterns: readonly string[]): WorkspaceMemberEnumeration {
  const members: string[] = [];
  const linkHits: string[] = [];
  const walk = (relative: string, segments: readonly string[]): void => {
    if (segments.length === 0) {
      if (relative !== '' && fs.existsSync(path.join(root, ...relative.split('/'), 'package.json'))) members.push(relative);
      return;
    }
    const head = segments[0]!;
    const rest = segments.slice(1);
    if (head === '**' || head === '*') {
      const { directories, links } = listDirectoryEntries(root, relative);
      for (const child of directories) walk(relative === '' ? child : `${relative}/${child}`, head === '**' ? segments : rest);
      for (const child of links) linkHits.push(relative === '' ? child : `${relative}/${child}`);
      return;
    }
    const nextRelative = relative === '' ? head : `${relative}/${head}`;
    let stats: fs.Stats | undefined;
    try {
      stats = fs.lstatSync(path.join(root, ...nextRelative.split('/')));
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'ENOENT') throw enumerationIoError();
    }
    if (stats !== undefined && stats.isSymbolicLink()) {
      linkHits.push(nextRelative);
      return;
    }
    walk(nextRelative, rest);
  };
  for (const pattern of patterns) walk('', pattern.split('/'));
  return { members: [...new Set(members)].sort(), linkHits: [...new Set(linkHits)].sort() };
}

/** 兼容既有调用方：只要真实成员列表（apply 安装路径必须改用 enumerateWorkspaceMembersDetailed）。 */
export function enumerateWorkspaceMembers(root: string, patterns: readonly string[]): string[] {
  return enumerateWorkspaceMembersDetailed(root, patterns).members;
}

/** 目标工程声明的静态 workspace 模式（按实际包管理器选取原生声明来源）。 */
function workspacePatternsOf(root: string, plan: IntegrationPlanV1): string[] {
  if (plan.packageManager === 'pnpm') {
    const read = readPnpmWorkspacePatterns(path.join(root, 'pnpm-workspace.yaml'));
    return read?.ok ? read.patterns : [];
  }
  const manifest = readManifestObject(root, 'package.json');
  const read = readNpmWorkspacePatterns(manifest);
  return read?.ok ? read.patterns : [];
}

// ─── 生成 ───

function authoritativeApiFor(element: MatchElement, evidence: readonly { response: ComponentMatchResponseV1 }[]): ComponentMatchResponseV1 {
  const variantReleaseId = element.target?.variantReleaseId;
  const response = evidence.find(entry => entry.response.target?.variantReleaseId === variantReleaseId)?.response;
  if (!response || response.status !== 'matched' || !response.api || !response.target) {
    throw new BindingError('API_MISMATCH', '缺少该实例的权威组件 API 快照');
  }
  return response;
}

function generateComponents(plan: IntegrationPlanV1): Map<string, Buffer> {
  const generated = new Map<string, Buffer>();
  const byInstance = new Map(plan.sourceMatchPlan.elements.map(element => [element.instanceId, element]));
  for (const change of plan.changes) {
    if (change.kind !== 'generated-component') continue;
    const element = byInstance.get(change.instanceId);
    if (!element?.target) throw new BindingError('API_MISMATCH', '生成变更缺少对应的映射实例');
    const response = authoritativeApiFor(element, plan.publicationEvidence);
    const model: GeneratedBindingModel = resolveBindingModel({
      element,
      api: response.api!,
      packageName: response.target!.packageName,
      exportName: response.target!.exportName,
      exportPath: response.target!.exportPath,
      styleExport: response.target!.styleExport,
    });
    const content = change.framework === 'vue' ? generateVueComponent(model) : generateReactComponent(model);
    generated.set(change.path, Buffer.from(content, 'utf8'));
  }
  return generated;
}

// ─── 清单 ───

type Guard = { exists: boolean; sha256?: string };

function baseGuardOf(plan: IntegrationPlanV1, relative: string): Guard {
  const snapshot = plan.baseFileHashes.find(entry => entry.path === relative);
  if (!snapshot) throw new PatchError('INVALID_PLAN', '计划缺少该路径的写入守卫', relative);
  return snapshot.exists
    ? { exists: true, sha256: snapshot.sha256 }
    : { exists: false };
}

function currentGuard(root: string, relative: string): Guard & { bytes?: Buffer } {
  const absolute = path.join(root, ...relative.split('/'));
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(absolute);
  } catch {
    return { exists: false };
  }
  if (!stats.isFile()) throw new PatchError('PATH_UNSAFE', '目标路径不是普通文件', relative);
  const bytes = fs.readFileSync(absolute);
  return { exists: true, sha256: sha256Hex(bytes), bytes };
}

function assertGuardMatches(root: string, relative: string, expected: Guard): void {
  const current = currentGuard(root, relative);
  if (current.exists !== expected.exists || (expected.sha256 !== undefined && current.sha256 !== expected.sha256)) {
    throw new PatchError('PROJECT_CHANGED', '目标文件与计划守卫不符', relative);
  }
}

function readManifestObject(root: string, relative: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(root, ...relative.split('/')), 'utf8'));
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function withExactDependencies(manifest: Record<string, unknown>, dependencies: readonly IntegrationDependency[]): Record<string, unknown> {
  const declared = isPlainObject(manifest['dependencies']) ? { ...(manifest['dependencies'] as Record<string, unknown>) } : {};
  for (const dependency of dependencies) declared[dependency.name] = dependency.version;
  return { ...manifest, dependencies: declared };
}

// ─── 备份与恢复 ───

type RestoreReport = {
  restored: string[];
  unchanged: string[];
  preserved: string[];
  unresolved: string[];
  issues: RestoreIssue[];
  clean: boolean;
};

/** 按备份候选逐项归入四组；四组互斥且完整覆盖，I/O 失败不冒称用户编辑。 */
function restoreFromBackup(root: string, document: IntegrationBackupV1): RestoreReport {
  const report: RestoreReport = { restored: [], unchanged: [], preserved: [], unresolved: [], issues: [], clean: true };
  for (const entry of document.files) {
    const outcome = restoreBackupEntry(root, entry);
    if (outcome.group === 'restored') report.restored.push(entry.path);
    else if (outcome.group === 'unchanged') report.unchanged.push(entry.path);
    else if (outcome.group === 'preserved') {
      report.preserved.push(entry.path);
      report.clean = false;
    } else {
      report.unresolved.push(entry.path);
      report.clean = false;
    }
    if (outcome.issue) report.issues.push(outcome.issue);
  }
  return report;
}

// ─── apply ───

type ApplyOutcome = {
  status: IntegrationApplyResultV1['status'];
  changedFiles: string[];
  beforeHashes: IntegrationApplyResultV1['beforeHashes'];
  afterHashes: IntegrationApplyResultV1['afterHashes'];
  installedVersions: IntegrationDependency[];
  issues: IntegrationApplyIssue[];
  installState: IntegrationApplyResultV1['installState'];
  backupRef: BackupReference;
};

async function runApply(
  operationId: string,
  root: string,
  plan: IntegrationPlanV1,
  options: IntegrationApplyOptions,
): Promise<IntegrationApplyResultV1> {
  const resolvedRoot = path.resolve(root);
  if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
    throw new IntegrationApplyError('INVALID_ARGUMENTS', '目标工程根不存在或不是目录');
  }
  const realRoot = realpathOrSelf(resolvedRoot);
  const projectRoot = canonicalProjectRoot(resolvedRoot);
  const planDigest = createHash('sha256').update(canonicalJson(plan)).digest('hex');

  const checkedPlan = validateIntegrationPlan(plan);
  if (!checkedPlan.ok || plan.stage !== 'plan' || plan.executionAuthorized !== false || plan.status !== 'planned') {
    return blockedResult(projectRoot, planDigest, operationId, [issueOf('INVALID_PLAN')]);
  }
  if (options.authorization === undefined) {
    return blockedResult(projectRoot, planDigest, operationId, [issueOf('AUTHORIZATION_REQUIRED')]);
  }
  if (!validateIntegrationApplyAuthorization(options.authorization, { plan, planDigest, projectRoot }).ok) {
    return blockedResult(projectRoot, planDigest, operationId, [issueOf('AUTHORIZATION_MISMATCH')]);
  }

  // 备份根：必须可创建为目录、不是链接、且位于目标工程之外。
  const backupRoot = path.resolve(options.backupRoot);
  try {
    // 逐级核验+创建（替换先 recursive mkdir 的旧路径）：上层 junction 在任何
    // mkdir、备份落盘或目标写入之前失败关闭，绝不沿链接在工程外创建；缺失普通
    // 子链只在已核验普通父目录下逐级创建并复核。
    ensureBackupRoot(backupRoot);
  } catch {
    return blockedResult(projectRoot, planDigest, operationId, [issueOf('BACKUP_INVALID')]);
  }
  let backupRootReal: string;
  try {
    backupRootReal = fs.realpathSync(backupRoot);
  } catch {
    return blockedResult(projectRoot, planDigest, operationId, [issueOf('BACKUP_INVALID')]);
  }
  if (path.resolve(backupRootReal) === path.resolve(realRoot)
    || path.resolve(backupRootReal).startsWith(`${path.resolve(realRoot)}${path.sep}`)) {
    return blockedResult(projectRoot, planDigest, operationId, [issueOf('BACKUP_INVALID')]);
  }

  // 重新核验：独立 replan 后逐字段比对（忽略纯检查时间字段）。
  const replanned = await replanAndCompare(resolvedRoot, plan, options);
  if (!replanned.ok) return blockedResult(projectRoot, planDigest, operationId, replanned.issues);
  const verified = replanned.plan;

  // 影响解析且尚未支持的工程配置：显式阻断，且不启动任何包管理器进程。
  try {
    assertSupportedProjectConfiguration(realRoot, verified);
  } catch (error) {
    if (error instanceof InstallError) {
      return blockedResult(projectRoot, planDigest, operationId, [issueOf(error.code)]);
    }
    throw toExecutionError(error);
  }

  // 生成器：未知/不安全的必需绑定在这里显式阻断，不留下任何目标写入。
  let generated: Map<string, Buffer>;
  try {
    generated = generateComponents(verified);
  } catch (error) {
    if (error instanceof BindingError) return blockedResult(projectRoot, planDigest, operationId, [issueOf(error.code)]);
    throw toExecutionError(error);
  }

  // workspace 安全预检（先于读取任何成员清单与启动候选锁）：模式命中链接一律显式阻断，
  // 绝不静默跳过不安全成员后假装检查完整；成员链/清单守卫或枚举 I/O 失败同样关闭。
  const workspaceEnumeration = enumerateWorkspaceMembersDetailed(realRoot, workspacePatternsOf(realRoot, verified));
  if (workspaceEnumeration.linkHits.length > 0) {
    return blockedResult(projectRoot, planDigest, operationId, [issueOf('DEPENDENCY_CONFLICT')]);
  }
  try {
    verifyWorkspaceMemberRoots(realRoot, workspaceEnumeration.members);
  } catch (error) {
    if (error instanceof InstallError) return blockedResult(projectRoot, planDigest, operationId, [issueOf(error.code)]);
    throw toExecutionError(error);
  }
  const workspaceMembers = workspaceEnumeration.members;

  // 拟写入内容：生成组件 + 清单（含精确依赖）+ 候选冻结锁。
  const manifestChange = verified.changes.find(change => change.kind === 'package-json');
  const lockChange = verified.changes.find(change => change.kind === 'lockfile-regeneration');
  const installPlanned = lockChange !== undefined;
  const manifestRelative = verified.localProject.workspace === '.'
    ? 'package.json'
    : `${verified.localProject.workspace}/package.json`;
  const manifestGuard = baseGuardOf(verified, manifestRelative);
  const originalManifest = readManifestObject(realRoot, manifestRelative);
  const newManifest = manifestChange !== undefined && originalManifest !== undefined
    ? withExactDependencies(originalManifest, manifestChange.dependencies)
    : undefined;

  const writes: { path: string; content: Buffer }[] = [];
  for (const change of verified.changes) {
    if (change.kind === 'generated-component') {
      const content = generated.get(change.path);
      if (content === undefined) throw new IntegrationApplyError('EXECUTION_FAILED', '生成的组件内容缺失');
      writes.push({ path: change.path, content });
    } else if (change.kind === 'package-json' && newManifest !== undefined) {
      writes.push({ path: change.path, content: Buffer.from(`${JSON.stringify(newManifest, null, 2)}\n`, 'utf8') });
    }
  }

  // 静态 workspace 成员与暂存清单来源（根 + 目标 importer + 其余静态成员）。
  const stagedManifests: { relative: string; manifest: Record<string, unknown> }[] = [];
  const rootManifest = readManifestObject(realRoot, 'package.json');
  const rootStaged = manifestRelative === 'package.json' ? (newManifest ?? originalManifest ?? rootManifest) : rootManifest;
  if (rootStaged !== undefined) stagedManifests.push({ relative: 'package.json', manifest: rootStaged });
  if (manifestRelative !== 'package.json') {
    const memberStaged = newManifest ?? originalManifest;
    if (memberStaged !== undefined) stagedManifests.push({ relative: manifestRelative, manifest: memberStaged });
  }
  for (const member of workspaceMembers) {
    const relative = `${member}/package.json`;
    if (relative === manifestRelative) continue;
    const manifest = readManifestObject(realRoot, relative);
    if (manifest !== undefined) stagedManifests.push({ relative, manifest });
  }

  let installContext: InstallContext | undefined;
  let frozenLock: Buffer | undefined;
  try {
    if (installPlanned && lockChange !== undefined && verified.packageManager !== undefined) {
      installContext = createInstallContext({
        operationId,
        projectRoot: realRoot,
        packageManager: verified.packageManager,
        registryOrigin: normalizeRegistryOrigin(options.registryUrl),
        ...(options.registryToken !== undefined ? { registryToken: options.registryToken } : {}),
        workspace: verified.localProject.workspace,
        members: workspaceMembers,
        manifests: stagedManifests,
        lockRelative: lockChange.path,
        exactDependencies: verified.exactDependencies,
        // 只读传入已验证 registry 发布证据：候选锁 SDK 身份绑定（integrity/origin）的
        // 唯一基准；绝不用计划文本自生成期望，也不把声明复制当证据。
        registryEvidence: verified.registryEvidence,
        // 交付日志落点（只读）：install-delivery.json 记录逐目录 planned/quarantined/
        // delivered 现场与身份上下文；使用原始备份根路径，与源码备份共用同一操作目录。
        deliveryJournal: { backupRoot, planDigest },
      });
      // 候选锁生成没有任何目标写入；失败即阻断，installState 保持 not-run。
      frozenLock = generateCandidateLock(installContext);
      writes.push({ path: lockChange.path, content: frozenLock });
    }
  } catch (error) {
    if (installContext !== undefined) cleanupInstall(installContext);
    if (error instanceof InstallError) return blockedResult(projectRoot, planDigest, operationId, [issueOf(error.code)]);
    throw toExecutionError(error);
  }

  // 按计划 allowedPaths 的确定性顺序写入。
  const ordered: { path: string; content: Buffer }[] = [];
  try {
    for (const relative of verified.allowedPaths) {
      const write = writes.find(candidate => candidate.path === relative);
      if (write === undefined) throw new IntegrationApplyError('EXECUTION_FAILED', '计划路径缺少拟写入内容');
      ordered.push(write);
    }
    if (ordered.length !== writes.length) {
      throw new IntegrationApplyError('EXECUTION_FAILED', '拟写入内容与计划路径不一致');
    }
  } catch (error) {
    // 候选锁成功后的执行错误出口：清除本次隔离凭据后原样上抛，不吞掉错误状态。
    if (installContext !== undefined) cleanupInstall(installContext);
    throw error;
  }

  // 备份：原字节 + 逐文件 hash 守卫，必须在任何目标写入前完整落盘。
  const files: IntegrationBackupV1['files'] = [];
  try {
    for (const write of ordered) {
      const relative = write.path;
      assertBackupSource(realRoot, relative);
      const guard = baseGuardOf(verified, relative);
      assertGuardMatches(realRoot, relative, guard);
      const current = currentGuard(realRoot, relative);
      files.push({
        path: relative,
        before: guard.exists ? { path: relative, exists: true, sha256: guard.sha256! } : { path: relative, exists: false },
        after: { path: relative, exists: true, sha256: sha256Hex(write.content) },
        ...(current.exists && current.bytes !== undefined ? { originalBase64: current.bytes.toString('base64') } : {}),
      });
    }
  } catch (error) {
    if (installContext !== undefined) cleanupInstall(installContext);
    if (error instanceof PatchError) return blockedResult(projectRoot, planDigest, operationId, [issueOf(error.code, error.path)]);
    throw toExecutionError(error);
  }
  let reference: BackupReference;
  // 最近一次成功持久化的可信不可变内存副本（绑定 reference id/hash）：仅供同一 apply
  // 在备份路径此后变为不可信时完成本次源码恢复，此后不再读盘；未经成功持久化的
  // 候选不得冒称备份。
  let persistedBackup: { reference: BackupReference; document: IntegrationBackupV1 } | undefined;
  try {
    // 持久化走原始备份根路径：junction/链接由 backup 侧逐级核验拒绝；
    // realpath（backupRootReal）只用于“备份根在工程外”的包含检查。
    const backupDocument: IntegrationBackupV1 = {
      schemaVersion: 1,
      operationId,
      projectRoot,
      planDigest,
      installPlanned,
      installStarted: false,
      files,
    };
    reference = persistBackup(backupRoot, backupDocument);
    persistedBackup = { reference, document: backupDocument };
  } catch (error) {
    if (installContext !== undefined) cleanupInstall(installContext);
    if (error instanceof BackupError) return blockedResult(projectRoot, planDigest, operationId, [issueOf('BACKUP_INVALID')]);
    throw toExecutionError(error);
  }

  // 逐文件 hash 守卫写入；任一失败按已发生动作恢复。
  const created: string[] = [];
  const changed: string[] = [];
  const beforeHashes: IntegrationApplyResultV1['beforeHashes'] = [];
  const afterHashes: IntegrationApplyResultV1['beforeHashes'] = [];
  let writeFailure: IntegrationApplyIssue | undefined;
  try {
    for (const write of ordered) {
      const guard = baseGuardOf(verified, write.path);
      assertGuardMatches(realRoot, write.path, guard);
      // 传递写前期望状态：rename 提交前晚复核，绝不覆盖提交窗口内
      // 并发出现/改写的用户字节（新建目标独占）。
      writeTargetFile(realRoot, write.path, write.content, created, guard.exists ? { exists: true, sha256: guard.sha256! } : { exists: false });
      // 成功提交的 receipt 在 rename 之后立即登记：before/after 全部来自可信候选
      // （计划守卫与拟写字节），先于任何可能失败的读回——读回失败不能抹掉“已提交”
      // 这一事实，否则已提交源码不进入恢复范围，留下既非用户字节又未报告的残留。
      // writeTargetFile 任何失败（含 rename 失败与提交前晚复核不符）都会抛出，
      // 绝不把从未提交的候选登记为已提交。
      changed.push(write.path);
      beforeHashes.push(guard.exists ? { path: write.path, exists: true, sha256: guard.sha256! } : { path: write.path, exists: false });
      afterHashes.push({ path: write.path, exists: true, sha256: sha256Hex(write.content) });
      const written = currentGuard(realRoot, write.path);
      if (!written.exists || written.sha256 !== sha256Hex(write.content)) {
        throw new PatchError('TARGET_CHANGED', '写入后的字节与拟写入内容不符', write.path);
      }
    }
  } catch (error) {
    writeFailure = error instanceof PatchError ? issueOf(error.code, error.path) : issueOf('WRITE_FAILED');
  }

  // 成功出口的最终证据复核：全部已提交目标必须仍以普通文件存在且字节与拟写内容一致。
  // 提交之后的安装/交付/清理期间被并发改写、删除或替换形态的目标一律视为偏离——
  // 绝不复用写入时记录的 afterHashes 冒称 applied；形态不可判定的读取失败同样算偏离。
  const verifyFinalEvidence = (): IntegrationApplyIssue[] => {
    const deviations: IntegrationApplyIssue[] = [];
    for (const write of ordered) {
      let deviated = true;
      try {
        const current = currentGuard(realRoot, write.path);
        deviated = !current.exists || current.sha256 !== sha256Hex(write.content);
      } catch {
        deviated = true;
      }
      if (deviated) deviations.push(issueOf('USER_EDITED', write.path));
    }
    return deviations;
  };

  if (writeFailure === undefined && installContext !== undefined) {
    // 物化进程启动前：原子持久化 installStarted=true 与新摘要/latest；失败绝不启动进程。
    try {
      // 同上：原始备份根路径进 backup 模块，由其逐级核验链接/形态。
      const startedDocument: IntegrationBackupV1 = {
        schemaVersion: 1,
        operationId,
        projectRoot,
        planDigest,
        installPlanned: true,
        installStarted: true,
        files,
      };
      reference = persistBackup(backupRoot, startedDocument);
      persistedBackup = { reference, document: startedDocument };
    } catch {
      // 日志持久化失败是 apply 自身的一次写失败：结果状态只能是 rolled-back，
      // 而契约的 ROLLED_BACK_ISSUE_CODES 只接受 WRITE_FAILED（BACKUP_INVALID 仅属于
      // blocked 的前置阶段），因此这里按写失败上报，并把引用留在最后一个可达版本上。
      writeFailure = issueOf('WRITE_FAILED');
    }
  }

  // 可信内存副本提取：只有与当前 reference 完全绑定（id/hash 相同、重序列化摘要与
  // 落盘版本一致、契约校验通过、原字节与快照摘要逐一相符）的最近一次成功持久化副本
  // 才合格；任一不符返回 undefined——此后不读盘，也不用未持久化候选冒充备份。
  const restoreFromTrustedPersisted = (): IntegrationBackupV1 | undefined => {
    const persisted = persistedBackup;
    if (persisted === undefined) return undefined;
    if (persisted.reference.id !== reference.id || persisted.reference.sha256 !== reference.sha256) return undefined;
    const document = persisted.document;
    if (document.operationId !== reference.id || document.projectRoot !== projectRoot || document.planDigest !== planDigest) return undefined;
    if (sha256Hex(serializeBackup(document)) !== reference.sha256) return undefined;
    if (!validateIntegrationBackup(document).ok) return undefined;
    for (const file of document.files) {
      if (!file.before.exists) continue;
      if (sha256Hex(Buffer.from(file.originalBase64 ?? '', 'base64')) !== file.before.sha256) return undefined;
    }
    return document;
  };

  const rollbackSource = (extra: IntegrationApplyIssue[], installState: IntegrationApplyResultV1['installState']): IntegrationApplyResultV1 => {
    // loadBackup 用原始备份根路径（backupRootReal 已被 realpath，会洗掉 junction，
    // 让 backup 侧的逐级核验失效）。
    // 仅当备份路径此后变为不可信（如 backupRoot 中途被 junction 替换）、loadBackup 拒绝
    // BackupError 时，才回退到同一 apply 的可信内存不可变副本完成本次源码恢复；其他
    // 错误不回退，无可信副本仍按原错误失败关闭——不吞 BackupError，冷启动回滚不受影响。
    let document: IntegrationBackupV1;
    try {
      document = loadBackup(backupRoot, reference, projectRoot);
    } catch (error) {
      if (!(error instanceof BackupError)) throw error;
      const trusted = restoreFromTrustedPersisted();
      if (trusted === undefined) throw error;
      document = trusted;
    }
    // 只恢复产品真正提交的文件（changed 集合）：未提交候选保留不动——首写失败时
    // 提交窗口内并发出现的用户文件不进入恢复，也不被计作产品副作用，更不伪造
    // changedFiles；结果保持 rolled-back + 空写入证据 + not-run。已提交后的用户
    // 编辑仍按四组完整分类（preserved + USER_EDITED → recovery-required）。
    const committed = document.files.filter(file => changed.includes(file.path));
    const report = restoreFromBackup(realRoot, { ...document, files: committed });
    removeCreatedDirectories(created);
    const status: IntegrationApplyResultV1['status'] = report.clean ? 'rolled-back' : 'recovery-required';
    return finishApply({
      status,
      changedFiles: changed,
      beforeHashes,
      afterHashes,
      installedVersions: [],
      issues: [...extra, ...report.issues.map(entry => issueOf(entry.code, entry.path))],
      installState,
      backupRef: reference,
    }, verified, planDigest, projectRoot, operationId);
  };

  if (writeFailure !== undefined) {
    // 安装尚未启动：外部暂存区只是过程产物，随恢复一起清掉，不在目标旁留残目录。
    if (installContext !== undefined) cleanupInstall(installContext);
    return rollbackSource([writeFailure], 'not-run');
  }

  if (installContext !== undefined && frozenLock !== undefined) {
    try {
      materializeFrozenDependencies(installContext, frozenLock);
      const delivery = planDelivery(installContext);
      buildReadyTree(installContext, delivery);
      deliverReadyTree(installContext, delivery);
    } catch (error) {
      const code = error instanceof InstallError && error.code !== 'PATH_UNSAFE' ? error.code : 'INSTALL_FAILED';
      // 物化/交付失败出口同样必须清除本次隔离凭据（含 registry 令牌的 userconfig
      // 随 envRoot 一并删除）；恢复状态由备份日志与结构化结果承载，与暂存清理互不影响。
      cleanupInstall(installContext);
      return rollbackSource([issueOf(code)], 'reinstall-required');
    }
    let installedVersions: IntegrationDependency[];
    try {
      installedVersions = readInstalledVersions(installContext);
    } catch (error) {
      const code = error instanceof InstallError && error.code !== 'PATH_UNSAFE' ? error.code : 'INSTALLED_VERSION_MISMATCH';
      // 后校验失败出口同样先清除隔离凭据，再构造恢复结果。
      cleanupInstall(installContext);
      return rollbackSource([issueOf(code)], 'reinstall-required');
    }
    // 成功出口严格清理：staging/env/ready 任一目录 rm 异常（即使目录随后消失）或删除后
    // 仍存在、隔离凭据清理后仍残留，都不得 applied——失败关闭，保守恢复已写入源码并
    // 保持 reinstall-required（installStarted=true 诚实保留）；凭据尽力清除且不回显令牌，
    // quarantine、交付日志与用户目标目录一律不动。
    if (!cleanupInstallStrict(installContext)) {
      return rollbackSource([issueOf('INSTALL_FAILED')], 'reinstall-required');
    }
    // 安装尾部最终证据复核：目标在物化/交付/清理期间被并发改写时保留用户字节，
    // 沿 committed 四组分类保守恢复源码，已发生的依赖副作用诚实保留为 reinstall-required。
    const finalDeviations = verifyFinalEvidence();
    if (finalDeviations.length > 0) {
      return rollbackSource(finalDeviations, 'reinstall-required');
    }
    return finishApply({
      status: 'applied',
      changedFiles: changed,
      beforeHashes,
      afterHashes,
      installedVersions,
      issues: [],
      installState: 'succeeded',
      backupRef: reference,
    }, verified, planDigest, projectRoot, operationId);
  }

  // 未安装出口同样遵守最终证据原则：提交后、结果返回前目标被并发改写时不冒称 applied，
  // 沿 committed 四组分类保守恢复（用户字节 preserved）；安装从未启动，保持 not-run。
  const finalDeviations = verifyFinalEvidence();
  if (finalDeviations.length > 0) {
    return rollbackSource(finalDeviations, 'not-run');
  }

  return finishApply({
    status: 'applied',
    changedFiles: changed,
    beforeHashes,
    afterHashes,
    installedVersions: [],
    issues: [],
    installState: 'not-run',
    backupRef: reference,
  }, verified, planDigest, projectRoot, operationId);
}

function normalizeRegistryOrigin(raw: string): string {
  try {
    return new URL(raw).origin;
  } catch {
    throw new IntegrationApplyError('INVALID_ARGUMENTS', 'registry 地址不是合法 URL');
  }
}

/**
 * 结果自校验：先过契约结构校验，再补上与计划上下文的交叉核验。
 *
 * 与共享契约保持一致：无安装意图时 `installedVersions` 必须为空，不能把计划或锁内
 * 版本冒称本次安装证据；有安装意图时逐一核验计划确切依赖。T17 另行读取真实安装树。
 */
function finishApply(
  outcome: ApplyOutcome,
  plan: IntegrationPlanV1,
  planDigest: string,
  projectRoot: string,
  operationId: string,
): IntegrationApplyResultV1 {
  const result: IntegrationApplyResultV1 = {
    schemaVersion: 1,
    operation: 'apply',
    operationId,
    projectRoot,
    planDigest,
    ...outcome,
  };
  if (!validateIntegrationApplyResult(result).ok) {
    throw new IntegrationApplyError('INVALID_SCHEMA', 'apply 结果未通过 IntegrationApplyResultV1 运行时校验');
  }
  if (result.projectRoot !== projectRoot || result.planDigest !== planDigest) {
    throw new IntegrationApplyError('INVALID_SCHEMA', 'apply 结果与调用上下文不符');
  }
  for (const relative of result.changedFiles) {
    if (!plan.allowedPaths.includes(relative)) {
      throw new IntegrationApplyError('INVALID_SCHEMA', 'apply 写入越出计划范围');
    }
  }
  for (const snapshot of result.beforeHashes) {
    const base = plan.baseFileHashes.find(entry => entry.path === snapshot.path);
    if (!base || base.exists !== snapshot.exists || base.sha256 !== snapshot.sha256) {
      throw new IntegrationApplyError('INVALID_SCHEMA', 'apply 写入前守卫与计划不符');
    }
  }
  const installation = plan.changes.some(change => change.kind === 'lockfile-regeneration');
  if (result.status === 'applied') {
    if (result.changedFiles.length !== plan.allowedPaths.length
      || !plan.allowedPaths.every(relative => result.changedFiles.includes(relative))) {
      throw new IntegrationApplyError('INVALID_SCHEMA', 'applied 必须覆盖完整计划');
    }
    if (result.installState !== (installation ? 'succeeded' : 'not-run')) {
      throw new IntegrationApplyError('INVALID_SCHEMA', 'installState 与计划安装意图不符');
    }
    if (installation) {
      if (result.installedVersions.length !== plan.exactDependencies.length
        || plan.exactDependencies.some(dependency => !result.installedVersions.some(
          entry => entry.name === dependency.name && entry.version === dependency.version,
        ))) {
        throw new IntegrationApplyError('INVALID_SCHEMA', '已安装版本必须逐一等于计划确切依赖');
      }
    } else if (result.installedVersions.length > 0) {
      throw new IntegrationApplyError('INVALID_SCHEMA', '无安装意图不得声称已安装依赖');
    }
  } else if (result.installedVersions.length > 0) {
    throw new IntegrationApplyError('INVALID_SCHEMA', '未成功的操作不得声称已接受安装版本');
  }
  return result;
}

export async function applyIntegration(
  root: string,
  plan: IntegrationPlanV1,
  options: IntegrationApplyOptions,
): Promise<IntegrationApplyResultV1> {
  return await runApply(createOperationId('apply'), root, plan, options);
}

// ─── rollback ───

export async function rollbackIntegration(
  root: string,
  backupRef: BackupReference,
  options: IntegrationRollbackOptions,
): Promise<IntegrationRollbackResultV1> {
  const resolvedRoot = path.resolve(root);
  if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
    throw new IntegrationApplyError('INVALID_ARGUMENTS', '目标工程根不存在或不是目录');
  }
  const realRoot = realpathOrSelf(resolvedRoot);
  const projectRoot = canonicalProjectRoot(resolvedRoot);

  // 不可信备份：抛固定脱敏 BACKUP_INVALID，绝不编造合法 rollback 对象。
  const document = loadBackup(path.resolve(options.backupRoot), backupRef, projectRoot);
  const report = restoreFromBackup(realRoot, document);
  const result: IntegrationRollbackResultV1 = {
    schemaVersion: 1,
    operation: 'rollback',
    operationId: document.operationId,
    projectRoot: document.projectRoot,
    planDigest: document.planDigest,
    status: report.preserved.length === 0 && report.unresolved.length === 0 ? 'rolled-back' : 'recovery-required',
    restoredPaths: report.restored,
    unchangedPaths: report.unchanged,
    preservedPaths: report.preserved,
    unresolvedPaths: report.unresolved,
    issues: report.issues.map(entry => issueOf(entry.code, entry.path)),
    installState: document.installStarted ? 'reinstall-required' : 'not-run',
  };
  if (!validateIntegrationRollbackResult(result, document).ok) {
    throw new IntegrationApplyError('INVALID_SCHEMA', 'rollback 结果未通过 IntegrationRollbackResultV1 运行时校验');
  }
  return result;
}
