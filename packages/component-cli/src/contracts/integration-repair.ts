import type { ValidationIssue } from './errors.js';
import type { ValidationResult } from './release-manifest.js';
import { integrationPathSchema, type IntegrationFileSnapshot } from './integration-plan.js';
import {
  integrationVerificationChecks, integrationVerificationContextIssues, integrationVerificationFinish,
  integrationVerificationIdentitySchema, integrationVerificationIssueSchema, integrationVerificationReportSchema,
  integrationVerificationSnapshotSchema, validateIntegrationVerificationReport,
  type IntegrationVerificationContext, type IntegrationVerificationIdentity, type IntegrationVerificationIssue, type IntegrationVerificationReportV1,
} from './integration-verification.js';
import { array, choice, hash, integer, object, text, validateSchema, type Schema } from './schema.js';

export type IntegrationRepairContext = IntegrationVerificationContext & { reportDigest?: string; sourceReport?: IntegrationVerificationReportV1 };
export type IntegrationRepairAttempt = {
  attempt: number; recipeId: string; beforeReportDigest: string; afterReportDigest: string; changedFiles: string[];
  beforeHashes: IntegrationFileSnapshot[]; afterHashes: IntegrationFileSnapshot[]; backupRef: { id: string; sha256: string };
};
export type IntegrationRepairResultV1 = IntegrationVerificationIdentity & {
  operation: 'repair'; specDigest: string; id: string; sourceReportDigest: string; maxAttempts: 0 | 1 | 2; attempts: IntegrationRepairAttempt[];
  status: 'repaired' | 'stopped' | 'blocked' | 'recovery-required';
  stopReason: 'passed' | 'max-attempts-reached' | 'user-edited' | 'missing-business-info' | 'out-of-scope' | 'invalid-input' | 'authorization-required' | 'verification-failed' | 'recovery-required';
  finalReport: IntegrationVerificationReportV1; changedFiles: string[]; pendingItems: IntegrationVerificationIssue[];
};
const id: Schema = { ...text, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' };
export const integrationRepairResultSchema: Schema = {
  ...object({ ...integrationVerificationIdentitySchema, specDigest: hash, operation: { type: 'string', const: 'repair' }, id, sourceReportDigest: hash, maxAttempts: integer(0, 2),
    attempts: array(object({ attempt: integer(1, 2), recipeId: id, beforeReportDigest: hash, afterReportDigest: hash,
      changedFiles: array(integrationPathSchema), beforeHashes: array(integrationVerificationSnapshotSchema), afterHashes: array(integrationVerificationSnapshotSchema), backupRef: object({ id, sha256: hash }) })),
    status: choice('repaired', 'stopped', 'blocked', 'recovery-required'),
    stopReason: choice('passed', 'max-attempts-reached', 'user-edited', 'missing-business-info', 'out-of-scope', 'invalid-input', 'authorization-required', 'verification-failed', 'recovery-required'),
    finalReport: integrationVerificationReportSchema, changedFiles: array(integrationPathSchema), pendingItems: array(integrationVerificationIssueSchema) }),
  description: 'At most two generated-file repair attempts. Runtime owns immutable private continuation guards, verifies all report/backup digests and preserves user changes; JSON cannot replace those guards.',
};
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(p => b.includes(p));
const equalSnapshot = (a: IntegrationFileSnapshot, b: IntegrationFileSnapshot) => a.path === b.path && a.exists === b.exists && a.sha256 === b.sha256;
export function validateIntegrationRepairResult(input: unknown, context?: IntegrationRepairContext): ValidationResult<IntegrationRepairResultV1> {
  const checked = validateSchema<IntegrationRepairResultV1>(integrationRepairResultSchema, input); if (!checked.ok) return checked;
  const p = checked.value; const issues: ValidationIssue[] = []; const { add, paths, snapshots, identity, fixedIssues } = integrationVerificationChecks(issues);
  identity(p); integrationVerificationContextIssues(p, context, add); paths(p.changedFiles, '/changedFiles'); fixedIssues(p.pendingItems, '/pendingItems');
  const final = validateIntegrationVerificationReport(p.finalReport, context);
  if (!final.ok) add('/finalReport', 'The final verification report must be valid');
  for (const field of ['projectRoot', 'planDigest', 'applyResultDigest', 'specDigest'] as const) if (p[field] !== p.finalReport[field]) add('/finalReport/' + field, 'Final report identity must match the repair');
  if (context?.reportDigest !== undefined && (!validateSchema(hash, context.reportDigest).ok || context.reportDigest !== p.sourceReportDigest)) add('/sourceReportDigest', 'Repair source report digest differs from the invocation');
  if (context?.sourceReport) {
    if (!validateIntegrationVerificationReport(context.sourceReport, context).ok || context.sourceReport.status === 'passed') add('/context/sourceReport', 'Repair requires a valid unresolved source report');
    for (const field of ['projectRoot', 'planDigest', 'applyResultDigest', 'specDigest'] as const) if (context.sourceReport[field] !== p[field]) add('/sourceReportDigest', 'Source report identity must match the repair');
  }
  if (p.attempts.length > p.maxAttempts) add('/attempts', 'Attempts exceed the bounded authorized budget');
  const generated = context?.plan?.changes.filter(c => c.kind === 'generated-component').map(c => c.path);
  const guards = new Map(context?.sourceReport?.snapshots.after.map(s => [s.path, s]) ?? []);
  let previousReport = p.sourceReportDigest;
  const allChanged: string[] = [];
  p.attempts.forEach((attempt, index) => {
    const field = '/attempts/' + index;
    if (attempt.attempt !== index + 1) add(field + '/attempt', 'Attempts must be contiguous and start at one');
    if (attempt.beforeReportDigest !== previousReport) add(field + '/beforeReportDigest', 'Attempt report digests must form a continuous source-bound chain');
    previousReport = attempt.afterReportDigest;
    paths(attempt.changedFiles, field + '/changedFiles'); snapshots(attempt.beforeHashes, field + '/beforeHashes'); snapshots(attempt.afterHashes, field + '/afterHashes');
    if (!sameSet(attempt.changedFiles, attempt.beforeHashes.map(s => s.path)) || !sameSet(attempt.changedFiles, attempt.afterHashes.map(s => s.path))) add(field, 'Each attempted changed file requires exactly one before and after guard');
    if (attempt.afterHashes.some(s => !s.exists)) add(field + '/afterHashes', 'Generated-file repair after guards must describe written files');
    if (generated && attempt.changedFiles.some(path => !generated.includes(path))) add(field + '/changedFiles', 'Repairs may only change exact originally planned generated files');
    for (const before of attempt.beforeHashes) {
      const prior = guards.get(before.path);
      if (prior && !equalSnapshot(prior, before)) add(field + '/beforeHashes', 'Attempt guards must continue the previous observed source state');
      if (context?.sourceReport && !prior) add(field + '/beforeHashes', 'Attempt guards must refer to observed source files');
    }
    for (const after of attempt.afterHashes) guards.set(after.path, after);
    allChanged.push(...attempt.changedFiles);
  });
  const uniqueChanges = [...new Set(allChanged)]; paths(uniqueChanges, '/attempts/changedFiles');
  if (!sameSet(p.changedFiles, uniqueChanges)) add('/changedFiles', 'Overall changed files must exactly cover all attempted generated-file writes');
  if (generated && p.changedFiles.some(path => !generated.includes(path))) add('/changedFiles', 'Overall changes exceed planned generated-file scope');
  if (p.status === 'repaired') {
    if (p.stopReason !== 'passed' || p.finalReport.status !== 'passed' || p.pendingItems.length || !p.attempts.length) add('/status', 'Repaired requires an actual successful attempt, a passed final report and no pending items');
    for (const path of uniqueChanges) {
      const observed = p.finalReport.snapshots.before.find(s => s.path === path);
      const last = guards.get(path);
      if (!observed || !last || !equalSnapshot(observed, last)) add('/finalReport/snapshots', 'Successful final verification must observe the final repair byte guards');
    }
  } else {
    if (p.stopReason === 'passed' || p.finalReport.status === 'passed' || !p.pendingItems.length) add('/status', 'Unresolved repair requires an unsuccessful final report and explicit pending items');
    if (p.status === 'stopped') {
      if (!['max-attempts-reached', 'missing-business-info', 'out-of-scope', 'verification-failed'].includes(p.stopReason)) add('/stopReason', 'Stopped requires an explicit bounded or non-repairable reason');
      if (p.stopReason === 'max-attempts-reached' && p.attempts.length !== p.maxAttempts) add('/attempts', 'A budget stop must have exhausted the authorized attempt count');
    }
    if (p.status === 'blocked' && !['user-edited', 'missing-business-info', 'out-of-scope', 'invalid-input', 'authorization-required'].includes(p.stopReason)) add('/stopReason', 'Blocked requires a pre-write trust, scope or source guard reason');
    if (p.status === 'recovery-required' && (p.stopReason !== 'recovery-required' || !p.attempts.length || !p.pendingItems.some(i => i.code === 'RECOVERY_REQUIRED' || i.code === 'WRITE_FAILED' || i.code === 'USER_EDITED'))) add('/status', 'Unresolved recovery requires attempted writes and an explicit recovery issue');
    if (['invalid-input', 'authorization-required'].includes(p.stopReason) && (p.attempts.length || p.changedFiles.length)) add('/attempts', 'Invalid or unauthorized input cannot claim repair attempts');
  }
  if (context?.sourceReport && p.attempts.length && context.sourceReport.pendingItems.some(i => i.code === 'MISSING_BUSINESS_INFO')) add('/attempts', 'Missing business information must stop repair without inventing a connection');
  return integrationVerificationFinish(p, issues);
}
