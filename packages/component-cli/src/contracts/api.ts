import type { ArtifactRef, Framework, PackageRef, ReleaseManifestV1, ValidationResult, VariantRef } from './release-manifest.js';
import type { ApiError } from './errors.js';
import type { CheckReportV1 } from './reports.js';
import { API_ERROR_CODES, CONTRACT_ERROR_CODES } from './errors.js';
import { array, artifactPath, choice, hash, integer, object, text, timestamp, validateSchema } from './schema.js';
import type { Schema } from './schema.js';
import { artifactSchema, manifestSchema, packageSchema, variantSchema, reportSchema } from './schemas.js';
import { validateManifest } from './validation.js';
import type { ManifestValidationContext } from './validation.js';

export const RELEASE_STATES = ['UPLOADING', 'VALIDATING', 'PENDING', 'PUBLISHING', 'READY', 'REJECTED', 'RETRY_WAIT', 'CONFLICT'] as const;
export const PUBLISHING_CHECKPOINTS = ['FINALIZE_OBJECTS', 'ENSURE_PACKAGES', 'REGISTER_ASSETS', 'CHECK_AVAILABILITY', 'READY_TX'] as const;
export type ReleaseState = typeof RELEASE_STATES[number];
export type PublishingCheckpoint = typeof PUBLISHING_CHECKPOINTS[number];
export type PublicVariantSummary = { variantReleaseId: string; variantId: string; framework: Framework; packageName: string; packageVersion: string };
export type ApiMessages = {
  createUploadRequest: { manifestDigest: string; files: ArtifactRef[] };
  createUploadResponse: { uploadSessionId: string; files: { path: string; uploadUrl: string; expiresAt: string; multipart?: { uploadId: string; partSize: number; parts: { partNumber: number; uploadUrl: string; expiresAt: string }[] } }[] };
  completeUploadRequest: { parts: { path: string; partNumber: number; etag: string }[] };
  completeUploadResponse: { status: 'complete'; verifiedFiles: ArtifactRef[] };
  createReleaseRequest: { uploadSessionId: string; manifest: ReleaseManifestV1 };
  createReleaseResponse: { jobId: string; state: ReleaseState };
  releaseJobResponse: { state: ReleaseState; stage: ReleaseState | PublishingCheckpoint; attempt: number; lastError?: ApiError; missingArtifacts: string[]; pollAfterMs: number; baselineCandidates?: { screenshotId: string; sourceScreenshotId: string; variantId: string; exampleId: string; environmentKey: string }[] };
  retryReleaseResponse: { jobId: string; state: ReleaseState };
  componentsQuery: { framework?: Framework; category?: string; query?: string; page?: number; pageSize?: number };
  componentsResponse: { items: { componentId: string; variants: PublicVariantSummary[] }[]; page: number; pageSize: number; total: number };
  variantReleaseResponse: { variantReleaseId: string; variant: VariantRef; package: PackageRef; availability: 'Ready' | 'DEPRECATED'; reportSource: 'local-automatic' | 'manual-upload' | 'none'; baselineStatus: 'unconfirmed' | 'accepted' | 'incompatible'; indexStatus: 'pending' | 'indexed' | 'failed' };
  variantReportsResponse: { variantReleaseId: string; reports: CheckReportV1[] };
  createBaselineRequest: { variantId: string; exampleId: string; environmentKey: string; screenshotId: string; reason: string; expectedRevision?: string };
  createBaselineResponse: { revisionId: string };
  deprecateRequest: { reason: string };
  deprecateResponse: { variantReleaseId: string; status: 'DEPRECATED' };
  previewGrantRequest: { variantReleaseId: string };
  previewGrantResponse: { bootstrapUrl: string; expiresAt: string };
  error: ApiError;
};
const identifier: Schema = { ...text, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' };
const url: Schema = { ...text, pattern: '^https?://[^\\s]+$' };
const release = object({ jobId: identifier, state: choice(...RELEASE_STATES) });
const issue = object({ code: choice(...CONTRACT_ERROR_CODES), path: { type: 'string', pattern: '^(?:/.*)?$' }, message: text });
const error = object({ code: choice(...API_ERROR_CODES), message: text, details: array(issue), requestId: identifier });
const schemas: Record<keyof ApiMessages, Schema> = {
  createUploadRequest: object({ manifestDigest: hash, files: array(artifactSchema, 1) }),
  createUploadResponse: object({ uploadSessionId: identifier, files: array(object({ path: artifactPath, uploadUrl: url, expiresAt: timestamp, multipart: object({ uploadId: text, partSize: integer(5242880), parts: array(object({ partNumber: integer(1, 10000), uploadUrl: url, expiresAt: timestamp }), 1) }) }, ['multipart']), 1) }),
  completeUploadRequest: object({ parts: array(object({ path: artifactPath, partNumber: integer(1), etag: text })) }),
  completeUploadResponse: object({ status: { type: 'string', const: 'complete' }, verifiedFiles: array(artifactSchema, 1) }),
  createReleaseRequest: object({ uploadSessionId: identifier, manifest: manifestSchema }),
  createReleaseResponse: release,
  releaseJobResponse: object({ state: choice(...RELEASE_STATES), stage: choice(...RELEASE_STATES, ...PUBLISHING_CHECKPOINTS), attempt: integer(), lastError: error, missingArtifacts: array(artifactPath), pollAfterMs: integer(1), baselineCandidates: array(object({ screenshotId: identifier, sourceScreenshotId: identifier, variantId: identifier, exampleId: identifier, environmentKey: hash })) }, ['lastError', 'baselineCandidates']),
  retryReleaseResponse: release,
  componentsQuery: object({ framework: choice('vue', 'react'), category: text, query: text, page: integer(1), pageSize: integer(1, 100) }, ['framework', 'category', 'query', 'page', 'pageSize']),
  componentsResponse: object({ items: array(object({ componentId: identifier, variants: array(object({ variantReleaseId: identifier, variantId: identifier, framework: choice('vue', 'react'), packageName: packageSchema.properties!.name!, packageVersion: packageSchema.properties!.version! }), 1) })), page: integer(1), pageSize: integer(1, 100), total: integer() }),
  variantReleaseResponse: object({ variantReleaseId: identifier, variant: variantSchema, package: packageSchema, availability: choice('Ready', 'DEPRECATED'), reportSource: choice('local-automatic', 'manual-upload', 'none'), baselineStatus: choice('unconfirmed', 'accepted', 'incompatible'), indexStatus: choice('pending', 'indexed', 'failed') }),
  variantReportsResponse: object({ variantReleaseId: identifier, reports: array(reportSchema) }),
  createBaselineRequest: object({ variantId: identifier, exampleId: identifier, environmentKey: hash, screenshotId: identifier, reason: text, expectedRevision: identifier }, ['expectedRevision']),
  createBaselineResponse: object({ revisionId: identifier }),
  deprecateRequest: object({ reason: text }),
  deprecateResponse: object({ variantReleaseId: identifier, status: { type: 'string', const: 'DEPRECATED' } }),
  previewGrantRequest: object({ variantReleaseId: identifier }),
  previewGrantResponse: object({ bootstrapUrl: url, expiresAt: timestamp }),
  error,
};
export const API_SCHEMAS: Record<string, Schema> = Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [`api-${name}-v1`, { $schema: 'https://json-schema.org/draft/2020-12/schema', title: name, ...schema }]));

/** Request/response shape validation; authentication, role checks and storage state belong to T05/T06. */
export function validateApiMessage<K extends keyof ApiMessages>(name: K, input: unknown, context: ManifestValidationContext = {}): ValidationResult<ApiMessages[K]> {
  if (!Object.hasOwn(schemas, name)) return { ok: false, issues: [{ code: 'INVALID_SCHEMA', path: '', message: 'Unknown API contract' }] };
  const result = validateSchema<ApiMessages[K]>(schemas[name], input);
  if (!result.ok) return result;
  if (name === 'createReleaseRequest') {
    const manifest = validateManifest((result.value as ApiMessages['createReleaseRequest']).manifest, context);
    if (!manifest.ok) return { ok: false, issues: manifest.issues.map(issue => ({ ...issue, path: `/manifest${issue.path}` })) };
  }
  return result;
}
