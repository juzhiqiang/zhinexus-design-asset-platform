import type { ValidationIssue } from './errors.js';
import type { ValidationResult } from './release-manifest.js';
import { componentApiSchema, duplicateIssues, validateComponentApi, type ComponentApiV1 } from './component-api.js';
import { matchTargetSchema, type MatchGap, type MatchTarget } from './match-plan.js';
import { array, choice, exactVersion, object, text, validateSchema } from './schema.js';

export type ComponentMatchQueryV1 = {
  componentId: string;
  framework: 'vue' | 'react';
  packageVersion: string;
  packageName?: string;
  frameworkVersion: string;
  echartsVersion?: string;
  reactDomVersion?: string;
};

export type ComponentMatchResponseV1 = {
  schemaVersion: 1;
  query: ComponentMatchQueryV1;
  status: 'matched' | 'gap';
  target?: MatchTarget;
  api?: ComponentApiV1;
  exactDependencies: { name: string; version: string }[];
  gaps: MatchGap[];
};

const packageName = { ...text, pattern: '^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$' };
const queryGapCodes = ['TARGET_UNAVAILABLE', 'API_UNSUPPORTED', 'DEPENDENCY_CONFLICT', 'COMPATIBILITY_UNVERIFIED'] as const;

/** HTTP adapters must preserve and reject duplicate decoded keys before validating this object. */
export const componentMatchQuerySchema = {
  ...object({
    componentId: { ...text, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' },
    framework: choice('vue', 'react'), packageVersion: exactVersion, packageName,
    frameworkVersion: exactVersion, echartsVersion: exactVersion, reactDomVersion: exactVersion,
  }, ['packageName', 'reactDomVersion', 'echartsVersion']),
  description: 'Structural schema only; runtime validation requires reactDomVersion for React and forbids it for Vue. HTTP adapters reject duplicate decoded query keys.',
};

export const componentMatchResponseSchema = {
  ...object({
    schemaVersion: { type: 'integer', const: 1 }, query: componentMatchQuerySchema, status: choice('matched', 'gap'),
    target: matchTargetSchema, api: componentApiSchema,
    exactDependencies: array(object({ name: packageName, version: exactVersion })),
    gaps: array(object({ code: choice(...queryGapCodes), message: text })),
  }, ['target', 'api']),
  description: 'Structural schema only; runtime validation enforces framework conditions, matched/gap materials, query/target/API identities, exact host dependencies and compatibility evidence.',
};

export function validateComponentMatchQuery(input: unknown): ValidationResult<ComponentMatchQueryV1> {
  const checked = validateSchema<ComponentMatchQueryV1>(componentMatchQuerySchema, input);
  if (!checked.ok) return checked;
  const query = checked.value;
  if ((query.framework === 'react') !== (query.reactDomVersion !== undefined)) {
    return { ok: false, issues: [{ code: 'INVALID_SCHEMA', path: '/reactDomVersion',
      message: 'React requires an exact reactDomVersion; Vue forbids reactDomVersion' }] };
  }
  return checked;
}

export function validateComponentMatchResponse(input: unknown): ValidationResult<ComponentMatchResponseV1> {
  const checked = validateSchema<ComponentMatchResponseV1>(componentMatchResponseSchema, input);
  if (!checked.ok) return checked;
  const response = checked.value;
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ code: 'INVALID_SCHEMA', path, message });
  const queryResult = validateComponentMatchQuery(response.query);
  if (!queryResult.ok) issues.push(...queryResult.issues.map(issue => ({ ...issue, path: '/query' + issue.path })));
  const { query, target, api, exactDependencies, gaps } = response;
  if (response.status === 'gap') {
    if (target !== undefined || api !== undefined || exactDependencies.length || !gaps.length) {
      add('', 'Unavailable targets require gaps and cannot expose target, API or dependencies');
    }
    if (gaps.some(gap => gap.code === 'COMPATIBILITY_UNVERIFIED')) add('/gaps', 'Compatibility gaps require a matched target');
  } else {
    if (!target) add('/target', 'Matched response requires target');
    if (!api) add('/api', 'Matched response requires API');
    if (gaps.some(gap => gap.code !== 'COMPATIBILITY_UNVERIFIED')) add('/gaps', 'Matched response can only carry compatibility gaps');
    issues.push(...duplicateIssues(exactDependencies.map(dependency => dependency.name), '/exactDependencies', 'name'));
    if (target) {
      for (const key of ['componentId', 'framework', 'packageVersion'] as const) {
        if (target[key] !== query[key]) add('/target/' + key, 'Target must match requested identity');
      }
      if (query.packageName !== undefined && target.packageName !== query.packageName) add('/target/packageName', 'Target must match requested package');
      for (const kind of ['api', 'docs'] as const) {
        if (!target.evidence.some(evidence => evidence.kind === kind)) add('/target/evidence', 'Both API and docs evidence are required');
      }
      const { status, recordIds } = target.compatibility;
      if ((status === 'verified') !== (recordIds.length > 0) || new Set(recordIds).size !== recordIds.length) {
        add('/target/compatibility', 'Compatibility status requires consistent unique evidence');
      }
      if ((status === 'unverified') !== gaps.some(gap => gap.code === 'COMPATIBILITY_UNVERIFIED')) {
        add('/gaps', 'Compatibility gaps must agree with target status');
      }
      const requiredDependencies = [
        { name: target.packageName, version: target.packageVersion },
        { name: query.framework, version: query.frameworkVersion },
        ...(query.echartsVersion ? [{ name: 'echarts', version: query.echartsVersion }] : []),
        ...(query.framework === 'react' ? [{ name: 'react-dom', version: query.reactDomVersion }] : []),
      ];
      for (const dependency of requiredDependencies) {
        if (!exactDependencies.some(actual => actual.name === dependency.name && actual.version === dependency.version)) {
          add('/exactDependencies', 'Exact target and host dependencies are required');
        }
      }
    }
    if (api) {
      const apiResult = validateComponentApi(api);
      if (!apiResult.ok) issues.push(...apiResult.issues.map(issue => ({ ...issue, path: '/api' + issue.path })));
      if (target) for (const key of ['componentId', 'framework', 'exportName', 'exportPath', 'styleExport', 'readyMethod'] as const) {
        if (api[key] !== target[key]) add('/api/' + key, 'API must match target identity and interface');
      }
    }
  }
  return issues.length ? { ok: false, issues: issues.slice(0, 100) } : checked;
}
