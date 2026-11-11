import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateApiMessage, validateManifest, validateReleaseBundle } from '@company/contracts';
import type { ApiMessages } from '@company/contracts';

const json = (name: string): unknown => JSON.parse(readFileSync(new URL(`../fixtures/releases/g1/json/${name}.json`, import.meta.url), 'utf8'));

describe('G1 reviewable wire snapshots', () => {
  it('accepts the checked-in web and CLI manifests', () => {
    expect(validateManifest(json('valid-web')).ok).toBe(true);
    expect(validateManifest(json('valid-cli'), { reports: json('reports') as Record<string, unknown> }).ok).toBe(true);
  });
  it('rejects every checked-in counterexample with its documented error code', () => {
    for (const { name, code } of json('negative-cases') as { name: string; code: string }[]) {
      const result = validateManifest(json(name)); expect(result.ok, name).toBe(false);
      if (!result.ok) expect(result.issues.some(x => x.code === code), name).toBe(true);
    }
  });
  it('verifies the same synthetic frozen bytes and embedded report documents', async () => {
    const bytes = new Map(Object.entries(json('synthetic-bytes') as Record<string, string>).map(([path, base64]) => [path, Buffer.from(base64, 'base64')]));
    expect((await validateReleaseBundle(json('valid-cli'), bytes)).ok).toBe(true);
  });
  it('accepts every checked-in API wire sample', () => {
    for (const [key, value] of Object.entries(json('api-messages') as Record<keyof ApiMessages, unknown>)) expect(validateApiMessage(key as keyof ApiMessages, value).ok, key).toBe(true);
  });
});
