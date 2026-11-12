import { createHash } from 'node:crypto';
import { validateApiMessage, type ApiMessages, type VariantRef, type PackageRef, type ArtifactRef, type CheckReportV1 } from '@company/contracts';
import type { Database } from '../db/database.js';
import type { ArtifactStore } from '../storage/artifact-store.js';
import { PlatformError } from '../errors.js';
import { compareVersions } from '../releases/version-order.js';
import { uuid } from '../db/access.js';

export type CatalogTarget = { releaseId: string } | { variantId: string; version: string };

type Row = { id: string; variant_id: string; component_id: string; framework: 'vue'|'react'; version: string; name: string;
  metadata: VariantRef; package_metadata: PackageRef; availability: 'Ready'|'DEPRECATED'; job_id: string };
const select = `SELECT vr.id,vr.variant_id,v.component_id,v.framework,p.name,p.version,vr.metadata,
  p.metadata AS package_metadata,vr.availability,p.job_id FROM variant_releases vr
  JOIN variants v ON v.id=vr.variant_id JOIN components c ON c.id=v.component_id
  JOIN package_releases p ON p.id=vr.package_release_id JOIN release_jobs j ON j.id=p.job_id`;
const ready = "p.state='READY' AND j.state='READY'";

export class CatalogService {
  constructor(private readonly db: Database, private readonly store?: ArtifactStore) {}
  async list(input: unknown, subject: string | null = null): Promise<ApiMessages['componentsResponse']> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PlatformError('INVALID_SCHEMA');
    const query = { ...input } as Record<string, unknown>;
    for (const name of ['page', 'pageSize']) if (typeof query[name] === 'string' && /^[1-9][0-9]*$/.test(query[name])) query[name] = Number(query[name]);
    const checked = validateApiMessage('componentsQuery', query);
    if (!checked.ok) throw new PlatformError('INVALID_SCHEMA', checked.issues);
    const { page = 1, pageSize = 20, framework, category, query: text } = checked.value;
    if (!Number.isSafeInteger(page) || (text?.length ?? 0) > 256 || (category?.length ?? 0) > 128) throw new PlatformError('INVALID_SCHEMA');
    const result = await this.db.query<Row>(`${select} WHERE ${ready} AND vr.availability='Ready' AND catalog_can_read(c.id,$1)
      AND ($2::text IS NULL OR v.framework=$2) AND ($3::text IS NULL OR c.category=$3)
      AND ($4::text IS NULL OR strpos(lower(c.id),lower($4))>0 OR strpos(lower(vr.metadata->>'exportName'),lower($4))>0)
      ORDER BY c.id COLLATE "C",v.id COLLATE "C",p.name COLLATE "C"`, [subject, framework ?? null, category ?? null, text ?? null]);
    const latest = new Map<string, Row>();
    for (const row of result.rows) {
      const old = latest.get(row.variant_id);
      if (!old || compareVersions(row.version, old.version) > 0) latest.set(row.variant_id, row);
    }
    const components = new Map<string, ApiMessages['componentsResponse']['items'][number]>();
    for (const row of latest.values()) {
      let component = components.get(row.component_id);
      if (!component) { component = { componentId: row.component_id, variants: [] }; components.set(row.component_id, component); }
      component.variants.push({ variantReleaseId: row.id, variantId: row.variant_id, framework: row.framework, packageName: row.name, packageVersion: row.version });
    }
    const items = [...components.values()];
    return { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: items.length };
  }
  async find(target: CatalogTarget, subject: string | null = null): Promise<Row> {
    if ('variantId' in target && (target.variantId.length > 128 || target.version.length > 128)) throw new PlatformError('NOT_FOUND');
    const rows = (await this.db.query<Row>(`${select} WHERE ${ready} AND vr.availability IN ('Ready','DEPRECATED')
      AND ($1::uuid IS NULL OR vr.id=$1) AND ($2::text IS NULL OR vr.variant_id=$2) AND ($3::text IS NULL OR p.version=$3)
      AND catalog_can_read(c.id,$4)`, ['releaseId' in target ? uuid(target.releaseId) : null,
      'variantId' in target ? target.variantId : null, 'version' in target ? target.version : null, subject])).rows;
    if (rows.length > 1) throw new PlatformError('CONFLICT');
    const row = rows[0];
    if (!row) throw new PlatformError('NOT_FOUND', [], subject !== null);
    return row;
  }
  async detail(target: CatalogTarget, subject: string | null = null): Promise<ApiMessages['variantReleaseResponse']> {
    const row = await this.find(target, subject);
    const screenshots = (await this.db.query<{ source: string; accepted: boolean }>(`SELECT s.source,
      EXISTS (SELECT 1 FROM baseline_heads h JOIN baseline_revisions b ON b.id=h.revision_id
        WHERE b.screenshot_id=s.id AND h.variant_id=$2 AND h.example_id=s.example_id AND h.environment_key=s.environment_key) AS accepted
      FROM screenshots s WHERE s.variant_release_id=$1`, [row.id, row.variant_id])).rows;
    const incompatible = (await this.db.query(`SELECT 1 FROM check_reports WHERE job_id=$1 AND variant_id=$2 AND content->>'baselineResult'='INCOMPATIBLE' LIMIT 1`, [row.job_id, row.variant_id])).rowCount;
    const outbox = (await this.db.query<{ state: ApiMessages['variantReleaseResponse']['indexStatus'] }>('SELECT state FROM release_outbox WHERE job_id=$1', [row.job_id])).rows[0];
    await this.find({ releaseId: row.id }, subject);
    return { variantReleaseId: row.id, variant: row.metadata, package: row.package_metadata, availability: row.availability,
      reportSource: screenshots.some(s => s.source === 'manual-upload') ? 'manual-upload' : screenshots.length ? 'local-automatic' : 'none',
      baselineStatus: screenshots.length && screenshots.every(s => s.source === 'local-automatic' && s.accepted) ? 'accepted' : incompatible ? 'incompatible' : 'unconfirmed',
      indexStatus: outbox?.state ?? 'pending' };
  }
  async artifact(target: CatalogTarget, path: unknown, subject: string | null = null): Promise<{ bytes: Uint8Array; mime: string }> {
    const row = await this.find(target, subject);
    if (typeof path !== 'string') throw new PlatformError('NOT_FOUND');
    const variant = row.metadata;
    const refs: { ref: ArtifactRef; mime: string }[] = [
      { ref: variant.docs, mime: 'text/plain; charset=utf-8' }, { ref: variant.api, mime: 'application/json; charset=utf-8' },
      ...variant.screenshots.map(s => ({ ref: s.image, mime: s.image.path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg' })),
    ];
    const found = refs.find(item => item.ref.path === path);
    if (!found) throw new PlatformError('NOT_FOUND');
    if (!this.store) throw new PlatformError('INFRA_UNAVAILABLE');
    const saved = (await this.db.query('SELECT object_key,sha256,bytes FROM release_artifacts WHERE job_id=$1 AND path=$2', [row.job_id, path])).rows[0];
    if (!saved || saved.object_key !== `releases/${row.job_id}/${path}` || saved.sha256 !== found.ref.sha256 || Number(saved.bytes) !== found.ref.bytes) throw new PlatformError('NOT_FOUND');
    const bytes = await this.store.read(saved.object_key, found.ref.bytes);
    if (createHash('sha256').update(bytes).digest('hex') !== found.ref.sha256) throw new PlatformError('DIGEST_MISMATCH');
    await this.find({ releaseId: row.id }, subject);
    return { bytes, mime: found.mime };
  }
  async reports(target: CatalogTarget, subject: string | null = null): Promise<ApiMessages['variantReportsResponse']> {
    const row = await this.find(target, subject);
    const reports = (await this.db.query<{ content: CheckReportV1 }>('SELECT content FROM check_reports WHERE job_id=$1 AND variant_id=$2 ORDER BY client_ref', [row.job_id, row.variant_id])).rows.map(r => r.content);
    await this.find({ releaseId: row.id }, subject);
    return { variantReleaseId: row.id, reports };
  }
}
