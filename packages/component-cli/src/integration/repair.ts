/**
 * T17 A2 受控有限修复编排：`repairIntegration`。
 *
 * 边界：
 * - 最多 2 次确定性生成模板修复（`maxAttempts` 仅接受 `0 | 1 | 2`，默认 `2`）；
 * - 仅允许修改 `plan` 中声明的 `generated-component` 文件子集（由授权 `allowedRepairPaths` 约束）；
 * - 修复前向外部 `artifactRoot` 独占子目录写入原字节备份；写入前执行晚 hash 守卫；
 * - 每次修复后沿本轮私有可信哈希链调用 `verifyIntegrationInternal` 做全量重验；
 * - 不修改 `package.json`、锁文件、业务文件或视觉基线；不执行任何错误文本中的命令。
 */
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
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
  validateIntegrationRepairResult,
  type IntegrationRepairAttempt,
  type IntegrationRepairResultV1,
} from '../contracts/integration-repair.js';
import {
  validateIntegrationExecutionAuthorization,
  validateIntegrationVerificationReport,
  validateIntegrationVerificationSpec,
  type IntegrationExecutionAuthorizationV1,
  type IntegrationVerificationIssue,
  type IntegrationVerificationReportV1,
  type IntegrationVerificationSpecV1,
} from '../contracts/integration-verification.js';
import type { MatchElement } from '../contracts/match-plan.js';
import { canonicalProjectRoot } from './apply.js';
import { resolveBindingModel } from './bindings.js';
import { generateReactComponent } from './generate-react.js';
import { generateVueComponent } from './generate-vue.js';
import {
  assertArtifactRootOutsideProject,
  canonicalDigest,
  createRunArtifactSession,
  sha256Hex,
  verificationIssue,
  type RunArtifactSession,
} from './report.js';
import { collectSourceSnapshots, validateOutputDirectories, verifyIntegrationInternal } from './verify.js';
import { isInsideDirectory, realpathOrSelf } from './workspace.js';

export type RepairIntegrationOptions = {
  applyResult: IntegrationApplyResultV1;
  spec: IntegrationVerificationSpecV1;
  authorization: IntegrationExecutionAuthorizationV1;
  artifactRoot: string;
  maxAttempts?: 0 | 1 | 2;
  signal?: AbortSignal;
};

type RecipeMatch = {
  recipeId: string;
  repairedContent: string;
};

type RepairFileIdentity = {
  dev: number;
  ino: number;
};

type GuardedFileRead = {
  bytes: Buffer;
  identity: RepairFileIdentity;
};

type GuardedWriteResult =
  | { status: 'written'; identity: RepairFileIdentity }
  | { status: 'changed' }
  | { status: 'failed-recovered' }
  | { status: 'recovery-required' };

function sameRepairFileIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino;
}

function repairFileIdentity(stats: fs.Stats): RepairFileIdentity {
  return { dev: stats.dev, ino: stats.ino };
}

function sameRepairFileIdentityValue(left: RepairFileIdentity, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && right.isFile();
}

function readDescriptorBytes(fd: number): Buffer {
  const stat = fs.fstatSync(fd);
  if (!stat.isFile() || stat.size > 16 * 1024 * 1024) {
    throw new Error('UNSAFE_REPAIR_FILE');
  }
  const bytes = Buffer.alloc(stat.size);
  let offset = 0;
  while (offset < bytes.length) {
    const read = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
    if (read === 0) break;
    offset += read;
  }
  if (offset !== bytes.length) throw new Error('UNSTABLE_REPAIR_FILE');
  const afterRead = fs.fstatSync(fd);
  if (!sameRepairFileIdentity(stat, afterRead) || stat.size !== afterRead.size) {
    throw new Error('UNSTABLE_REPAIR_FILE');
  }
  return bytes;
}

function readRepairFileSafely(projectRoot: string, absPath: string): GuardedFileRead | undefined {
  let fd: number | undefined;
  try {
    const beforePath = fs.lstatSync(absPath);
    if (beforePath.isSymbolicLink() || !beforePath.isFile()) return undefined;
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
    fd = fs.openSync(absPath, flags);
    const opened = fs.fstatSync(fd);
    const afterOpenPath = fs.lstatSync(absPath);
    if (
      afterOpenPath.isSymbolicLink() ||
      !sameRepairFileIdentity(beforePath, opened) ||
      !sameRepairFileIdentity(opened, afterOpenPath) ||
      !isInsideDirectory(projectRoot, realpathOrSelf(absPath))
    ) {
      return undefined;
    }
    const bytes = readDescriptorBytes(fd);
    const afterReadPath = fs.lstatSync(absPath);
    const afterReadHandle = fs.fstatSync(fd);
    if (
      afterReadPath.isSymbolicLink() ||
      !sameRepairFileIdentity(opened, afterReadHandle) ||
      !sameRepairFileIdentity(afterReadHandle, afterReadPath)
    ) {
      return undefined;
    }
    return { bytes, identity: repairFileIdentity(afterReadHandle) };
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }
}

function writeDescriptorFully(fd: number, bytes: Buffer): number {
  let offset = 0;
  while (offset < bytes.length) {
    const written = fs.writeSync(fd, bytes, offset, bytes.length - offset, offset);
    if (written <= 0) throw new Error('REPAIR_WRITE_FAILED');
    offset += written;
  }
  return offset;
}

function isPrefixOf(expected: Buffer, actual: Buffer): boolean {
  return actual.length <= expected.length && expected.subarray(0, actual.length).equals(actual);
}

function restoreOriginalDescriptor(
  fd: number,
  identity: RepairFileIdentity,
  originalBytes: Buffer,
  allowedCurrent: (bytes: Buffer) => boolean,
): boolean {
  try {
    if (!sameRepairFileIdentityValue(identity, fs.fstatSync(fd))) return false;
    if (!allowedCurrent(readDescriptorBytes(fd))) return false;
    fs.ftruncateSync(fd, 0);
    writeDescriptorFully(fd, originalBytes);
    fs.fsyncSync(fd);
    return (
      sameRepairFileIdentityValue(identity, fs.fstatSync(fd)) &&
      readDescriptorBytes(fd).equals(originalBytes)
    );
  } catch {
    return false;
  }
}

function pathStillMatchesDescriptor(
  projectRoot: string,
  absPath: string,
  fd: number,
  expectedIdentity: RepairFileIdentity,
): boolean {
  try {
    const pathStat = fs.lstatSync(absPath);
    const handleStat = fs.fstatSync(fd);
    return (
      !pathStat.isSymbolicLink() &&
      sameRepairFileIdentityValue(expectedIdentity, handleStat) &&
      sameRepairFileIdentity(handleStat, pathStat) &&
      isInsideDirectory(projectRoot, realpathOrSelf(absPath))
    );
  } catch {
    return false;
  }
}

function writeRepairFileSafely(params: {
  projectRoot: string;
  absPath: string;
  expectedBefore: IntegrationFileSnapshot;
  expectedIdentity: RepairFileIdentity;
  originalBytes: Buffer;
  repairedBytes: Buffer;
}): GuardedWriteResult {
  let fd: number | undefined;
  let mutationStarted = false;
  let writtenBytes = 0;
  try {
    const beforePath = fs.lstatSync(params.absPath);
    if (beforePath.isSymbolicLink() || !sameRepairFileIdentityValue(params.expectedIdentity, beforePath)) {
      return { status: 'changed' };
    }
    const flags = fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW ?? 0);
    fd = fs.openSync(params.absPath, flags);
    if (!pathStillMatchesDescriptor(params.projectRoot, params.absPath, fd, params.expectedIdentity)) {
      return { status: 'changed' };
    }
    const currentBytes = readDescriptorBytes(fd);
    if (
      sha256Hex(currentBytes) !== params.expectedBefore.sha256 ||
      !currentBytes.equals(params.originalBytes)
    ) {
      return { status: 'changed' };
    }
    // 再核对路径身份与内容；后续只通过已打开的文件描述符写，不会跟随被替换的符号链接。
    if (!pathStillMatchesDescriptor(params.projectRoot, params.absPath, fd, params.expectedIdentity)) {
      return { status: 'changed' };
    }
    const lastRead = readDescriptorBytes(fd);
    if (!lastRead.equals(params.originalBytes)) return { status: 'changed' };

    mutationStarted = true;
    fs.ftruncateSync(fd, 0);
    writtenBytes = writeDescriptorFully(fd, params.repairedBytes);
    fs.fsyncSync(fd);
    const stillOwnedPath = pathStillMatchesDescriptor(params.projectRoot, params.absPath, fd, params.expectedIdentity);
    const finalBytes = readDescriptorBytes(fd);
    if (!stillOwnedPath || !finalBytes.equals(params.repairedBytes)) {
      if (!restoreOriginalDescriptor(fd, params.expectedIdentity, params.originalBytes, bytes => bytes.equals(params.repairedBytes))) {
        return { status: 'recovery-required' };
      }
      return stillOwnedPath ? { status: 'recovery-required' } : { status: 'changed' };
    }
    return { status: 'written', identity: params.expectedIdentity };
  } catch {
    if (!mutationStarted || fd === undefined) return { status: 'failed-recovered' };
    try {
      const stillOwnedPath = pathStillMatchesDescriptor(params.projectRoot, params.absPath, fd, params.expectedIdentity);
      const allowedCurrent = (bytes: Buffer) => {
        const expectedPartial = params.repairedBytes.subarray(0, writtenBytes);
        return bytes.equals(expectedPartial) || isPrefixOf(params.repairedBytes, bytes);
      };
      if (!restoreOriginalDescriptor(fd, params.expectedIdentity, params.originalBytes, allowedCurrent)) {
        return { status: 'recovery-required' };
      }
      return stillOwnedPath ? { status: 'failed-recovered' } : { status: 'changed' };
    } catch {
      return { status: 'recovery-required' };
    }
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }
}

function blockedRepairResult(params: {
  id: string;
  projectRoot: string;
  planDigest: string;
  applyResultDigest: string;
  specDigest: string;
  sourceReportDigest: string;
  maxAttempts: 0 | 1 | 2;
  stopReason: IntegrationRepairResultV1['stopReason'];
  finalReport: IntegrationVerificationReportV1;
  issue: IntegrationVerificationIssue;
  status?: 'blocked' | 'stopped';
}): IntegrationRepairResultV1 {
  return {
    schemaVersion: 1,
    projectRoot: params.projectRoot,
    planDigest: params.planDigest,
    applyResultDigest: params.applyResultDigest,
    specDigest: params.specDigest,
    operation: 'repair',
    id: params.id,
    sourceReportDigest: params.sourceReportDigest,
    maxAttempts: params.maxAttempts,
    attempts: [],
    status: params.status ?? 'blocked',
    stopReason: params.stopReason,
    finalReport: params.finalReport,
    changedFiles: [],
    pendingItems: [params.issue],
  };
}

function tryDeterministicRecipe(
  plan: IntegrationPlanV1,
  relPath: string,
  currentBytes: Buffer,
): RecipeMatch | undefined {
  const change = plan.changes.find(c => c.kind === 'generated-component' && c.path === relPath);
  if (!change || change.kind !== 'generated-component') return undefined;

  const element: MatchElement | undefined = plan.sourceMatchPlan.elements.find(e => e.instanceId === change.instanceId);
  if (!element) return undefined;

  const pub = plan.publicationEvidence.find(
    p => p.response.status === 'matched' && p.response.target?.componentId === element.target?.componentId,
  );
  if (!pub?.response.target || !pub.response.api) return undefined;

  const currentText = currentBytes.toString('utf8');

  // 确定性模板 recipe: 识别 synthetic-template-fault 标记并按 T16 权威生成器重建
  const bindingBase = {
    api: pub.response.api,
    packageName: pub.response.target.packageName,
    exportName: pub.response.target.exportName,
    exportPath: pub.response.target.exportPath,
    styleExport: pub.response.target.styleExport,
  };
  const expectedFaultModel = resolveBindingModel({ ...bindingBase, element });
  const expectedFaultText =
    change.framework === 'vue'
      ? generateVueComponent(expectedFaultModel)
      : generateReactComponent(expectedFaultModel);

  if (
    element.layout?.startsWith('synthetic-template-fault:') &&
    currentText === expectedFaultText
  ) {
    const cleanElement: MatchElement = { ...element, layout: 'grid cell 1' };
    const cleanModel = resolveBindingModel({ ...bindingBase, element: cleanElement });
    const repairedContent =
      change.framework === 'vue'
        ? generateVueComponent(cleanModel)
        : generateReactComponent(cleanModel);
    return {
      recipeId: 'regenerate-generated-component',
      repairedContent,
    };
  }

  return undefined;
}

function writeRepairBackup(
  session: RunArtifactSession,
  attempt: number,
  relPath: string,
  originalBytes: Buffer,
): { ok: true; backupRef: { id: string; sha256: string } } | { ok: false } {
  try {
    const backupId = `repair-backup-${attempt}-${randomUUID().slice(0, 8)}`;
    const payload = JSON.stringify({
      id: backupId,
      path: relPath,
      sha256: sha256Hex(originalBytes),
      originalBase64: originalBytes.toString('base64'),
    });
    const ref = session.writeText(`${backupId}.json`, payload);
    return { ok: true, backupRef: { id: backupId, sha256: ref.sha256 } };
  } catch {
    return { ok: false };
  }
}

function firstSnapshotMismatch(
  expectedSnapshots: readonly IntegrationFileSnapshot[],
  actualSnapshots: readonly IntegrationFileSnapshot[],
): string | undefined {
  const expected = new Map(expectedSnapshots.map(snapshot => [snapshot.path, snapshot]));
  const actual = new Map(actualSnapshots.map(snapshot => [snapshot.path, snapshot]));
  return [...new Set([...expected.keys(), ...actual.keys()])].sort().find(filePath => {
    const before = expected.get(filePath);
    const current = actual.get(filePath);
    return before?.exists !== current?.exists || before?.sha256 !== current?.sha256;
  });
}

export async function repairIntegration(
  root: string,
  plan: IntegrationPlanV1,
  report: IntegrationVerificationReportV1,
  options: RepairIntegrationOptions,
): Promise<IntegrationRepairResultV1> {
  const repairId = `repair-${randomUUID().slice(0, 12)}`;
  const canonicalRoot = canonicalProjectRoot(root);
  const planDigest = canonicalDigest(plan);
  const applyResultDigest = canonicalDigest(options.applyResult);
  const specDigest = canonicalDigest(options.spec);
  const sourceReportDigest = canonicalDigest(report);

  const rawMax = options.maxAttempts ?? options.authorization?.maxAttempts ?? 2;
  if (rawMax !== 0 && rawMax !== 1 && rawMax !== 2) {
    return blockedRepairResult({
      id: repairId,
      projectRoot: canonicalRoot,
      planDigest,
      applyResultDigest,
      specDigest,
      sourceReportDigest,
      maxAttempts: 0,
      stopReason: 'invalid-input',
      finalReport: report,
      issue: verificationIssue('INVALID_INPUT'),
    });
  }
  const requestedMax: 0 | 1 | 2 = rawMax;

  const realProjectRoot = realpathOrSelf(path.resolve(root));
  const artCheck = assertArtifactRootOutsideProject(realProjectRoot, options.artifactRoot);
  if (!artCheck.ok) {
    return blockedRepairResult({
      id: repairId,
      projectRoot: canonicalRoot,
      planDigest,
      applyResultDigest,
      specDigest,
      sourceReportDigest,
      maxAttempts: requestedMax,
      stopReason: 'invalid-input',
      finalReport: report,
      issue: artCheck.issue,
    });
  }

  const planCheck = validateIntegrationPlan(plan);
  const applyCheck = validateIntegrationApplyResult(options.applyResult);
  const specCheck = validateIntegrationVerificationSpec(options.spec, {
    projectRoot: canonicalRoot,
    planDigest,
    applyResultDigest,
    plan,
    applyResult: options.applyResult,
  });
  const reportCheck = validateIntegrationVerificationReport(report, {
    projectRoot: canonicalRoot,
    planDigest,
    applyResultDigest,
    specDigest,
    plan,
    applyResult: options.applyResult,
    spec: options.spec,
  });

  if (!planCheck.ok || plan.status !== 'planned' || !applyCheck.ok || options.applyResult.status !== 'applied' || !specCheck.ok || !reportCheck.ok || report.status === 'passed') {
    return blockedRepairResult({
      id: repairId,
      projectRoot: canonicalRoot,
      planDigest,
      applyResultDigest,
      specDigest,
      sourceReportDigest,
      maxAttempts: requestedMax,
      stopReason: 'invalid-input',
      finalReport: report,
      issue: verificationIssue('INVALID_INPUT'),
    });
  }

  const authCheck = validateIntegrationExecutionAuthorization(options.authorization, {
    projectRoot: canonicalRoot,
    planDigest,
    applyResultDigest,
    specDigest,
    reportDigest: sourceReportDigest,
    plan,
    applyResult: options.applyResult,
    spec: options.spec,
    sourceReport: report,
  });
  if (!authCheck.ok || options.authorization.operation !== 'repair') {
    return blockedRepairResult({
      id: repairId,
      projectRoot: canonicalRoot,
      planDigest,
      applyResultDigest,
      specDigest,
      sourceReportDigest,
      maxAttempts: requestedMax,
      stopReason: 'authorization-required',
      finalReport: report,
      issue: verificationIssue('AUTHORIZATION_MISMATCH'),
    });
  }

  if (report.pendingItems.some(i => i.code === 'MISSING_BUSINESS_INFO')) {
    return blockedRepairResult({
      id: repairId,
      projectRoot: canonicalRoot,
      planDigest,
      applyResultDigest,
      specDigest,
      sourceReportDigest,
      maxAttempts: requestedMax,
      stopReason: 'missing-business-info',
      finalReport: report,
      issue: verificationIssue('MISSING_BUSINESS_INFO'),
    });
  }

  const outputDirCheck = validateOutputDirectories(realProjectRoot, options.spec.commands);
  if (!outputDirCheck.ok) {
    return blockedRepairResult({
      id: repairId, projectRoot: canonicalRoot, planDigest, applyResultDigest, specDigest, sourceReportDigest,
      maxAttempts: requestedMax, stopReason: 'invalid-input', finalReport: report, issue: outputDirCheck.issue,
    });
  }
  const currentSource = collectSourceSnapshots(realProjectRoot, outputDirCheck.excludedRelPaths);
  if (!currentSource.ok) {
    return blockedRepairResult({
      id: repairId, projectRoot: canonicalRoot, planDigest, applyResultDigest, specDigest, sourceReportDigest,
      maxAttempts: requestedMax, stopReason: 'invalid-input', finalReport: report, issue: currentSource.issue,
    });
  }
  const reportedAfter = new Map(report.snapshots.after.map(snapshot => [snapshot.path, snapshot]));
  const currentAfter = new Map(currentSource.snapshots.map(snapshot => [snapshot.path, snapshot]));
  const changedSinceReport = [...new Set([...reportedAfter.keys(), ...currentAfter.keys()])].sort().find(filePath => {
    const expected = reportedAfter.get(filePath);
    const actual = currentAfter.get(filePath);
    return expected?.exists !== actual?.exists || expected?.sha256 !== actual?.sha256;
  });
  if (changedSinceReport) {
    return blockedRepairResult({
      id: repairId, projectRoot: canonicalRoot, planDigest, applyResultDigest, specDigest, sourceReportDigest,
      maxAttempts: requestedMax, stopReason: 'user-edited', finalReport: report,
      issue: verificationIssue('USER_EDITED', changedSinceReport),
    });
  }

  const effectiveMax = Math.min(requestedMax, options.authorization.maxAttempts) as 0 | 1 | 2;
  if (effectiveMax === 0) {
    return blockedRepairResult({
      id: repairId,
      projectRoot: canonicalRoot,
      planDigest,
      applyResultDigest,
      specDigest,
      sourceReportDigest,
      maxAttempts: 0,
      stopReason: 'verification-failed',
      finalReport: report,
      issue: report.pendingItems[0] ?? verificationIssue('REPAIR_LIMIT_REACHED'),
      status: 'stopped',
    });
  }

  // 复核初始守卫：applyResult.afterHashes 与 report.snapshots.after 均必须与当前磁盘一致
  for (const guard of options.applyResult.afterHashes) {
    const abs = path.resolve(realProjectRoot, guard.path);
    let stat: fs.Stats | undefined;
    try { stat = fs.lstatSync(abs); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return blockedRepairResult({
          id: repairId, projectRoot: canonicalRoot, planDigest, applyResultDigest, specDigest, sourceReportDigest,
          maxAttempts: effectiveMax, stopReason: 'invalid-input', finalReport: report,
          issue: verificationIssue('PATH_UNSAFE', guard.path),
        });
      }
    }
    const exists = stat !== undefined;
    if (stat && (stat.isSymbolicLink() || !stat.isFile())) {
      return blockedRepairResult({
        id: repairId, projectRoot: canonicalRoot, planDigest, applyResultDigest, specDigest, sourceReportDigest,
        maxAttempts: effectiveMax, stopReason: 'invalid-input', finalReport: report,
        issue: verificationIssue('PATH_UNSAFE', guard.path),
      });
    }
    const realTarget = exists ? realpathOrSelf(abs) : abs;
    if (exists && !isInsideDirectory(realProjectRoot, realTarget)) {
      return blockedRepairResult({
        id: repairId, projectRoot: canonicalRoot, planDigest, applyResultDigest, specDigest, sourceReportDigest,
        maxAttempts: effectiveMax, stopReason: 'invalid-input', finalReport: report,
        issue: verificationIssue('PATH_UNSAFE', guard.path),
      });
    }
    const guardedRead = exists ? readRepairFileSafely(realProjectRoot, abs) : undefined;
    if (exists && !guardedRead) {
      return blockedRepairResult({
        id: repairId, projectRoot: canonicalRoot, planDigest, applyResultDigest, specDigest, sourceReportDigest,
        maxAttempts: effectiveMax, stopReason: 'invalid-input', finalReport: report,
        issue: verificationIssue('PATH_UNSAFE', guard.path),
      });
    }
    const actualSha = guardedRead ? sha256Hex(guardedRead.bytes) : undefined;
    if (guard.exists !== exists || guard.sha256 !== actualSha) {
      return blockedRepairResult({
        id: repairId, projectRoot: canonicalRoot, planDigest, applyResultDigest, specDigest, sourceReportDigest,
        maxAttempts: effectiveMax, stopReason: 'user-edited', finalReport: report,
        issue: verificationIssue('USER_EDITED', guard.path),
      });
    }
  }

  const session = createRunArtifactSession(options.artifactRoot, 'repair');
  const privateGuards = new Map<string, IntegrationFileSnapshot>(
    options.applyResult.afterHashes.map(s => [s.path, { ...s }]),
  );
  const privateIdentities = new Map<string, RepairFileIdentity>();
  for (const guard of options.applyResult.afterHashes) {
    if (!guard.exists) continue;
    const guardedRead = readRepairFileSafely(realProjectRoot, path.resolve(realProjectRoot, guard.path));
    if (!guardedRead || sha256Hex(guardedRead.bytes) !== guard.sha256) {
      return blockedRepairResult({
        id: repairId, projectRoot: canonicalRoot, planDigest, applyResultDigest, specDigest, sourceReportDigest,
        maxAttempts: effectiveMax, stopReason: 'user-edited', finalReport: report,
        issue: verificationIssue('USER_EDITED', guard.path),
      });
    }
    privateIdentities.set(guard.path, guardedRead.identity);
  }

  const attempts: IntegrationRepairAttempt[] = [];
  const changedSet = new Set<string>();
  let currentReport = report;
  let currentReportDigest = sourceReportDigest;
  let stopReason: IntegrationRepairResultV1['stopReason'] = 'verification-failed';
  let status: IntegrationRepairResultV1['status'] = 'stopped';

  for (let attemptNum = 1; attemptNum <= effectiveMax; attemptNum++) {
    if (options.signal?.aborted) {
      stopReason = 'verification-failed';
      status = 'stopped';
      break;
    }

    let matchedPath: string | undefined;
    let matchedRecipe: RecipeMatch | undefined;
    let originalBytes: Buffer | undefined;
    let beforeSnap: IntegrationFileSnapshot | undefined;
    let beforeIdentity: RepairFileIdentity | undefined;

    for (const relPath of options.authorization.allowedRepairPaths) {
      const abs = path.resolve(realProjectRoot, relPath);
      if (!fs.existsSync(abs)) {
        continue;
      }
      const guardedRead = readRepairFileSafely(realProjectRoot, abs);
      if (!guardedRead) {
        status = 'blocked';
        stopReason = 'user-edited';
        break;
      }
      const { bytes } = guardedRead;
      const currentSha = sha256Hex(bytes);
      const expectedBefore = privateGuards.get(relPath);
      const expectedIdentity = privateIdentities.get(relPath);
      if (
        !expectedBefore || !expectedBefore.exists || expectedBefore.sha256 !== currentSha ||
        !expectedIdentity || expectedIdentity.dev !== guardedRead.identity.dev || expectedIdentity.ino !== guardedRead.identity.ino
      ) {
        status = 'blocked';
        stopReason = 'user-edited';
        break;
      }
      const recipe = tryDeterministicRecipe(plan, relPath, bytes);
      if (recipe) {
        matchedPath = relPath;
        matchedRecipe = recipe;
        originalBytes = bytes;
        beforeSnap = { path: relPath, exists: true, sha256: currentSha };
        beforeIdentity = guardedRead.identity;
        break;
      }
    }

    if (status === 'blocked') {
      break;
    }
    if (!matchedPath || !matchedRecipe || !originalBytes || !beforeSnap || !beforeIdentity) {
      stopReason = attempts.length === effectiveMax ? 'max-attempts-reached' : 'verification-failed';
      status = 'stopped';
      break;
    }

    const backupRes = writeRepairBackup(session, attemptNum, matchedPath, originalBytes);
    if (!backupRes.ok) {
      status = 'blocked';
      stopReason = 'invalid-input';
      break;
    }

    // 复核当前轮报告的完整 after 快照，捕获自上轮 verify 后新增、删除或修改的任意源文件。
    const immediatelyBeforeWrite = collectSourceSnapshots(realProjectRoot, outputDirCheck.excludedRelPaths);
    if (!immediatelyBeforeWrite.ok) {
      status = 'blocked';
      stopReason = 'user-edited';
      break;
    }
    const snapshotMismatch = firstSnapshotMismatch(currentReport.snapshots.after, immediatelyBeforeWrite.snapshots);
    if (snapshotMismatch) {
      status = 'blocked';
      stopReason = 'user-edited';
      break;
    }

    const targetAbs = path.resolve(realProjectRoot, matchedPath);
    const writeResult = writeRepairFileSafely({
      projectRoot: realProjectRoot,
      absPath: targetAbs,
      expectedBefore: beforeSnap,
      expectedIdentity: beforeIdentity,
      originalBytes,
      repairedBytes: Buffer.from(matchedRecipe.repairedContent, 'utf8'),
    });
    if (writeResult.status !== 'written') {
      if (writeResult.status === 'changed') {
        status = 'blocked';
        stopReason = 'user-edited';
      } else if (writeResult.status === 'recovery-required') {
        status = 'recovery-required';
        stopReason = 'recovery-required';
      } else {
        status = 'stopped';
        stopReason = 'verification-failed';
      }
      break;
    }

    const afterSnap: IntegrationFileSnapshot = {
      path: matchedPath,
      exists: true,
      sha256: sha256Hex(Buffer.from(matchedRecipe.repairedContent, 'utf8')),
    };
    privateGuards.set(matchedPath, afterSnap);
    privateIdentities.set(matchedPath, writeResult.identity);
    changedSet.add(matchedPath);

    // 构造本次内部 verify 授权并执行全量重验
    const verifyAuth: IntegrationExecutionAuthorizationV1 = {
      schemaVersion: 1,
      projectRoot: canonicalRoot,
      planDigest,
      applyResultDigest,
      specDigest,
      operation: 'verify',
      allowProjectScripts: options.authorization.allowProjectScripts,
      allowBrowser: options.authorization.allowBrowser,
      scriptNames: [...options.authorization.scriptNames],
      allowedRepairPaths: [],
      maxAttempts: 0,
    };

    const nextReport = await verifyIntegrationInternal(
      root,
      plan,
      {
        applyResult: options.applyResult,
        spec: options.spec,
        authorization: verifyAuth,
        artifactRoot: options.artifactRoot,
        signal: options.signal,
      },
      [...privateGuards.values()],
    );
    const nextReportDigest = canonicalDigest(nextReport);

    attempts.push({
      attempt: attemptNum,
      recipeId: matchedRecipe.recipeId,
      beforeReportDigest: currentReportDigest,
      afterReportDigest: nextReportDigest,
      changedFiles: [matchedPath],
      beforeHashes: [beforeSnap],
      afterHashes: [afterSnap],
      backupRef: backupRes.backupRef,
    });

    currentReport = nextReport;
    currentReportDigest = nextReportDigest;

    if (nextReport.status === 'passed') {
      status = 'repaired';
      stopReason = 'passed';
      break;
    }

    if (attemptNum === effectiveMax) {
      status = 'stopped';
      stopReason = 'max-attempts-reached';
    }
  }

  const changedFiles = [...changedSet];
  const pendingItems: IntegrationVerificationIssue[] =
    status === 'repaired'
      ? []
      : currentReport.pendingItems.length > 0
        ? currentReport.pendingItems
        : [verificationIssue(stopReason === 'user-edited' ? 'USER_EDITED' : 'REPAIR_LIMIT_REACHED')];

  const result: IntegrationRepairResultV1 = {
    schemaVersion: 1,
    projectRoot: canonicalRoot,
    planDigest,
    applyResultDigest,
    specDigest,
    operation: 'repair',
    id: repairId,
    sourceReportDigest,
    maxAttempts: effectiveMax,
    attempts,
    status,
    stopReason,
    finalReport: currentReport,
    changedFiles,
    pendingItems,
  };

  const validated = validateIntegrationRepairResult(result);
  if (!validated.ok) {
    throw new Error(`INVALID_REPAIR_RESULT: ${validated.issues.map(i => `${i.path}:${i.message}`).join('; ')}`);
  }
  return validated.value;
}
