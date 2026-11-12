import { createHash, randomBytes } from 'node:crypto';
import { previewOriginFor, validateApiMessage, type PreviewConfig, type ApiMessages } from '@company/contracts';
import type { Database } from '../db/database.js';
import { audit, uuid, type RequestContext } from '../db/access.js';
import { PlatformError } from '../errors.js';

export class PreviewService {
  constructor(private readonly db: Database, private readonly config?: PreviewConfig) {}
  async create(input: unknown, context: RequestContext): Promise<ApiMessages['previewGrantResponse']> {
    const parsed = validateApiMessage('previewGrantRequest', input);
    if (!parsed.ok) throw new PlatformError('INVALID_SCHEMA', parsed.issues);
    const id = uuid(parsed.value.variantReleaseId);
    if (!this.config) throw new PlatformError('INFRA_UNAVAILABLE');
    const origin = previewOriginFor(id, this.config);
    return this.db.transaction(async sql => {
      if (!(await sql.query('SELECT preview_can_read($1,$2) AS allowed', [id, context.principal.subject])).rows[0]?.allowed) throw new PlatformError('NOT_FOUND', [], true);
      const token = randomBytes(32).toString('base64url');
      const hash = createHash('sha256').update(token).digest('hex');
      const result = await sql.query<{ expires_at: Date }>(`INSERT INTO preview_grants(token_hash,subject,variant_release_id,origin,expires_at)
        VALUES ($1,$2,$3,$4,clock_timestamp()+interval '5 minutes') RETURNING expires_at`, [hash, context.principal.subject, id, origin]);
      await audit(sql, context.principal.subject, 'PREVIEW_GRANTED', id, {}, context.requestId);
      return { bootstrapUrl: `${origin}/bootstrap?grant=${token}`, expiresAt: result.rows[0]!.expires_at.toISOString() };
    });
  }
}
