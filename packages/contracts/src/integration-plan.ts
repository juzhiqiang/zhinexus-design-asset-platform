import type { ValidationIssue } from './errors.js';
import type { ValidationResult } from './release-manifest.js';
import { canonicalJson } from './schema.js';
import { sameComponentMember } from './component-values.js';
import { MATCH_GAP_CODES, matchPlanSchema, validateMatchPlan, type MatchPlanV1 } from './match-plan.js';
import { componentMatchResponseSchema, validateComponentMatchResponse, type ComponentMatchResponseV1 } from './component-match.js';
import { array, choice, exactVersion, hash, object, text, timestamp, validateSchema, type Schema } from './schema.js';

export const INTEGRATION_CONFLICT_CODES = [
  ...MATCH_GAP_CODES, 'PACKAGE_MANAGER_UNSUPPORTED', 'PACKAGE_MANAGER_MISMATCH', 'LOCKFILE_MISSING',
  'LOCKFILE_MULTIPLE', 'LOCKFILE_UNSUPPORTED', 'LOCKFILE_INVALID', 'WORKSPACE_REQUIRED', 'WORKSPACE_INVALID',
  'IMPORTER_MISSING', 'FRAMEWORK_MISSING', 'FRAMEWORK_AMBIGUOUS', 'FRAMEWORK_UNSUPPORTED',
  'VERSION_UNRESOLVED', 'VERSION_MISMATCH', 'REACT_DOM_MISSING', 'ECHARTS_MISSING',
  'PATH_UNSAFE', 'PROJECT_CHANGED', 'DIRTY_TARGET', 'OUTPUT_EXISTS', 'MATCH_CONTEXT_MISMATCH',
  'TARGET_CHANGED', 'API_MISMATCH', 'PACKAGE_DIGEST_MISMATCH', 'REGISTRY_UNAVAILABLE',
] as const;
export type IntegrationConflict = { code: typeof INTEGRATION_CONFLICT_CODES[number]; message: string; blocking: true; path?: string; instanceId?: string };
export type IntegrationFileSnapshot = { path: string; exists: true; sha256: string } | { path: string; exists: false; sha256?: never };
export type IntegrationDependency = { name: string; version: string };
export type LocalProjectInspectionV1 = {
  schemaVersion: 1; status: 'inspected' | 'conflicted'; workspace: string;
  packageManager?: 'npm' | 'pnpm'; lockfile?: { path: string; format: 'npm-v3' | 'pnpm-v9' };
  framework?: 'vue' | 'react'; resolvedDependencies: (IntegrationDependency & { specifier: string })[];
  scripts: string[]; git: { status: 'clean' | 'dirty' | 'unavailable'; dirtyPaths: string[] };
  fileSnapshots: IntegrationFileSnapshot[]; conflicts: IntegrationConflict[];
};
export type IntegrationCommand = { executable: 'npm' | 'pnpm'; args: string[]; cwd: string; purpose: 'install' | 'typecheck' | 'build' };
export type IntegrationChange =
  | { kind: 'package-json'; path: string; dependencies: IntegrationDependency[] }
  | { kind: 'lockfile-regeneration'; path: string }
  | { kind: 'generated-component'; path: string; instanceId: string; framework: 'vue' | 'react' };
export type IntegrationPlanV1 = {
  schemaVersion: 1; stage: 'plan'; executionAuthorized: false; status: 'planned' | 'conflicted';
  localProject: LocalProjectInspectionV1;
  /** Preserve the input for gap auditing; digest is SHA-256 of canonicalJson(sourceMatchPlan). */
  sourceMatchPlan: MatchPlanV1; matchPlanDigest: string;
  baseFileHashes: IntegrationFileSnapshot[]; allowedPaths: string[]; packageManager?: 'npm' | 'pnpm';
  exactDependencies: IntegrationDependency[]; commands: IntegrationCommand[]; changes: IntegrationChange[];
  conflicts: IntegrationConflict[];
  /** Final GET snapshots, after registry reads; not an apply authorization. */
  publicationEvidence: { response: ComponentMatchResponseV1; checkedAt: string }[];
  registryEvidence: { name: string; version: string; sha256: string; integrity: string; verification: 'platform-sha256' | 'registry-integrity' }[];
};

// Logical project paths allow spaces/Unicode; no decoding, traversal, ADS, devices or aliases.
const pathPattern = '^(?!/)(?!.*//)(?!.*(?:^|/)(?:\\.{1,2}|[cC][oO][nN]|[pP][rR][nN]|[aA][uU][xX]|[nN][uU][lL]|[cC][oO][mM][1-9¹²³]|[lL][pP][tT][1-9¹²³])(?:\\.[^/]*|/|$))(?!.*(?:[. ]/|[. ]$))[^/\\\\:%?*#<>|"\\u0000-\\u001f\\u007f]+(?:/[^/\\\\:%?*#<>|"\\u0000-\\u001f\\u007f]+)*$';
export const integrationPathSchema: Schema = { ...text, pattern: pathPattern };
const directory: Schema = { ...text, pattern: `^(?:\\.|${pathPattern.slice(1, -1)})$` };
const packageName: Schema = { ...text, pattern: '^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$' };
const dependency = object({ name: packageName, version: exactVersion });
const conflict = object({ code: choice(...INTEGRATION_CONFLICT_CODES), message: text, blocking: { type: 'boolean', const: true }, path: integrationPathSchema, instanceId: text }, ['path', 'instanceId']);
const snapshot = object({ path: integrationPathSchema, exists: { type: 'boolean' }, sha256: hash }, ['sha256']);
export const localProjectInspectionSchema: Schema = {
  ...object({ schemaVersion: { type: 'integer', const: 1 }, status: choice('inspected', 'conflicted'), workspace: directory,
    packageManager: choice('npm', 'pnpm'), lockfile: object({ path: integrationPathSchema, format: choice('npm-v3', 'pnpm-v9') }),
    framework: choice('vue', 'react'), resolvedDependencies: array(object({ ...dependency.properties!, specifier: text })),
    scripts: array(text), git: object({ status: choice('clean', 'dirty', 'unavailable'), dirtyPaths: array(integrationPathSchema) }),
    fileSnapshots: array(snapshot), conflicts: array(conflict),
  }, ['packageManager', 'lockfile', 'framework']),
  description: 'Structural schema. Runtime additionally checks snapshot existence/hash, path uniqueness, status/conflicts and host/lock consistency. Realpath and original-byte verification are caller duties.',
};
export const integrationPlanSchema: Schema = {
  ...object({ schemaVersion: { type: 'integer', const: 1 }, stage: { type: 'string', const: 'plan' }, executionAuthorized: { type: 'boolean', const: false },
    status: choice('planned', 'conflicted'), localProject: localProjectInspectionSchema, sourceMatchPlan: matchPlanSchema, matchPlanDigest: hash,
    baseFileHashes: array(snapshot), allowedPaths: array(integrationPathSchema), packageManager: choice('npm', 'pnpm'),
    exactDependencies: array(dependency), commands: array(object({ executable: choice('npm', 'pnpm'), args: array(text, 1), cwd: directory, purpose: choice('install', 'typecheck', 'build') })),
    changes: array(object({ kind: choice('package-json', 'lockfile-regeneration', 'generated-component'), path: integrationPathSchema,
      dependencies: array(dependency), instanceId: text, framework: choice('vue', 'react') }, ['dependencies', 'instanceId', 'framework'])),
    conflicts: array(conflict), publicationEvidence: array(object({ response: componentMatchResponseSchema, checkedAt: timestamp })),
    registryEvidence: array(object({ ...dependency.properties!, sha256: hash, integrity: { ...text, pattern: '^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$' }, verification: choice('platform-sha256', 'registry-integrity') })),
  }, ['packageManager']),
  description: 'Structural schema only. validateIntegrationPlan enforces file guards, change/command restrictions, status/gap propagation and publication identities. Caller must hash canonical sourceMatchPlan and recheck real files, authoritative API and registry bytes. Never authorizes execution.',
};

const key = (path: string) => path.normalize('NFC').toLowerCase();
function checker(issues: ValidationIssue[]) {
  const add = (path: string, message: string) => { if (issues.length < 100) issues.push({ code: 'INVALID_SCHEMA', path, message }); };
  const unique = (values: string[], path: string, paths = false) => {
    const keys = paths ? values.map(key) : values;
    if (new Set(keys).size !== keys.length) add(path, 'Duplicate or aliased entries');
  };
  const snapshots = (files: IntegrationFileSnapshot[], path: string) => {
    unique(files.map(f => f.path), path, true);
    files.forEach((f, i) => { if (f.exists !== (f.sha256 !== undefined)) add(`${path}/${i}`, 'Existing files need a hash; absent files forbid a hash'); });
  };
  return { add, unique, snapshots };
}
function inspectionIssues(p: LocalProjectInspectionV1): ValidationIssue[] {
  const issues: ValidationIssue[] = []; const { add, unique, snapshots } = checker(issues);
  snapshots(p.fileSnapshots, '/fileSnapshots'); unique(p.scripts, '/scripts');
  unique(p.resolvedDependencies.map(d => d.name), '/resolvedDependencies'); unique(p.git.dirtyPaths, '/git/dirtyPaths', true);
  if ((p.status === 'conflicted') !== (p.conflicts.length > 0)) add('/status', 'Status must agree with blocking conflicts');
  if ((p.git.status === 'dirty') !== (p.git.dirtyPaths.length > 0)) add('/git', 'Git status must agree with dirty paths; unavailable cannot claim observed dirty paths');
  if (p.status === 'inspected') {
    if (!p.packageManager || !p.lockfile || !p.framework) add('', 'Successful inspection requires package manager, lock and framework');
    const host = p.resolvedDependencies.find(d => d.name === p.framework);
    if (!host || !host.version.startsWith(p.framework === 'vue' ? '3.' : '19.')) add('/resolvedDependencies', 'Supported exact framework version required');
    if (p.framework === 'react' && !p.resolvedDependencies.some(d => d.name === 'react-dom')) add('/resolvedDependencies', 'React requires resolved react-dom');
    if (p.lockfile && p.lockfile.format !== (p.packageManager === 'npm' ? 'npm-v3' : 'pnpm-v9')) add('/lockfile', 'Lock format must match package manager');
    if (p.lockfile && p.lockfile.path !== (p.packageManager === 'npm' ? 'package-lock.json' : 'pnpm-lock.yaml')) add('/lockfile/path', 'Use the canonical project root lock path');
    for (const path of ['package.json', ...(p.workspace === '.' ? [] : [`${p.workspace}/package.json`, ...(p.packageManager === 'pnpm' ? ['pnpm-workspace.yaml'] : [])]), ...(p.lockfile ? [p.lockfile.path] : [])]) {
      if (!p.fileSnapshots.some(f => f.path === path && f.exists)) add('/fileSnapshots', 'Manifest and lock snapshots required');
    }
  }
  return issues;
}
export function validateLocalProjectInspection(input: unknown): ValidationResult<LocalProjectInspectionV1> {
  const checked = validateSchema<LocalProjectInspectionV1>(localProjectInspectionSchema, input); if (!checked.ok) return checked;
  const issues = inspectionIssues(checked.value); return issues.length ? { ok: false, issues } : checked;
}

export function validateIntegrationPlan(input: unknown): ValidationResult<IntegrationPlanV1> {
  const checked = validateSchema<IntegrationPlanV1>(integrationPlanSchema, input); if (!checked.ok) return checked;
  const p = checked.value; const issues = inspectionIssues(p.localProject).map(i => ({ ...i, path: '/localProject' + i.path }));
  const { add, unique, snapshots } = checker(issues);
  const match = validateMatchPlan(p.sourceMatchPlan); if (!match.ok) issues.push(...match.issues.map(i => ({ ...i, path: '/sourceMatchPlan' + i.path })));
  snapshots(p.baseFileHashes, '/baseFileHashes'); unique(p.allowedPaths, '/allowedPaths', true);
  unique(p.exactDependencies.map(d => d.name), '/exactDependencies'); unique(p.changes.map(c => c.path), '/changes', true);
  unique(p.registryEvidence.map(d => d.name), '/registryEvidence');
  if ((p.status === 'conflicted') !== (p.conflicts.length > 0)) add('/status', 'Status must agree with blocking conflicts');
  if (p.packageManager !== p.localProject.packageManager) add('/packageManager', 'Must match inspection');
  const requireConflict = (code: IntegrationConflict['code'], instanceId?: string, path?: string) => {
    if (!p.conflicts.some(c => c.code === code && (instanceId === undefined || c.instanceId === instanceId) && (path === undefined || c.path === path))) add('/conflicts', `Missing blocking ${code} conflict`);
  };
  for (const c of p.localProject.conflicts) requireConflict(c.code, c.instanceId, c.path);
  for (const g of p.sourceMatchPlan.gaps) requireConflict(g.code);
  for (const e of p.sourceMatchPlan.elements) for (const g of e.gaps) requireConflict(g.code, e.instanceId);
  const hostVersion = (name: string) => p.localProject.resolvedDependencies.find(d => d.name === name)?.version;
  const context = p.sourceMatchPlan.context;
  if (context.framework !== p.localProject.framework || context.packageManager !== p.packageManager ||
      context.frameworkVersion !== hostVersion(context.framework) ||
      (hostVersion('echarts') !== undefined && context.echartsVersion !== hostVersion('echarts'))) requireConflict('MATCH_CONTEXT_MISMATCH');
  for (const f of p.localProject.fileSnapshots) {
    const base = p.baseFileHashes.find(b => b.path === f.path);
    if (!base || base.exists !== f.exists || base.sha256 !== f.sha256) add('/baseFileHashes', 'Inspection snapshots must be preserved exactly');
  }
  for (const path of p.allowedPaths) {
    if (!p.baseFileHashes.some(f => f.path === path)) add('/baseFileHashes', 'Every allowed path needs an explicit guard');
    if (!p.changes.some(c => c.path === path)) add('/allowedPaths', 'Allowed paths must enumerate described changes only');
    if (p.localProject.git.dirtyPaths.some(d => key(d) === key(path))) requireConflict('DIRTY_TARGET', undefined, path);
  }
  const manifest = p.localProject.workspace === '.' ? 'package.json' : `${p.localProject.workspace}/package.json`;
  for (const c of p.changes) {
    if (!p.allowedPaths.includes(c.path)) add('/changes', 'Change lacks an allowed path');
    const raw = c as unknown as Record<string, unknown>;
    const guard = p.baseFileHashes.find(f => f.path === c.path);
    if (c.kind === 'package-json') {
      if (c.path !== manifest || !guard?.exists || !Array.isArray(c.dependencies) || raw.instanceId !== undefined || raw.framework !== undefined) add('/changes', 'Manifest change requires dependencies and an existing target manifest only');
      unique((c.dependencies ?? []).map(d => d.name), '/changes/dependencies');
      for (const d of c.dependencies ?? []) if (!p.exactDependencies.some(e => e.name === d.name && e.version === d.version)) add('/changes/dependencies', 'Manifest dependency must match exact plan dependency');
    } else if (c.kind === 'lockfile-regeneration') {
      if (c.path !== p.localProject.lockfile?.path || !guard?.exists || raw.dependencies !== undefined || raw.instanceId !== undefined || raw.framework !== undefined) add('/changes', 'Lock change describes regeneration of the inspected lock only');
    } else {
      const element = p.sourceMatchPlan.elements.find(e => e.instanceId === c.instanceId);
      if (!element?.target || c.framework !== element.target.framework || raw.dependencies !== undefined) add('/changes', 'Generated component must reference a mapped instance of the same framework');
      if (!c.path.endsWith(c.framework === 'vue' ? '.vue' : '.tsx') || (p.localProject.workspace !== '.' && !c.path.startsWith(p.localProject.workspace + '/'))) add('/changes/path', 'Generated path must be inside the target workspace with its framework extension');
      if (guard?.exists) requireConflict('OUTPUT_EXISTS', c.instanceId, c.path);
    }
  }
  for (const c of p.commands) {
    if (c.executable !== p.packageManager) add('/commands', 'Only the inspected package manager may be previewed');
    if (c.purpose === 'install') {
      if (c.cwd !== '.' || c.args.length !== 2 || c.args[0] !== 'install' || c.args[1] !== '--ignore-scripts') add('/commands', 'Install preview is fixed to root install --ignore-scripts');
    } else if (c.cwd !== p.localProject.workspace || c.args.length !== 2 || c.args[0] !== 'run' || c.args[1] !== c.purpose || !p.localProject.scripts.includes(c.purpose)) {
      add('/commands', 'Only an existing native build/typecheck script can be previewed');
    }
  }
  for (const [i, evidence] of p.publicationEvidence.entries()) {
    const checkedResponse = validateComponentMatchResponse(evidence.response);
    if (!checkedResponse.ok) issues.push(...checkedResponse.issues.map(issue => ({ ...issue, path: `/publicationEvidence/${i}/response${issue.path}` })));
    for (const gap of evidence.response.gaps) requireConflict(gap.code);
    const query = evidence.response.query;
    if (query.framework !== p.localProject.framework || query.frameworkVersion !== hostVersion(query.framework) ||
        query.echartsVersion !== (hostVersion('echarts') ?? context.echartsVersion) ||
        (query.framework === 'react' && query.reactDomVersion !== hostVersion('react-dom'))) requireConflict('MATCH_CONTEXT_MISMATCH');
  }
  for (const e of p.sourceMatchPlan.elements) {
    if (!e.target) continue;
    const response = p.publicationEvidence.find(r => r.response.target?.variantReleaseId === e.target!.variantReleaseId)?.response;
    const api = response?.api;
    if (response?.target && canonicalJson(response.target) !== canonicalJson(e.target)) requireConflict('TARGET_CHANGED', e.instanceId);
    if (api && (api.props.length !== e.props.length || api.events.length !== e.events.length ||
        api.props.some(prop => !e.props.some(p => sameComponentMember(p, prop))) ||
        api.events.some(event => !e.events.some(p => sameComponentMember(p, event))))) requireConflict('API_MISMATCH', e.instanceId);
  }
  for (const r of p.registryEvidence) {
    if (!p.exactDependencies.some(d => d.name === r.name && d.version === r.version)) add('/registryEvidence', 'Registry evidence must describe an exact plan dependency');
    if (r.verification === 'platform-sha256' && !p.publicationEvidence.some(e => e.response.target?.packageName === r.name && e.response.target.packageVersion === r.version && e.response.target.packageSha256 === r.sha256)) add('/registryEvidence', 'Platform digest claims require matching authoritative publication evidence');
  }
  if (p.status === 'planned') {
    if (p.localProject.status !== 'inspected' || !p.packageManager) add('/localProject', 'Planned result requires complete inspection');
    for (const e of p.sourceMatchPlan.elements) {
      const t = e.target; if (!t) { add('/sourceMatchPlan', 'Planned result requires all mapped elements'); continue; }
      if (p.changes.filter(c => c.kind === 'generated-component' && c.instanceId === e.instanceId).length !== 1) add('/changes', 'Every planned instance requires exactly one generated component intent');
      const response = p.publicationEvidence.find(r => r.response.target?.variantReleaseId === t.variantReleaseId)?.response;
      if (!response?.target || response.status !== 'matched') { add('/publicationEvidence', 'Every target requires a final authoritative GET snapshot'); continue; }
      for (const field of ['componentId', 'framework', 'packageName', 'packageVersion', 'packageSha256'] as const) if (response.target[field] !== t[field]) add('/publicationEvidence', 'Publication identity must match input target');
      for (const d of response.exactDependencies) if (!p.exactDependencies.some(a => a.name === d.name && a.version === d.version)) add('/exactDependencies', 'All authoritative dependencies must be preserved');
      if (!p.registryEvidence.some(r => r.name === t.packageName && r.version === t.packageVersion && r.sha256 === t.packageSha256 && r.verification === 'platform-sha256')) add('/registryEvidence', 'Selected package requires matching platform digest evidence');
    }
    for (const d of p.exactDependencies) {
      if (!p.localProject.resolvedDependencies.some(r => r.name === d.name && r.version === d.version) && !p.registryEvidence.some(r => r.name === d.name && r.version === d.version)) add('/registryEvidence', 'New exact dependencies require registry verification');
      const host = p.localProject.resolvedDependencies.find(r => r.name === d.name);
      if (host && host.version !== d.version) add('/exactDependencies', 'Plan must not silently upgrade locked dependencies');
      if (!host) {
        if (!p.changes.some(c => c.kind === 'package-json' && c.dependencies?.some(a => a.name === d.name && a.version === d.version))) add('/changes', 'New dependencies require explicit manifest edits');
        if (!p.changes.some(c => c.kind === 'lockfile-regeneration')) add('/changes', 'New dependencies require lock regeneration intent');
        if (!p.commands.some(c => c.purpose === 'install')) add('/commands', 'New dependencies require an install preview');
      }
    }
  }
  return issues.length ? { ok: false, issues: issues.slice(0, 100) } : checked;
}
