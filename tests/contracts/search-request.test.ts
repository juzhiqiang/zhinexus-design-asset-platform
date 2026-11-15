import { describe, expect, it } from 'vitest';
import { CONTRACT_SCHEMAS, validateSearchCandidatesRequest } from '@company/contracts';

const context = { framework: 'react', frameworkVersion: '19.3.1', echartsVersion: '6.1.0', packageManager: 'pnpm', requirements: [] };
describe('文本检索请求', () => {
  it('保留明确查询与独立 React DOM 版本', () => {
    const input = { query: '趋势图', context, reactDomVersion: '19.3.1' };
    expect(validateSearchCandidatesRequest(input)).toEqual({ ok: true, value: input });
    expect(validateSearchCandidatesRequest({ query: 'line', context }).ok).toBe(true);
    expect(CONTRACT_SCHEMAS['search-candidates-request-v1']).toBeDefined();
  });
  it.each(['', '   ', 'x'.repeat(2049), null, 1])('拒绝非法查询 %s', query => {
    expect(validateSearchCandidatesRequest({ query, context }).ok).toBe(false);
  });
  it.each(['19', '^19.3.1', '19.3.1+build', '', null])('拒绝不精确 DOM 版本 %s', reactDomVersion => {
    expect(validateSearchCandidatesRequest({ query: 'line', context, reactDomVersion }).ok).toBe(false);
  });
  it('拒绝未知请求字段和未知上下文字段', () => {
    expect(validateSearchCandidatesRequest({ query: 'line', context, subject: 'admin' }).ok).toBe(false);
    expect(validateSearchCandidatesRequest({ query: 'line', context: { ...context, reactDomVersion: '19.3.1' } }).ok).toBe(false);
  });
});
