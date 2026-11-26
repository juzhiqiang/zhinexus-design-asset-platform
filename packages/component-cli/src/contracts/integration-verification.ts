import type { ValidationIssue } from './errors.js';
import type { ArtifactRef, ValidationResult } from './release-manifest.js';
import type { EnvironmentV1 } from './reports.js';
import { integrationPathSchema, validateIntegrationPlan, type IntegrationFileSnapshot, type IntegrationPlanV1 } from './integration-plan.js';
import { validateIntegrationApplyResult, type IntegrationApplyResultV1 } from './integration-apply.js';
import { array, artifactPath, canonicalJson, choice, exactVersion, hash, integer, object, text, timestamp, validateSchema, type Schema } from './schema.js';

/** Fixed sanitized wire messages; raw process, browser and filesystem errors are never messages. */
export const INTEGRATION_VERIFICATION_ISSUE_MESSAGES = {
  INVALID_INPUT: 'Integration verification input is invalid.',
  AUTHORIZATION_REQUIRED: 'Explicit execution authorization is required.',
  AUTHORIZATION_MISMATCH: 'Execution authorization does not match the requested scope.',
  IDENTITY_MISMATCH: 'Integration verification identity does not match the invocation.',
  PROJECT_CHANGED: 'Project source files changed during verification.',
  PATH_UNSAFE: 'An integration verification path is unsafe.',
  SCRIPT_NOT_ALLOWED: 'A project script is outside the authorized scope.',
  SCRIPT_FAILED: 'A project script failed.',
  TYPE_FAILED: 'Project type verification failed.',
  BUILD_FAILED: 'Project build verification failed.',
  DEPENDENCY_MISMATCH: 'Installed dependencies do not match the integration plan.',
  BROWSER_FAILED: 'The local browser verification failed.',
  BEHAVIOR_FAILED: 'Browser behavior verification failed.',
  VISUAL_DIFF: 'The screenshot differs from the approved baseline.',
  VISUAL_BASELINE_MISSING: 'An approved visual baseline is missing.',
  VISUAL_ENVIRONMENT_MISMATCH: 'The visual environment does not match the approved baseline.',
  MISSING_BUSINESS_INFO: 'Required business information is missing.',
  REPAIR_OUT_OF_SCOPE: 'The requested repair is outside generated-file scope.',
  REPAIR_LIMIT_REACHED: 'The bounded repair attempt limit was reached.',
  USER_EDITED: 'A user-edited file was preserved.',
  BACKUP_INVALID: 'The repair backup is invalid.',
  WRITE_FAILED: 'A generated-file repair write failed.',
  RECOVERY_REQUIRED: 'Manual recovery is required.',
  EXECUTION_FAILED: 'Integration verification execution failed.',
  TIMEOUT: 'Integration verification exceeded its time limit.',
  CANCELLED: 'Integration verification was cancelled.',
  EVIDENCE_INVALID: 'Integration verification evidence is invalid.',
} as const;
export const INTEGRATION_VERIFICATION_ISSUE_CODES = Object.keys(INTEGRATION_VERIFICATION_ISSUE_MESSAGES) as (keyof typeof INTEGRATION_VERIFICATION_ISSUE_MESSAGES)[];
export type IntegrationVerificationIssueCode = keyof typeof INTEGRATION_VERIFICATION_ISSUE_MESSAGES;
export type IntegrationVerificationIssue = { [Code in IntegrationVerificationIssueCode]: {
  code: Code; message: typeof INTEGRATION_VERIFICATION_ISSUE_MESSAGES[Code]; path?: string;
} }[IntegrationVerificationIssueCode];
export const INTEGRATION_BUSINESS_GAPS = ['data-source', 'event-handler', 'route', 'authentication', 'visual-baseline'] as const;
export type IntegrationVerificationIdentity = { schemaVersion: 1; projectRoot: string; planDigest: string; applyResultDigest: string };
export type IntegrationVerificationCommand = { kind: 'type' | 'build'; script: string; manifestPath: string; manifestSha256: string; timeoutMs: number; outputDirectories: string[] };
export type IntegrationVerificationSpecV1 = IntegrationVerificationIdentity & {
  commands: IntegrationVerificationCommand[];
  browser?: {
    url: string; readySelector: string; timeoutMs: number; viewport: { width: number; height: number }; renderer: 'canvas' | 'svg'; theme: string;
    actions: ({ kind: 'click'; selector: string; value?: never } | { kind: 'fill'; selector: string; value: string })[];
    assertions: ({ kind: 'visible'; selector: string; value?: never; count?: never } | { kind: 'text'; selector: string; value: string; count?: never } | { kind: 'count'; selector: string; count: number; value?: never })[];
    visual?: { baseline: { image: ArtifactRef; environment: EnvironmentV1 }; pixelThreshold: number; maxDiffPixelRatio: number };
  };
  businessGaps: typeof INTEGRATION_BUSINESS_GAPS[number][];
};
export type IntegrationExecutionAuthorizationV1 = IntegrationVerificationIdentity & {
  operation: 'verify' | 'repair'; specDigest: string; allowProjectScripts: boolean; allowBrowser: boolean; scriptNames: string[];
  allowedRepairPaths: string[]; maxAttempts: 0 | 1 | 2; sourceReportDigest?: string;
};
export type IntegrationVerificationCheck = {
  id: string; category: 'type' | 'build' | 'behavior' | 'visual' | 'missing-business-info';
  status: 'passed' | 'failed' | 'blocked' | 'not-run'; issues: IntegrationVerificationIssue[]; evidence: ArtifactRef[];
};
export type IntegrationVerificationReportV1 = IntegrationVerificationIdentity & {
  operation: 'verify'; specDigest: string; id: string; toolVersion: string; verifiedAt: string; status: 'passed' | 'failed' | 'blocked';
  checks: IntegrationVerificationCheck[]; changedFiles: string[]; snapshots: { before: IntegrationFileSnapshot[]; after: IntegrationFileSnapshot[] };
  installedVersions: { name: string; version: string; manifestSha256: string }[];
  visualResult: 'PASS' | 'DIFF' | 'NEW' | 'INCOMPATIBLE' | 'not-run'; environment?: EnvironmentV1;
  artifacts: ArtifactRef[]; pendingItems: IntegrationVerificationIssue[];
};
/** Expected digests are provided by a trusted boundary after hashing actual inputs, never copied from this JSON. */
export type IntegrationVerificationContext = {
  projectRoot?: string; planDigest?: string; applyResultDigest?: string; specDigest?: string;
  plan?: IntegrationPlanV1; applyResult?: IntegrationApplyResultV1; spec?: IntegrationVerificationSpecV1;
};

const id: Schema = { ...text, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' };
const scriptName: Schema = { ...text, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$' };
const root: Schema = { ...text, pattern: '^[A-Za-z]:/' };
const selector: Schema = { ...text, maxLength: 1024 };
const stringValue: Schema = { type: 'string', maxLength: 4096 };
const timeout = integer(1, 600000);
export const integrationVerificationArtifactSchema = object({ path: artifactPath, sha256: hash, bytes: integer() });
export const integrationVerificationSnapshotSchema = object({ path: integrationPathSchema, exists: { type: 'boolean' }, sha256: hash }, ['sha256']);
export const integrationVerificationIssueSchema = object({ code: choice(...INTEGRATION_VERIFICATION_ISSUE_CODES), message: choice(...Object.values(INTEGRATION_VERIFICATION_ISSUE_MESSAGES)), path: integrationPathSchema }, ['path']);
export const integrationVerificationIdentitySchema = { schemaVersion: { type: 'integer', const: 1 } as Schema, projectRoot: root, planDigest: hash, applyResultDigest: hash };
// Kept local to avoid a schemas registry -> verification -> registry cycle. Matches EnvironmentV1 exactly.
const environment = object({
  os: text, arch: text, browserVersion: text, browserRevision: text, fontDigest: hash, locale: text, timezone: text,
  deviceScaleFactor: { type: 'number', exclusiveMinimum: 0 }, renderer: choice('canvas', 'svg'), width: integer(1, 8192), height: integer(1, 8192),
  theme: text, frameworkVersion: exactVersion, echartsVersion: exactVersion,
}, ['echartsVersion']);
export const integrationVerificationSpecSchema: Schema = {
  ...object({ ...integrationVerificationIdentitySchema, commands: array(object({ kind: choice('type', 'build'), script: scriptName, manifestPath: integrationPathSchema,
    manifestSha256: hash, timeoutMs: timeout, outputDirectories: array(integrationPathSchema) })),
    browser: object({ url: text, readySelector: selector, timeoutMs: timeout, viewport: object({ width: integer(1, 8192), height: integer(1, 8192) }), renderer: choice('canvas', 'svg'), theme: text,
      actions: array(object({ kind: choice('click', 'fill'), selector, value: stringValue }, ['value'])),
      assertions: array(object({ kind: choice('visible', 'text', 'count'), selector, value: stringValue, count: integer() }, ['value', 'count'])),
      visual: object({ baseline: object({ image: integrationVerificationArtifactSchema, environment }), pixelThreshold: { type: 'number', minimum: 0, maximum: 1 }, maxDiffPixelRatio: { type: 'number', minimum: 0, maximum: 1 } }),
    }, ['visual']), businessGaps: array(choice(...INTEGRATION_BUSINESS_GAPS)) }, ['browser']),
  description: 'Declarative local verification only, never execution authorization. Runtime proves physical paths, approved script bytes, local host trust, actual artifacts and environment.',
};
export const integrationExecutionAuthorizationSchema: Schema = {
  ...object({ ...integrationVerificationIdentitySchema, specDigest: hash, operation: choice('verify', 'repair'), allowProjectScripts: { type: 'boolean' }, allowBrowser: { type: 'boolean' },
    scriptNames: array(scriptName), allowedRepairPaths: array(integrationPathSchema), maxAttempts: integer(0, 2), sourceReportDigest: hash }, ['sourceReportDigest']),
  description: 'Trusted invocation scope, not proof of approval. Runtime rehashes inputs, validates local permissions and binds exact generated-file repair scope.',
};
export const integrationVerificationReportSchema: Schema = {
  ...object({ ...integrationVerificationIdentitySchema, specDigest: hash, operation: { type: 'string', const: 'verify' }, id, toolVersion: exactVersion, verifiedAt: timestamp,
    status: choice('passed', 'failed', 'blocked'), checks: array(object({ id, category: choice('type', 'build', 'behavior', 'visual', 'missing-business-info'), status: choice('passed', 'failed', 'blocked', 'not-run'),
      issues: array(integrationVerificationIssueSchema), evidence: array(integrationVerificationArtifactSchema) })), changedFiles: array(integrationPathSchema),
    snapshots: object({ before: array(integrationVerificationSnapshotSchema), after: array(integrationVerificationSnapshotSchema) }),
    installedVersions: array(object({ name: { ...text, pattern: '^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$' }, version: exactVersion, manifestSha256: hash })),
    visualResult: choice('PASS', 'DIFF', 'NEW', 'INCOMPATIBLE', 'not-run'), environment, artifacts: array(integrationVerificationArtifactSchema), pendingItems: array(integrationVerificationIssueSchema),
  }, ['environment']),
  description: 'Observed checks and source guards, not source attestation for a hostile host. Runtime hashes real artifacts and installed manifests; passed requires complete checks and visual evidence.',
};

type Add = (path: string, message: string) => void;
const pathKey = (p: string) => p.normalize('NFC').toLowerCase();
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(p => b.includes(p));
export function integrationVerificationChecks(issues: ValidationIssue[]) {
  const add: Add = (path, message) => { if (issues.length < 100) issues.push({ code: 'INVALID_SCHEMA', path, message }); };
  const paths = (values: string[], field: string) => {
    const keys = values.map(pathKey); if (new Set(keys).size !== keys.length) add(field, 'Duplicate or aliased paths');
    const sorted = [...keys].sort();
    for (let i = 1; i < sorted.length; i++) if (sorted[i]!.startsWith(sorted[i - 1]! + '/')) { add(field, 'File paths cannot contain an ancestor file'); break; }
  };
  const snapshots = (values: IntegrationFileSnapshot[], field: string) => {
    paths(values.map(s => s.path), field);
    values.forEach((s, i) => { if (s.exists !== (s.sha256 !== undefined)) add(field + '/' + i, 'Existing files require hashes; absent files forbid hashes'); });
  };
  const identity = (value: IntegrationVerificationIdentity) => {
    if (value.projectRoot.slice(3) && !validateSchema(integrationPathSchema, value.projectRoot.slice(3)).ok) add('/projectRoot', 'Canonical absolute Windows project root required');
  };
  const fixedIssues = (values: IntegrationVerificationIssue[], field: string) => values.forEach((issue, i) => {
    if (issue.message !== INTEGRATION_VERIFICATION_ISSUE_MESSAGES[issue.code]) add(field + '/' + i + '/message', 'Issue message must match its fixed sanitized code');
  });
  return { add, paths, snapshots, identity, fixedIssues };
}
export function integrationVerificationFinish<T>(value: T, issues: ValidationIssue[]): ValidationResult<T> { return issues.length ? { ok: false, issues } : { ok: true, value }; }
export function integrationVerificationContextIssues(value: IntegrationVerificationIdentity & { specDigest?: string }, context: IntegrationVerificationContext | undefined, add: Add) {
  if (!context) return;
  for (const field of ['projectRoot', 'planDigest', 'applyResultDigest', 'specDigest'] as const) {
    const expected = context[field]; if (expected === undefined) continue;
    if (!validateSchema(field === 'projectRoot' ? root : hash, expected).ok || field !== 'specDigest' && value[field] !== expected || field === 'specDigest' && value.specDigest !== undefined && value.specDigest !== expected) add('/' + field, 'Identity differs from the trusted invocation');
  }
  if (context.plan && (!validateIntegrationPlan(context.plan).ok || context.plan.status !== 'planned')) add('/context/plan', 'A valid planned context is required');
  if (context.applyResult) {
    // Deliberately no old apply context: a legal no-install apply may have no installedVersions.
    const checked = validateIntegrationApplyResult(context.applyResult);
    if (!checked.ok || context.applyResult.status !== 'applied') add('/context/applyResult', 'A structurally valid applied result is required');
    if (context.applyResult.projectRoot !== value.projectRoot || context.applyResult.planDigest !== value.planDigest) add('/context/applyResult', 'Apply identity must match verification');
  }
  if (context.spec) {
    if (!validateIntegrationVerificationSpec(context.spec).ok) add('/context/spec', 'A valid verification specification is required');
    for (const key of ['projectRoot', 'planDigest', 'applyResultDigest'] as const) if (context.spec[key] !== value[key]) add('/context/spec/' + key, 'Specification identity must match');
  }
}
function loopbackUrl(value: string) {
  if (!/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?(?:\/[^\s]*)?$/i.test(value)) return false;
  try { const u = new URL(value); return !u.username && !u.password && !u.search && !u.hash && !/[?#\\]/.test(value); } catch { return false; }
}
export function validateIntegrationVerificationSpec(input: unknown, context?: IntegrationVerificationContext): ValidationResult<IntegrationVerificationSpecV1> {
  const checked = validateSchema<IntegrationVerificationSpecV1>(integrationVerificationSpecSchema, input); if (!checked.ok) return checked;
  const p = checked.value; const issues: ValidationIssue[] = []; const { add, paths, identity } = integrationVerificationChecks(issues); identity(p);
  integrationVerificationContextIssues(p, context ? { ...context, spec: undefined } : undefined, add);
  if (p.commands.length > 32) add('/commands', 'Command count exceeds the bounded specification');
  const seen = new Set<string>(); const manifests = new Map<string, { path: string; hash: string }>();
  p.commands.forEach((c, i) => {
    const field = '/commands/' + i; const key = c.kind + ':' + c.manifestPath + ':' + c.script;
    if (seen.has(key)) add(field, 'Duplicate command'); seen.add(key);
    if (c.manifestPath !== 'package.json' && !c.manifestPath.endsWith('/package.json')) add(field + '/manifestPath', 'A package.json manifest is required');
    const previous = manifests.get(pathKey(c.manifestPath));
    if (previous && (previous.path !== c.manifestPath || previous.hash !== c.manifestSha256)) add(field + '/manifestPath', 'Manifest aliases or conflicting byte guards are forbidden');
    manifests.set(pathKey(c.manifestPath), { path: c.manifestPath, hash: c.manifestSha256 });
    paths(c.outputDirectories, field + '/outputDirectories');
    const prefix = c.manifestPath.slice(0, -'package.json'.length);
    if (c.outputDirectories.some(d => !['dist', 'build', '.next', 'out'].some(leaf => d === prefix + leaf))) add(field + '/outputDirectories', 'Only declared workspace dist/build/.next/out directories may be excluded');
    const applied = context?.applyResult?.afterHashes.find(f => f.path === c.manifestPath);
    if (applied && (!applied.exists || applied.sha256 !== c.manifestSha256)) add(field + '/manifestSha256', 'Manifest guard must match the applied bytes');
    if (context?.plan) {
      const workspace = context.plan.localProject.workspace;
      if (c.manifestPath !== (workspace === '.' ? 'package.json' : workspace + '/package.json')) add(field + '/manifestPath', 'Command manifest must identify the planned workspace');
    }
  });
  if (new Set(p.businessGaps).size !== p.businessGaps.length) add('/businessGaps', 'Duplicate business gap');
  if (p.browser) {
    const b = p.browser; if (!loopbackUrl(b.url)) add('/browser/url', 'An exact loopback HTTP URL without credentials, query or fragment is required');
    if (b.actions.length > 64 || b.assertions.length > 64) add('/browser', 'Browser controls exceed the bounded specification');
    b.actions.forEach((a, i) => { if ((a.kind === 'fill') !== (a.value !== undefined)) add('/browser/actions/' + i, 'Only fill actions require a value'); });
    b.assertions.forEach((a, i) => { if ((a.kind === 'text') !== (a.value !== undefined) || (a.kind === 'count') !== (a.count !== undefined)) add('/browser/assertions/' + i, 'Assertion fields must match their kind'); });
    if (b.visual) {
      const e = b.visual.baseline.environment;
      if (b.visual.baseline.image.bytes === 0) add('/browser/visual/baseline/image', 'A baseline requires nonempty image bytes');
      if (e.width !== b.viewport.width || e.height !== b.viewport.height || e.renderer !== b.renderer || e.theme !== b.theme) add('/browser/visual/baseline/environment', 'Baseline dimensions, renderer and theme must match the browser specification');
    }
  }
  return integrationVerificationFinish(p, issues);
}

export function validateIntegrationExecutionAuthorization(input: unknown, context?: IntegrationVerificationContext & { reportDigest?: string; sourceReport?: IntegrationVerificationReportV1 }): ValidationResult<IntegrationExecutionAuthorizationV1> {
  const checked = validateSchema<IntegrationExecutionAuthorizationV1>(integrationExecutionAuthorizationSchema, input); if (!checked.ok) return checked;
  const p = checked.value; const issues: ValidationIssue[] = []; const { add, paths, identity } = integrationVerificationChecks(issues); identity(p); paths(p.allowedRepairPaths, '/allowedRepairPaths');
  integrationVerificationContextIssues(p, context, add);
  if (new Set(p.scriptNames).size !== p.scriptNames.length) add('/scriptNames', 'Duplicate authorized script');
  if (!p.allowProjectScripts && p.scriptNames.length) add('/scriptNames', 'Denied project scripts cannot have an authorized script scope');
  if (p.operation === 'verify' && (p.allowedRepairPaths.length || p.maxAttempts !== 0 || p.sourceReportDigest !== undefined)) add('/operation', 'Verify cannot authorize repairs or bind a repair source report');
  if (p.operation === 'repair') {
    if (!p.sourceReportDigest) add('/sourceReportDigest', 'Repair requires a source report digest');
    if (context?.reportDigest !== undefined && (!validateSchema(hash, context.reportDigest).ok || p.sourceReportDigest !== context.reportDigest)) add('/sourceReportDigest', 'Repair source report differs from the invocation');
    if (context?.plan) {
      const generated = context.plan.changes.filter(c => c.kind === 'generated-component').map(c => c.path);
      if (p.allowedRepairPaths.some(path => !generated.includes(path))) add('/allowedRepairPaths', 'Repair scope must be a subset of exact planned generated files');
    }
    if (context?.sourceReport) {
      if (!validateIntegrationVerificationReport(context.sourceReport, context).ok || context.sourceReport.status === 'passed') add('/context/sourceReport', 'Repair requires a valid unresolved verification report');
      for (const field of ['projectRoot', 'planDigest', 'applyResultDigest', 'specDigest'] as const) if (context.sourceReport[field] !== p[field]) add('/sourceReportDigest', 'Source report identity must match authorization');
    }
  }
  if (context?.spec) {
    const names = [...new Set(context.spec.commands.map(c => c.script))];
    if (!sameSet(names, p.scriptNames) || names.length && !p.allowProjectScripts) add('/scriptNames', 'Authorization must name exactly the declared scripts');
    if (Boolean(context.spec.browser) !== p.allowBrowser) add('/allowBrowser', 'Browser authorization must match the declared browser scope');
  }
  return integrationVerificationFinish(p, issues);
}

export function validateIntegrationVerificationReport(input: unknown, context?: IntegrationVerificationContext): ValidationResult<IntegrationVerificationReportV1> {
  const checked = validateSchema<IntegrationVerificationReportV1>(integrationVerificationReportSchema, input); if (!checked.ok) return checked;
  const p = checked.value; const issues: ValidationIssue[] = []; const { add, paths, snapshots, identity, fixedIssues } = integrationVerificationChecks(issues);
  identity(p); integrationVerificationContextIssues(p, context, add); paths(p.changedFiles, '/changedFiles'); snapshots(p.snapshots.before, '/snapshots/before'); snapshots(p.snapshots.after, '/snapshots/after');
  paths(p.artifacts.map(a => a.path), '/artifacts'); fixedIssues(p.pendingItems, '/pendingItems');
  if (new Set(p.checks.map(c => c.id)).size !== p.checks.length) add('/checks', 'Check identities must be unique');
  if (new Set(p.installedVersions.map(d => d.name)).size !== p.installedVersions.length) add('/installedVersions', 'Installed dependency names must be unique');
  const before = new Map(p.snapshots.before.map(s => [s.path, s])); const after = new Map(p.snapshots.after.map(s => [s.path, s]));
  const allPaths = [...new Set([...before.keys(), ...after.keys()])]; paths(allPaths, '/snapshots');
  const differences = allPaths.filter(path => { const a = before.get(path); const b = after.get(path); return Boolean(a?.exists) !== Boolean(b?.exists) || a?.sha256 !== b?.sha256; });
  if (!sameSet(differences, p.changedFiles)) add('/changedFiles', 'Changed files must exactly describe the before/after source guard differences');
  const refs = new Map(p.artifacts.map(a => [a.path, a]));
  p.checks.forEach((c, i) => {
    fixedIssues(c.issues, '/checks/' + i + '/issues'); paths(c.evidence.map(e => e.path), '/checks/' + i + '/evidence');
    for (const e of c.evidence) if (canonicalJson(refs.get(e.path) ?? null) !== canonicalJson(e)) add('/checks/' + i + '/evidence', 'Check evidence must exactly reference a declared artifact');
    if (c.status === 'passed' && c.issues.length || ['failed', 'blocked'].includes(c.status) && !c.issues.length) add('/checks/' + i + '/status', 'Check outcome must agree with explicit issues');
    if (c.status === 'not-run' && c.evidence.length) add('/checks/' + i + '/evidence', 'An unexecuted check cannot claim execution evidence');
    if (c.issues.some(issue => !p.pendingItems.some(item => canonicalJson(item) === canonicalJson(issue)))) add('/pendingItems', 'Unresolved check issues must remain visible in pending items');
  });
  const dependencyGuard = p.checks.find(c => c.id === 'dependency-guard');
  if (dependencyGuard && dependencyGuard.category !== 'behavior') add('/checks', 'The dependency guard is an additional behavior check');
  if (p.status === 'passed') {
    if (!p.checks.length || p.checks.some(c => c.status !== 'passed') || p.pendingItems.length || p.changedFiles.length) add('/status', 'Passed requires all checks passed, no source changes and no pending work');
    for (const category of ['type', 'build', 'behavior', 'visual', 'missing-business-info']) if (!p.checks.some(c => c.category === category && c.id !== 'dependency-guard')) add('/checks', 'Passed requires all five check categories, in addition to the dependency guard');
    if (dependencyGuard?.status !== 'passed' || !p.installedVersions.length) add('/installedVersions', 'Passed requires installed manifest proof and a passed dependency guard');
    if (p.visualResult !== 'PASS' || !p.environment) add('/visualResult', 'Passed requires matching visual environment and PASS');
    if (!p.checks.some(c => c.category === 'visual' && c.evidence.some(e => /\.(png|webp)$/i.test(e.path) && e.bytes > 0))) add('/checks', 'Passed requires nonempty screenshot evidence');
    if (context?.spec && (!context.spec.browser?.visual || context.spec.businessGaps.length)) add('/context/spec', 'Passed requires a visual baseline and no declared business gaps');
  } else {
    if (!p.pendingItems.length) add('/pendingItems', 'Unsuccessful verification requires explicit pending issues');
    if (p.status === 'failed' && !p.checks.some(c => c.status === 'failed')) add('/status', 'Failed requires an actually failed check');
    if (p.status === 'blocked' && p.checks.some(c => c.status === 'failed')) add('/status', 'Executed failures must be reported as failed');
  }
  if (p.changedFiles.length && !p.pendingItems.some(i => i.code === 'PROJECT_CHANGED' || i.code === 'USER_EDITED')) add('/pendingItems', 'Observed source changes require an explicit source guard issue');
  const visual = p.checks.filter(c => c.category === 'visual');
  if (p.visualResult === 'PASS' && (!p.environment || !visual.some(c => c.status === 'passed'))) add('/visualResult', 'Visual PASS needs an observed passed visual check and environment');
  if (p.visualResult !== 'PASS' && visual.some(c => c.status === 'passed')) add('/visualResult', 'Visual checks cannot pass with an unresolved visual outcome');
  if (p.environment && context?.spec?.browser) {
    const b = context.spec.browser;
    if (p.environment.width !== b.viewport.width || p.environment.height !== b.viewport.height || p.environment.renderer !== b.renderer || p.environment.theme !== b.theme) add('/environment', 'Observed environment must match the requested browser configuration');
    if (p.visualResult === 'PASS' && b.visual) {
      const projection = (e: EnvironmentV1) => { const { frameworkVersion: _f, echartsVersion: _e, ...rest } = e; return rest; };
      if (canonicalJson(projection(p.environment)) !== canonicalJson(projection(b.visual.baseline.environment))) add('/environment', 'Visual PASS must use the baseline environment');
    }
  }
  if (context?.plan && (p.status === 'passed' || dependencyGuard?.status === 'passed')) {
    const expected = context.plan.exactDependencies;
    if (p.installedVersions.length !== expected.length || expected.some(d => !p.installedVersions.some(a => a.name === d.name && a.version === d.version))) add('/installedVersions', 'Installed exact dependency identities must match the plan');
  }
  return integrationVerificationFinish(p, issues);
}
