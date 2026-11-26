import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as contracts from '@company/contracts';
import { makeApiFixtures } from '../fixtures/releases/g1/api.js';
import { makeFixture } from '../fixtures/releases/g1/factory.js';

describe('G1 API and generated JSON Schema', () => {
  it('accepts optional server candidate IDs without changing frozen screenshot reference IDs', () => {
    const job = makeApiFixtures().releaseJobResponse as contracts.ApiMessages['releaseJobResponse'];
    const baselineCandidates = [{ screenshotId: 'server-id', sourceScreenshotId: 'client-id', variantId: 'line-vue', exampleId: 'default', environmentKey: 'a'.repeat(64) }];
    expect(contracts.validateApiMessage('releaseJobResponse', { ...job, baselineCandidates }).ok).toBe(true);
    expect(contracts.validateApiMessage('releaseJobResponse', { ...job, baselineCandidates: [{ ...baselineCandidates[0], environmentKey: 'unknown-manual' }] }).ok).toBe(false);
  });
  it.each(Object.entries(makeApiFixtures()))('accepts the %s wire fixture', (name, sample) => {
    expect(contracts.validateApiMessage(name as keyof contracts.ApiMessages, sample)).toEqual({ ok: true, value: sample });
  });
  it.each(['createUploadRequest', 'createReleaseRequest', 'createBaselineRequest', 'previewGrantRequest'])('rejects client-supplied subject on %s', name => {
    const fixture = makeApiFixtures()[name] as Record<string, unknown>;
    expect(contracts.validateApiMessage(name as keyof contracts.ApiMessages, { ...fixture, subject: 'forged-subject' }).ok).toBe(false);
  });
  it('rejects missing screenshots inside release API requests', () => {
    const { manifest } = makeFixture(); manifest.variants[1]!.screenshots = [];
    expect(contracts.validateApiMessage('createReleaseRequest', { uploadSessionId: 'upload-synthetic', manifest }).ok).toBe(false);
  });
  it('rejects an unknown-manual baseline environment', () => {
    const fixture = makeApiFixtures().createBaselineRequest as Record<string, unknown>;
    expect(contracts.validateApiMessage('createBaselineRequest', { ...fixture, environmentKey: 'unknown-manual' }).ok).toBe(false);
  });
  it('does not infer baseline or index state from Ready, and accepts optional governance metadata on variantReleaseResponse', () => {
    const fixture = makeApiFixtures().variantReleaseResponse;
    const validated = contracts.validateApiMessage('variantReleaseResponse', fixture);
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.value).toMatchObject({ availability: 'Ready', reportSource: 'manual-upload', baselineStatus: 'unconfirmed', indexStatus: 'pending' });

    const enriched = contracts.validateApiMessage('variantReleaseResponse', {
      ...(fixture as Record<string, unknown>),
      isPublic: false,
      deprecatedReason: '已被 0.2.0 替代',
      baselineHeads: [{ exampleId: 'default', environmentKey: 'a'.repeat(64), revisionId: '11111111-1111-4111-8111-111111111111', screenshotId: 'shot-line-vue-default' }],
    });
    expect(enriched.ok).toBe(true);
    expect(contracts.validateApiMessage('variantReleaseResponse', {
      ...(fixture as Record<string, unknown>),
      baselineHeads: [{ exampleId: 'default', environmentKey: 'unknown-manual', revisionId: 'bad', screenshotId: 'shot-1' }],
    }).ok).toBe(false);
  });
  it('generates every committed schema from the runtime definitions without drift', () => {
    for (const [name, schema] of Object.entries({ ...contracts.CONTRACT_SCHEMAS, ...contracts.API_SCHEMAS })) {
      const json = readFileSync(new URL(`../../packages/contracts/schemas/${name}.schema.json`, import.meta.url), 'utf8');
      expect(json, `${name}: regenerate with pnpm --filter @company/contracts schemas:generate`).toBe(`${JSON.stringify(schema, null, 2)}\n`);
    }
  });
});
