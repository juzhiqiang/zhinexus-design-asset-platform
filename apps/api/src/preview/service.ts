import { createHash, randomBytes } from 'node:crypto';
import { validateApiMessage, type ApiMessages } from '@company/contracts';
import { previewOriginFor, validatePreviewConfig, type PreviewConfig } from '@company/contracts/preview';
import type { Database } from '../db/database.js';
import { audit, uuid, requireCurrentIdentity, type RequestContext } from '../db/access.js';
import { PlatformError } from '../errors.js';

export class PreviewService {
  constructor(private readonly db: Database, private readonly config?: PreviewConfig) {}
  async create(input: unknown, context: RequestContext): Promise<ApiMessages['previewGrantResponse']> {
    const parsed = validateApiMessage('previewGrantRequest', input);
    if (!parsed.ok) throw new PlatformError('INVALID_SCHEMA', parsed.issues);
    const id = uuid(parsed.value.variantReleaseId);
    if (!this.config) throw new PlatformError('INFRA_UNAVAILABLE');
    return this.db.transaction(async sql => {
      await requireCurrentIdentity(sql,context,'read');
      const states=(await sql.query('SELECT a.section,a.generation,r.config FROM access_active a LEFT JOIN access_revisions r ON r.id=a.active_revision_id ORDER BY a.section FOR SHARE OF a')).rows;
      const preview=states.find(r=>r.section==='preview'),oidc=states.find(r=>r.section==='oidc');
      const config=preview?.config ? validatePreviewConfig({...this.config,...preview.config}) : this.config!;
      const origin = previewOriginFor(id, config);
      if ((context.principal.generation ?? '0') !== oidc?.generation) throw new PlatformError('UNAUTHENTICATED');
      if (!(await sql.query('SELECT preview_can_read($1,$2) AS allowed', [id, context.principal.subject])).rows[0]?.allowed) throw new PlatformError('NOT_FOUND', [], true);
      const token = randomBytes(32).toString('base64url');
      const hash = createHash('sha256').update(token).digest('hex');
      const result = await sql.query<{ expires_at: Date }>(`INSERT INTO preview_grants(token_hash,subject,variant_release_id,origin,expires_at,preview_generation,oidc_generation,read_roles)
        VALUES ($1,$2,$3,$4,clock_timestamp()+interval '5 minutes',$5,$6,$7) RETURNING expires_at`, [hash, context.principal.subject, id, origin,preview?.generation,oidc?.generation,[...new Set(context.principal.roles)]]);
      await audit(sql, context.principal.subject, 'PREVIEW_GRANTED', id, {}, context.requestId);
      return { bootstrapUrl: `${origin}/bootstrap?grant=${token}`, expiresAt: result.rows[0]!.expires_at.toISOString(),mode:config.mode ?? 'domain' };
    });
  }
}
