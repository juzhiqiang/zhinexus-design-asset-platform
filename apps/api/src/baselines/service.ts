import { randomUUID } from 'node:crypto';
import { environmentKey, validateApiMessage, validateCheckReport, type ApiMessages } from '@company/contracts';
import type { Database } from '../db/database.js';
import { audit, requireComponents, uuid, type RequestContext } from '../db/access.js';
import { PlatformError } from '../errors.js';

export class BaselineService {
  constructor(private readonly db: Database) {}
  async accept(input: unknown, context: RequestContext): Promise<ApiMessages['createBaselineResponse']> {
    const checked = validateApiMessage('createBaselineRequest', input);
    if (!checked.ok) throw new PlatformError('INVALID_SCHEMA', checked.issues);
    const value = checked.value;
    if (!value.reason.trim() || value.reason.length > 2000) throw new PlatformError('INVALID_SCHEMA');
    return this.db.transaction(async client => {
      const variant = (await client.query('SELECT component_id FROM variants WHERE id=$1', [value.variantId])).rows[0];
      if (!variant) throw new PlatformError('NOT_FOUND');
      await requireComponents(client, context.principal.subject, [variant.component_id], true);
      const select = `SELECT s.*,vr.variant_id,pr.sha256 AS package_sha256,r.content AS report
        FROM screenshots s JOIN variant_releases vr ON vr.id=s.variant_release_id
        JOIN package_releases pr ON pr.id=vr.package_release_id
        LEFT JOIN check_reports r ON r.id=s.report_id`;
      const serverId = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.screenshotId) ? value.screenshotId : null;
      let shot = (await client.query(`${select} WHERE s.id=$1`, [serverId])).rows[0];
      if (!shot) {
        // Legacy references may only resolve inside this authorized variant/example.
        const references = (await client.query(`${select} WHERE s.client_ref=$1 AND vr.variant_id=$2 AND s.example_id=$3`,
          [value.screenshotId, value.variantId, value.exampleId])).rows;
        const matching = references.filter(row => row.environment_key === value.environmentKey);
        if (matching.length > 1) throw new PlatformError('CONFLICT');
        shot = matching[0];
        if (!shot && references.some(row => row.source !== 'local-automatic' || row.environment_key === 'unknown-manual')) throw new PlatformError('SOURCE_FORBIDDEN');
        if (!shot && references.length) throw new PlatformError('SCREENSHOT_VARIANT_MISMATCH');
      }
      if (!shot) throw new PlatformError('NOT_FOUND');
      if (shot.source !== 'local-automatic' || shot.environment_key === 'unknown-manual') throw new PlatformError('SOURCE_FORBIDDEN');
      if (shot.variant_id !== value.variantId || shot.example_id !== value.exampleId || shot.environment_key !== value.environmentKey) throw new PlatformError('SCREENSHOT_VARIANT_MISMATCH');
      const report = validateCheckReport(shot.report);
      if (!report.ok || !report.value.checks.length || report.value.checks.some(check => check.status !== 'passed') ||
        report.value.baselineResult === 'INCOMPATIBLE' || report.value.variantId !== value.variantId || report.value.exampleId !== value.exampleId ||
        report.value.packageSha256 !== shot.package_sha256 || await environmentKey(report.value.environment) !== value.environmentKey ||
        !report.value.screenshots.some(screenshot => screenshot.id === shot.client_ref && screenshot.image.sha256 === shot.sha256 &&
          screenshot.variantId === value.variantId && screenshot.exampleId === value.exampleId && screenshot.source === 'local-automatic' && screenshot.environmentKey === value.environmentKey)) throw new PlatformError('REPORT_MISMATCH');
      const key = [value.variantId, value.exampleId, value.environmentKey];
      await client.query('INSERT INTO baseline_heads(variant_id,example_id,environment_key) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', key);
      const head = (await client.query('SELECT revision_id FROM baseline_heads WHERE variant_id=$1 AND example_id=$2 AND environment_key=$3 FOR UPDATE', key)).rows[0]!;
      if (head.revision_id !== (value.expectedRevision ?? null)) throw new PlatformError('CONFLICT');
      const revisionId = randomUUID();
      await client.query('INSERT INTO baseline_revisions(id,variant_id,example_id,environment_key,screenshot_id,parent_revision,reason,subject) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [revisionId, ...key, shot.id, head.revision_id, value.reason.trim(), context.principal.subject]);
      await client.query('UPDATE baseline_heads SET revision_id=$4 WHERE variant_id=$1 AND example_id=$2 AND environment_key=$3', [...key, revisionId]);
      await audit(client, context.principal.subject, 'BASELINE_ACCEPTED', revisionId, { variantId: value.variantId, screenshotId: shot.id, reason: value.reason.trim(), parentRevision: head.revision_id }, context.requestId);
      return { revisionId };
    });
  }
  async deprecate(id: string, input: unknown, context: RequestContext): Promise<ApiMessages['deprecateResponse']> {
    const checked = validateApiMessage('deprecateRequest', input);
    if (!checked.ok) throw new PlatformError('INVALID_SCHEMA', checked.issues);
    const reason = checked.value.reason.trim();
    if (!reason || reason.length > 2000) throw new PlatformError('INVALID_SCHEMA');
    return this.db.transaction(async client => {
      const row = (await client.query('SELECT vr.availability,v.component_id FROM variant_releases vr JOIN variants v ON v.id=vr.variant_id WHERE vr.id=$1 FOR UPDATE OF vr', [uuid(id)])).rows[0];
      if (!row) throw new PlatformError('NOT_FOUND');
      await requireComponents(client, context.principal.subject, [row.component_id], true);
      if (row.availability !== 'Ready' && row.availability !== 'DEPRECATED') throw new PlatformError('CONFLICT');
      if (row.availability === 'Ready') {
        await client.query("UPDATE variant_releases SET availability='DEPRECATED',deprecated_reason=$2 WHERE id=$1", [id, reason]);
        await audit(client, context.principal.subject, 'VARIANT_DEPRECATED', id, { reason }, context.requestId);
      }
      return { variantReleaseId: id, status: 'DEPRECATED' };
    });
  }
}
