import type { ValidationIssue } from './errors.js';
import type { ValidationResult } from './release-manifest.js';
import { integrationPathSchema, validateIntegrationPlan, type IntegrationDependency, type IntegrationFileSnapshot, type IntegrationPlanV1 } from './integration-plan.js';
import { array, choice, exactVersion, hash, object, text, validateSchema, type Schema } from './schema.js';

/** Structural evidence only. Callers must prove authorization, real paths, hashes and installed bytes. */
export const INTEGRATION_APPLY_ISSUE_CODES = [
  'INVALID_PLAN', 'AUTHORIZATION_REQUIRED', 'AUTHORIZATION_MISMATCH', 'PROJECT_CHANGED', 'PATH_UNSAFE',
  'DIRTY_TARGET', 'TARGET_CHANGED', 'DEPENDENCY_CONFLICT', 'API_MISMATCH', 'BINDING_UNSUPPORTED',
  'INSTALL_FAILED', 'INSTALLED_VERSION_MISMATCH', 'BACKUP_INVALID', 'WRITE_FAILED', 'USER_EDITED', 'RECOVERY_REQUIRED',
] as const;
export type IntegrationApplyIssueCode = typeof INTEGRATION_APPLY_ISSUE_CODES[number];
export const INTEGRATION_APPLY_ISSUE_MESSAGES = {
  INVALID_PLAN: 'Integration plan is invalid.',
  AUTHORIZATION_REQUIRED: 'Explicit apply authorization is required.',
  AUTHORIZATION_MISMATCH: 'Apply authorization does not match the current plan.',
  PROJECT_CHANGED: 'Project state changed after planning.',
  PATH_UNSAFE: 'A target path is unsafe.',
  DIRTY_TARGET: 'A target file has local changes.',
  TARGET_CHANGED: 'A target file changed during apply.',
  DEPENDENCY_CONFLICT: 'Requested dependencies conflict with the project.',
  API_MISMATCH: 'The verified component API no longer matches the plan.',
  BINDING_UNSUPPORTED: 'A requested binding is unsupported.',
  INSTALL_FAILED: 'Dependency installation failed.',
  INSTALLED_VERSION_MISMATCH: 'Installed dependency versions do not match the plan.',
  BACKUP_INVALID: 'The recovery backup is invalid.',
  WRITE_FAILED: 'A planned file write failed.',
  USER_EDITED: 'A user-edited file was preserved.',
  RECOVERY_REQUIRED: 'Manual recovery is required.',
} as const satisfies Record<IntegrationApplyIssueCode, string>;
export type IntegrationApplyIssue = {
  [Code in IntegrationApplyIssueCode]: { code: Code; message: typeof INTEGRATION_APPLY_ISSUE_MESSAGES[Code]; path?: string }
}[IntegrationApplyIssueCode];
export type IntegrationApplyAuthorizationV1 = {
  schemaVersion: 1; operation: 'apply'; projectRoot: string; planDigest: string; allowedPaths: string[]; allowInstall: boolean;
};
export type IntegrationBackupV1 = {
  schemaVersion: 1; operationId: string; projectRoot: string; planDigest: string;
  installPlanned: boolean; installStarted: boolean;
  files: { path: string; before: IntegrationFileSnapshot; after: IntegrationFileSnapshot; originalBase64?: string }[];
};
export type IntegrationApplyResultV1 = {
  schemaVersion: 1; operation: 'apply'; operationId: string; projectRoot: string; planDigest: string;
  status: 'applied' | 'blocked' | 'rolled-back' | 'recovery-required'; changedFiles: string[];
  beforeHashes: IntegrationFileSnapshot[]; afterHashes: IntegrationFileSnapshot[]; installedVersions: IntegrationDependency[];
  issues: IntegrationApplyIssue[]; backupRef?: { id: string; sha256: string };
  installState: 'not-run' | 'succeeded' | 'failed' | 'reinstall-required';
};
export type IntegrationRollbackResultV1 = {
  schemaVersion: 1; operation: 'rollback'; operationId: string; projectRoot: string; planDigest: string;
  status: 'rolled-back' | 'recovery-required'; restoredPaths: string[]; unchangedPaths: string[]; preservedPaths: string[]; unresolvedPaths: string[];
  issues: IntegrationApplyIssue[]; installState: 'not-run' | 'reinstall-required';
};
/** Expected values must come from the trusted invocation boundary, not the same untrusted JSON. */
export type IntegrationApplyContext = { plan: IntegrationPlanV1; planDigest: string; projectRoot: string };

const operationId: Schema = { ...text, maxLength: 128, pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$' };
const projectRoot: Schema = { ...text, pattern: '^[A-Za-z]:/' };
const snapshot = object({ path: integrationPathSchema, exists: { type: 'boolean' }, sha256: hash }, ['sha256']);
const issue = object({ code: choice(...INTEGRATION_APPLY_ISSUE_CODES), message: choice(...Object.values(INTEGRATION_APPLY_ISSUE_MESSAGES)), path: integrationPathSchema }, ['path']);
const dependency = object({ name: { ...text, pattern: '^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$' }, version: exactVersion });
const identity = { schemaVersion: { type: 'integer', const: 1 } as Schema, operationId, projectRoot, planDigest: hash };
export const integrationApplyAuthorizationSchema: Schema = {
  ...object({ schemaVersion: identity.schemaVersion, operation: { type: 'string', const: 'apply' }, projectRoot, planDigest: hash,
    allowedPaths: array(integrationPathSchema, 1), allowInstall: { type: 'boolean' } }),
  description: 'Explicit invocation scope only; not proof of human authorization. Runtime checks exact plan scope; caller verifies digest and physical root.',
};
export const integrationBackupSchema: Schema = {
  ...object({ ...identity, installPlanned: { type: 'boolean' }, installStarted: { type: 'boolean' }, files: array(object({ path: integrationPathSchema, before: snapshot, after: snapshot,
    originalBase64: { type: 'string', maxLength: 8 * 1024 * 1024, pattern: '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' },
  }, ['originalBase64']), 1) }),
  description: 'Runtime additionally checks canonical base64, snapshots and unique non-overlapping paths. Original byte digests and root binding require local verification.',
};
export const integrationApplyResultSchema: Schema = {
  ...object({ ...identity, operation: { type: 'string', const: 'apply' }, status: choice('applied', 'blocked', 'rolled-back', 'recovery-required'),
    changedFiles: array(integrationPathSchema), beforeHashes: array(snapshot), afterHashes: array(snapshot), installedVersions: array(dependency),
    issues: array(issue), backupRef: object({ id: operationId, sha256: hash }), installState: choice('not-run', 'succeeded', 'failed', 'reinstall-required'),
  }, ['backupRef']),
  description: 'Evidence of attempted writes, not a verified byte claim. Runtime enforces status/guard/scope consistency. Applied needs exact installed dependencies when context supplied.',
};
export const integrationRollbackResultSchema: Schema = {
  ...object({ ...identity, operation: { type: 'string', const: 'rollback' }, status: choice('rolled-back', 'recovery-required'), restoredPaths: array(integrationPathSchema),
    unchangedPaths: array(integrationPathSchema), preservedPaths: array(integrationPathSchema), unresolvedPaths: array(integrationPathSchema), issues: array(issue), installState: choice('not-run', 'reinstall-required') }),
  description: 'Runtime checks disjoint restored, unchanged, preserved and unresolved coverage plus backup identity. Caller compares actual hashes before restoring; node_modules is not restored by file rollback.',
};

const pathKey = (p: string) => p.normalize('NFC').toLowerCase();
const equalSnapshot = (a: IntegrationFileSnapshot, b: IntegrationFileSnapshot) => a.path === b.path && a.exists === b.exists && a.sha256 === b.sha256;
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(p => b.includes(p));
function checks(issues: ValidationIssue[]) {
  const add = (path: string, message: string) => { if (issues.length < 100) issues.push({ code: 'INVALID_SCHEMA', path, message }); };
  const paths = (values: string[], field: string) => {
    const keys = values.map(pathKey);
    if (new Set(keys).size !== keys.length) add(field, 'Duplicate or aliased path');
    const sorted = [...keys].sort();
    for (let i = 1; i < sorted.length; i++) if (sorted[i]!.startsWith(sorted[i - 1]! + '/')) { add(field, 'A file cannot be an ancestor of another file'); break; }
  };
  const snapshots = (values: IntegrationFileSnapshot[], field: string) => {
    paths(values.map(f => f.path), field);
    values.forEach((f, i) => { if (f.exists !== (f.sha256 !== undefined)) add(`${field}/${i}`, 'Existing file requires a hash; absent file forbids a hash'); });
  };
  const root = (value: string) => {
    if (value.slice(3) && !validateSchema(integrationPathSchema, value.slice(3)).ok) add('/projectRoot', 'Canonical absolute Windows root required');
  };
  return { add, paths, snapshots, root };
}
function finish<T>(value: T, issues: ValidationIssue[]): ValidationResult<T> { return issues.length ? { ok: false, issues } : { ok: true, value }; }
function validateIssueMessages(values: IntegrationApplyIssue[], add: (path: string, message: string) => void) {
  values.forEach((issue, index) => {
    if (issue.message !== INTEGRATION_APPLY_ISSUE_MESSAGES[issue.code]) add(`/issues/${index}/message`, 'Issue message must match its fixed sanitized code message');
  });
}
const BLOCKED_ISSUE_CODES: readonly IntegrationApplyIssueCode[] = [
  'INVALID_PLAN', 'AUTHORIZATION_REQUIRED', 'AUTHORIZATION_MISMATCH', 'PROJECT_CHANGED', 'PATH_UNSAFE',
  'DIRTY_TARGET', 'DEPENDENCY_CONFLICT', 'API_MISMATCH', 'BINDING_UNSUPPORTED', 'BACKUP_INVALID',
];
const ROLLED_BACK_ISSUE_CODES: readonly IntegrationApplyIssueCode[] = [
  'TARGET_CHANGED', 'INSTALL_FAILED', 'INSTALLED_VERSION_MISMATCH', 'WRITE_FAILED',
];
const RECOVERY_REQUIRED_ISSUE_CODES: readonly IntegrationApplyIssueCode[] = [
  ...ROLLED_BACK_ISSUE_CODES, 'USER_EDITED', 'RECOVERY_REQUIRED',
];
function restrictIssueCodes(values: IntegrationApplyIssue[], allowed: readonly IntegrationApplyIssueCode[], add: (path: string, message: string) => void) {
  values.forEach((issue, index) => {
    if (!allowed.includes(issue.code)) add(`/issues/${index}/code`, 'Issue code is incompatible with the result status');
  });
}
function contextIssues(value: { projectRoot: string; planDigest: string }, context: IntegrationApplyContext, add: (p: string, m: string) => void) {
  if (!validateIntegrationPlan(context.plan).ok || context.plan.status !== 'planned') add('/context/plan', 'A valid planned context is required');
  if (!validateSchema(hash, context.planDigest).ok || value.planDigest !== context.planDigest) add('/planDigest', 'Plan digest does not match the invocation');
  if (!validateSchema(projectRoot, context.projectRoot).ok || value.projectRoot !== context.projectRoot) add('/projectRoot', 'Project root does not match the invocation');
}

export function validateIntegrationApplyAuthorization(input: unknown, context?: IntegrationApplyContext): ValidationResult<IntegrationApplyAuthorizationV1> {
  const checked = validateSchema<IntegrationApplyAuthorizationV1>(integrationApplyAuthorizationSchema, input); if (!checked.ok) return checked;
  const p = checked.value; const issues: ValidationIssue[] = []; const { add, paths, root } = checks(issues);
  paths(p.allowedPaths, '/allowedPaths'); root(p.projectRoot);
  if (context) {
    contextIssues(p, context, add);
    if (!sameSet(p.allowedPaths, context.plan.allowedPaths)) add('/allowedPaths', 'Authorization must enumerate the exact plan paths');
    if (context.plan.changes.some(c => c.kind === 'lockfile-regeneration') && !p.allowInstall) add('/allowInstall', 'Dependency installation requires explicit permission');
  }
  return finish(p, issues);
}

function canonicalBase64(value: string): boolean {
  // RFC 4648 unused pad bits must be zero; regex alone permits alternate encodings such as Zh==.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  if (value.endsWith('==')) return alphabet.indexOf(value[value.length - 3]!) % 16 === 0;
  if (value.endsWith('=')) return alphabet.indexOf(value[value.length - 2]!) % 4 === 0;
  return true;
}
export function validateIntegrationBackup(input: unknown, context?: IntegrationApplyContext): ValidationResult<IntegrationBackupV1> {
  const checked = validateSchema<IntegrationBackupV1>(integrationBackupSchema, input); if (!checked.ok) return checked;
  const p = checked.value; const issues: ValidationIssue[] = []; const { add, paths, snapshots, root } = checks(issues);
  root(p.projectRoot); paths(p.files.map(f => f.path), '/files');
  snapshots(p.files.map(f => f.before), '/files/before'); snapshots(p.files.map(f => f.after), '/files/after');
  for (const [i, f] of p.files.entries()) {
    if (f.before.path !== f.path || f.after.path !== f.path) add(`/files/${i}`, 'Snapshot paths must match the file');
    if (!f.after.exists) add(`/files/${i}/after`, 'Every planned write creates a regular file');
    if (f.before.exists !== (f.originalBase64 !== undefined)) add(`/files/${i}/originalBase64`, 'Prior bytes required only for existing files, including empty files');
    if (f.originalBase64 !== undefined && !canonicalBase64(f.originalBase64)) add(`/files/${i}/originalBase64`, 'Noncanonical base64 padding');
  }
  if (context) {
    contextIssues(p, context, add);
    if (!sameSet(p.files.map(f => f.path), context.plan.allowedPaths)) add('/files', 'Backup must cover the exact plan write set');
    for (const f of p.files) { const before = context.plan.baseFileHashes.find(s => s.path === f.path); if (!before || !equalSnapshot(before, f.before)) add('/files/before', 'Original guard must match the plan'); }
    if (p.installPlanned !== context.plan.changes.some(c => c.kind === 'lockfile-regeneration')) add('/installPlanned', 'Installation intent must match the plan');
  }
  if (p.installStarted && !p.installPlanned) add('/installStarted', 'Installation cannot start without a planned install');
  return finish(p, issues);
}

export function validateIntegrationApplyResult(input: unknown, context?: IntegrationApplyContext): ValidationResult<IntegrationApplyResultV1> {
  const checked = validateSchema<IntegrationApplyResultV1>(integrationApplyResultSchema, input); if (!checked.ok) return checked;
  const p = checked.value; const issues: ValidationIssue[] = []; const { add, paths, snapshots, root } = checks(issues);
  root(p.projectRoot); paths(p.changedFiles, '/changedFiles'); snapshots(p.beforeHashes, '/beforeHashes'); snapshots(p.afterHashes, '/afterHashes');
  validateIssueMessages(p.issues, add);
  if (!sameSet(p.changedFiles, p.beforeHashes.map(f => f.path)) || !sameSet(p.changedFiles, p.afterHashes.map(f => f.path))) add('/changedFiles', 'Every changed path needs exactly one before and after guard');
  if (p.afterHashes.some(f => !f.exists)) add('/afterHashes', 'After guards describe files written by apply');
  if (new Set(p.installedVersions.map(d => d.name)).size !== p.installedVersions.length) add('/installedVersions', 'Duplicate dependency');
  if (p.backupRef && p.backupRef.id !== p.operationId) add('/backupRef/id', 'Backup identity must match the operation');
  if (p.changedFiles.length && !p.backupRef) add('/backupRef', 'Written files require a backup reference');
  if (p.status === 'applied') {
    if (!p.changedFiles.length || p.issues.length) add('/status', 'Applied requires writes and no issues');
    if (!['not-run', 'succeeded'].includes(p.installState)) add('/installState', 'Applied cannot claim failed or unresolved installation');
  } else {
    if (!p.issues.length) add('/issues', 'Non-success requires explicit issues');
    if (p.installedVersions.length) add('/installedVersions', 'Failed operations cannot claim accepted installed versions');
    if (p.status === 'blocked') {
      if (p.changedFiles.length || p.installState !== 'not-run' || p.backupRef) add('/status', 'Blocked is a pre-write, pre-install result without a backup');
      restrictIssueCodes(p.issues, BLOCKED_ISSUE_CODES, add);
    }
    if (p.status === 'rolled-back') {
      if (!p.backupRef || !['not-run', 'reinstall-required'].includes(p.installState)) add('/status', 'A fully recovered apply failure retains its backup and an honest installation state');
      restrictIssueCodes(p.issues, ROLLED_BACK_ISSUE_CODES, add);
    }
    if (p.status === 'recovery-required') {
      if (!p.backupRef) add('/backupRef', 'Unresolved recovery requires its backup');
      if (!p.changedFiles.length && p.installState === 'not-run') add('/status', 'Unresolved recovery requires write or installation side-effect evidence');
      restrictIssueCodes(p.issues, RECOVERY_REQUIRED_ISSUE_CODES, add);
    }
  }
  if (context) {
    contextIssues(p, context, add);
    for (const path of p.changedFiles) if (!context.plan.allowedPaths.includes(path)) add('/changedFiles', 'Writes must remain within the plan');
    for (const f of p.beforeHashes) { const base = context.plan.baseFileHashes.find(b => b.path === f.path); if (!base || !equalSnapshot(base, f)) add('/beforeHashes', 'Original guard must match the plan'); }
    if (p.status === 'applied') {
      if (!sameSet(p.changedFiles, context.plan.allowedPaths)) add('/changedFiles', 'Applied must cover the complete plan');
      if (p.installedVersions.length !== context.plan.exactDependencies.length || context.plan.exactDependencies.some(d => !p.installedVersions.some(e => e.name === d.name && e.version === d.version))) add('/installedVersions', 'Actual exact installed dependencies must match the plan');
      const installation = context.plan.changes.some(c => c.kind === 'lockfile-regeneration');
      if (p.installState !== (installation ? 'succeeded' : 'not-run')) add('/installState', 'Installation evidence must agree with the plan');
    }
  }
  return finish(p, issues);
}

export function validateIntegrationRollbackResult(input: unknown, backup?: IntegrationBackupV1): ValidationResult<IntegrationRollbackResultV1> {
  const checked = validateSchema<IntegrationRollbackResultV1>(integrationRollbackResultSchema, input); if (!checked.ok) return checked;
  const p = checked.value; const issues: ValidationIssue[] = []; const { add, paths, root } = checks(issues);
  root(p.projectRoot); paths([...p.restoredPaths, ...p.unchangedPaths, ...p.preservedPaths, ...p.unresolvedPaths], '/restoredPaths');
  validateIssueMessages(p.issues, add);
  if (p.status === 'rolled-back' && (p.preservedPaths.length || p.unresolvedPaths.length || p.issues.length)) add('/status', 'Successful rollback has no preserved or unresolved paths');
  if (p.status === 'recovery-required' && ((!p.preservedPaths.length && !p.unresolvedPaths.length) || !p.issues.length)) add('/status', 'Unresolved rollback names preserved or unresolved paths and issues');
  for (const path of p.preservedPaths) if (!p.issues.some(i => i.code === 'USER_EDITED' && i.path === path)) add('/issues', 'Each preserved path requires a matching USER_EDITED issue');
  for (const i of p.issues) if (i.code === 'USER_EDITED' && (!i.path || !p.preservedPaths.includes(i.path))) add('/issues', 'USER_EDITED issues must identify a preserved file');
  for (const path of p.unresolvedPaths) if (!p.issues.some(i => (i.code === 'WRITE_FAILED' || i.code === 'RECOVERY_REQUIRED') && i.path === path)) add('/issues', 'Each unresolved path requires a matching recovery issue');
  for (const i of p.issues) if ((i.code === 'WRITE_FAILED' || i.code === 'RECOVERY_REQUIRED') && (!i.path || !p.unresolvedPaths.includes(i.path))) add('/issues', 'Recovery issues must identify an unresolved file');
  if (backup) {
    const checkedBackup = validateIntegrationBackup(backup);
    if (!checkedBackup.ok) add('/backup', 'A valid backup is required');
    else {
      const validBackup = checkedBackup.value;
      if (p.operationId !== validBackup.operationId || p.planDigest !== validBackup.planDigest || p.projectRoot !== validBackup.projectRoot) add('/operationId', 'Backup operation, project and plan must match');
      if (!sameSet([...p.restoredPaths, ...p.unchangedPaths, ...p.preservedPaths, ...p.unresolvedPaths], validBackup.files.map(f => f.path))) add('/restoredPaths', 'Recovery must account for every backup candidate');
      if (p.installState !== (validBackup.installStarted ? 'reinstall-required' : 'not-run')) add('/installState', 'File rollback cannot restore an installation that started');
    }
  }
  return finish(p, issues);
}
