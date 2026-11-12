import { makeFixture } from './factory.js';

/** Proposed V1 wire examples for A/B review. All URLs and identifiers are synthetic. */
export function makeApiFixtures(): Record<string, unknown> {
  const { manifest } = makeFixture();
  const job = { state: 'RETRY_WAIT', stage: 'ENSURE_PACKAGES', attempt: 2, lastError: { code: 'INFRA_UNAVAILABLE', message: 'Synthetic registry unavailable', details: [], requestId: 'request-synthetic' }, missingArtifacts: [], pollAfterMs: 1000 };
  return {
    createUploadRequest: { manifestDigest: 'a'.repeat(64), files: manifest.files },
    createUploadResponse: { uploadSessionId: 'upload-synthetic', files: manifest.files.map(file => ({ path: file.path, uploadUrl: `https://uploads.example.test/${file.path}`, expiresAt: '2026-11-12T10:00:00.000Z' })) },
    completeUploadRequest: { parts: [{ path: manifest.files[0]!.path, partNumber: 1, etag: 'synthetic-etag' }] },
    completeUploadResponse: { status: 'complete', verifiedFiles: manifest.files },
    createReleaseRequest: { uploadSessionId: 'upload-synthetic', manifest },
    createReleaseResponse: { jobId: 'job-synthetic', state: 'VALIDATING' },
    releaseJobResponse: job,
    retryReleaseResponse: { jobId: 'job-synthetic', state: 'PENDING' },
    componentsQuery: { framework: 'react', query: 'line', page: 1, pageSize: 20 },
    componentsResponse: { items: [{ componentId: 'line', variants: [{ variantReleaseId: 'release-synthetic', variantId: 'line-react', framework: 'react', packageName: '@company/charts-react', packageVersion: '0.0.1' }] }], page: 1, pageSize: 20, total: 1 },
    variantReleaseResponse: { variantReleaseId: 'release-synthetic', variant: manifest.variants[2], package: manifest.packages[1], availability: 'Ready', reportSource: 'manual-upload', baselineStatus: 'unconfirmed', indexStatus: 'pending' },
    variantReportsResponse: { variantReleaseId: 'release-synthetic', reports: Object.values(makeFixture('cli').reports).slice(0, 1) },
    createBaselineRequest: { variantId: 'line-react', exampleId: 'example-line-react', environmentKey: 'a'.repeat(64), screenshotId: 'screenshot-line-react', reason: 'Synthetic baseline review', expectedRevision: 'revision-1' },
    createBaselineResponse: { revisionId: 'revision-2' },
    deprecateRequest: { reason: 'Synthetic deprecation reason' },
    deprecateResponse: { variantReleaseId: 'release-synthetic', status: 'DEPRECATED' },
    previewGrantRequest: { variantReleaseId: 'release-synthetic' },
    previewGrantResponse: { bootstrapUrl: 'https://r-synthetic.preview.example.test/bootstrap', expiresAt: '2026-11-12T10:00:00.000Z' },
    error: { code: 'CONFLICT', message: 'Same package version with different digest', details: [{ code: 'CONFLICT', path: '/packages/0', message: 'Different frozen bytes' }], requestId: 'request-synthetic' },
  };
}
