import { expect, it } from 'vitest';
import { validateApiMessage } from '@company/contracts';

const hash = 'a'.repeat(64);
const item = {
  compatibilityId: 'compatibility-1', variantReleaseId: 'release-1',
  packageName: '@company/charts-vue', packageVersion: '0.0.10', packageSha256: hash,
  framework: 'vue', frameworkVersion: '3.5.13', echartsVersion: '6.1.0',
  candidateIntegrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}`,
  candidateSource: 'https://registry.npmjs.org/', status: 'passed', evidenceSha256: hash,
  createdAt: '2026-11-15T00:00:00.000Z',
};

it('describes public compatibility records without exposing private audit fields', () => {
  const response = { variantReleaseId: 'release-1', items: [item] };
  expect(validateApiMessage('variantCompatibilityResponse', response).ok).toBe(true);
  expect(validateApiMessage('variantCompatibilityResponse', { ...response, items: [{ ...item, subject: 'private', reason: 'private' }] }).ok).toBe(false);
  expect(validateApiMessage('myVariantCompatibilityResponse', { ...response, items: [{ ...item, subject: 'maintainer', reason: 'reviewed' }] }).ok).toBe(true);
  expect(validateApiMessage('createCompatibilityResponse', { ...item, variantId: 'line-vue', subject: 'maintainer', reason: 'reviewed' }).ok).toBe(true);
});

it('validates the request envelope while retaining evidence as untrusted input for the service', () => {
  const request = {
    packageSha256: hash, reason: 'Reviewed local report',
    candidate: { version: '6.1.0', integrity: item.candidateIntegrity, source: item.candidateSource },
    evidence: { schemaVersion: 1, kind: 'a-t10-sdk-probe', combinations: [] },
  };
  expect(validateApiMessage('createCompatibilityRequest', request).ok).toBe(true);
  expect(validateApiMessage('createCompatibilityRequest', { ...request, subject: 'forged' }).ok).toBe(false);
  expect(validateApiMessage('createCompatibilityRequest', { ...request, evidence: null }).ok).toBe(false);
  for (const source of ['https://u:p@registry.example.com/', 'https://registry.example.com/?token=x', 'https://registry.example.com/#x', ' https://registry.example.com/', 'http://registry.example.com/']) {
    expect(validateApiMessage('createCompatibilityRequest', { ...request, candidate: { ...request.candidate, source } }).ok).toBe(false);
  }
});
