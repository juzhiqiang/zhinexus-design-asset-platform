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
import { verifyIntegrationInternal } from './verify.js';
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
    const exists = fs.existsSync(abs);
    if (exists && fs.lstatSync(abs).isSymbolicLink()) {
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
    const actualSha = exists ? sha256Hex(fs.readFileSync(abs)) : undefined;
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

    for (const relPath of options.authorization.allowedRepairPaths) {
      const abs = path.resolve(realProjectRoot, relPath);
      if (!fs.existsSync(abs) || fs.lstatSync(abs).isSymbolicLink() || !isInsideDirectory(realProjectRoot, realpathOrSelf(abs))) {
        continue;
      }
      const bytes = fs.readFileSync(abs);
      const currentSha = sha256Hex(bytes);
      const expectedBefore = privateGuards.get(relPath);
      if (!expectedBefore || !expectedBefore.exists || expectedBefore.sha256 !== currentSha) {
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
        break;
      }
    }

    if (status === 'blocked') {
      break;
    }
    if (!matchedPath || !matchedRecipe || !originalBytes || !beforeSnap) {
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

    const targetAbs = path.resolve(realProjectRoot, matchedPath);
    // 晚 hash 守卫：写前再次核对字节
    const lateSha = sha256Hex(fs.readFileSync(targetAbs));
    if (lateSha !== beforeSnap.sha256) {
      status = 'blocked';
      stopReason = 'user-edited';
      break;
    }

    try {
      fs.writeFileSync(targetAbs, matchedRecipe.repairedContent, 'utf8');
    } catch {
      // 尝试恢复原字节
      try {
        fs.writeFileSync(targetAbs, originalBytes);
        status = 'stopped';
        stopReason = 'verification-failed';
      } catch {
        status = 'recovery-required';
        stopReason = 'recovery-required';
      }
      break;
    }

    const writtenBytes = fs.readFileSync(targetAbs);
    const afterSnap: IntegrationFileSnapshot = {
      path: matchedPath,
      exists: true,
      sha256: sha256Hex(writtenBytes),
    };
    privateGuards.set(matchedPath, afterSnap);
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
