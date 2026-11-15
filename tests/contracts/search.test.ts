import { describe, expect, it } from 'vitest';
import { CONTRACT_SCHEMAS, validateCandidate, validateSearchCandidatesResponse } from '@company/contracts';
import { candidateFixture } from '../fixtures/search.js';

describe('候选响应边界', () => {
  it('保留精确发布身份，缺用途和视觉评分不补零', () => {
    const candidate = candidateFixture();
    expect(validateCandidate(candidate)).toEqual({ ok: true, value: candidate });
    expect(validateSearchCandidatesResponse({ candidates: [candidate], gaps: ['尚无视觉排序'] }).ok).toBe(true);
    expect(candidate.ranking).not.toHaveProperty('visual');
  });
  it('允许空结果并保留缺口', () => {
    expect(validateSearchCandidatesResponse({ candidates: [], gaps: ['无符合条件的候选'] }).ok).toBe(true);
  });
  it('截图来源与兼容证据正交', () => {
    const candidate = candidateFixture();
    candidate.evidence.push({ kind: 'screenshot', path: 'images/line.png', sha256: 'd'.repeat(64), source: 'manual-upload' });
    candidate.ranking.visual = 0.9;
    expect(validateCandidate(candidate).ok).toBe(true);
    candidate.compatibility = { status: 'verified', recordIds: ['accepted-1'] };
    expect(validateCandidate(candidate).ok).toBe(true);
  });
  it.each([
    { packageVersion: '^0.1.0' }, { packageVersion: '0.1' }, { packageSha256: 'bad' },
    { framework: 'angular' }, { packageName: 'INVALID NAME' }, { exportName: 'a.b' },
    { ranking: { text: NaN } }, { ranking: { text: Infinity } }, { ranking: { text: -0.1 } },
    { ranking: { text: 1.1 } }, { ranking: { text: 1, usage: 2 } }, { ranking: { text: 1, visual: 0.5 } },
    { ranking: { text: 1, invented: 0.5 } }, { compatibility: { status: 'verified', recordIds: [] } },
    { compatibility: { status: 'unverified', recordIds: ['fake'] } },
    { compatibility: { status: 'verified', recordIds: ['a', 'a'] } },
    { evidence: [] }, { evidence: [{ kind: 'api', path: '../secret', sha256: 'a'.repeat(64) }] },
    { evidence: [{ kind: 'api', path: 'api.json', sha256: 'a'.repeat(64), source: 'local-automatic' }] },
    { extra: true }, { gaps: [' '] },
  ])('拒绝非法候选 %#', patch => {
    expect(validateCandidate({ ...candidateFixture(), ...patch }).ok).toBe(false);
  });
  it('每个候选同时要求 API 和文档证据，截图必须说明来源', () => {
    const candidate = candidateFixture();
    candidate.evidence.pop();
    expect(validateCandidate(candidate).ok).toBe(false);
    const invalid = candidateFixture();
    invalid.evidence.push({ kind: 'screenshot', path: 'image.png', sha256: 'b'.repeat(64) });
    expect(validateCandidate(invalid).ok).toBe(false);
  });
  it('拒绝重复发布和错误响应，并定位嵌套字段', () => {
    const c = candidateFixture();
    expect(validateSearchCandidatesResponse({ candidates: [c, c], gaps: [] }).ok).toBe(false);
    for (const input of [null, new Date(), { candidates: [], gaps: [], extra: true }]) {
      expect(validateSearchCandidatesResponse(input).ok).toBe(false);
    }
    c.compatibility = { status: 'verified', recordIds: [] };
    const result = validateSearchCandidatesResponse({ candidates: [c], gaps: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toBe('/candidates/0/compatibility/recordIds');
  });
  it('注册可生成的候选与响应 schema', () => {
    expect(CONTRACT_SCHEMAS['candidate-v1']).toMatchObject({ type: 'object', additionalProperties: false });
    expect(CONTRACT_SCHEMAS['search-candidates-response-v1']).toMatchObject({ required: ['candidates', 'gaps'] });
  });
});
