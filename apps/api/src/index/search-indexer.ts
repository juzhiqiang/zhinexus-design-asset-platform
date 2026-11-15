import { validateCandidate } from '@company/contracts';
import type { Database } from '../db/database.js';
import { SEARCH_PROVIDER, searchRevision, searchSelect, searchFrom, type SearchRow } from '../search/current.js';

/** Derived metadata only: never imports or executes published component code. */
export class SearchIndexer {
  constructor(private readonly db: Database) {}
  rebuild(jobId: string): Promise<boolean> { return this.runOnce(jobId, true); }
  async runOnce(jobId?: string, rebuild = false): Promise<boolean> {
    return this.db.transaction(async client => {
      const job = (await client.query<{ job_id: string }>(`SELECT o.job_id FROM release_outbox o
        JOIN release_jobs j ON j.id=o.job_id WHERE j.state='READY' AND ($1::uuid IS NULL OR o.job_id=$1)
        AND (o.state IN ('pending','failed') OR $2) ORDER BY o.search_attempted_at NULLS FIRST,o.created_at,o.job_id
        LIMIT 1 FOR UPDATE OF o SKIP LOCKED`, [jobId ?? null, rebuild])).rows[0];
      if (!job) return false;
      await client.query('SAVEPOINT search_build');
      try {
        const rows = (await client.query<SearchRow>(`${searchSelect} ${searchFrom} WHERE j.id=$1 AND p.state='READY'`, [job.job_id])).rows;
        if (!rows.length) throw new Error('Missing released variants');
        for (const row of rows) {
          const checked = validateCandidate({ variantReleaseId: row.id, variantId: row.variant_id, componentId: row.component_id,
            framework: row.framework, packageName: row.name, packageVersion: row.version, packageSha256: row.sha256,
            exportName: row.metadata.exportName, evidence: [{ kind: 'api', ...row.metadata.api }, { kind: 'docs', ...row.metadata.docs }].map(({kind,path,sha256}) => ({kind,path,sha256})),
            compatibility: { status: 'unverified', recordIds: [] }, ranking: { text: 0 }, gaps: [] });
          if (!checked.ok || row.package_metadata.tarball.sha256 !== row.sha256) throw new Error('Invalid released metadata');
          const body = [row.component_id,row.variant_id,row.metadata.exportName,row.name,row.category].join(' ');
          await client.query(`INSERT INTO search_documents(variant_release_id,revision,provider_version,body) VALUES ($1,$2,$3,$4)
            ON CONFLICT(variant_release_id) DO UPDATE SET revision=EXCLUDED.revision,provider_version=EXCLUDED.provider_version,
            body=EXCLUDED.body,indexed_at=now()`, [row.id, searchRevision(row), SEARCH_PROVIDER, body]);
        }
        await client.query("UPDATE release_outbox SET state='indexed',search_attempted_at=now() WHERE job_id=$1", [job.job_id]);
        await client.query('RELEASE SAVEPOINT search_build');
      } catch {
        await client.query('ROLLBACK TO SAVEPOINT search_build');
        await client.query("UPDATE release_outbox SET state='failed',search_attempted_at=now() WHERE job_id=$1", [job.job_id]);
      }
      return true;
    });
  }
}
