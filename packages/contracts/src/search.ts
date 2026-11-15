import type { ValidationIssue } from './errors.js';
import type { ValidationResult } from './release-manifest.js';
import { array, artifactPath, choice, exactVersion, hash, object, text, validateSchema } from './schema.js';

/** Shape validation does not authenticate evidence or prove compatibility. */
export type Candidate = {
  variantReleaseId: string; variantId: string; componentId: string; framework: 'vue' | 'react';
  packageName: string; packageVersion: string; packageSha256: string; exportName: string;
  evidence: { kind: 'api' | 'docs' | 'screenshot'; path: string; sha256: string; source?: 'manual-upload' | 'local-automatic' }[];
  compatibility: { status: 'verified' | 'unverified'; recordIds: string[] };
  ranking: { text: number; usage?: number; visual?: number };
  gaps: string[];
};
export type SearchCandidatesResponse = { candidates: Candidate[]; gaps: string[] };

const score = { type: 'number', minimum: 0, maximum: 1 } as const;
export const candidateSchema = object({
  variantReleaseId: text, variantId: text, componentId: text, framework: choice('vue', 'react'),
  packageName: { ...text, pattern: '^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$' },
  packageVersion: exactVersion, packageSha256: hash,
  exportName: { ...text, pattern: '^[A-Za-z_$][A-Za-z0-9_$]*$' },
  evidence: array(object({ kind: choice('api', 'docs', 'screenshot'), path: artifactPath, sha256: hash, source: choice('manual-upload', 'local-automatic') }, ['source']), 2),
  compatibility: object({ status: choice('verified', 'unverified'), recordIds: array(text) }),
  ranking: object({ text: score, usage: score, visual: score }, ['usage', 'visual']),
  gaps: array(text),
});
export const searchCandidatesResponseSchema = object({ candidates: array(candidateSchema), gaps: array(text) });

function candidateIssues(candidate: Candidate, prefix = ''): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ code: 'INVALID_SCHEMA', path: prefix + path, message });
  const { status, recordIds } = candidate.compatibility;
  if ((status === 'verified') !== (recordIds.length > 0) || new Set(recordIds).size !== recordIds.length) {
    add('/compatibility/recordIds', 'Verified requires unique accepted record IDs; unverified requires no records');
  }
  for (const kind of ['api', 'docs']) {
    if (!candidate.evidence.some(e => e.kind === kind)) add('/evidence', `Missing ${kind} evidence`);
  }
  candidate.evidence.forEach((e, i) => {
    if ((e.kind === 'screenshot') !== (e.source !== undefined)) add(`/evidence/${i}/source`, 'Only screenshots require a source');
  });
  if (candidate.ranking.visual !== undefined && !candidate.evidence.some(e => e.kind === 'screenshot')) {
    add('/ranking/visual', 'Visual score requires screenshot evidence');
  }
  return issues;
}

export function validateCandidate(input: unknown): ValidationResult<Candidate> {
  const result = validateSchema<Candidate>(candidateSchema, input);
  if (!result.ok) return result;
  const issues = candidateIssues(result.value);
  return issues.length ? { ok: false, issues } : result;
}

export function validateSearchCandidatesResponse(input: unknown): ValidationResult<SearchCandidatesResponse> {
  const result = validateSchema<SearchCandidatesResponse>(searchCandidatesResponseSchema, input);
  if (!result.ok) return result;
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  result.value.candidates.forEach((candidate, i) => {
    if (issues.length >= 100) return;
    issues.push(...candidateIssues(candidate, `/candidates/${i}`));
    if (seen.has(candidate.variantReleaseId)) issues.push({ code: 'DUPLICATE_ID', path: `/candidates/${i}/variantReleaseId`, message: 'Duplicate candidate release' });
    seen.add(candidate.variantReleaseId);
  });
  return issues.length ? { ok: false, issues: issues.slice(0, 100) } : result;
}
