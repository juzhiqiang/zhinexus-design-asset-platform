import { validateSearchCandidatesRequest, type SearchCandidatesResponse } from '@company/contracts';
import type { Database } from '../db/database.js';
import { PlatformError } from '../errors.js';
import { filterEligibleCandidates, type IndexedCandidateHit } from './eligibility.js';
import { loadCurrentCandidates, SEARCH_PROVIDER, searchFrom } from './current.js';

export class SearchService {
  constructor(private readonly db: Database) {}
  async search(input: unknown, subject: string): Promise<SearchCandidatesResponse> {
    const checked = validateSearchCandidatesRequest(input);
    if (!checked.ok) throw new PlatformError('INVALID_SCHEMA', checked.issues);
    const { query, context, reactDomVersion } = checked.value;
    const rows = (await this.db.query<{ id: string; revision: string; provider_version: string; score: number }>(`
      SELECT vr.id,d.revision,d.provider_version,
        GREATEST(ts_rank_cd(d.document,plainto_tsquery('simple',$1),32),0.01)::float8 AS score
      ${searchFrom} JOIN search_documents d ON d.variant_release_id=vr.id JOIN release_outbox o ON o.job_id=j.id
      WHERE p.state='READY' AND j.state='READY' AND vr.availability='Ready' AND catalog_can_read(c.id,$2)
        AND v.framework=$3 AND o.state='indexed' AND d.provider_version=$4
        AND (d.document @@ plainto_tsquery('simple',$1) OR strpos(lower(d.body),lower($1))>0)
      ORDER BY score DESC,vr.id LIMIT 50`, [query.trim(), subject, context.framework, SEARCH_PROVIDER])).rows;
    const hits: IndexedCandidateHit[] = rows.map(row => ({ variantReleaseId: row.id, revision: row.revision, providerVersion: row.provider_version, ranking: { text: row.score } }));
    const peers: Record<string, string> = reactDomVersion ? { 'react-dom': reactDomVersion } : {};
    const initial = await loadCurrentCandidates(this.db, rows.map(row => row.id), subject);
    const eligible = await filterEligibleCandidates(context, hits, async id => initial.get(id) ?? null, peers);
    const eligibleIds = new Set(eligible.candidates.map(candidate => candidate.variantReleaseId));
    // Final batched authority read: all candidates share the same statement snapshot.
    const current = await loadCurrentCandidates(this.db, [...eligibleIds], subject);
    const result = await filterEligibleCandidates(context, hits.filter(hit => eligibleIds.has(hit.variantReleaseId)), async id => current.get(id) ?? null, peers);
    result.gaps.push('当前仅检索已发布元数据；未提供用途或视觉评分，需求语义尚未评估');
    if (rows.length === 50) result.gaps.push('本次仅检查前 50 个文本命中，结果可能不完整');
    return result;
  }
}
