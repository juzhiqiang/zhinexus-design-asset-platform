import React from 'react';
import type { Candidate, SearchCandidatesResponse } from '@company/contracts';

/**
 * 二期 B2：候选响应纯展示组件。
 *
 * 边界（与 `2026-11-15-phase2-candidates.md` B2 一致）：
 * - **纯展示**：仅渲染已通过契约校验的 `SearchCandidatesResponse`，不做任何请求、不持久化、
 *   不构造证据 URL；证据路径一律以纯文本展示，不生成可点击存储地址或预览链接；
 * - 本批**不挂载**到在线 `/match`，接入真实检索服务时再统一接线与升版；
 * - 不自行推断任何字段：缺省评分不补 0，来源只取证据自带 `source`，兼容只取契约 `status`；
 * - 文本/用途/视觉评分分开展示，**不**合并为单一「相似度」，也不用评分冒充兼容证明。
 *
 * 展示契约由 `tests/gallery/candidate-results.test.ts` 固定（根 `#candidate-results`、
 * 空态 `#candidate-empty`「暂无候选」、每候选 `.candidate-card`、「文本评分」必显、
 * 「用途评分」/「视觉评分」仅在有值时显，缺 visual 显「未提供视觉评分」）。
 *
 * 说明：B2 允许改动范围不含 CSS 文件，故沿用语义类名 + 控制台既有行内样式约定；
 * 样式细化留给后续接入批（随组件挂载与画廊样式统一处理）。
 */

const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 20 };
const cardStyle: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20,
  display: 'flex', flexDirection: 'column', gap: 12,
};
const rowStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline' };
const nameStyle: React.CSSProperties = { fontSize: 18, fontWeight: 700, color: '#0f172a' };
const metaStyle: React.CSSProperties = { fontSize: 12, color: '#64748b', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#475569' };
const pathStyle: React.CSSProperties = { fontSize: 12, color: '#334155', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all' };
const emptyStyle: React.CSSProperties = {
  margin: 0, padding: 32, textAlign: 'center', color: '#64748b', fontSize: 14,
  background: '#ffffff', border: '1px dashed #cbd5e1', borderRadius: 12,
};

function CandidateCard({ candidate }: { candidate: Candidate }) {
  const verified = candidate.compatibility.status === 'verified';
  return (
    <li className="candidate-card" style={cardStyle}>
      <div style={rowStyle}>
        <span style={nameStyle}>{candidate.exportName}</span>
        <span style={metaStyle}>{`${candidate.packageName}@${candidate.packageVersion}`}</span>
        <span className={`tag tag-framework-${candidate.framework}`} style={{ fontSize: 11 }}>
          {candidate.framework === 'vue' ? 'Vue' : 'React'}
        </span>
      </div>

      <div style={{ ...rowStyle, fontSize: 12, color: '#64748b' }}>
        <span>{`组件：${candidate.componentId}`}</span>
        <span>{`实现：${candidate.variantId}`}</span>
        <span>{`发布：${candidate.variantReleaseId}`}</span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline', fontSize: 13 }}>
        <span className={verified ? 'tag tag-ready' : 'tag'}>
          {verified ? '已验证' : '未验证'}
        </span>
        {verified && candidate.compatibility.recordIds.length > 0 && (
          <span style={{ fontSize: 12, color: '#475569' }}>
            {`记录：${candidate.compatibility.recordIds.join('、')}`}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={labelStyle}>证据</span>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {candidate.evidence.map((item, index) => (
            <li key={`${index}-${item.path}`} style={{ fontSize: 12, color: '#475569' }}>
              <span style={labelStyle}>{`${item.kind}：`}</span>
              <span style={pathStyle}>{item.path}</span>
              {item.source ? <span style={{ ...pathStyle, marginLeft: 8 }}>{`（来源：${item.source}）`}</span> : null}
            </li>
          ))}
        </ul>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 13, color: '#334155' }}>
        <span>{`文本评分：${candidate.ranking.text}`}</span>
        {candidate.ranking.usage !== undefined ? <span>{`用途评分：${candidate.ranking.usage}`}</span> : null}
        {candidate.ranking.visual !== undefined ? (
          <span>{`视觉评分：${candidate.ranking.visual}`}</span>
        ) : (
          <span style={{ color: '#92400e' }}>未提供视觉评分</span>
        )}
      </div>

      {candidate.gaps.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>缺口</span>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {candidate.gaps.map((gap, index) => (
              <li key={`${index}-${gap}`} style={{ fontSize: 12, color: '#991b1b' }}>{gap}</li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

export function CandidateResults({ response }: { response: SearchCandidatesResponse }) {
  return (
    <section id="candidate-results" className="candidate-results" style={sectionStyle}>
      {response.candidates.length === 0 ? (
        <p id="candidate-empty" className="candidate-empty" style={emptyStyle}>
          暂无候选
        </p>
      ) : (
        <ol className="candidate-list" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {response.candidates.map((candidate) => (
            <CandidateCard key={candidate.variantReleaseId} candidate={candidate} />
          ))}
        </ol>
      )}

      {response.gaps.length > 0 && (
        <div id="candidate-response-gaps" className="candidate-gaps" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>整体缺口</span>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {response.gaps.map((gap, index) => (
              <li key={`${index}-${gap}`} style={{ fontSize: 12, color: '#991b1b' }}>{gap}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
