import { describe, expect, it } from 'vitest';
import * as c from '@company/contracts';
import { componentMatchQueryFixture as query, componentMatchResponseFixture as response, componentMatchGapFixture as gap } from '../fixtures/component-match.js';

describe('component GET query contract', () => {
  it('accepts precise Vue/React queries, scoped packages, prereleases and case-sensitive IDs', () => {
    for (const framework of ['vue', 'react'] as const) {
      expect(c.validateComponentMatchQuery(query(framework)).ok).toBe(true);
      expect(c.validateComponentMatchResponse(response(framework)).ok).toBe(true);
      expect(c.validateComponentMatchResponse(gap(framework)).ok).toBe(true);
    }
    const value = { ...query(), componentId: 'Line.A_1-x', packageName: '@company/charts-vue', packageVersion: '1.2.3-rc.1' };
    expect(c.validateComponentMatchQuery(value)).toEqual({ ok: true, value });
    expect(c.validateComponentMatchQuery({ ...query(), componentId: 'a'.repeat(128) }).ok).toBe(true);
  });
  it('reactRequiresDomVersion', () => {
    const value = query('react'); delete value.reactDomVersion;
    expect(c.validateComponentMatchQuery(value).ok).toBe(false);
    expect(c.validateComponentMatchResponse({ ...response('react'), query: value }).ok).toBe(false);
  });
  it('vueRejectsDomVersion', () => {
    expect(c.validateComponentMatchQuery({ ...query(), reactDomVersion: '19.3.1' }).ok).toBe(false);
  });
  it.each(['latest', '^1.2.3', '~1.2.3', '1', '1.2', '01.2.3', '1.2.3+build', '1.2.3-01', ' 1.2.3'])('rejects floating or malformed versions: %s', version => {
    for (const key of ['packageVersion', 'frameworkVersion', 'echartsVersion', 'reactDomVersion']) {
      expect(c.validateComponentMatchQuery({ ...query('react'), [key]: version }).ok).toBe(false);
    }
  });
  it.each(['', ' line', 'line ', '../line', 'line/vue', '%6cine', '组件', 'a'.repeat(129)])('rejects invalid IDs without normalization: %s', componentId => {
    expect(c.validateComponentMatchQuery({ ...query(), componentId }).ok).toBe(false);
  });
  it.each([{}, { ...query(), framework: 'React' }, { ...query(), componentId: ['line'] },
    { ...query(), componentId: { name: 'line' } }, { ...query(), packageName: '@company/charts-vue ' },
    { ...query(), unknown: 'value' }, { ...query(), componentId: undefined }])('rejects missing fields and non-string/unknown input %#', input => {
    expect(c.validateComponentMatchQuery(input).ok).toBe(false);
  });
  it('gapCannotExposeMaterials', () => {
    const matched = response();
    for (const extra of [{ target: matched.target }, { api: matched.api }, { exactDependencies: matched.exactDependencies }]) {
      expect(c.validateComponentMatchResponse({ ...gap(), ...extra }).ok).toBe(false);
    }
    expect(c.validateComponentMatchResponse({ ...gap(), gaps: [] }).ok).toBe(false);
  });
  it.each(['target', 'api'])('matched requires %s', key => {
    const input = response(); delete input[key as 'target' | 'api'];
    expect(c.validateComponentMatchResponse(input).ok).toBe(false);
  });
  it('responseMustBindRequestedIdentity', () => {
    for (const [key, value] of [['componentId', 'bar'], ['framework', 'react'], ['packageVersion', '0.0.11']] as const) {
      const input = response(); Object.assign(input.target!, { [key]: value });
      expect(c.validateComponentMatchResponse(input).ok).toBe(false);
    }
    const wrongPackage = response(); wrongPackage.query.packageName = '@other/charts';
    expect(c.validateComponentMatchResponse(wrongPackage).ok).toBe(false);
    for (const [key, value] of [['componentId', 'bar'], ['framework', 'react'], ['exportName', 'BarChart'], ['exportPath', './bar'], ['styleExport', './other.css'], ['readyMethod', 'ready']] as const) {
      const input = response(); Object.assign(input.api!, { [key]: value });
      expect(c.validateComponentMatchResponse(input).ok).toBe(false);
    }
  });
  it('unverifiedRequiresGap and compatibility evidence must agree', () => {
    expect(c.validateComponentMatchResponse({ ...response(), gaps: [] }).ok).toBe(false);
    for (const compatibility of [{ status: 'verified', recordIds: [] }, { status: 'unverified', recordIds: ['r'] }, { status: 'verified', recordIds: ['r', 'r'] }]) {
      const input = response(); Object.assign(input.target!, { compatibility });
      expect(c.validateComponentMatchResponse(input).ok).toBe(false);
    }
    const verified = response(); verified.target!.compatibility = { status: 'verified', recordIds: ['r'] }; verified.gaps = [];
    expect(c.validateComponentMatchResponse(verified).ok).toBe(true);
  });
  it('requires exact target and host dependencies with no duplicate package names', () => {
    for (const framework of ['vue', 'react'] as const) {
      const original = response(framework);
      for (let i = 0; i < original.exactDependencies.length; i++) {
        const missing = response(framework); missing.exactDependencies.splice(i, 1);
        expect(c.validateComponentMatchResponse(missing).ok).toBe(false);
        const wrong = response(framework); wrong.exactDependencies[i]!.version = '99.0.0';
        expect(c.validateComponentMatchResponse(wrong).ok).toBe(false);
      }
      const duplicate = response(framework); duplicate.exactDependencies.push({ ...duplicate.exactDependencies[0]! });
      expect(c.validateComponentMatchResponse(duplicate).ok).toBe(false);
    }
  });
  it('validates API cross-field rules and requires both static evidence kinds', () => {
    const duplicate = response(); duplicate.api!.props.push({ ...duplicate.api!.props[0]! });
    expect(c.validateComponentMatchResponse(duplicate).ok).toBe(false);
    const collision = response(); collision.api!.events[0]!.name = 'data';
    expect(c.validateComponentMatchResponse(collision).ok).toBe(false);
    const missingDocs = response(); missingDocs.target!.evidence = [missingDocs.target!.evidence[0]!, missingDocs.target!.evidence[0]!];
    expect(c.validateComponentMatchResponse(missingDocs).ok).toBe(false);
  });
  it('GET does not assert unrequested business bindings or conceal unavailable targets', () => {
    for (const code of ['MISSING_PROP', 'MISSING_EVENT', 'LAYOUT_UNKNOWN', 'TARGET_UNAVAILABLE', 'DEPENDENCY_CONFLICT'] as const) {
      const input = response(); input.gaps.push({ code, message: 'Invalid GET matched gap' });
      expect(c.validateComponentMatchResponse(input).ok).toBe(false);
    }
    expect(c.validateComponentMatchResponse({ ...gap(), gaps: [{ code: 'COMPATIBILITY_UNVERIFIED', message: 'Not an unavailable target' }] }).ok).toBe(false);
  });
  it('registers structural schemas and documents runtime-only conditions', () => {
    for (const name of ['component-match-query-v1', 'component-match-response-v1']) expect(c.CONTRACT_SCHEMAS[name]).toBeDefined();
    expect(c.CONTRACT_SCHEMAS['component-match-query-v1']!.description).toContain('runtime');
    expect(c.CONTRACT_SCHEMAS['component-match-response-v1']!.description).toContain('runtime');
  });
});
