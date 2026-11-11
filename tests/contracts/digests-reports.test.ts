import { describe, expect, it } from 'vitest';
import * as contracts from '@company/contracts';
import { digest, environment, expectedEnvironmentKey, makeFixture } from '../fixtures/releases/g1/factory.js';

describe('G1 deterministic JSON and environment', () => {
  it('uses sorted object keys, preserves array order and hashes actual UTF-8 bytes', async () => {
    expect(contracts.canonicalJson({ z: 1, a: { z: '中文', a: 2 } })).toBe('{"a":{"a":2,"z":"中文"},"z":1}');
    expect(await contracts.sha256(new TextEncoder().encode('hello'))).toBe(digest('hello'));
    const f = makeFixture().manifest;
    expect(await contracts.manifestDigest(f)).toBe(await contracts.manifestDigest(Object.fromEntries(Object.entries(f).reverse())));
  });
  it.each([undefined, NaN, Infinity, { missing: undefined }, [undefined], new Date(), 1n])('rejects non-JSON canonical input %#', input => {
    expect(() => contracts.canonicalJson(input)).toThrow();
  });
  it('rejects cyclic input without overflowing', () => {
    const input: Record<string, unknown> = {}; input.self = input;
    expect(() => contracts.canonicalJson(input)).toThrow();
    expect(contracts.validateManifest(input).ok).toBe(false);
  });
  it('excludes tested dependency versions and normalizes OS/arch whitespace and case', async () => {
    expect(await contracts.environmentKey(environment)).toBe(expectedEnvironmentKey(environment));
    expect(await contracts.environmentKey({ ...environment, os: ' Windows ', arch: 'X64', frameworkVersion: '19.3.1', echartsVersion: '6.1.1' })).toBe(await contracts.environmentKey(environment));
  });
  it.each(['fontDigest', 'browserRevision', 'width', 'theme', 'locale'] as const)('changes key when %s changes', async field => {
    const changed = { ...environment, [field]: field === 'width' ? 801 : field === 'fontDigest' ? 'a'.repeat(64) : 'different' };
    expect(await contracts.environmentKey(changed)).not.toBe(await contracts.environmentKey(environment));
  });
});

describe('G1 report structure', () => {
  it('accepts a synthetic report', () => {
    expect(contracts.validateCheckReport(makeFixture('cli').reports['reports/line-vue.json']).ok).toBe(true);
  });
  it.each(['2026-02-30T09:00:00.000Z', 'yesterday', '2026-11-12', '2026-11-12T25:00:00Z'])('rejects invalid report timestamps %s', createdAt => {
    const report = makeFixture('cli').reports['reports/line-vue.json']!; report.createdAt = createdAt;
    expect(contracts.validateCheckReport(report).ok).toBe(false);
  });
  it('rejects zero dimensions, fractional dimensions and nonpositive scale', () => {
    for (const change of [{ width: 0 }, { height: 1.5 }, { deviceScaleFactor: 0 }]) expect(contracts.validateEnvironment({ ...environment, ...change }).ok).toBe(false);
  });
});
