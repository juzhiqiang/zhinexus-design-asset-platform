import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import type { Candidate, SearchCandidatesResponse } from '@company/contracts';
import { candidateFixture } from '../fixtures/search.js';
import { parseCandidateResults } from '../../apps/admin/app/lib/candidate-results.js';
import { CandidateResults } from '../../apps/admin/app/match/CandidateResults.js';

// React runtime belongs to gallery; resolve from its declared dependency boundary.
const galleryRequire = createRequire(new URL('../../apps/gallery/package.json', import.meta.url));
const { createElement } = galleryRequire('react') as typeof import('react');
const { renderToStaticMarkup } = galleryRequire('react-dom/server') as typeof import('react-dom/server');

/**
 * 二期 B2：候选响应解析与纯展示组件测试（初期为 RED 基线，两实现文件当时尚未创建）。
 *
 * 约定（与 `2026-11-15-phase2-candidates.md` B2 一致）：
 * - `parseCandidateResults(input: unknown)` 位于 `apps/gallery/app/lib/candidate-results.ts`，
 *   直接复用 `@company/contracts` 的 `validateSearchCandidatesResponse`，
 *   返回既有 `ValidationResult<SearchCandidatesResponse>`，**不抛原始异常**；
 * - `CandidateResults({ response })` 位于 `apps/gallery/app/(console)/match/CandidateResults.tsx`，纯展示；
 * - 复用 `tests/fixtures/search.ts` 的 `candidateFixture()` 与 `@company/contracts` 类型，不自定义公共 DTO；
 * - 本组件**不挂载**到在线 `/match`，不发请求、不持久化、不构造证据 URL；证据路径仅以文本展示。
 *
 * 展示契约（由本测试固定，实现须逐字满足）：
 * - 根元素 `#candidate-results`；空数组输出 `#candidate-empty` 且包含「暂无候选」；
 * - 每个候选一张 `.candidate-card`，含 `packageName@packageVersion`、框架、`exportName`；
 * - 兼容：`verified` → 「已验证」并列出 recordIds；`unverified` → 「未验证」；
 * - 证据：以文本展示 path；截图证据附来源（`manual-upload` / `local-automatic`）；
 * - 评分独立分栏：文本评分必显示；`usage` 存在才显示「用途评分」；`visual` 存在才显示「视觉评分」，
 *   否则显示「未提供视觉评分」；不得把缺省分数补 0，不得合并为单一相似度；
 * - 候选级与响应级 `gaps` 均展示；全部文本按 HTML 转义，不出现可点击存储地址或预览链接。
 *
 * 测试清单（实现后应全部转 GREEN）：
 *   parseCandidateResults：保真返回 / 空数组 / 重复 releaseId / 伪 verified / unverified 夹带记录 /
 *     重复 recordIds / 缺 api 证据 / 缺 docs 证据 / 截图缺 source / 非截图夹带 source /
 *     visual 无截图证据 / 范围版本 / 分数越界 / 未知字段 / 不推导缺省分数 / 非法输入不抛异常
 *   CandidateResults：空态 / 精确版本与框架 / 证据路径与来源 / 已验证与未验证 / 独立评分与未提供视觉评分 /
 *     候选级与响应级 gaps / HTML 转义 / 无链接无请求
 *
 * TDD 记录：实现文件缺失时本文件因无法解析导入而失败（RED）；由 C 在宿主确认 RED 后再实现转 GREEN。
 */

const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return { ...candidateFixture(), ...overrides };
}

function response(candidates: Candidate[], gaps: string[] = []): SearchCandidatesResponse {
  return { candidates, gaps };
}

function render(response: SearchCandidatesResponse): string {
  return renderToStaticMarkup(createElement(CandidateResults, { response }));
}

describe('parseCandidateResults（复用契约 validateSearchCandidatesResponse）', () => {
  it('接受合法响应并原样保留真实字段，不改写、不补默认值', () => {
    const fixture = candidate();
    const result = parseCandidateResults(response([fixture]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.candidates).toHaveLength(1);
      expect(result.value.candidates[0]).toEqual(fixture);
      expect(result.value.gaps).toEqual([]);
    }
  });

  it('空 candidates 数组与空 gaps 通过校验（供诚实空态使用）', () => {
    const result = parseCandidateResults(response([]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.candidates).toEqual([]);
      expect(result.value.gaps).toEqual([]);
    }
  });

  it('拒绝重复 variantReleaseId', () => {
    const result = parseCandidateResults(response([candidate(), candidate()]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'DUPLICATE_ID')).toBe(true);
    }
  });

  it('拒绝伪 verified（verified 无 recordIds）', () => {
    const forged = candidate({ compatibility: { status: 'verified', recordIds: [] } });
    const result = parseCandidateResults(response([forged]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.path.includes('/compatibility'))).toBe(true);
    }
  });

  it('拒绝 unverified 夹带 recordIds', () => {
    const smuggled = candidate({ compatibility: { status: 'unverified', recordIds: ['rec-1'] } });
    const result = parseCandidateResults(response([smuggled]));
    expect(result.ok).toBe(false);
  });

  it('拒绝重复 recordIds', () => {
    const dup = candidate({
      compatibility: { status: 'verified', recordIds: ['rec-1', 'rec-1'] },
      evidence: [
        { kind: 'api', path: 'api/line.json', sha256: SHA_B },
        { kind: 'docs', path: 'docs/line.md', sha256: SHA_C },
      ],
    });
    const result = parseCandidateResults(response([dup]));
    expect(result.ok).toBe(false);
  });

  it('拒绝缺少 api 或 docs 证据', () => {
    const noApi = candidate({
      evidence: [{ kind: 'docs', path: 'docs/line.md', sha256: SHA_C }],
    });
    const noDocs = candidate({
      evidence: [{ kind: 'api', path: 'api/line.json', sha256: SHA_B }],
    });
    expect(parseCandidateResults(response([noApi])).ok).toBe(false);
    expect(parseCandidateResults(response([noDocs])).ok).toBe(false);
  });

  it('拒绝截图证据缺 source、非截图证据夹带 source', () => {
    const shotNoSource = candidate({
      evidence: [
        { kind: 'api', path: 'api/line.json', sha256: SHA_B },
        { kind: 'docs', path: 'docs/line.md', sha256: SHA_C },
        { kind: 'screenshot', path: 'screenshots/line.png', sha256: SHA_D },
      ],
    });
    const apiWithSource = candidate({
      evidence: [
        { kind: 'api', path: 'api/line.json', sha256: SHA_B, source: 'manual-upload' },
        { kind: 'docs', path: 'docs/line.md', sha256: SHA_C },
      ],
    });
    expect(parseCandidateResults(response([shotNoSource])).ok).toBe(false);
    expect(parseCandidateResults(response([apiWithSource])).ok).toBe(false);
  });

  it('拒绝 visual 评分存在但无截图证据', () => {
    const visualNoShot = candidate({ ranking: { text: 0.5, visual: 0.9 } });
    const result = parseCandidateResults(response([visualNoShot]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.path.includes('/ranking/visual'))).toBe(true);
    }
  });

  it('接受 visual 评分且有截图证据', () => {
    const visualWithShot = candidate({
      evidence: [
        { kind: 'api', path: 'api/line.json', sha256: SHA_B },
        { kind: 'docs', path: 'docs/line.md', sha256: SHA_C },
        { kind: 'screenshot', path: 'screenshots/line.png', sha256: SHA_D, source: 'manual-upload' },
      ],
      ranking: { text: 0.5, usage: 0.4, visual: 0.9 },
    });
    const result = parseCandidateResults(response([visualWithShot]));
    expect(result.ok).toBe(true);
  });

  it('拒绝范围版本与非法摘要', () => {
    const range = candidate({ packageVersion: '^0.1.0' });
    const badSha = candidate({ packageSha256: 'not-a-hash' });
    expect(parseCandidateResults(response([range])).ok).toBe(false);
    expect(parseCandidateResults(response([badSha])).ok).toBe(false);
  });

  it('拒绝越界或非有限分数', () => {
    const tooHigh = candidate({ ranking: { text: 1.5 } });
    const nan = candidate({ ranking: { text: Number.NaN } });
    expect(parseCandidateResults(response([tooHigh])).ok).toBe(false);
    expect(parseCandidateResults(response([nan])).ok).toBe(false);
  });

  it('拒绝未知字段', () => {
    const unknown = { ...candidate(), surprise: 'x' } as unknown as Candidate;
    const result = parseCandidateResults(response([unknown]));
    expect(result.ok).toBe(false);
  });

  it('不推导缺省分数：usage/visual 省略时返回值不含这些键', () => {
    const result = parseCandidateResults(response([candidate({ ranking: { text: 0.8 } })]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ranking = result.value.candidates[0]!.ranking as Record<string, unknown>;
      expect(ranking.text).toBe(0.8);
      expect(Object.prototype.hasOwnProperty.call(ranking, 'usage')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(ranking, 'visual')).toBe(false);
    }
  });

  it('非法输入返回 ok:false 而不抛原始异常', () => {
    for (const bad of [null, undefined, 'text', 42, [], { candidates: 'x' }, { candidates: [], gaps: 'x' }]) {
      let result: ReturnType<typeof parseCandidateResults> | undefined;
      expect(() => { result = parseCandidateResults(bad); }).not.toThrow();
      expect(result?.ok).toBe(false);
    }
  });
});

describe('CandidateResults（纯展示，静态 renderToStaticMarkup）', () => {
  it('框架标签只展示响应提供的框架，不猜测框架主版本', () => {
    for (const framework of ['react', 'vue'] as const) {
      const html = render(response([candidate({ framework })]));
      expect(html).toContain(framework === 'react' ? '>React<' : '>Vue<');
      expect(html).not.toContain(framework === 'react' ? '>React 19<' : '>Vue 3<');
    }
  });
  it('空 candidates 输出诚实空态，不虚构候选', () => {
    const html = render(response([]));
    expect(html).toContain('id="candidate-results"');
    expect(html).toContain('id="candidate-empty"');
    expect(html).toContain('暂无候选');
    expect(html).not.toContain('class="candidate-card"');
  });

  it('展示精确包版本、框架与导出名', () => {
    const html = render(response([candidate()]));
    expect(html).toContain('@company/charts-react@0.1.0');
    expect(html).toContain('react');
    expect(html).toContain('LineChart');
    expect(html).toContain('class="candidate-card"');
  });

  it('以文本展示真实证据路径，截图证据附来源', () => {
    const withShot = candidate({
      evidence: [
        { kind: 'api', path: 'api/line.json', sha256: SHA_B },
        { kind: 'docs', path: 'docs/line.md', sha256: SHA_C },
        { kind: 'screenshot', path: 'screenshots/line.png', sha256: SHA_D, source: 'manual-upload' },
      ],
    });
    const html = render(response([withShot]));
    expect(html).toContain('api/line.json');
    expect(html).toContain('docs/line.md');
    expect(html).toContain('screenshots/line.png');
    expect(html).toContain('manual-upload');
  });

  it('区分已验证与未验证，verified 列出 recordIds', () => {
    const verified = candidate({
      compatibility: { status: 'verified', recordIds: ['rec-42'] },
    });
    const unverified = candidate({ compatibility: { status: 'unverified', recordIds: [] } });
    const verifiedHtml = render(response([verified]));
    expect(verifiedHtml).toContain('已验证');
    expect(verifiedHtml).toContain('rec-42');
    expect(render(response([unverified]))).toContain('未验证');
  });

  it('独立评分分栏，缺 visual 显示「未提供视觉评分」', () => {
    const textOnly = render(response([candidate({ ranking: { text: 0.8 } })]));
    expect(textOnly).toContain('文本评分');
    expect(textOnly).toContain('0.8');
    expect(textOnly).toContain('未提供视觉评分');
    expect(textOnly).not.toContain('用途评分');

    const full = render(response([candidate({
      evidence: [
        { kind: 'api', path: 'api/line.json', sha256: SHA_B },
        { kind: 'docs', path: 'docs/line.md', sha256: SHA_C },
        { kind: 'screenshot', path: 'screenshots/line.png', sha256: SHA_D, source: 'local-automatic' },
      ],
      ranking: { text: 0.8, usage: 0.4, visual: 0.9 },
    })]));
    expect(full).toContain('用途评分');
    expect(full).toContain('0.4');
    expect(full).toContain('视觉评分');
    expect(full).toContain('0.9');
    expect(full).not.toContain('未提供视觉评分');
  });

  it('展示候选级与响应级 gaps', () => {
    const html = render(
      response([candidate({ gaps: ['缺少 React 19 peer 声明'] })], ['索引可能过期']),
    );
    expect(html).toContain('缺少 React 19 peer 声明');
    expect(html).toContain('索引可能过期');
  });

  it('按 HTML 转义文本，不泄露原始标签', () => {
    const hostile = candidate({ gaps: ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>'] });
    const html = render(response([hostile], ['</div><script>alert(2)</script>']));
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<script>alert(2)');
    expect(html).toContain('&lt;script&gt;');
  });

  it('不生成可点击存储地址或预览链接，也不外发请求', () => {
    const withShot = candidate({
      evidence: [
        { kind: 'api', path: 'api/line.json', sha256: SHA_B },
        { kind: 'docs', path: 'docs/line.md', sha256: SHA_C },
        { kind: 'screenshot', path: 'screenshots/line.png', sha256: SHA_D, source: 'manual-upload' },
      ],
    });
    const html = render(response([withShot]));
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
  });
});
