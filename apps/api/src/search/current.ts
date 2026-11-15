import { createHash } from 'node:crypto';
import { canonicalJson, type PackageRef, type VariantRef, type AcceptedCompatibilityRecord, type ReleaseState } from '@company/contracts';
import type { Sql } from '../db/access.js';
import type { CurrentCandidateSnapshot } from './eligibility.js';

export const SEARCH_PROVIDER = 'metadata-text-v1';
export type SearchRow = {
  id: string; variant_id: string; component_id: string; framework: 'vue'|'react'; category: string;
  name: string; version: string; sha256: string; metadata: VariantRef; package_metadata: PackageRef;
  availability: 'PENDING'|'Ready'|'DEPRECATED'; package_state: ReleaseState; job_state: ReleaseState;
};
export const searchSelect = `SELECT vr.id,vr.variant_id,v.component_id,v.framework,c.category,
  p.name,p.version,p.sha256,vr.metadata,p.metadata AS package_metadata,vr.availability,
  p.state AS package_state,j.state AS job_state`;
export const searchFrom = `FROM variant_releases vr JOIN variants v ON v.id=vr.variant_id
  JOIN components c ON c.id=v.component_id JOIN package_releases p ON p.id=vr.package_release_id
  JOIN release_jobs j ON j.id=p.job_id`;
export function searchRevision(row: SearchRow): string {
  return createHash('sha256').update(canonicalJson({ id: row.id, variantId: row.variant_id, componentId: row.component_id,
    framework: row.framework, category: row.category, name: row.name, version: row.version, sha256: row.sha256,
    variant: row.metadata, package: row.package_metadata })).digest('hex');
}

/** One SQL statement provides one current snapshot across all returned candidates. */
export async function loadCurrentCandidates(sql: Sql, ids: string[], subject: string): Promise<Map<string, CurrentCandidateSnapshot>> {
  type Row = SearchRow & { can_read: boolean; index_state: string; index_revision: string; provider_version: string; accepted: AcceptedCompatibilityRecord[] };
  const rows = (await sql.query<Row>(`${searchSelect}, catalog_can_read(c.id,$2) AS can_read,
    o.state AS index_state,d.revision AS index_revision,d.provider_version,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'compatibilityId',e.id,'variantReleaseId',e.variant_release_id,'packageName',e.package_name,
      'packageVersion',e.package_version,'packageSha256',e.package_sha256,'framework',e.framework,
      'frameworkVersion',e.framework_version,'echartsVersion',e.echarts_version,
      'candidateIntegrity',e.candidate_integrity,'candidateSource',e.candidate_source,'status',e.status,
      'evidenceSha256',e.evidence_sha256,'createdAt',to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY e.id)
      FROM compatibility_evidences e WHERE e.variant_release_id=vr.id),'[]'::jsonb) AS accepted
    ${searchFrom} LEFT JOIN search_documents d ON d.variant_release_id=vr.id
    LEFT JOIN release_outbox o ON o.job_id=j.id WHERE vr.id=ANY($1::uuid[])`, [ids, subject])).rows;
  return new Map(rows.map(row => [row.id, {
    canRead: row.can_read, availability: row.availability === 'PENDING' ? 'Pending' : row.availability,
    packageState: row.package_state, jobState: row.job_state, revision: searchRevision(row), activeProviderVersion: SEARCH_PROVIDER,
    index: { state: row.index_state === 'indexed' ? 'ready' : row.index_state === 'failed' ? 'failed' : 'pending', revision: row.index_revision, providerVersion: row.provider_version },
    peerDependencies: row.package_metadata.peerDependencies, acceptedCompatibility: row.accepted,
    candidate: { variantReleaseId: row.id, variantId: row.variant_id, componentId: row.component_id, framework: row.framework,
      packageName: row.name, packageVersion: row.version, packageSha256: row.sha256, exportName: row.metadata.exportName,
      evidence: [{ kind: 'api', path: row.metadata.api.path, sha256: row.metadata.api.sha256 },
        { kind: 'docs', path: row.metadata.docs.path, sha256: row.metadata.docs.sha256 },
        ...row.metadata.screenshots.map(s => ({ kind: 'screenshot' as const, path: s.image.path, sha256: s.image.sha256, source: s.source }))], gaps: [] },
  }]));
}
