import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateComponentMatchQuery, validateComponentMatchResponse } from '@company/contracts';
import { componentMatchGapFixture, componentMatchResponseFixture, componentMatchQueryFixture } from '../fixtures/component-match.js';

const doc = readFileSync(new URL('../../docs/phases/phase2/component-query-api.md', import.meta.url), 'utf8');
function example(name: string): unknown {
  const found = new RegExp('<!-- example: ' + name + ' -->\\s*```json\\s*([\\s\\S]*?)\\s*```').exec(doc);
  if (!found) throw new Error(`Missing example ${name}`);
  return JSON.parse(found[1]!);
}

describe('component query API examples', () => {
  it('published Vue and React query examples pass runtime validation', () => {
    for (const name of ['vue-query', 'react-query']) expect(validateComponentMatchQuery(example(name)).ok, name).toBe(true);
  });
  it('published gap response passes runtime validation', () => {
    expect(validateComponentMatchResponse(example('unavailable-response')).ok).toBe(true);
  });
  it('conditional query and gap material constraints reject invalid consumer payloads', () => {
    const { reactDomVersion: _dom, ...noDom } = componentMatchQueryFixture('react');
    expect(validateComponentMatchQuery(noDom).ok).toBe(false);
    expect(validateComponentMatchQuery({ ...componentMatchQueryFixture('vue'), reactDomVersion: '19.3.1' }).ok).toBe(false);
    expect(validateComponentMatchQuery({ ...componentMatchQueryFixture('vue'), packageVersion: 'latest' }).ok).toBe(false);
    const matched = componentMatchResponseFixture('vue');
    expect(validateComponentMatchResponse({ ...matched, status: 'gap', exactDependencies: [] }).ok).toBe(false);
    expect(validateComponentMatchResponse(componentMatchGapFixture('vue')).ok).toBe(true);
  });
});
